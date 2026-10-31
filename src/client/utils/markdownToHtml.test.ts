import { afterEach, describe, expect, it, vi } from 'vitest';

import { inlineImages, markdownToHtml } from './markdownToHtml';

describe('markdownToHtml', () => {
  it('renders GitHub-flavored markdown to plain semantic HTML', () => {
    const html = markdownToHtml(
      '# Title\n\nSome **bold** text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
    );

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('class=');
  });

  it('leaves out the YAML frontmatter', () => {
    const html = markdownToHtml('---\ntitle: Doc\n---\n# Body\n');

    expect(html).toBe('<h1>Body</h1>');
  });

  it('drops unsafe link targets', () => {
    const html = markdownToHtml('[x](javascript:alert(1))');

    expect(html).not.toContain('javascript:');
  });
});

describe('inlineImages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('embeds images served by difit as data URLs and leaves external ones alone', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const html = await inlineImages(
      '<p><img src="/api/blob/chart.png?ref=working" alt="chart"><img src="https://example.com/a.png" alt=""></p>',
    );

    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps the original src when the image cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    const html = await inlineImages('<img src="/missing.png" alt="">');

    expect(html).toBe('<img src="/missing.png" alt="">');
  });
});
