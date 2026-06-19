import { createHash } from 'crypto';

const MAX_SLUG_LENGTH = 200;

export function slugify(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!slug) return 'untitled';

  if (slug.length > MAX_SLUG_LENGTH) {
    const hash = createHash('sha256').update(name).digest('hex').slice(0, 4);
    slug = slug.slice(0, MAX_SLUG_LENGTH) + '_' + hash;
  }

  return slug;
}

export function deriveEntityPath(name: string): string {
  return `entities/${slugify(name)}.md`;
}
