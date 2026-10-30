import type React from 'react';

/** GitHub's heading slug: lowercase, punctuation dropped, spaces become hyphens. */
export const slugifyHeading = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');

/**
 * Finds the preview heading a `#fragment` points to. Repeated headings get `-1`, `-2`
 * suffixes like on GitHub. In the split preview only the new side counts, unless the
 * file has no new side.
 */
export const findMarkdownAnchor = (scope: ParentNode, fragment: string): HTMLElement | null => {
  let target = fragment.replace(/^#/, '');
  try {
    target = decodeURIComponent(target);
  } catch {
    // keep the raw fragment
  }
  target = target.toLowerCase();

  const headings = Array.from(scope.querySelectorAll<HTMLElement>('[data-md-anchor]'));
  const newSide = headings.filter((heading) => !heading.closest('[data-md-side="old"]'));
  const counts = new Map<string, number>();
  for (const heading of newSide.length > 0 ? newSide : headings) {
    const slug = heading.dataset.mdAnchor ?? '';
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    if ((count === 0 ? slug : `${slug}-${count}`) === target) return heading;
  }
  return null;
};

/**
 * Click handler for `#fragment` links in a markdown preview or a comment: scrolls to the
 * heading in the same file instead of changing the page URL. `filePath` locates the file
 * when the link sits outside the file's section.
 */
export const handleAnchorLinkClick = (
  event: React.MouseEvent<HTMLAnchorElement>,
  filePath?: string,
) => {
  const href = event.currentTarget.getAttribute('href') ?? '';
  if (!href.startsWith('#')) return;
  event.preventDefault();
  const scope =
    event.currentTarget.closest('[data-file-path]') ??
    (filePath ? document.querySelector(`[data-file-path="${CSS.escape(filePath)}"]`) : null);
  findMarkdownAnchor(scope ?? document, href)?.scrollIntoView({ block: 'start' });
};
