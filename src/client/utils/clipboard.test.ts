import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyRichTextToClipboard, copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard when writeText succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await copyTextToClipboard('secure copy');

    expect(writeText).toHaveBeenCalledWith('secure copy');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when writeText rejects', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('insecure context')),
      },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await copyTextToClipboard('fallback copy');

    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});

describe('copyRichTextToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('writes HTML and plain text through navigator.clipboard.write', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: Record<string, Blob | Promise<Blob>>) {}
      },
    );

    await copyRichTextToClipboard(Promise.resolve('<h1>Title</h1>'), '# Title');

    const [[[item]]] = write.mock.calls as [[[{ items: Record<string, Blob | Promise<Blob>> }]]];
    expect(await (await item.items['text/html'])?.text()).toBe('<h1>Title</h1>');
    expect(await (await item.items['text/plain'])?.text()).toBe('# Title');
  });

  it('falls back to a copy event that sets both formats', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} });
    const setData = vi.fn();
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        const event = new Event('copy') as ClipboardEvent;
        Object.defineProperty(event, 'clipboardData', { value: { setData } });
        document.dispatchEvent(event);
        return true;
      }),
    });

    await copyRichTextToClipboard('<p>Body</p>', 'Body');

    expect(setData).toHaveBeenCalledWith('text/html', '<p>Body</p>');
    expect(setData).toHaveBeenCalledWith('text/plain', 'Body');
  });
});
