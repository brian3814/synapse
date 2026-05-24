import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export function createTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
    emDelimiter: '*',
  });

  td.use(gfm);

  // Safety net: remove common non-content elements Turndown would otherwise convert
  td.remove(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']);

  return td;
}

let _instance: TurndownService | null = null;

function getInstance(): TurndownService {
  if (!_instance) {
    _instance = createTurndownService();
  }
  return _instance;
}

export function htmlToMarkdown(input: string | HTMLElement): string {
  return getInstance().turndown(input);
}
