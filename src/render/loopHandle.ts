import { MAP_HEIGHT, MAP_WIDTH } from "../data/network.ts";
import type { Point, Station } from "../model/types.ts";

export type LoopHandleGeometry = {
  stubPath: string;
  tip: Point;
};

export function computeLoopHandle(
  station: Station,
  prev: Station,
  next: Station,
  stubLength = 44,
): LoopHandleGeometry {
  const trackDx = next.x - prev.x;
  const trackDy = next.y - prev.y;
  const trackLen = Math.hypot(trackDx, trackDy) || 1;
  const tx = trackDx / trackLen;
  const ty = trackDy / trackLen;

  let perpX = -ty;
  let perpY = tx;

  const centerX = MAP_WIDTH / 2;
  const centerY = MAP_HEIGHT / 2;
  const outward =
    (station.x - centerX) * perpX + (station.y - centerY) * perpY;
  if (outward < 0) {
    perpX = -perpX;
    perpY = -perpY;
  }

  const tip = {
    x: station.x + perpX * stubLength,
    y: station.y + perpY * stubLength,
  };

  const capHalf = 7;
  const capStart = { x: tip.x - tx * capHalf, y: tip.y - ty * capHalf };
  const capEnd = { x: tip.x + tx * capHalf, y: tip.y + ty * capHalf };

  return {
    stubPath:
      `M ${station.x} ${station.y} L ${tip.x} ${tip.y} ` +
      `M ${capStart.x} ${capStart.y} L ${capEnd.x} ${capEnd.y}`,
    tip,
  };
}

export function loopHandleGeometryForLine(
  lineStationIds: string[],
  handleStationId: string,
  stationMap: Map<string, Station>,
): LoopHandleGeometry | null {
  const index = lineStationIds.indexOf(handleStationId);
  if (index < 0) return null;

  const station = stationMap.get(handleStationId);
  const prev = stationMap.get(
    lineStationIds[(index - 1 + lineStationIds.length) % lineStationIds.length],
  );
  const next = stationMap.get(
    lineStationIds[(index + 1) % lineStationIds.length],
  );

  if (!station || !prev || !next) return null;
  return computeLoopHandle(station, prev, next);
}
