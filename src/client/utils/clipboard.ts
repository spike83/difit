function fallbackCopyTextToClipboard(text: string): void {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    throw new Error('Clipboard is unavailable in this environment');
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.setAttribute('aria-hidden', 'true');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '-9999px';
  textArea.style.opacity = '0';

  const selection = document.getSelection();
  const originalRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  document.body.append(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  const didCopy = document.execCommand('copy');

  textArea.remove();

  if (selection && originalRange) {
    selection.removeAllRanges();
    selection.addRange(originalRange);
  }

  activeElement?.focus();

  if (!didCopy) {
    throw new Error('Failed to copy text');
  }
}

function copyRichTextWithCopyEvent(html: string, text: string): void {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    throw new Error('Clipboard is unavailable in this environment');
  }

  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/html', html);
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };
  document.addEventListener('copy', onCopy);
  try {
    if (!document.execCommand('copy')) {
      throw new Error('Failed to copy rich text');
    }
  } finally {
    document.removeEventListener('copy', onCopy);
  }
}

// Puts HTML for rich-text targets and plain text for everything else on the clipboard.
// The copy event goes first: Chromium on Wayland (Brave) drops text/html written through
// navigator.clipboard.write and keeps only the plain text.
export async function copyRichTextToClipboard(html: string, text: string): Promise<void> {
  try {
    copyRichTextWithCopyEvent(html, text);
    return;
  } catch {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.clipboard?.write !== 'function' ||
      typeof ClipboardItem === 'undefined'
    ) {
      throw new Error('Clipboard is unavailable in this environment');
    }
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    }),
  ]);
}

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error('Modern clipboard API is unavailable');
    }

    // Some browsers expose navigator.clipboard on insecure contexts but reject writeText().
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    fallbackCopyTextToClipboard(text);
  }
}
