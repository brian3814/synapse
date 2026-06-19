import { describe, it, expect } from 'vitest';
import { generateEntityMarkdown, parseEntityFrontmatter, rewriteTitle } from '../../electron/entity-files/entity-markdown';

describe('generateEntityMarkdown', () => {
  it('generates frontmatter with id and title', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Machine Learning',
      summary: 'A branch of AI.',
      edges: [],
      sources: [],
    });
    expect(md).toContain('---\nid: abc-123\ntitle: Machine Learning\n---');
    expect(md).toContain('# Machine Learning');
    expect(md).toContain('A branch of AI.');
  });

  it('renders relationships section from edges', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Machine Learning',
      summary: null,
      edges: [
        { targetName: 'Neural Networks', label: 'foundational_architecture', direction: 'outgoing' },
        { sourceName: 'Alan Turing', label: 'contributed_to', direction: 'incoming' },
      ],
      sources: [],
    });
    expect(md).toContain('## Relationships');
    expect(md).toContain('- [[Neural Networks]] — *foundational_architecture*');
    expect(md).toContain('- [[Alan Turing]] → *contributed_to*');
  });

  it('renders sources section', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Machine Learning',
      summary: null,
      edges: [],
      sources: [{ name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/ML' }],
    });
    expect(md).toContain('## Sources');
    expect(md).toContain('- [Wikipedia](https://en.wikipedia.org/wiki/ML)');
  });

  it('omits empty sections', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Test',
      summary: null,
      edges: [],
      sources: [],
    });
    expect(md).not.toContain('## Relationships');
    expect(md).not.toContain('## Sources');
  });
});

describe('parseEntityFrontmatter', () => {
  it('extracts id and title from frontmatter', () => {
    const result = parseEntityFrontmatter('---\nid: abc-123\ntitle: Machine Learning\n---\n\n# Body');
    expect(result).toEqual({ id: 'abc-123', title: 'Machine Learning' });
  });

  it('falls back to H1 when no frontmatter', () => {
    const result = parseEntityFrontmatter('# Some Heading\n\nSome text');
    expect(result).toEqual({ id: null, title: 'Some Heading' });
  });

  it('returns null title when no frontmatter and no H1', () => {
    const result = parseEntityFrontmatter('Just plain text');
    expect(result).toEqual({ id: null, title: null });
  });

  it('returns null id when frontmatter has no id field', () => {
    const result = parseEntityFrontmatter('---\ntitle: Something\n---\n\nBody');
    expect(result).toEqual({ id: null, title: 'Something' });
  });
});

describe('rewriteTitle', () => {
  it('replaces title in frontmatter', () => {
    const content = '---\nid: abc\ntitle: Old Title\n---\n\n# Old Title\n\nBody';
    const result = rewriteTitle(content, 'New Title');
    expect(result).toContain('title: New Title');
    expect(result).toContain('id: abc');
    expect(result).toContain('# Old Title'); // body unchanged
  });
});
