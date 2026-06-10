import {
  routeOctilinear,
  routeOctilinearOpen,
  stationStopsOnPath,
} from "../geometry/octilinearRouter.ts";
import type { PlayerLine, Station } from "../model/types.ts";
import type { Train } from "../model/types.ts";

export type PendingSegment = {
  pathD: string;
  activeSegmentIndex: number;
};

export function buildPendingSegments(
  line: PlayerLine,
  stationMap: Map<string, Station>,
): PendingSegment[] {
  if (!line.pendingApplyStationId) return [];

  const active = line.activeStationIds;
  const pending = line.stationIds;
  const activeStations = active
    .map((id) => stationMap.get(id))
    .filter((station): station is Station => Boolean(station));
  const pendingStations = pending
    .map((id) => stationMap.get(id))
    .filter((station): station is Station => Boolean(station));

  if (activeStations.length < 2 || pendingStations.length < 2) return [];

  const segments: PendingSegment[] = [];
  const pushOpen = (fromIndex: number, toIndex: number, activeSegmentIndex: number) => {
    const from = pendingStations[fromIndex];
    const to = pendingStations[toIndex];
    if (!from || !to) return;
    const pathD = routeOctilinearOpen([from, to]);
    if (pathD) segments.push({ pathD, activeSegmentIndex });
  };

  const isTailExtension =
    pending.length > active.length &&
    active.every((id, index) => pending[index] === id) &&
    line.isLoop === line.activeIsLoop;

  if (isTailExtension) {
    const junctionIndex = active.length - 1;
    for (let index = Math.max(0, junctionIndex); index < pending.length - 1; index += 1) {
      pushOpen(index, index + 1, Math.max(0, junctionIndex - 1));
    }
    return segments;
  }

  if (line.isLoop && !line.activeIsLoop && active.every((id, index) => pending[index] === id)) {
    pushOpen(pending.length - 2, pending.length - 1, pending.length - 2);
    pushOpen(pending.length - 1, 0, pending.length - 1);
    return segments;
  }

  const junctionIndex = active.indexOf(line.pendingApplyStationId);
  if (junctionIndex < 0) return [];

  for (let index = 0; index < pending.length - 1; index += 1) {
    const isNew =
      pending[index] !== active[index] ||
      pending[index + 1] !== active[index + 1];
    if (isNew) {
      pushOpen(index, index + 1, Math.max(0, junctionIndex - 1));
    }
  }

  if (line.isLoop && !line.activeIsLoop) {
    pushOpen(pending.length - 1, 0, pending.length - 1);
  }

  return segments;
}

export function isTrainOnJunctionSegment(
  train: Train,
  line: PlayerLine,
  stationMap: Map<string, Station>,
): boolean {
  const junctionId = line.pendingApplyStationId;
  if (!junctionId || line.activeStationIds.length < 2) return false;

  const activeStations = line.activeStationIds
    .map((id) => stationMap.get(id))
    .filter((station): station is Station => Boolean(station));

  const pathD = line.activeIsLoop
    ? routeOctilinear(activeStations)
    : routeOctilinearOpen(activeStations);

  if (!pathD) return false;

  const stops = stationStopsOnPath(pathD, activeStations);
  const junctionIndex = stops.findIndex((stop) => stop.stationId === junctionId);
  if (junctionIndex < 0) return false;

  const margin = 6;
  const onSegment = (from: number, to: number): boolean => {
    const low = Math.min(from, to) - margin;
    const high = Math.max(from, to) + margin;

    if (!line.activeIsLoop) {
      return train.distance >= low && train.distance <= high;
    }

    if (from <= to) {
      return train.distance >= low && train.distance <= high;
    }

    return train.distance >= from - margin || train.distance <= to + margin;
  };

  const prevIndex =
    junctionIndex === 0
      ? line.activeIsLoop
        ? stops.length - 1
        : -1
      : junctionIndex - 1;

  if (prevIndex >= 0) {
    if (onSegment(stops[prevIndex].distance, stops[junctionIndex].distance)) {
      return true;
    }
  }

  if (junctionIndex < stops.length - 1) {
    if (onSegment(stops[junctionIndex].distance, stops[junctionIndex + 1].distance)) {
      return true;
    }
  }

  if (line.activeIsLoop && junctionIndex === stops.length - 1) {
    return onSegment(stops[junctionIndex].distance, stops[0].distance);
  }

  return false;
}
