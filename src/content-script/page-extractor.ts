/**
 * Return the cleaned content-bearing DOM element for the page.
 * Used by both text extraction (innerText) and markdown extraction (Turndown).
 */
export function extractContentElement(): { title: string; url: string; element: HTMLElement } {
  const title = document.title || '';
  const url = window.location.href;

  const article =
    document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('main') ||
    document.querySelector('.post-content') ||
    document.querySelector('.article-content') ||
    document.querySelector('.entry-content');

  if (article) {
    return { title, url, element: article.cloneNode(true) as HTMLElement };
  }

  // Fallback: clone body, remove non-content elements
  const body = document.body.cloneNode(true) as HTMLElement;
  const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'];
  removeSelectors.forEach((sel) => {
    body.querySelectorAll(sel).forEach((el) => el.remove());
  });

  return { title, url, element: body };
}

export function extractPageContent(): { title: string; text: string; url: string } {
  const { title, url, element } = extractContentElement();
  let text = element.innerText;

  // Trim and limit length
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 10000) {
    text = text.substring(0, 10000) + '...';
  }

  return { title, text, url };
}

export function getSelectedText(): string {
  return window.getSelection()?.toString()?.trim() ?? '';
}

/** Lightweight keyword extraction from the current page (no LLM) */
export function extractPageTerms(): { url: string; title: string; terms: string[] } {
  const url = window.location.href;
  const title = document.title || '';
  const terms = new Set<string>();

  // 1. Title words (high signal)
  addSignificantWords(title, terms);

  // 2. Headings (h1-h3)
  document.querySelectorAll('h1, h2, h3').forEach((el) => {
    addSignificantWords((el as HTMLElement).innerText, terms);
  });

  // 3. Meta description
  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
  if (metaDesc) addSignificantWords(metaDesc, terms);

  // 4. Meta keywords
  const metaKeywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content');
  if (metaKeywords) {
    metaKeywords.split(',').forEach((k) => {
      const trimmed = k.trim();
      if (trimmed.length > 1) terms.add(trimmed.toLowerCase());
    });
  }

  // 5. Bold/strong text (likely important entities)
  document.querySelectorAll('strong, b').forEach((el) => {
    const text = (el as HTMLElement).innerText.trim();
    if (text.length > 1 && text.length < 80) {
      terms.add(text.toLowerCase());
    }
  });

  // 6. Proper nouns from first few paragraphs (capitalized multi-word phrases)
  const paragraphs = document.querySelectorAll('p');
  const firstParagraphs = Array.from(paragraphs).slice(0, 5);
  for (const p of firstParagraphs) {
    const text = (p as HTMLElement).innerText;
    // Match capitalized phrases (2+ words starting with caps)
    const properNouns = text.match(/(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g);
    if (properNouns) {
      properNouns.forEach((pn) => {
        if (pn.length > 3 && pn.length < 60) terms.add(pn.toLowerCase());
      });
    }
  }

  return { url, title, terms: Array.from(terms).slice(0, 50) };
}

export interface PageComplexity {
  wordCount: number;
  headingCount: number;
  tableCount: number;
  listCount: number;
  jsonLdCount: number;
}

export function analyzePageComplexity(): PageComplexity {
  const text = document.body.innerText ?? '';
  return {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    headingCount: document.querySelectorAll('h1, h2, h3, h4').length,
    tableCount: document.querySelectorAll('table').length,
    listCount: document.querySelectorAll('ul, ol').length,
    jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
  };
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'this', 'that', 'these', 'those', 'it', 'its', 'not', 'no', 'how', 'what',
  'when', 'where', 'who', 'which', 'why', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very',
  'can', 'just', 'about', 'new', 'also', 'one', 'two', 'first',
]);

function addSignificantWords(text: string, terms: Set<string>): void {
  const words = text.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/);

  // Add individual significant words (3+ chars, not stop words)
  for (const word of words) {
    if (word.length > 3 && !STOP_WORDS.has(word)) {
      terms.add(word);
    }
  }

  // Add multi-word phrases from the text (2-3 word combos)
  const filtered = words.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  for (let i = 0; i < filtered.length - 1; i++) {
    terms.add(`${filtered[i]} ${filtered[i + 1]}`);
  }
}
