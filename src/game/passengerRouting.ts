import type {
  Passenger,
  PassengerRouteLeg,
  PlayerLine,
  Station,
  StationShape,
} from "../model/types.ts";

export type TransitNetwork = {
  stations: readonly Station[];
  lines: readonly PlayerLine[];
};

export function buildStationAdjacency(lines: readonly PlayerLine[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  const link = (fromId: string, toId: string): void => {
    if (!adjacency.has(fromId)) adjacency.set(fromId, new Set());
    if (!adjacency.has(toId)) adjacency.set(toId, new Set());
    adjacency.get(fromId)!.add(toId);
    adjacency.get(toId)!.add(fromId);
  };

  for (const line of lines) {
    const ids = line.activeStationIds;
    if (ids.length < 2) continue;

    for (let index = 0; index < ids.length - 1; index += 1) {
      link(ids[index], ids[index + 1]);
    }

    if (line.activeIsLoop && ids.length >= 3) {
      link(ids[ids.length - 1], ids[0]);
    }
  }

  return adjacency;
}

export function findLineConnecting(
  fromId: string,
  toId: string,
  lines: readonly PlayerLine[],
): string | null {
  for (const line of lines) {
    const ids = line.activeStationIds;
    if (ids.length < 2) continue;

    for (let index = 0; index < ids.length - 1; index += 1) {
      const a = ids[index];
      const b = ids[index + 1];
      if ((a === fromId && b === toId) || (a === toId && b === fromId)) {
        return line.id;
      }
    }

    if (line.activeIsLoop && ids.length >= 3) {
      const last = ids[ids.length - 1];
      const first = ids[0];
      if (
        (last === fromId && first === toId) ||
        (last === toId && first === fromId)
      ) {
        return line.id;
      }
    }
  }

  return null;
}

export function findStationPath(
  startStationId: string,
  destinationShape: StationShape,
  network: TransitNetwork,
): string[] | null {
  const goalIds = new Set(
    network.stations
      .filter((station) => station.shape === destinationShape)
      .map((station) => station.id),
  );

  if (goalIds.size === 0) return null;
  if (goalIds.has(startStationId)) return [startStationId];

  const adjacency = buildStationAdjacency(network.lines);
  const queue = [startStationId];
  const visited = new Set([startStationId]);
  const parent = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (goalIds.has(current)) {
      const path = [current];
      let node = current;
      while (parent.has(node)) {
        node = parent.get(node)!;
        path.unshift(node);
      }
      return path;
    }

    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  return null;
}

export function pathToRouteLegs(
  path: string[],
  lines: readonly PlayerLine[],
): PassengerRouteLeg[] {
  if (path.length < 2) return [];

  const legs: PassengerRouteLeg[] = [];
  let index = 0;

  while (index < path.length - 1) {
    const lineId = findLineConnecting(path[index], path[index + 1], lines);
    if (!lineId) return [];

    let end = index + 1;
    while (end < path.length - 1) {
      const nextLineId = findLineConnecting(path[end], path[end + 1], lines);
      if (nextLineId !== lineId) break;
      end += 1;
    }

    legs.push({ lineId, alightStationId: path[end] });
    index = end;
  }

  return legs;
}

export function planPassengerRoute(
  fromStationId: string,
  destinationShape: StationShape,
  network: TransitNetwork,
): PassengerRouteLeg[] | null {
  const path = findStationPath(fromStationId, destinationShape, network);
  if (!path || path.length < 2) return null;

  const legs = pathToRouteLegs(path, network.lines);
  return legs.length > 0 ? legs : null;
}

export function ensurePassengerRoute(
  passenger: Passenger,
  atStationId: string,
  network: TransitNetwork,
): PassengerRouteLeg[] | null {
  const legIndex = passenger.routeLegIndex ?? 0;
  const existing = passenger.routeLegs;

  if (existing && legIndex < existing.length) {
    return existing;
  }

  const planned = planPassengerRoute(atStationId, passenger.destinationShape, network);
  if (!planned) return null;

  passenger.routeLegs = planned;
  passenger.routeLegIndex = 0;
  return planned;
}

export function shouldPassengerBoard(
  passenger: Passenger,
  lineId: string,
  atStationId: string,
  network: TransitNetwork,
): boolean {
  const legs = ensurePassengerRoute(passenger, atStationId, network);
  if (!legs) return false;

  const legIndex = passenger.routeLegIndex ?? 0;
  if (legIndex >= legs.length) return false;

  return legs[legIndex].lineId === lineId;
}

export function shouldPassengerAlight(
  passenger: Passenger,
  stationId: string,
  stationShape: StationShape,
): boolean {
  if (stationShape === passenger.destinationShape) return true;

  const legIndex = passenger.routeLegIndex ?? 0;
  const legs = passenger.routeLegs;
  if (!legs || legIndex >= legs.length) return false;

  return legs[legIndex].alightStationId === stationId;
}

export function advancePassengerAfterAlight(
  passenger: Passenger,
  stationId: string,
  stationShape: StationShape,
): void {
  if (stationShape === passenger.destinationShape) return;

  passenger.stationId = stationId;
  passenger.routeLegIndex = (passenger.routeLegIndex ?? 0) + 1;
}
