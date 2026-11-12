import { BaseEdge, getSmoothStepPath, useInternalNode, type Edge, type EdgeProps } from "@xyflow/react";
import type { Point } from "./layout";

export type RoutedEdgeData = {
  /** The arrow's orthogonal route (absolute): ELK's, or `routeAround`'s for a minor connection. */
  points?: Point[];
};
export type RoutedEdgeType = Edge<RoutedEdgeData, "routed">;

/** SVG path through `points` with rounded corners, plus a label position halfway along it. */
export function roundedPath(points: Point[], radius = 10): [string, number, number] {
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p0, p1, p2] = [points[i - 1], points[i], points[i + 1]];
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    if (r < 0.5) {
      d += ` L ${p1.x},${p1.y}`;
      continue;
    }
    const a = { x: p1.x + ((p0.x - p1.x) * r) / d1, y: p1.y + ((p0.y - p1.y) * r) / d1 };
    const b = { x: p1.x + ((p2.x - p1.x) * r) / d2, y: p1.y + ((p2.y - p1.y) * r) / d2 };
    d += ` L ${a.x},${a.y} Q ${p1.x},${p1.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;

  // Label halfway along the polyline.
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const t = remaining / lengths[i];
      return [d, points[i].x + (points[i + 1].x - points[i].x) * t, points[i].y + (points[i + 1].y - points[i].y) * t];
    }
    remaining -= lengths[i];
  }
  return [d, last.x, last.y];
}

/**
 * Draws the arrow's orthogonal route, so it goes around boxes instead of through them (boxes are never
 * dragged, so the route stays right). Without one (no way around was found) it falls back to a
 * smooth-step path between the handles.
 */
export function RoutedEdge(props: EdgeProps<RoutedEdgeType>) {
  const points = props.data?.points;
  const [path, labelX, labelY] =
    points && points.length >= 2
      ? roundedPath(points)
      : getSmoothStepPath({
          sourceX: props.sourceX,
          sourceY: props.sourceY,
          sourcePosition: props.sourcePosition,
          targetX: props.targetX,
          targetY: props.targetY,
          targetPosition: props.targetPosition,
          borderRadius: 10,
        });

  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
      label={props.label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={props.labelStyle}
      labelShowBg={props.labelShowBg}
      labelBgStyle={props.labelBgStyle}
      labelBgPadding={props.labelBgPadding}
      labelBgBorderRadius={props.labelBgBorderRadius}
      interactionWidth={12}
    />
  );
}

export type LoopEdgeType = Edge<Record<string, never>, "loop">;

/**
 * Two parts that import each other sit side by side; this draws the one two-way arrow between their
 * facing sides (or top and bottom, should they ever be stacked), labelled "loop".
 */
export function LoopEdge(props: EdgeProps<LoopEdgeType>) {
  const s = useInternalNode(props.source);
  const t = useInternalNode(props.target);
  if (!s || !t) return null;
  const box = (n: NonNullable<typeof s>) => ({
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured?.width ?? n.width ?? 0,
    h: n.measured?.height ?? n.height ?? 0,
  });
  const a = box(s);
  const b = box(t);
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let p1: Point;
  let p2: Point;
  if (Math.abs(ac.x - bc.x) >= Math.abs(ac.y - bc.y)) {
    const [l, r] = ac.x <= bc.x ? [a, b] : [b, a];
    const top = Math.max(l.y, r.y);
    const bottom = Math.min(l.y + l.h, r.y + r.h);
    const y = bottom > top ? Math.min(top + 30, (top + bottom) / 2) : (l.y + l.h / 2 + r.y + r.h / 2) / 2;
    p1 = { x: l.x + l.w + 3, y };
    p2 = { x: r.x - 3, y };
  } else {
    const [u, d] = ac.y <= bc.y ? [a, b] : [b, a];
    const x = (Math.max(u.x, d.x) + Math.min(u.x + u.w, d.x + d.w)) / 2 || (ac.x + bc.x) / 2;
    p1 = { x, y: u.y + u.h + 3 };
    p2 = { x, y: d.y - 3 };
  }
  return (
    <BaseEdge
      id={props.id}
      path={`M ${p1.x},${p1.y} L ${p2.x},${p2.y}`}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      style={props.style}
      label={props.label}
      labelX={(p1.x + p2.x) / 2}
      labelY={(p1.y + p2.y) / 2 - 14}
      labelStyle={props.labelStyle}
      labelShowBg={props.labelShowBg}
      labelBgStyle={props.labelBgStyle}
      labelBgPadding={props.labelBgPadding}
      labelBgBorderRadius={props.labelBgBorderRadius}
      interactionWidth={14}
    />
  );
}

export const edgeTypes = { routed: RoutedEdge, loop: LoopEdge };
