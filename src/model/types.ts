export type Point = { x: number; y: number };

export type Station = Point & {
  id: string;
  name: string;
};

export type LineDefinition = {
  id: string;
  name: string;
  color: string;
};

export type PlayerLine = LineDefinition & {
  stationIds: string[];
  isLoop: boolean;
};

export type RoutedLine = {
  line: PlayerLine;
  stations: Station[];
  pathD: string;
  totalLength: number;
};
