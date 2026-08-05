// The concept model: the high-level semantic layer, extracted from a codebase.
// Concepts are the domain ideas (Agent, Perspective, Neighbourhood…); threads are
// cross-cutting flows that show how a capability pulls concepts together.

export interface ConceptRelation {
  to: string; // concept id
  label: string; // verb: contains | signs | shares | owned by | …
}

export interface Concept {
  id: string;
  name: string;
  summary: string;
  layer: number; // 0 = primitive / foundational … higher = composite / high-level
  pillar: boolean; // an anchor concept a newcomer must grasp first
  parent: string | null; // breakdown hierarchy: the concept this is a sub-part of
  implementedBy: string[]; // repo-relative paths / dirs
  relations: ConceptRelation[];
}

export interface ThreadStep {
  concept: string; // concept id
  code: string; // repo-relative path[:line]
  note: string;
}

export interface Thread {
  id: string;
  name: string;
  summary: string;
  steps: ThreadStep[];
}

export interface ConceptModel {
  system: string;
  summary: string;
  concepts: Concept[];
  threads: Thread[];
}

// The code grounding: each concept's implementedBy paths, expanded into the real
// file tree. A node with `concept` set is the top of that concept's code; deeper
// nodes hang off `parent`. This is the concept→code bridge for the drill-down.
export interface CodeNode {
  id: string; // "code:<repo-relative-path>"
  path: string;
  label: string;
  kind: 'dir' | 'file';
  parent: string | null; // parent code node id
  concept?: string; // set on the top node of a concept's code
}

export interface CodeModel {
  target: string;
  nodes: CodeNode[];
}

// The change model: git PRs / planned deltas for an initiative, each mapped to
// the concepts + code paths it touches, arranged as a branch/PR DAG.
export interface ChangeNode {
  id: string;
  kind: 'pr' | 'planned' | 'merge';
  lane: string;
  ref: string | null;
  title: string;
  status: 'merged' | 'open' | 'draft' | 'planned';
  order: number;
  parents: string[];
  summary: string;
  changedConcepts: string[];
  changedPaths: string[];
}

export interface ChangeLane {
  id: string;
  name: string;
  color: string;
}

export interface ChangeModel {
  initiative: string;
  summary: string;
  lanes: ChangeLane[];
  nodes: ChangeNode[];
}
