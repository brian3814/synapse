(() => {
  const title = document.title;
  const url = location.href;

  const clone = document.body.cloneNode(true) as HTMLElement;

  const removeSelectors = [
    'script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    'iframe', 'svg', '.ad', '.ads', '.advertisement',
  ];
  removeSelectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  });

  function extractMarkdown(el: HTMLElement): string {
    const blocks: string[] = [];

    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const text = (child as HTMLElement).innerText?.trim();
      if (!text) continue;

      if (tag.match(/^h[1-6]$/)) {
        const level = parseInt(tag[1]);
        blocks.push('#'.repeat(level) + ' ' + text);
      } else if (tag === 'pre' || tag === 'code') {
        blocks.push('```\n' + text + '\n```');
      } else if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(child.querySelectorAll(':scope > li'));
        items.forEach((li, i) => {
          const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
          blocks.push(prefix + (li as HTMLElement).innerText.trim());
        });
      } else if (tag === 'table') {
        const rows = Array.from(child.querySelectorAll('tr'));
        const tableRows: string[] = [];
        rows.forEach((row, ri) => {
          const cells = Array.from(row.querySelectorAll('th, td'))
            .map((c) => (c as HTMLElement).innerText.trim());
          tableRows.push('| ' + cells.join(' | ') + ' |');
          if (ri === 0) {
            tableRows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
          }
        });
        blocks.push(tableRows.join('\n'));
      } else if (tag === 'a') {
        const href = (child as HTMLAnchorElement).href;
        blocks.push(`[${text}](${href})`);
      } else if (tag === 'img') {
        const src = (child as HTMLImageElement).src;
        const alt = (child as HTMLImageElement).alt || 'image';
        blocks.push(`![${alt}](${src})`);
      } else if (tag === 'blockquote') {
        blocks.push('> ' + text.replace(/\n/g, '\n> '));
      } else {
        if (child.children.length > 3) {
          blocks.push(extractMarkdown(child as HTMLElement));
        } else {
          blocks.push(text);
        }
      }
    }

    return blocks.join('\n\n');
  }

  let content = extractMarkdown(clone);
  content = content.replace(/\n{3,}/g, '\n\n');

  if (content.length > 50_000) {
    content = content.substring(0, 50_000) + '\n\n...[truncated]';
  }

  return { title, url, content };
})();
