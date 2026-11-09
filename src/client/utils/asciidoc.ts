import DOMPurify from 'dompurify';

import type { MarkdownBlock } from './markdownBlocks';

/** Blocks of one side and the HTML of each rendered block. */
export interface PreparedBlocks {
  old: MarkdownBlock[];
  new: MarkdownBlock[];
  html: Map<MarkdownBlock, string>;
}

/** Where a side's file lives, so includes and images can be fetched at that version. */
export interface AsciidocSource {
  path: string;
  ref?: string;
}

const DELIMITER = /^(?:-{4,}|={4,}|\*{4,}|\+{4,}|\.{4,}|_{4,}|\/{4,}|[|,:!]={3,}|--)$/;
const DOCUMENT_TITLE = /^=\s+\S/;
const SECTION_TITLE = /^={2,6}\s+\S/;
const LIST_ITEM = /^\s*(?:[*-]+|\.+|\d+\.|<\d+>)\s+\S/;
// Block attribute lists, anchors and block titles belong to the block below them.
const BLOCK_PREFIX = /^(?:\[.*\]|\.[^.\s].*)$/;
const ATTRIBUTE_ENTRY = /^:!?\w[\w-]*!?:(?:\s|$)/;
const INCLUDE = /^include::(\S*)\[.*\]$/;
const LINE_COMMENT = /^\/\/(?!\/\/)/;

const isMetadataLine = (line: string) =>
  ATTRIBUTE_ENTRY.test(line) || INCLUDE.test(line) || LINE_COMMENT.test(line);

const delimitedKind = (delimiter: string): MarkdownBlock['kind'] => {
  if (/^[|,:!]/.test(delimiter)) return 'table';
  if (/^[-.]{4}/.test(delimiter)) return 'code';
  if (delimiter.startsWith('/')) return 'definition';
  return 'paragraph';
};

/**
 * Splits AsciiDoc into the blocks the previews align and render one by one: the document
 * header, section titles, list items, delimited blocks and paragraphs. Attribute entries,
 * includes and comments become 'definition' blocks, which show as source.
 */
export function parseAsciidocBlocks(text: string): MarkdownBlock[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const blocks: MarkdownBlock[] = [];
  let prefixStart: number | null = null;
  let index = 0;

  const push = (kind: MarkdownBlock['kind'], start: number, end: number) => {
    blocks.push({
      kind,
      startLine: start + 1,
      endLine: end + 1,
      source: lines.slice(start, end + 1).join('\n'),
    });
  };
  const runUntil = (from: number, stop: (line: string) => boolean) => {
    let end = from;
    while (end + 1 < lines.length && lines[end + 1]?.trim() && !stop(lines[end + 1] ?? '')) end++;
    return end;
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      if (prefixStart !== null) push('definition', prefixStart, index - 1);
      prefixStart = null;
      index++;
      continue;
    }
    if (BLOCK_PREFIX.test(line) && !DELIMITER.test(line)) {
      prefixStart ??= index;
      index++;
      continue;
    }
    const start = prefixStart ?? index;
    prefixStart = null;

    if (DELIMITER.test(line)) {
      let end = index + 1;
      while (end < lines.length && lines[end] !== line) end++;
      end = Math.min(end, lines.length - 1);
      push(delimitedKind(line), start, end);
      index = end + 1;
    } else if (DOCUMENT_TITLE.test(line) && blocks.every((block) => block.kind === 'definition')) {
      // The header: title, author and revision lines, attribute entries.
      const end = runUntil(index, () => false);
      push('heading', start, end);
      index = end + 1;
    } else if (SECTION_TITLE.test(line)) {
      push('heading', start, index);
      index++;
    } else if (isMetadataLine(line)) {
      const end = runUntil(index, (next) => !isMetadataLine(next));
      push('definition', start, end);
      index = end + 1;
    } else if (LIST_ITEM.test(line)) {
      const end = runUntil(
        index,
        (next) => LIST_ITEM.test(next) || DELIMITER.test(next) || BLOCK_PREFIX.test(next),
      );
      push('listItem', start, end);
      index = end + 1;
    } else {
      const end = runUntil(
        index,
        (next) => DELIMITER.test(next) || SECTION_TITLE.test(next) || BLOCK_PREFIX.test(next),
      );
      push('paragraph', start, end);
      index = end + 1;
    }
  }
  if (prefixStart !== null) push('definition', prefixStart, lines.length - 1);

  return blocks;
}

const dirname = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** Joins a relative path onto a directory; null if it climbs out of the repository. */
export const resolveRepoPath = (dir: string, relative: string): string | null => {
  const parts: string[] = [];
  for (const part of `${dir}${relative}`.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (part && part !== '.') {
      parts.push(part);
    }
  }
  return parts.join('/');
};

const isFetchableRef = (ref?: string): ref is string => Boolean(ref && ref !== 'stdin');

const blobUrl = (path: string, ref: string) =>
  `/api/blob/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;

const fetchText = async (path: string, ref: string) => {
  const response = await fetch(blobUrl(path, ref));
  return response.ok ? response.text() : null;
};

/** The attribute entries an included file sets, following its own includes. */
const includedAttributes = async (
  path: string,
  ref: string,
  depth: number,
  cache: Map<string, Promise<string[]>>,
): Promise<string[]> => {
  const key = `${ref}:${path}`;
  let entries = cache.get(key);
  if (!entries) {
    entries = (async () => {
      const text = await fetchText(path, ref);
      return text ? attributeLines(text, { path, ref }, depth + 1, cache) : [];
    })();
    cache.set(key, entries);
  }
  return entries;
};

const attributeLines = async (
  text: string,
  source: AsciidocSource,
  depth: number,
  cache: Map<string, Promise<string[]>>,
): Promise<string[]> => {
  const result: string[] = [];
  for (const line of text.split('\n').map((l) => l.replace(/\r$/, ''))) {
    if (ATTRIBUTE_ENTRY.test(line)) {
      result.push(line);
      continue;
    }
    const target = INCLUDE.exec(line)?.[1];
    if (target && depth < 3 && isFetchableRef(source.ref) && !target.includes('{')) {
      const included = resolveRepoPath(dirname(source.path), target);
      if (included) result.push(...(await includedAttributes(included, source.ref, depth, cache)));
    }
  }
  return result;
};

/** Points relative image paths at the blob API, at the version the side was read from. */
const resolveImages = (html: string, source: AsciidocSource) =>
  html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (match, before, src: string, after) => {
    if (!isFetchableRef(source.ref) || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return match;
    const path = resolveRepoPath(dirname(source.path), src);
    return path ? `${before}${blobUrl(path, source.ref)}${after}` : match;
  });

// Asciidoctor is large, so it loads with the first AsciiDoc preview. 'secure' ignores
// includes; DOMPurify drops what passthrough blocks could inject.
export const renderAsciidoc = async (asciidoc: string): Promise<string> => {
  const { convert } = await import('@asciidoctor/core');
  const html = await convert(asciidoc, { safe: 'secure', attributes: { showtitle: true } });
  return DOMPurify.sanitize(String(html));
};

const renderCache = new Map<string, Promise<string>>();

const renderCached = (asciidoc: string, source: AsciidocSource) => {
  const key = `${source.ref ?? ''}\u0000${source.path}\u0000${asciidoc}`;
  let html = renderCache.get(key);
  if (!html) {
    html = renderAsciidoc(asciidoc).then((rendered) => resolveImages(rendered, source));
    renderCache.set(key, html);
  }
  return html;
};

/**
 * Parses one side and renders each block on its own. Every block gets the attribute
 * entries set above it, including those from included files, so settings like
 * `imagesdir` reach the whole document.
 */
export async function prepareAsciidocSide(
  content: string | null,
  source: AsciidocSource,
  html: Map<MarkdownBlock, string>,
): Promise<MarkdownBlock[]> {
  if (content === null) return [];
  const blocks = parseAsciidocBlocks(content);
  const includes = new Map<string, Promise<string[]>>();
  const attributes: string[] = [];
  const renders: Promise<void>[] = [];

  for (const block of blocks) {
    const prelude = attributes.join('\n');
    const ownAttributes = await attributeLines(block.source, source, 0, includes);
    if (block.kind !== 'definition') {
      // Include lines would render as links in secure mode; their attributes stand in.
      const body = block.source
        .split('\n')
        .filter((line) => !INCLUDE.test(line))
        .join('\n');
      const asciidoc = DOCUMENT_TITLE.test(body)
        ? [body.split('\n')[0], prelude, ...ownAttributes].join('\n')
        : `${prelude}\n\n${body}`;
      renders.push(
        renderCached(asciidoc, source).then((rendered) => {
          html.set(block, rendered);
        }),
      );
    }
    attributes.push(...ownAttributes);
  }
  await Promise.all(renders);

  return blocks;
}
