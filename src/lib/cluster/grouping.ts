/**
 * Groupings the diagram can show: the folder baseline, the clusters found by search, or the
 * architecture the AI designed (named modules with purposes and tiers). Client-safe.
 */

import type { DepGraph, Partition } from "@/lib/graph/types";
import type { ModuleKind } from "@/lib/graph/kinds";
import { clusterGraph, turboMQ } from "./mq";
import { DEFAULT_SEARCH, placeIsolated, searchPartition, toPartition, type SearchOptions, type SearchStats } from "./search";

export type GroupingKind = "folders" | "clusters" | "ai";

export interface Grouping {
  kind: GroupingKind;
  partition: Partition;
  labels: Record<string, string>;
  /** One line per module (AI architecture). */
  descriptions?: Record<string, string>;
  /** Architectural tier per module: 0 = entry points/UI at the top, higher = foundations. */
  tiers?: Record<string, number>;
  /** What kind of part each module is (AI architecture); the map draws each kind as its own shape. */
  kinds?: Record<string, ModuleKind>;
  mq: number;
}

/** MQ of any partition of `graph`'s files. */
export function partitionMQ(graph: DepGraph, partition: Partition): number {
  const g = clusterGraph(graph);
  const ids = new Map<string, number>();
  return turboMQ(
    g,
    g.ids.map((f) => {
      const m = partition[f] ?? "";
      if (!ids.has(m)) ids.set(m, ids.size);
      return ids.get(m)!;
    }),
  );
}

/** A cluster's name from the folders its files come from: "services", or "services + state". */
export function clusterLabels(partition: Partition, folders: Partition, folderLabels: Record<string, string>): Record<string, string> {
  const members = new Map<string, string[]>();
  for (const [file, c] of Object.entries(partition)) members.set(c, [...(members.get(c) ?? []), file]);
  const labels: Record<string, string> = {};
  const used = new Map<string, number>();
  for (const [c, files] of members) {
    const counts = new Map<string, number>();
    for (const f of files) {
      const label = folderLabels[folders[f]] ?? folders[f] ?? "?";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    let label = ranked[0][1] / files.length >= 0.6 || ranked.length === 1 ? ranked[0][0] : `${ranked[0][0]} + ${ranked[1][0]}`;
    const seen = used.get(label) ?? 0;
    used.set(label, seen + 1);
    if (seen > 0) label = `${label} (${seen + 1})`;
    labels[c] = label;
  }
  return labels;
}

export interface ClusterRun {
  grouping: Grouping;
  folderMQ: number;
  stats: SearchStats;
}

/** Runs the search on the source graph and names the clusters it finds. */
export function clusterProject(graph: DepGraph, folders: { partition: Partition; labels: Record<string, string> }, options: Partial<SearchOptions> = {}): ClusterRun {
  const o = { ...DEFAULT_SEARCH, ...options };
  const g = clusterGraph(graph);
  const folderIds = new Map<string, number>();
  const start =
    o.start === "singletons"
      ? g.ids.map((_, i) => i)
      : g.ids.map((f) => {
          const m = folders.partition[f] ?? "";
          if (!folderIds.has(m)) folderIds.set(m, folderIds.size);
          return folderIds.get(m)!;
        });
  const { assignment, mq, stats } = searchPartition(g, start, o);
  placeIsolated(g, assignment, (f) => folders.partition[f] ?? "");
  const partition = toPartition(g, assignment);
  return {
    grouping: { kind: "clusters", partition, labels: clusterLabels(partition, folders.partition, folders.labels), mq },
    folderMQ: partitionMQ(graph, folders.partition),
    stats,
  };
}

export interface ArchitectureModule {
  name: string;
  purpose: string;
  tier: number;
  kind?: ModuleKind;
  files: string[];
}

/** The AI's architecture as a grouping (module ids "ai-1".. in the order given). */
export function architectureGrouping(graph: DepGraph, modules: readonly ArchitectureModule[]): Grouping {
  const partition: Partition = {};
  const labels: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  const tiers: Record<string, number> = {};
  const kinds: Record<string, ModuleKind> = {};
  modules.forEach((m, i) => {
    const id = `ai-${i + 1}`;
    labels[id] = m.name;
    descriptions[id] = m.purpose;
    tiers[id] = m.tier;
    if (m.kind) kinds[id] = m.kind;
    for (const f of m.files) partition[f] = id;
  });
  return { kind: "ai", partition, labels, descriptions, tiers, kinds, mq: partitionMQ(graph, partition) };
}
