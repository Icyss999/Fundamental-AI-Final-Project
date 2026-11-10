/**
 * Core data model shared by all three layers.
 *
 * Layer 1 produces a DepGraph and a Partition, Layer 2 attaches a probability to each
 * file id, and Layer 3 plans over (DepGraph, Partition) states.
 */

/** What a file is for. Only "source" files are shown on the diagram by default. */
export type FileRole = "source" | "test" | "story" | "example" | "config" | "declaration";

/** A source file. `id` is its path relative to the project root, using forward slashes. */
export interface FileNode {
  id: string;
  /** Directory part of `id` ("" for files at the project root). */
  dir: string;
  /** File name without directories. */
  name: string;
  role: FileRole;
  /** Non-blank lines. */
  loc: number;
}

/** A resolved import from one project file to another. */
export interface ImportEdge {
  source: string;
  target: string;
  /** True when the import only brings in types (`import type ...`). */
  typeOnly: boolean;
}

export interface DepGraph {
  /** Absolute path of the analysed project. */
  root: string;
  nodes: FileNode[];
  edges: ImportEdge[];
}

/** Key for one file-level import, shared by every layer: `${source}\0${target}`. */
export const importKey = (source: string, target: string) => `${source}\0${target}`;

/** Assignment of every file id to a module (cluster) id. */
export type Partition = Record<string, string>;
