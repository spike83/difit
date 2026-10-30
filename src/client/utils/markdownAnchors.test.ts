import { describe, expect, it } from 'vitest';

import { findMarkdownAnchor, slugifyHeading } from './markdownAnchors';

const preview = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
};

describe('slugifyHeading', () => {
  it('builds GitHub-style slugs', () => {
    expect(slugifyHeading('Getting Started')).toBe('getting-started');
    expect(slugifyHeading('API: `--title` & more!')).toBe('api---title--more');
    expect(slugifyHeading('snake_case Über')).toBe('snake_case-über');
  });
});

describe('findMarkdownAnchor', () => {
  it('numbers repeated headings like GitHub', () => {
    const container = preview('<h2 data-md-anchor="usage">a</h2><h2 data-md-anchor="usage">b</h2>');

    expect(findMarkdownAnchor(container, '#usage')?.textContent).toBe('a');
    expect(findMarkdownAnchor(container, '#usage-1')?.textContent).toBe('b');
    expect(findMarkdownAnchor(container, '#missing')).toBeNull();
  });

  it('prefers the new side of the split preview', () => {
    const container = preview(
      '<div data-md-side="old"><h2 data-md-anchor="intro">old</h2></div>' +
        '<div data-md-side="new"><h2 data-md-anchor="intro">new</h2></div>',
    );

    expect(findMarkdownAnchor(container, '#intro')?.textContent).toBe('new');
  });

  it('falls back to the old side for a deleted file and decodes the fragment', () => {
    const container = preview('<div data-md-side="old"><h2 data-md-anchor="über">old</h2></div>');

    expect(findMarkdownAnchor(container, '#%C3%BCber')?.textContent).toBe('old');
  });
});
