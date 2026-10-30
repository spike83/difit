import { describe, expect, it } from 'vitest';

import { markdownToHtml } from './markdownToHtml';

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
