import {
  INITIAL_STATION_COUNT,
  MAP_HEIGHT,
  MAP_PADDING,
  MAP_WIDTH,
} from "../data/network.ts";
import type { Point, Station, StationShape } from "../model/types.ts";

export const SHAPE_ORDER: StationShape[] = [
  "circle",
  "triangle",
  "square",
  "pentagon",
  "hexagon",
];

const STATION_NAMES = [
  "Harbor",
  "Market",
  "Plaza",
  "Museum",
  "Park",
  "Terminal",
  "Depot",
  "Square",
  "Bridge",
  "Heights",
  "Gardens",
  "Riverside",
  "Uptown",
  "Midtown",
  "Crossing",
  "Junction",
  "Bay",
  "Crest",
  "Lane",
  "Point",
  "Gate",
  "Quay",
  "Hill",
  "Vale",
  "Row",
  "Arcade",
  "Commons",
  "Wharf",
  "Meadow",
  "Cove",
  "Summit",
  "Loop",
];

const BASE_STATION_RADIUS = 20;
const MIN_STATION_RADIUS = 5;
const REFERENCE_STATION_RADIUS = 10;

export function stationRadius(totalStations: number): number {
  const t = Math.min(1, Math.max(0, (totalStations - INITIAL_STATION_COUNT) / 22));
  return BASE_STATION_RADIUS - (BASE_STATION_RADIUS - MIN_STATION_RADIUS) * t;
}

export function mapScale(totalStations: number): number {
  return stationRadius(totalStations) / REFERENCE_STATION_RADIUS;
}

export function minStationDistance(totalStations: number): number {
  const radius = stationRadius(totalStations);
  return radius * 2 + 48;
}

export function pickStationName(usedNames: Set<string>): string {
  for (const name of STATION_NAMES) {
    if (!usedNames.has(name)) return name;
  }
  let index = usedNames.size + 1;
  while (usedNames.has(`Stop ${index}`)) index += 1;
  return `Stop ${index}`;
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function isValidPlacement(
  point: Point,
  existing: Station[],
  minDistance: number,
): boolean {
  if (
    point.x < MAP_PADDING ||
    point.x > MAP_WIDTH - MAP_PADDING ||
    point.y < MAP_PADDING ||
    point.y > MAP_HEIGHT - MAP_PADDING
  ) {
    return false;
  }

  return existing.every((station) => distance(point, station) >= minDistance);
}

export function findPlacement(existing: Station[], minDistance: number): Point | null {
  const center = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  const maxRadius = Math.min(MAP_WIDTH, MAP_HEIGHT) / 2 - MAP_PADDING;

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * maxRadius;
    const point = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };

    if (isValidPlacement(point, existing, minDistance)) {
      return point;
    }
  }

  for (let ring = 1; ring <= 6; ring += 1) {
    const samples = ring * 10;
    for (let i = 0; i < samples; i += 1) {
      const angle = (Math.PI * 2 * i) / samples;
      const radius = (maxRadius * ring) / 6;
      const point = {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };

      if (isValidPlacement(point, existing, minDistance * 0.85)) {
        return point;
      }
    }
  }

  return null;
}

export function getUnlockedShapes(shapeCounts: Record<StationShape, number>): StationShape[] {
  const unlocked: StationShape[] = [SHAPE_ORDER[0]];

  for (let i = 0; i < SHAPE_ORDER.length - 1; i += 1) {
    if (shapeCounts[SHAPE_ORDER[i]] >= 2) {
      unlocked.push(SHAPE_ORDER[i + 1]);
    }
  }

  return unlocked;
}

export function pickStationShape(
  shapeCounts: Record<StationShape, number>,
  forceShape?: StationShape,
): StationShape {
  if (forceShape) return forceShape;

  const unlocked = getUnlockedShapes(shapeCounts);
  return unlocked[Math.floor(Math.random() * unlocked.length)];
}

export function createStation(
  id: string,
  point: Point,
  shape: StationShape,
  name: string,
): Station {
  return { id, name, shape, x: point.x, y: point.y };
}

export function emptyShapeCounts(): Record<StationShape, number> {
  return {
    circle: 0,
    triangle: 0,
    square: 0,
    pentagon: 0,
    hexagon: 0,
  };
}

export function shapeLabel(shape: StationShape): string {
  switch (shape) {
    case "circle":
      return "●";
    case "triangle":
      return "▲";
    case "square":
      return "■";
    case "pentagon":
      return "⬠";
    case "hexagon":
      return "⬡";
  }
}
