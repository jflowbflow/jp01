import type { Point, Station } from "../model/types.ts";

export type ExtendHandleGeometry = {
  stubPath: string;
  tip: Point;
};

export function computeExtendHandle(
  endpoint: Station,
  towardNeighbor: Station,
  stubLength = 20,
): ExtendHandleGeometry {
  const dx = endpoint.x - towardNeighbor.x;
  const dy = endpoint.y - towardNeighbor.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;

  const tip = {
    x: endpoint.x + tx * stubLength,
    y: endpoint.y + ty * stubLength,
  };

  const capHalf = 7;
  const perpX = -ty;
  const perpY = tx;
  const barA = { x: tip.x + perpX * capHalf, y: tip.y + perpY * capHalf };
  const barB = { x: tip.x - perpX * capHalf, y: tip.y - perpY * capHalf };

  return {
    stubPath:
      `M ${endpoint.x} ${endpoint.y} L ${tip.x} ${tip.y} ` +
      `M ${barA.x} ${barA.y} L ${barB.x} ${barB.y}`,
    tip,
  };
}

export function trimSegmentHitEndpoints(
  from: Point,
  to: Point,
  margin: number,
): [Point, Point] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= margin * 2 + 6) return null;

  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: from.x + ux * margin, y: from.y + uy * margin },
    { x: to.x - ux * margin, y: to.y - uy * margin },
  ];
}
