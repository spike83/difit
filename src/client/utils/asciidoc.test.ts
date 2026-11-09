import DOMPurify from 'dompurify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MarkdownBlock } from './markdownBlocks';
import {
  parseAsciidocBlocks,
  prepareAsciidocSide,
  renderAsciidoc,
  resolveRepoPath,
} from './asciidoc';

const summary = (text: string) =>
  parseAsciidocBlocks(text).map(({ kind, startLine, endLine }) => [kind, startLine, endLine]);

const mockBlobs = (blobs: Record<string, string>) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${url.searchParams.get('ref')}:${decodeURIComponent(url.pathname.slice('/api/blob/'.length))}`;
    return new Response(blobs[key] ?? '', { status: key in blobs ? 200 : 404 });
  });

describe('parseAsciidocBlocks', () => {
  it('splits the header, sections, list items and delimited blocks', () => {
    const text = [
      '= Guide', // 1
      ':toc:',
      '',
      '== Setup', // 4
      'Run it.', // 5
      '',
      '* one', // 7
      '* two', // 8
      '  more',
      '',
      '[source,bash]', // 11
      '----',
      'make',
      '',
      'make test',
      '----', // 16
      '',
      '|===', // 18
      '|a |b',
      '|===',
      '',
      ':imagesdir: img', // 22
    ].join('\n');

    expect(summary(text)).toEqual([
      ['heading', 1, 2],
      ['heading', 4, 4],
      ['paragraph', 5, 5],
      ['listItem', 7, 7],
      ['listItem', 8, 9],
      ['code', 11, 16],
      ['table', 18, 20],
      ['definition', 22, 22],
    ]);
  });
});

describe('resolveRepoPath', () => {
  it('joins and normalizes, refusing paths outside the repository', () => {
    expect(resolveRepoPath('src/deck/', '../img/a.svg')).toBe('src/img/a.svg');
    expect(resolveRepoPath('src/', './a/./b.png')).toBe('src/a/b.png');
    expect(resolveRepoPath('src/', '../../a.png')).toBeNull();
  });
});

describe('prepareAsciidocSide', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // happy-dom's parser trips DOMPurify up, so only check that the HTML goes through it
  it('renders through the sanitizer', async () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize').mockImplementation((html) => `clean:${html}`);

    const html = await renderAsciidoc('= Guide\n\n== Setup\n\nRun `make`.');

    expect(sanitize).toHaveBeenCalledOnce();
    expect(html).toMatch(/^clean:<h1>Guide<\/h1>/);
    expect(html).toContain('<code>make</code>');
  });

  it('takes imagesdir from an included header and loads images from the repository', async () => {
    vi.spyOn(DOMPurify, 'sanitize').mockImplementation((html) => String(html));
    mockBlobs({ 'HEAD:src/common/header.adoc': ':imagesdir: ../img/\n' });
    const html = new Map<MarkdownBlock, string>();

    const blocks = await prepareAsciidocSide(
      '= Deck\ninclude::../common/header.adoc[]\n\n== Logo\n\nimage::logo.svg[]',
      { path: 'src/deck/index.adoc', ref: 'HEAD' },
      html,
    );

    const image = blocks.find((block) => block.source.startsWith('image::'));
    expect(image && html.get(image)).toContain(
      `src="/api/blob/${encodeURIComponent('src/img/logo.svg')}?ref=HEAD"`,
    );
    const header = blocks[0];
    expect(header && html.get(header)).not.toContain('include');
  });
});
