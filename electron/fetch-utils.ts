import { htmlToMarkdown } from '../src/shared/html-to-markdown';
import { isBlockedUrl } from '../src/offscreen/url-utils';

const DEFAULT_FETCH_MAX_BYTES = 20_000;

export { isBlockedUrl };

export async function fetchAndCleanContent(
  url: string,
  maxBytes: number = DEFAULT_FETCH_MAX_BYTES
): Promise<{ content: string; error?: string }> {
  if (isBlockedUrl(url)) {
    return { content: '', error: 'Blocked: requests to private/internal network addresses are not allowed' };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { content: '', error: `Fetch failed: ${response.status} ${response.statusText}` };
    }
    const html = await response.text();

    let markdown = htmlToMarkdown(html);
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    const truncated =
      markdown.length > maxBytes
        ? markdown.substring(0, maxBytes) + '\n\n...[truncated]'
        : markdown;
    return { content: truncated };
  } catch (e: any) {
    return { content: '', error: `Failed to fetch URL: ${e.message}` };
  }
}
