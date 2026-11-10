import { BaseEdge, getSmoothStepPath, useInternalNode, type Edge, type EdgeProps } from "@xyflow/react";
import type { Point } from "./layout";

export type RoutedEdgeData = {
  /** ELK's orthogonal route (absolute). */
  points?: Point[];
  /** Where ELK put the two endpoint nodes; if either has moved since, the route is stale. */
  anchors?: { source: Point; target: Point };
};
export type RoutedEdgeType = Edge<RoutedEdgeData, "routed">;

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

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
 * Draws ELK's orthogonal route while both endpoints are where ELK put them, so edges
 * go around boxes instead of through them. Once the user drags an endpoint the route
 * is stale, and the edge falls back to a smooth-step path between the handles.
 */
export function RoutedEdge(props: EdgeProps<RoutedEdgeType>) {
  const { source, target, data } = props;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const fresh =
    data?.points &&
    data.points.length >= 2 &&
    data.anchors &&
    sourceNode &&
    targetNode &&
    near(sourceNode.internals.positionAbsolute, data.anchors.source) &&
    near(targetNode.internals.positionAbsolute, data.anchors.target);

  const [path, labelX, labelY] = fresh
    ? roundedPath(data.points!)
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

export const edgeTypes = { routed: RoutedEdge };
