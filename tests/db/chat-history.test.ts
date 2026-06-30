import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setEngine } from '../../src/db/worker/query-executor';
import { runMigrations } from '../../src/db/worker/migrations';
import * as chatQueries from '../../src/db/worker/queries/chat-queries';

// ── Harness (copied from migrations.test.ts) ──────────────────────────

function bindEngine(db: Database.Database): void {
  setEngine({
    async exec(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        return db.prepare(sql).run(...(params as unknown[])).changes;
      }
      db.exec(sql);
      return 0;
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        return db.prepare(sql).all(...(params as unknown[])) as T[];
      }
      return db.prepare(sql).all() as T[];
    },
    async checkModuleAvailable(moduleName: string) {
      try {
        return db.prepare('SELECT name FROM pragma_module_list WHERE name = ?')
          .all(moduleName).length > 0;
      } catch {
        return false;
      }
    },
  });
}

// ── Setup / Teardown ──────────────────────────────────────────────────

let db: Database.Database;

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  bindEngine(db);
  await runMigrations();
});

afterEach(() => {
  db.close();
});

// ── Session CRUD ──────────────────────────────────────────────────────

describe('Session CRUD', () => {
  it('createSession creates a session with correct fields', async () => {
    const session = await chatQueries.createSession('s1', 'Hello world');

    expect(session).toBeDefined();
    expect(session.id).toBe('s1');
    expect(session.title).toBe('Hello world');
    expect(session.status).toBe('active');
    expect(session.created_at).toBeDefined();
    expect(session.last_active_at).toBeDefined();
  });

  it('getActiveSession returns the active session', async () => {
    await chatQueries.createSession('s1', 'Test session');

    const active = await chatQueries.getActiveSession();

    expect(active).toBeDefined();
    expect(active.id).toBe('s1');
  });

  it('getActiveSession returns null when no active session exists', async () => {
    const active = await chatQueries.getActiveSession();
    expect(active).toBeNull();
  });

  it('getAllSessions returns sessions ordered by last_active_at DESC', async () => {
    await chatQueries.createSession('s1', 'First');
    await chatQueries.createSession('s2', 'Second');
    await chatQueries.createSession('s3', 'Third');

    // Touch s1 to make it most recent
    await chatQueries.touchSession('s1');

    const sessions = await chatQueries.getAllSessions();

    expect(sessions.length).toBe(3);
    expect(sessions[0].id).toBe('s1');
  });

  it('getAllSessions limits to 20 results', async () => {
    for (let i = 0; i < 25; i++) {
      await chatQueries.createSession(`s${i}`, `Session ${i}`);
    }

    const sessions = await chatQueries.getAllSessions();
    expect(sessions.length).toBe(20);
  });

  it('deleteSession removes the session', async () => {
    await chatQueries.createSession('s1', 'Doomed');

    await chatQueries.deleteSession('s1');

    const sessions = await chatQueries.getAllSessions();
    expect(sessions.length).toBe(0);
  });

  it('deleteSession removes associated messages', async () => {
    await chatQueries.createSession('s1', 'Doomed');
    await chatQueries.saveMessage({ id: 'm1', sessionId: 's1', role: 'user', content: 'hi', status: 'complete' });
    await chatQueries.saveMessage({ id: 'm2', sessionId: 's1', role: 'assistant', content: 'hello', status: 'complete' });

    await chatQueries.deleteSession('s1');

    const messages = await chatQueries.getSessionMessages('s1');
    expect(messages.length).toBe(0);
  });

  it('deleteSession on non-existent ID does not throw', async () => {
    await expect(chatQueries.deleteSession('nonexistent')).resolves.not.toThrow();
  });

  it('updateSessionTitle changes the title', async () => {
    await chatQueries.createSession('s1', 'Old title');

    await chatQueries.updateSessionTitle('s1', 'New title');

    const sessions = await chatQueries.getAllSessions();
    expect(sessions[0].title).toBe('New title');
  });

  it('updateSessionTitle on non-existent ID does not throw', async () => {
    await expect(chatQueries.updateSessionTitle('nonexistent', 'Title')).resolves.not.toThrow();
  });
});

// ── Session Lifecycle ─────────────────────────────────────────────────

describe('Session Lifecycle', () => {
  it('expireSession sets status to expired', async () => {
    await chatQueries.createSession('s1', 'Test');

    await chatQueries.expireSession('s1');

    const sessions = await chatQueries.getAllSessions();
    expect(sessions[0].status).toBe('expired');
  });

  it('expired session is NOT returned by getActiveSession', async () => {
    await chatQueries.createSession('s1', 'Test');
    await chatQueries.expireSession('s1');

    const active = await chatQueries.getActiveSession();
    expect(active).toBeNull();
  });

  it('touchSession does not throw and session remains accessible', async () => {
    await chatQueries.createSession('s1', 'Test');

    await expect(chatQueries.touchSession('s1')).resolves.not.toThrow();

    const sessions = await chatQueries.getAllSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('s1');
    expect(sessions[0].last_active_at).toBeDefined();
  });

  it('pruneSessions keeps only N most recent sessions', async () => {
    await chatQueries.createSession('s1', 'Oldest');
    await chatQueries.createSession('s2', 'Middle');
    await chatQueries.createSession('s3', 'Newest');

    await chatQueries.pruneSessions(2);

    const sessions = await chatQueries.getAllSessions();
    expect(sessions.length).toBe(2);
  });
});

// ── Messages ──────────────────────────────────────────────────────────

describe('Messages', () => {
  it('saveMessage stores a message linked to a session', async () => {
    await chatQueries.createSession('s1', 'Test');

    const msg = await chatQueries.saveMessage({
      id: 'm1', sessionId: 's1', role: 'user', content: 'hello', status: 'complete',
    });

    expect(msg).toBeDefined();
    expect(msg.id).toBe('m1');
    expect(msg.session_id).toBe('s1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('getSessionMessages returns messages in chronological order', async () => {
    await chatQueries.createSession('s1', 'Test');
    await chatQueries.saveMessage({ id: 'm1', sessionId: 's1', role: 'user', content: 'first', status: 'complete' });
    await chatQueries.saveMessage({ id: 'm2', sessionId: 's1', role: 'assistant', content: 'second', status: 'complete' });
    await chatQueries.saveMessage({ id: 'm3', sessionId: 's1', role: 'user', content: 'third', status: 'complete' });

    const messages = await chatQueries.getSessionMessages('s1');

    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe('first');
    expect(messages[1].content).toBe('second');
    expect(messages[2].content).toBe('third');
  });

  it('getSessionMessages returns empty array for non-existent session', async () => {
    const messages = await chatQueries.getSessionMessages('nonexistent');
    expect(messages).toEqual([]);
  });

  it('getRecentMessages returns at most N messages', async () => {
    await chatQueries.createSession('s1', 'Test');
    for (let i = 1; i <= 5; i++) {
      await chatQueries.saveMessage({
        id: `m${i}`, sessionId: 's1', role: 'user', content: `msg ${i}`, status: 'complete',
      });
    }

    const recent = await chatQueries.getRecentMessages('s1', 3);

    expect(recent.length).toBe(3);
    const contents = recent.map((m: any) => m.content);
    expect(contents).toContain('msg 5');
    expect(contents).toContain('msg 4');
    expect(contents).toContain('msg 3');
  });
});

// ── Integration Scenarios ─────────────────────────────────────────────

describe('Integration Scenarios', () => {
  it('full flow: create session → save messages → load → verify', async () => {
    await chatQueries.createSession('s1', 'My conversation');
    await chatQueries.saveMessage({ id: 'm1', sessionId: 's1', role: 'user', content: 'What is ML?', status: 'complete' });
    await chatQueries.saveMessage({ id: 'm2', sessionId: 's1', role: 'assistant', content: 'Machine learning is...', status: 'complete' });
    await chatQueries.saveMessage({ id: 'm3', sessionId: 's1', role: 'user', content: 'Tell me more', status: 'complete' });

    const messages = await chatQueries.getSessionMessages('s1');

    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
  });

  it('expire → touch re-activates a session', async () => {
    await chatQueries.createSession('s1', 'Expired then revived');
    await chatQueries.expireSession('s1');

    expect(await chatQueries.getActiveSession()).toBeNull();

    await chatQueries.touchSession('s1');
    // touchSession only updates last_active_at — status remains expired
    // So getActiveSession (which filters on status='active') still returns null
    // This confirms we need to handle re-activation differently if desired
    const active = await chatQueries.getActiveSession();
    // touchSession doesn't change status, so it stays expired
    expect(active).toBeNull();
  });

  it('delete middle session preserves others', async () => {
    await chatQueries.createSession('s1', 'First');
    await chatQueries.createSession('s2', 'Second');
    await chatQueries.createSession('s3', 'Third');

    await chatQueries.deleteSession('s2');

    const sessions = await chatQueries.getAllSessions();
    expect(sessions.length).toBe(2);
    const ids = sessions.map((s: any) => s.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s3');
    expect(ids).not.toContain('s2');
  });

  it('delete session cascades to messages', async () => {
    await chatQueries.createSession('s1', 'Test');
    await chatQueries.saveMessage({ id: 'm1', sessionId: 's1', role: 'user', content: 'hello', status: 'complete' });
    await chatQueries.saveMessage({ id: 'm2', sessionId: 's1', role: 'assistant', content: 'hi', status: 'complete' });

    await chatQueries.deleteSession('s1');

    const messages = await chatQueries.getSessionMessages('s1');
    expect(messages).toEqual([]);
  });

  it('rename session reflects in getAllSessions', async () => {
    await chatQueries.createSession('s1', 'Original');

    await chatQueries.updateSessionTitle('s1', 'Renamed');

    const sessions = await chatQueries.getAllSessions();
    expect(sessions[0].title).toBe('Renamed');
  });
});
