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

export type PassengerRouteLeg = {
  lineId: string;
  alightStationId: string;
};

export type Passenger = {
  id: string;
  stationId: string;
  destinationShape: StationShape;
  routeLegs?: PassengerRouteLeg[];
  routeLegIndex?: number;
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
  activeStationIds: string[];
  activeIsLoop: boolean;
  activeLoopHandleStationId?: string;
  pendingApplyStationId?: string;
};

export type RoutedLine = {
  line: PlayerLine;
  stations: Station[];
  pathD: string;
  totalLength: number;
};

export type UpgradeType = "thruster" | "carriage" | "train";

export type Train = {
  id: string;
  lineId: string;
  distance: number;
  direction: 1 | -1;
  displayAngle: number;
  speed: number;
  capacity: number;
  passengers: Passenger[];
  stopStationId: string | null;
  transferCooldown: number;
  lastStationId: string | null;
};

export const BASE_TRAIN_CAPACITY = 6;
export const BASE_TRAIN_SPEED = 48;
export const CARRIAGE_CAPACITY_BONUS = 2;
export const THRUSTER_SPEED_BONUS = 12;
export const PASSENGERS_PER_UPGRADE = 5;
