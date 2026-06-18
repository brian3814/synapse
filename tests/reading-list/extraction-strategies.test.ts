import { describe, it, expect } from 'vitest';
import { selectStrategy, chunkText } from '../../src/core/extraction-strategies';

// ---------------------------------------------------------------------------
// selectStrategy
// ---------------------------------------------------------------------------

describe('selectStrategy', () => {
  it('selects direct for small content (<30KB)', () => {
    const text = 'a'.repeat(10_000); // 10KB
    const result = selectStrategy(text);
    expect(result.strategy).toBe('direct');
    expect(result.reason).toContain('text → direct');
  });

  it('selects direct for content exactly at the threshold', () => {
    const text = 'a'.repeat(30_000); // exactly 30KB
    const result = selectStrategy(text);
    expect(result.strategy).toBe('direct');
  });

  it('selects chunked for medium content (30-200KB)', () => {
    const text = 'a'.repeat(100_000); // 100KB
    const result = selectStrategy(text);
    expect(result.strategy).toBe('chunked');
    expect(result.reason).toContain('text → chunked');
  });

  it('selects chunked for content exactly at the upper threshold', () => {
    const text = 'a'.repeat(200_000); // exactly 200KB
    const result = selectStrategy(text);
    expect(result.strategy).toBe('chunked');
  });

  it('selects map-reduce for large content (>200KB)', () => {
    const text = 'a'.repeat(300_000); // 300KB
    const result = selectStrategy(text);
    expect(result.strategy).toBe('map-reduce');
    expect(result.reason).toContain('text → map-reduce');
  });

  it('selects direct for image files regardless of size', () => {
    const text = 'a'.repeat(500_000); // 500KB — would normally be map-reduce
    const result = selectStrategy(text, { isImage: true });
    expect(result.strategy).toBe('direct');
    expect(result.reason).toBe('image file → direct (vision input)');
  });

  it('respects custom thresholds — lower directThreshold', () => {
    const text = 'a'.repeat(5_000); // 5KB
    // With a custom directThreshold of 2KB, this becomes chunked
    const result = selectStrategy(text, { directThreshold: 2_000, chunkedThreshold: 200_000 });
    expect(result.strategy).toBe('chunked');
  });

  it('respects custom thresholds — lower chunkedThreshold', () => {
    const text = 'a'.repeat(50_000); // 50KB — normally chunked
    // With a custom chunkedThreshold of 40KB, this becomes map-reduce
    const result = selectStrategy(text, { directThreshold: 30_000, chunkedThreshold: 40_000 });
    expect(result.strategy).toBe('map-reduce');
  });

  it('reason strings contain size info for direct', () => {
    const text = 'a'.repeat(15_000); // ~15KB → 15 when Math.round(15000/1000)
    const result = selectStrategy(text);
    expect(result.reason).toMatch(/\d+KB/);
    expect(result.reason).toContain('direct');
  });

  it('reason strings contain size info for chunked', () => {
    const text = 'a'.repeat(50_000);
    const result = selectStrategy(text);
    expect(result.reason).toMatch(/\d+KB/);
    expect(result.reason).toContain('chunked');
  });

  it('reason strings contain size info for map-reduce', () => {
    const text = 'a'.repeat(250_000);
    const result = selectStrategy(text);
    expect(result.reason).toMatch(/\d+KB/);
    expect(result.reason).toContain('map-reduce');
  });
});

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns single chunk for small text', () => {
    const text = 'Hello, world!\nThis is a small document.';
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text.trim());
  });

  it('splits on headings (## heading)', () => {
    const text = [
      'Intro paragraph.',
      '\n## Section One',
      '\nContent of section one.',
      '\n## Section Two',
      '\nContent of section two.',
    ].join('');

    const chunks = chunkText(text, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some(c => c.includes('Section One'))).toBe(true);
    expect(chunks.some(c => c.includes('Section Two'))).toBe(true);
  });

  it('splits on # h1 headings', () => {
    const text = 'Intro.\n# Chapter One\nText.\n# Chapter Two\nMore text.';
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits on ### h3 headings', () => {
    const text = 'Lead.\n### Sub One\nDetails.\n### Sub Two\nMore.';
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits on form feed character', () => {
    const text = 'Page one content.\fPage two content.\fPage three.';
    const chunks = chunkText(text, 100);
    // With maxChunkSize=100, sections are small enough that they may accumulate,
    // but form feeds should cause boundaries
    const allText = chunks.join(' ');
    expect(allText).toContain('Page one');
    expect(allText).toContain('Page two');
    expect(allText).toContain('Page three');
  });

  it('splits oversized chunks by paragraphs', () => {
    // Build a chunk that's too large — no headings, just paragraphs
    const para = 'word '.repeat(500); // ~2500 chars each
    const text = [para, para, para, para].join('\n\n'); // ~10KB with separators

    const chunks = chunkText(text, 3_000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Each chunk should be within a reasonable bound
      expect(chunk.length).toBeLessThanOrEqual(3_000 + para.length + 2); // allow up to para overhang
    }
  });

  it('trims whitespace from chunks', () => {
    const text = '  \n  Leading spaces  \n## Section\n  content  \n  ';
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
    }
  });

  it('filters empty chunks', () => {
    const text = '\n\n\n## Empty between headings\n\n## Another\n\ncontent';
    const chunks = chunkText(text);
    expect(chunks.every(c => c.length > 0)).toBe(true);
  });

  it('handles empty string input', () => {
    const chunks = chunkText('');
    expect(chunks).toHaveLength(0);
  });

  it('handles whitespace-only input', () => {
    const chunks = chunkText('   \n   \n   ');
    expect(chunks).toHaveLength(0);
  });

  it('respects custom maxChunkSize', () => {
    // 3 sections of ~100 chars each; with limit 150 two fit in one chunk
    const section = 'x'.repeat(90);
    const text = `${section}\n## A\n${section}\n## B\n${section}`;
    const chunksSmall = chunkText(text, 50);
    const chunksLarge = chunkText(text, 1_000);
    expect(chunksSmall.length).toBeGreaterThan(chunksLarge.length);
  });
});
