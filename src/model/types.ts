export type Point = { x: number; y: number };

export type Station = Point & {
  id: string;
  name: string;
};

export type MetroLine = {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
};

export type RoutedLine = {
  line: MetroLine;
  stations: Station[];
  path: Point[];
  pathD: string;
  totalLength: number;
};
