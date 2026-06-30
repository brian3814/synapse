import { describe, it, expect } from 'vitest';
import type { ReadingListResource, ResourceStatus } from '../../src/shared/reading-list-types';

/**
 * The inbox badge count logic from ActivityBar's InboxBadge component:
 *   Object.values(items).filter(i => i.status === 'ready').length
 *
 * Tests verify the count matches the expected behavior for each status.
 */

function makeItem(id: string, status: ResourceStatus): ReadingListResource {
  return {
    id,
    source: { kind: 'url', url: `https://${id}.com` },
    title: id,
    addedAt: Date.now(),
    status,
  };
}

function inboxBadgeCount(items: Record<string, ReadingListResource>): number {
  return Object.values(items).filter(i => i.status === 'ready').length;
}

describe('Inbox badge count', () => {
  it('returns 0 when no items exist', () => {
    expect(inboxBadgeCount({})).toBe(0);
  });

  it('returns 0 when all items are pending', () => {
    const items = {
      a: makeItem('a', 'pending'),
      b: makeItem('b', 'pending'),
    };
    expect(inboxBadgeCount(items)).toBe(0);
  });

  it('returns 0 when all items are processing', () => {
    const items = {
      a: makeItem('a', 'processing'),
    };
    expect(inboxBadgeCount(items)).toBe(0);
  });

  it('returns 0 when all items are complete (already merged)', () => {
    const items = {
      a: makeItem('a', 'complete'),
      b: makeItem('b', 'complete'),
    };
    expect(inboxBadgeCount(items)).toBe(0);
  });

  it('counts only ready items', () => {
    const items = {
      a: makeItem('a', 'ready'),
      b: makeItem('b', 'ready'),
      c: makeItem('c', 'pending'),
    };
    expect(inboxBadgeCount(items)).toBe(2);
  });

  it('does not count complete items in the badge', () => {
    const items = {
      a: makeItem('a', 'ready'),
      b: makeItem('b', 'complete'),
      c: makeItem('c', 'complete'),
    };
    expect(inboxBadgeCount(items)).toBe(1);
  });

  it('counts correctly with mixed statuses', () => {
    const items = {
      a: makeItem('a', 'pending'),
      b: makeItem('b', 'processing'),
      c: makeItem('c', 'ready'),
      d: makeItem('d', 'complete'),
      e: makeItem('e', 'ready'),
      f: makeItem('f', 'pending'),
    };
    expect(inboxBadgeCount(items)).toBe(2);
  });

  it('updates when item transitions from processing to ready', () => {
    const items: Record<string, ReadingListResource> = {
      a: makeItem('a', 'processing'),
    };
    expect(inboxBadgeCount(items)).toBe(0);

    items.a = { ...items.a, status: 'ready' };
    expect(inboxBadgeCount(items)).toBe(1);
  });

  it('updates when item transitions from ready to complete', () => {
    const items: Record<string, ReadingListResource> = {
      a: makeItem('a', 'ready'),
    };
    expect(inboxBadgeCount(items)).toBe(1);

    items.a = { ...items.a, status: 'complete' };
    expect(inboxBadgeCount(items)).toBe(0);
  });
});
