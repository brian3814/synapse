/**
 * URL validation and HTML fetching utilities.
 * Extracted from agent-loop.ts for reuse by the reading list extractor.
 */

const DEFAULT_FETCH_MAX_BYTES = 20_000;

/**
 * Returns true if the URL should be blocked (private/internal network, non-HTTP, etc).
 */
export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Block non-HTTP protocols
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true;

    // Block loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0') return true;

    // Block private/internal IP ranges
    if (hostname.startsWith('10.')) return true;
    if (hostname.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;

    // Block link-local and cloud metadata endpoints
    if (hostname.startsWith('169.254.')) return true;
    if (hostname === 'metadata.google.internal') return true;

    return false;
  } catch {
    return true;
  }
}

/**
 * Fetch a URL and return cleaned text content (HTML tags, scripts, styles stripped).
 * @param url - The URL to fetch
 * @param maxBytes - Maximum character length of the returned text (default 20,000)
 */
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
    const text = await response.text();
    // Basic HTML cleaning
    const cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const truncated =
      cleaned.length > maxBytes
        ? cleaned.substring(0, maxBytes) + '...[truncated]'
        : cleaned;
    return { content: truncated };
  } catch (e: any) {
    return { content: '', error: e.message };
  }
}
