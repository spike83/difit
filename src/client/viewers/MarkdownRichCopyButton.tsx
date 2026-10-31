import { Check, ClipboardCopy } from 'lucide-react';
import { useState } from 'react';

import { copyRichTextToClipboard } from '../utils/clipboard';
import { inlineImages, markdownToHtml } from '../utils/markdownToHtml';

export function MarkdownRichCopyButton({ markdown }: { markdown: string }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleClick = async () => {
    try {
      // Local images load in milliseconds, well within the click's user activation.
      const html = await inlineImages(markdownToHtml(markdown));
      await copyRichTextToClipboard(html, markdown);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy rich text:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors duration-200 flex items-center gap-1 cursor-pointer ${
        isCopied
          ? 'text-github-accent'
          : 'text-github-text-secondary hover:text-github-text-primary'
      }`}
      title="Copy the rendered document as rich text"
      aria-label="Copy as rich text"
    >
      {isCopied ? <Check size={14} /> : <ClipboardCopy size={14} />}
      Copy as rich text
    </button>
  );
}
