export const version = 12;
export const description = 'Add content_hash column for rename detection';

export const up = `
ALTER TABLE nodes ADD COLUMN content_hash TEXT;
`;
