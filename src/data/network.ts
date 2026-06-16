import type { LineDefinition } from "../model/types.ts";

export const MAP_WIDTH = 900;
export const MAP_HEIGHT = 560;
export const MAP_PADDING = 55;

export const lineDefinitions: LineDefinition[] = [
  { id: "line-a", name: "Blue Line", color: "#4ea5ff" },
  { id: "line-b", name: "Orange Line", color: "#f28c28" },
  { id: "line-c", name: "Green Line", color: "#5ec269" },
];

export const INITIAL_STATION_COUNT = 3;
export const MAX_STATIONS = 32;
export const BASE_STATION_SPAWN_INTERVAL = 22;
export const MIN_STATION_SPAWN_INTERVAL = 14;
export const BASE_PASSENGER_SPAWN_INTERVAL = 8;
