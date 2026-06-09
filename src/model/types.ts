export type Point = { x: number; y: number };

export type StationShape =
  | "circle"
  | "triangle"
  | "square"
  | "pentagon"
  | "hexagon";

export type Station = Point & {
  id: string;
  name: string;
  shape: StationShape;
};

export type Passenger = {
  id: string;
  stationId: string;
  destinationShape: StationShape;
};

export type LineDefinition = {
  id: string;
  name: string;
  color: string;
};

export type PlayerLine = LineDefinition & {
  stationIds: string[];
  isLoop: boolean;
  loopHandleStationId?: string;
};

export type RoutedLine = {
  line: PlayerLine;
  stations: Station[];
  pathD: string;
  totalLength: number;
};
