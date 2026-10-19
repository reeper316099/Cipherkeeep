import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownView } from '../src/components/MarkdownView';
import { mockApi, renderApp } from './helpers';

const lists = {
  '/commands': {
    items: [{ id: 'c1', title: 'ls', name: 'ls', archived: false }],
    total: 1,
    limit: 500,
    offset: 0,
  },
  '/notes': {
    items: [{ id: 'n1', title: 'SSH Guide', archived: false }],
    total: 1,
    limit: 500,
    offset: 0,
  },
};

const render = (src: string) => renderApp(<MarkdownView source={src} />);

describe('MarkdownView sanitisation: XSS payloads stay inert', () => {
  it('drops raw HTML, scripts and event handlers', () => {
    mockApi(lists);
    const { container } = render(
      '<script>window.__pwned=1</script>\n\n<img src=x onerror="window.__pwned=1">\n\n<a href="javascript:alert(1)" onclick="x()">raw</a>\n\n<iframe src="https://evil.test"></iframe>',
    );
    expect(container.querySelector('script, iframe, img, [onerror], [onclick]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('neutralises dangerous link and image URLs written in Markdown', () => {
    mockApi(lists);
    const { container } = render(
      '[js](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [vb](vbscript:x) [ok](https://example.com)\n\n![x](http://tracker.test/p.png) ![y](data:image/svg+xml;base64,AAAA) ![z](javascript:alert(1))',
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com']);
    expect(container.querySelector('img')).toBeNull(); // no remote or data: images
    expect(container.textContent).toContain('remote image blocked');
  });

  it('opens external links safely', () => {
    mockApi(lists);
    const { container } = render('[site](https://example.com)');
    const a = container.querySelector('a')!;
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('does not let user markup spoof our internal wiki or callout classes', () => {
    mockApi(lists);
    const { container } = render(
      '<div class="callout callout-tip" style="position:fixed;inset:0">x</div>\n\n[sneaky](ck-wiki:%7B%22target%22%3A%22x%22%7D)',
    );
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelector('.callout')).toBeNull();
  });
});

describe('MarkdownView features', () => {
  it('resolves [[wiki links]] and [[cmd:…]] to routes, marks missing ones, ignores code and glob classes', async () => {
    mockApi(lists);
    const { container } = render(
      'See [[SSH Guide]], [[cmd:ls|list files]], [[Nope]], `[[code]]`, and [[:alpha:]].',
    );
    await waitFor(() => expect(container.querySelectorAll('a.wikilink')).toHaveLength(2));
    const links = [...container.querySelectorAll('a.wikilink')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['SSH Guide', '/notes/n1'],
      ['list files', '/commands/c1'],
    ]);
    expect(container.querySelector('.wikilink.missing')?.textContent).toBe('Nope');
    expect(container.textContent).toContain('[[code]]');
    expect(container.textContent).toContain('[[:alpha:]]');
  });

  it('renders GFM tables, task lists, highlighted code and callouts', () => {
    mockApi(lists);
    const { container } = render(
      '| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n```bash\nls -la\n```\n\n> [!TIP]\n> Tab completes.',
    );
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('input[type=checkbox]')).not.toBeNull();
    expect(container.querySelector('code.language-bash')).not.toBeNull();
    expect(container.querySelector('.callout.callout-tip')).not.toBeNull();
    expect(screen.getByText('TIP')).toBeInTheDocument();
  });
});
