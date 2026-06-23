import { describe, it, expect } from 'vitest';
import { slugify, deriveEntityPath } from '../../electron/entity-files/entity-slug';

describe('slugify', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(slugify('Machine Learning')).toBe('machine_learning');
  });

  it('strips non-alphanumeric except underscore and hyphen', () => {
    expect(slugify('C++ Programming (Advanced)')).toBe('c_programming_advanced');
  });

  it('collapses multiple underscores', () => {
    expect(slugify('foo   bar')).toBe('foo_bar');
  });

  it('trims leading and trailing underscores', () => {
    expect(slugify('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('untitled');
  });

  it('truncates at 200 chars and appends hash suffix for long names', () => {
    const longName = 'a'.repeat(250);
    const result = slugify(longName);
    expect(result.length).toBeLessThanOrEqual(205);
    expect(result).toMatch(/^a{200}_[a-f0-9]{4}$/);
  });

  it('handles unicode by stripping non-ascii', () => {
    expect(slugify('café résumé')).toBe('caf_rsum');
  });
});

describe('deriveEntityPath', () => {
  it('returns entities/{slug}.md', () => {
    expect(deriveEntityPath('Machine Learning')).toBe('entities/machine_learning.md');
  });
});
