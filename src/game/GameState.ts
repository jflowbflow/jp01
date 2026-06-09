import {
  INITIAL_STATION_COUNT,
  lineDefinitions,
  MAX_STATIONS,
} from "../data/network.ts";
import {
  createStation,
  emptyShapeCounts,
  findPlacement,
  getUnlockedShapes,
  minStationDistance,
  pickStationName,
  pickStationShape,
  stationRadius,
} from "./stationSpawner.ts";
import type { Passenger, PlayerLine, Station, StationShape } from "../model/types.ts";

export class GameState {
  private readonly lines: PlayerLine[];
  private activeLineId: string;
  private stations: Station[] = [];
  private passengers: Passenger[] = [];
  private nextStationId = 1;
  private nextPassengerId = 1;
  private readonly shapeCounts = emptyShapeCounts();
  private readonly usedNames = new Set<string>();
  private week = 1;
  private elapsedSeconds = 0;

  constructor() {
    this.lines = lineDefinitions.map((definition) => ({
      ...definition,
      stationIds: [],
      isLoop: false,
    }));
    this.activeLineId = this.lines[0].id;

    for (let i = 0; i < INITIAL_STATION_COUNT; i += 1) {
      this.spawnStation("circle");
    }
  }

  getLines(): readonly PlayerLine[] {
    return this.lines;
  }

  getStations(): readonly Station[] {
    return this.stations;
  }

  getPassengers(): readonly Passenger[] {
    return this.passengers;
  }

  getPassengersAtStation(stationId: string): Passenger[] {
    return this.passengers.filter((passenger) => passenger.stationId === stationId);
  }

  getStationRadius(): number {
    return stationRadius(this.stations.length);
  }

  getWeek(): number {
    return this.week;
  }

  getUnlockedShapes(): StationShape[] {
    return getUnlockedShapes(this.shapeCounts);
  }

  getActiveLineId(): string {
    return this.activeLineId;
  }

  setActiveLine(lineId: string): void {
    if (this.lines.some((line) => line.id === lineId)) {
      this.activeLineId = lineId;
    }
  }

  getActiveLine(): PlayerLine {
    return this.lines.find((line) => line.id === this.activeLineId) ?? this.lines[0];
  }

  addStation(stationId: string): boolean {
    const line = this.getActiveLine();
    if (line.isLoop) return false;

    const { stationIds } = line;
    if (stationIds.length === 0) {
      stationIds.push(stationId);
      return true;
    }

    const lastId = stationIds[stationIds.length - 1];
    if (stationId === lastId) return false;

    const firstId = stationIds[0];
    if (stationId === firstId) {
      if (stationIds.length < 3) return false;
      line.isLoop = true;
      return true;
    }

    if (stationIds.includes(stationId)) return false;

    stationIds.push(stationId);
    return true;
  }

  undoLastStation(lineId?: string): boolean {
    const line = this.lines.find((entry) => entry.id === (lineId ?? this.activeLineId));
    if (!line || line.isLoop || line.stationIds.length === 0) return false;
    line.stationIds.pop();
    return true;
  }

  getLineStatus(line: PlayerLine): string {
    if (line.isLoop) return "Loop complete";
    if (line.stationIds.length === 0) return "Select stations";
    if (line.stationIds.length === 1) return "1 station";
    return `${line.stationIds.length} stations — return to start to loop`;
  }

  advanceTime(dt: number): void {
    this.elapsedSeconds += dt;
    const nextWeek = Math.floor(this.elapsedSeconds / 18) + 1;
    if (nextWeek > this.week) {
      this.week = nextWeek;
    }
  }

  spawnStation(forceShape?: StationShape): boolean {
    if (this.stations.length >= MAX_STATIONS) return false;

    const minDistance = minStationDistance(this.stations.length + 1);
    const point = findPlacement(this.stations, minDistance);
    if (!point) return false;

    const shape = pickStationShape(this.shapeCounts, forceShape);
    const name = pickStationName(this.usedNames);
    const station = createStation(`s${this.nextStationId}`, point, shape, name);

    this.nextStationId += 1;
    this.usedNames.add(name);
    this.shapeCounts[shape] += 1;
    this.stations.push(station);
    return true;
  }

  spawnPassengerAt(stationId: string): boolean {
    const station = this.stations.find((entry) => entry.id === stationId);
    if (!station) return false;

    const queue = this.getPassengersAtStation(stationId);
    if (queue.length >= 8) return false;

    const shapesOnMap = [...new Set(this.stations.map((entry) => entry.shape))];
    const destinationOptions = shapesOnMap.filter((shape) => shape !== station.shape);
    const destinationShape =
      destinationOptions.length > 0
        ? destinationOptions[Math.floor(Math.random() * destinationOptions.length)]
        : shapesOnMap[Math.floor(Math.random() * shapesOnMap.length)];

    this.passengers.push({
      id: `p${this.nextPassengerId}`,
      stationId,
      destinationShape,
    });
    this.nextPassengerId += 1;
    return true;
  }
}
