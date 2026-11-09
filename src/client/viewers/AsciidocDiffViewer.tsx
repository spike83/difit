import { MarkdownDiffViewer } from './MarkdownDiffViewer';
import type { DiffViewerBodyProps } from './types';

export function AsciidocDiffViewer(props: DiffViewerBodyProps) {
  return <MarkdownDiffViewer {...props} format="asciidoc" />;
}
