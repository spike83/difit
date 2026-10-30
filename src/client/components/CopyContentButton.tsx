import { Check, ClipboardCopy } from 'lucide-react';
import { useState } from 'react';

import { copyTextToClipboard } from '../utils/clipboard';

interface CopyContentButtonProps {
  getText: () => string | Promise<string>;
  title: string;
  className?: string;
}

export function CopyContentButton({ getText, title, className = '' }: CopyContentButtonProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleClick = async () => {
    try {
      await copyTextToClipboard(await getText());
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error(`${title} failed:`, err);
    }
  };

  return (
    <button
      type="button"
      className={`bg-transparent border-none cursor-pointer px-1.5 py-1 rounded text-sm transition-all hover:bg-github-bg-tertiary ${
        isCopied
          ? 'text-github-accent'
          : 'text-github-text-secondary hover:text-github-text-primary'
      } ${className}`}
      onClick={() => void handleClick()}
      title={title}
      aria-label={title}
    >
      {isCopied ? <Check size={14} /> : <ClipboardCopy size={14} />}
    </button>
  );
}
