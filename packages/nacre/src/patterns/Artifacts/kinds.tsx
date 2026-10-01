import { AppWindow, ChartColumn, FileText, Image, Table2, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';

export type ArtifactKindName = 'html' | 'markdown' | 'svg' | 'mermaid' | 'chart' | 'table';

/** How each kind is named and drawn, in words a person uses. */
export const ARTIFACT_KINDS: Record<
  ArtifactKindName,
  { label: string; icon: ReactNode; language: string }
> = {
  html: { label: 'Page', icon: <AppWindow />, language: 'html' },
  markdown: { label: 'Document', icon: <FileText />, language: 'markdown' },
  svg: { label: 'Picture', icon: <Image />, language: 'xml' },
  mermaid: { label: 'Diagram', icon: <Workflow />, language: 'text' },
  chart: { label: 'Chart', icon: <ChartColumn />, language: 'json' },
  table: { label: 'Table', icon: <Table2 />, language: 'text' },
};
