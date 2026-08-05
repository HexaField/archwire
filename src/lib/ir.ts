// The intermediate representation (IR): one typed property graph.
// Every view projects from this single model. Extractors emit it;
// the app renders it. Structural edges come only from static analysis.

export interface IrNode {
  id: string; // stable id — a repo-relative path for files/dirs
  label: string; // display name (basename)
  kind: 'file' | 'dir';
  parent?: string; // compound-parent id (the containing dir)
  fanIn?: number;
  fanOut?: number;
  loc?: number;
}

export interface IrEdge {
  source: string;
  target: string;
  cyclic?: boolean; // participates in a circular dependency (SCC > 1)
}

export interface IrMeta {
  target: string;
  generatedFrom: string;
  fileCount: number;
  edgeCount: number;
  cycleCount: number;
}

export interface IrModel {
  nodes: IrNode[];
  edges: IrEdge[];
  meta: IrMeta;
}
