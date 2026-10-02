import { AppWindow, ChartColumn, FileText, Image, Table2, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';

import type { EditorLanguage } from '../CodeEditor';

export type ArtifactKindName = 'html' | 'markdown' | 'svg' | 'mermaid' | 'chart' | 'table';

/** How each kind is named and drawn, in words a person uses, and how it's edited. */
export const ARTIFACT_KINDS: Record<
  ArtifactKindName,
  { label: string; icon: ReactNode; language: string; editor: EditorLanguage }
> = {
  html: { label: 'Page', icon: <AppWindow />, language: 'html', editor: 'html' },
  markdown: { label: 'Document', icon: <FileText />, language: 'markdown', editor: 'markdown' },
  svg: { label: 'Picture', icon: <Image />, language: 'xml', editor: 'xml' },
  mermaid: { label: 'Diagram', icon: <Workflow />, language: 'text', editor: 'mermaid' },
  chart: { label: 'Chart', icon: <ChartColumn />, language: 'json', editor: 'json' },
  table: { label: 'Table', icon: <Table2 />, language: 'text', editor: 'csv' },
};
