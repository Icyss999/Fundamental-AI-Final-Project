/** Formatting shared by the Bug risk and Refactor panels and the diagram nodes (client-safe). */

/** Probability as a short percentage: "73%", "7.5%", "0.4%", "<0.1%". */
export function formatProb(p: number): string {
  if (p >= 0.995) return "99%+";
  if (p >= 0.1) return `${Math.round(p * 100)}%`;
  if (p >= 0.001) return `${(p * 100).toFixed(1)}%`;
  return "<0.1%";
}

/** A Bayes factor from its natural log: "×12", "×3.4", "×0.62". */
export function formatFactor(logBF: number): string {
  const f = Math.exp(logBF);
  if (f >= 100) return `×${Math.round(f)}`;
  if (f >= 10) return `×${f.toFixed(0)}`;
  if (f >= 1) return `×${f.toFixed(1)}`;
  return `×${f.toFixed(2)}`;
}

/** Path below the folder every file shares (e.g. "src/pages/a.tsx" -> "pages/a.tsx"). */
export function relPath(path: string, prefix: string): string {
  return prefix && path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function hops(depth: number): string {
  return depth === 1 ? "imports it directly" : `reaches it in ${depth} hops`;
}

/** Background for a heat intensity in [0, 1]: one hue, from the surface (near zero) to orange. */
export function heatBackground(intensity: number, surface: string): string {
  return `color-mix(in oklab, var(--heat) ${Math.round(Math.max(0, Math.min(1, intensity)) * 62)}%, ${surface})`;
}
