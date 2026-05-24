const STOP_WORDS = new Set([
  'what', 'who', 'where', 'when', 'why', 'how', 'is', 'are', 'was', 'were',
  'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'will', 'shall', 'may', 'might', 'the', 'a', 'an', 'and', 'or', 'but', 'in',
  'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about', 'between',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'they', 'them', 'their',
  'it', 'its', 'this', 'that', 'these', 'those', 'know', 'tell', 'give',
  'find', 'show', 'get', 'all', 'any', 'some', 'every', 'each', 'much',
  'many', 'more', 'most', 'other', 'another', 'such', 'no', 'not', 'only',
  'very', 'just', 'also', 'than', 'too', 'so', 'if', 'then', 'because',
  'while', 'although', 'though', 'even', 'still', 'already', 'yet',
]);

export function extractSearchTerms(question: string): string[] {
  const quotedPhrases: string[] = [];
  const withoutQuotes = question.replace(/"([^"]+)"/g, (_, phrase) => {
    quotedPhrases.push(phrase.trim());
    return '';
  });

  const words = withoutQuotes
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return [...quotedPhrases, ...words];
}
