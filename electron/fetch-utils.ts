import { htmlToMarkdown } from '../src/shared/html-to-markdown';
import { isBlockedUrl } from '../src/offscreen/url-utils';

const DEFAULT_FETCH_MAX_BYTES = 20_000;

export { isBlockedUrl };

export async function fetchAndCleanContent(
  url: string,
  maxBytes: number = DEFAULT_FETCH_MAX_BYTES
): Promise<{ content: string; error?: string; blocked?: boolean }> {
  if (isBlockedUrl(url)) {
    return { content: '', error: 'Blocked: requests to private/internal network addresses are not allowed' };
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      const blocked = response.status === 403 || response.status === 401 || response.status === 429;
      return { content: '', error: `Fetch failed: ${response.status} ${response.statusText}`, blocked };
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
