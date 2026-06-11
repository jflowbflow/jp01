import {
  pathTotalLength,
  pointAtPathLength,
  routeOctilinear,
  routeOctilinearOpen,
  stationStopsOnPath,
} from "../geometry/octilinearRouter.ts";
import type { PlayerLine, Station, Train } from "../model/types.ts";

export type RouteSegment = { fromId: string; toId: string };

export type PendingSegment = {
  pathD: string;
};

const SEGMENT_MARGIN = 6;

function directedKey(fromId: string, toId: string): string {
  return `${fromId}>${toId}`;
}

export function listRouteSegments(
  stationIds: readonly string[],
  isLoop: boolean,
): RouteSegment[] {
  if (stationIds.length < 2) return [];

  const segments: RouteSegment[] = [];
  for (let index = 0; index < stationIds.length - 1; index += 1) {
    segments.push({ fromId: stationIds[index], toId: stationIds[index + 1] });
  }

  if (isLoop && stationIds.length >= 3) {
    segments.push({
      fromId: stationIds[stationIds.length - 1],
      toId: stationIds[0],
    });
  }

  return segments;
}

function segmentKeySet(segments: readonly RouteSegment[]): Set<string> {
  return new Set(segments.map((segment) => directedKey(segment.fromId, segment.toId)));
}

export function diffNewPendingSegments(line: PlayerLine): RouteSegment[] {
  const activeKeys = segmentKeySet(
    listRouteSegments(line.activeStationIds, line.activeIsLoop),
  );

  return listRouteSegments(line.stationIds, line.isLoop).filter(
    (segment) => !activeKeys.has(directedKey(segment.fromId, segment.toId)),
  );
}

export function diffRemovedActiveSegments(line: PlayerLine): RouteSegment[] {
  const pendingKeys = segmentKeySet(listRouteSegments(line.stationIds, line.isLoop));

  return listRouteSegments(line.activeStationIds, line.activeIsLoop).filter(
    (segment) => !pendingKeys.has(directedKey(segment.fromId, segment.toId)),
  );
}

export function getAffectedActiveSegments(line: PlayerLine): RouteSegment[] {
  return diffRemovedActiveSegments(line);
}

export function pickJunctionForStationRemoval(
  line: PlayerLine,
  removedStationId: string,
): string | undefined {
  const activeIndex = line.activeStationIds.indexOf(removedStationId);
  if (activeIndex >= 0) {
    if (activeIndex > 0) return line.activeStationIds[activeIndex - 1];
    if (activeIndex < line.activeStationIds.length - 1) {
      return line.activeStationIds[activeIndex + 1];
    }
  }

  const pendingIndex = line.stationIds.indexOf(removedStationId);
  if (pendingIndex > 0) return line.stationIds[pendingIndex - 1];
  if (pendingIndex >= 0 && pendingIndex < line.stationIds.length - 1) {
    return line.stationIds[pendingIndex + 1];
  }

  return line.stationIds[0];
}

export function getApplyStationIds(line: PlayerLine): string[] {
  const pendingIds = new Set(line.stationIds);
  const stations = new Set<string>();

  if (line.pendingApplyStationId) {
    stations.add(line.pendingApplyStationId);
  }

  for (const segment of getAffectedActiveSegments(line)) {
    if (pendingIds.has(segment.fromId)) stations.add(segment.fromId);
    if (pendingIds.has(segment.toId)) stations.add(segment.toId);
  }

  for (const segment of diffNewPendingSegments(line)) {
    if (pendingIds.has(segment.fromId)) stations.add(segment.fromId);
    if (pendingIds.has(segment.toId)) stations.add(segment.toId);
  }

  return [...stations];
}

export function buildPendingSegments(
  line: PlayerLine,
  stationMap: Map<string, Station>,
): PendingSegment[] {
  const segments: PendingSegment[] = [];

  for (const routeSegment of diffNewPendingSegments(line)) {
    const from = stationMap.get(routeSegment.fromId);
    const to = stationMap.get(routeSegment.toId);
    if (!from || !to) continue;

    const pathD = routeOctilinearOpen([from, to]);
    if (pathD) segments.push({ pathD });
  }

  return segments;
}

function distanceOnSegment(
  distance: number,
  from: number,
  to: number,
  isLoop: boolean,
): boolean {
  const low = Math.min(from, to) - SEGMENT_MARGIN;
  const high = Math.max(from, to) + SEGMENT_MARGIN;

  if (!isLoop) {
    return distance >= low && distance <= high;
  }

  if (from <= to) {
    return distance >= low && distance <= high;
  }

  return distance >= from - SEGMENT_MARGIN || distance <= to + SEGMENT_MARGIN;
}

export function isTrainOnRouteSegment(
  train: Train,
  line: PlayerLine,
  stationMap: Map<string, Station>,
  segment: RouteSegment,
): boolean {
  if (line.activeStationIds.length < 2) return false;

  const activeStations = line.activeStationIds
    .map((id) => stationMap.get(id))
    .filter((station): station is Station => Boolean(station));

  const pathD = line.activeIsLoop
    ? routeOctilinear(activeStations)
    : routeOctilinearOpen(activeStations);

  if (!pathD) return false;

  const totalLength = pathTotalLength(pathD);
  if (totalLength === 0) return false;

  const stops = stationStopsOnPath(pathD, activeStations);
  const fromStop = stops.find((stop) => stop.stationId === segment.fromId);
  const toStop = stops.find((stop) => stop.stationId === segment.toId);
  if (!fromStop || !toStop) return false;

  return distanceOnSegment(
    train.distance,
    fromStop.distance,
    toStop.distance,
    line.activeIsLoop,
  );
}

export function isTrainOnAffectedSegments(
  train: Train,
  line: PlayerLine,
  stationMap: Map<string, Station>,
): boolean {
  const affected = getAffectedActiveSegments(line);
  if (affected.length === 0) return false;

  return affected.some((segment) =>
    isTrainOnRouteSegment(train, line, stationMap, segment),
  );
}

export function canApplyRouteChangeNow(
  train: Train | undefined,
  line: PlayerLine,
  stationMap: Map<string, Station>,
): boolean {
  if (
    line.stationIds.join() === line.activeStationIds.join() &&
    line.isLoop === line.activeIsLoop
  ) {
    return false;
  }

  if (!train) return true;
  return !isTrainOnAffectedSegments(train, line, stationMap);
}

export function closestPathDistance(pathD: string, point: { x: number; y: number }): number {
  const total = pathTotalLength(pathD);
  if (total === 0) return 0;

  const samples = Math.max(48, Math.ceil(total / 6));
  let bestDistance = 0;
  let bestGap = Infinity;

  for (let index = 0; index <= samples; index += 1) {
    const distance = (total * index) / samples;
    const sample = pointAtPathLength(pathD, distance);
    const gap = Math.hypot(sample.x - point.x, sample.y - point.y);
    if (gap < bestGap) {
      bestGap = gap;
      bestDistance = distance;
    }
  }

  return bestDistance;
}

export function remapTrainToPendingRoute(
  train: Train,
  line: PlayerLine,
  stationMap: Map<string, Station>,
): void {
  if (line.activeStationIds.length < 2 || line.stationIds.length < 2) return;

  const activeStations = line.activeStationIds
    .map((id) => stationMap.get(id))
    .filter((station): station is Station => Boolean(station));
  const oldPathD = line.activeIsLoop
    ? routeOctilinear(activeStations)
    : routeOctilinearOpen(activeStations);

  if (!oldPathD) return;

  const position = pointAtPathLength(oldPathD, train.distance);
  const pendingStations = line.stationIds
    .map((id) => stationMap.get(id))
    .filter((station): station is Station => Boolean(station));
  const newPathD = line.isLoop
    ? routeOctilinear(pendingStations)
    : routeOctilinearOpen(pendingStations);

  if (!newPathD) return;

  train.distance = closestPathDistance(newPathD, position);
}

// Kept for callers that still check junction overlap during pending travel.
export function isTrainOnJunctionSegment(
  train: Train,
  line: PlayerLine,
  stationMap: Map<string, Station>,
): boolean {
  if (!line.pendingApplyStationId || line.activeStationIds.length < 2) return false;
  return isTrainOnAffectedSegments(train, line, stationMap);
}
