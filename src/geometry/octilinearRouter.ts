import type { Point } from "../model/types.ts";

function addPoint(points: Point[], point: Point): void {
  const last = points[points.length - 1];
  if (!last || last.x !== point.x || last.y !== point.y) {
    points.push(point);
  }
}

function routeSegment(start: Point, end: Point): Point[] {
  const points: Point[] = [{ ...start }];
  let current = { ...start };

  while (current.x !== end.x || current.y !== end.y) {
    const dx = end.x - current.x;
    const dy = end.y - current.y;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);

    if (stepX !== 0 && stepY !== 0) {
      current = { x: current.x + stepX, y: current.y + stepY };
    } else if (stepX !== 0) {
      current = { x: current.x + stepX, y: current.y };
    } else {
      current = { x: current.x, y: current.y + stepY };
    }

    addPoint(points, current);
  }

  return points;
}

function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  const simplified: Point[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    const beforePrev = simplified[simplified.length - 2] ?? prev;

    const prevDx = Math.sign(prev.x - beforePrev.x);
    const prevDy = Math.sign(prev.y - beforePrev.y);
    const nextDx = Math.sign(current.x - prev.x);
    const nextDy = Math.sign(current.y - prev.y);

    if (prevDx !== nextDx || prevDy !== nextDy) {
      simplified.push(current);
    } else {
      simplified[simplified.length - 1] = current;
    }
  }

  return simplified;
}

function buildPath(stations: Point[], closed: boolean): string {
  if (stations.length < 2) return "";

  const rawPoints: Point[] = [];
  const segmentCount = closed ? stations.length : stations.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const next = stations[(i + 1) % stations.length];
    const segment = routeSegment(stations[i], next);
    if (rawPoints.length === 0) {
      rawPoints.push(...segment);
    } else {
      rawPoints.push(...segment.slice(1));
    }
  }

  const points = simplify(rawPoints);
  if (points.length < 2) return "";

  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${points[i].x} ${points[i].y}`);
  }
  if (closed) parts.push("Z");

  return parts.join(" ");
}

export function routeOctilinear(stations: Point[]): string {
  return buildPath(stations, true);
}

export function routeOctilinearOpen(stations: Point[]): string {
  return buildPath(stations, false);
}

export function pathTotalLength(pathD: string): number {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  svg.append(path);
  return path.getTotalLength();
}

export function pointAtPathLength(pathD: string, distance: number): Point {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  svg.append(path);

  const length = path.getTotalLength();
  const clamped = ((distance % length) + length) % length;
  const point = path.getPointAtLength(clamped);
  return { x: point.x, y: point.y };
}
