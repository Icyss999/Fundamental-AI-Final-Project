import type { DepGraph } from "./types";

export interface Degree {
  /** Number of files that import this file. */
  fanIn: number;
  /** Number of files this file imports. */
  fanOut: number;
}

export function degrees(graph: DepGraph): Map<string, Degree> {
  const result = new Map<string, Degree>(graph.nodes.map((n) => [n.id, { fanIn: 0, fanOut: 0 }]));
  for (const e of graph.edges) {
    result.get(e.source)!.fanOut++;
    result.get(e.target)!.fanIn++;
  }
  return result;
}

/**
 * Import cycles: strongly connected components with more than one file
 * (self-imports are already dropped during extraction). Uses Tarjan's algorithm,
 * written iteratively so deep graphs cannot overflow the call stack.
 * Each cycle is returned as a sorted list of file ids; cycles are sorted largest first.
 */
export function findCycles(graph: DepGraph): string[][] {
  const adjacency = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) adjacency.get(e.source)!.push(e.target);

  let counter = 0;
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  for (const start of adjacency.keys()) {
    if (index.has(start)) continue;
    // Each frame is a node plus the position of the next neighbour to visit.
    const callStack: { node: string; next: number }[] = [{ node: start, next: 0 }];
    index.set(start, counter);
    lowLink.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const neighbours = adjacency.get(frame.node)!;
      if (frame.next < neighbours.length) {
        const w = neighbours[frame.next++];
        if (!index.has(w)) {
          index.set(w, counter);
          lowLink.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          callStack.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node)!, index.get(w)!));
        }
        continue;
      }

      // All neighbours visited: close the frame.
      callStack.pop();
      if (callStack.length > 0) {
        const parent = callStack[callStack.length - 1].node;
        lowLink.set(parent, Math.min(lowLink.get(parent)!, lowLink.get(frame.node)!));
      }
      if (lowLink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.node);
        if (component.length > 1) components.push(component.sort());
      }
    }
  }

  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export interface GodFile {
  id: string;
  fanIn: number;
  /** How many standard deviations the fan-in sits above the mean. */
  zScore: number;
}

/**
 * "God" files: files that far more of the project depends on than is typical.
 * A file qualifies when its fan-in is at least `minFanIn` and at least `zThreshold`
 * standard deviations above the mean fan-in.
 */
export function findGodFiles(
  graph: DepGraph,
  { zThreshold = 2, minFanIn = 5 }: { zThreshold?: number; minFanIn?: number } = {},
): GodFile[] {
  const deg = degrees(graph);
  const fanIns = [...deg.values()].map((d) => d.fanIn);
  if (fanIns.length < 2) return [];
  const mean = fanIns.reduce((a, b) => a + b, 0) / fanIns.length;
  const std = Math.sqrt(fanIns.reduce((a, b) => a + (b - mean) ** 2, 0) / fanIns.length);
  if (std === 0) return [];

  const result: GodFile[] = [];
  for (const [id, { fanIn }] of deg) {
    const zScore = (fanIn - mean) / std;
    if (fanIn >= minFanIn && zScore >= zThreshold) result.push({ id, fanIn, zScore });
  }
  return result.sort((a, b) => b.fanIn - a.fanIn);
}
