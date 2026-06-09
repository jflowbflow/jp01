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

export type DragMode = "extend" | "insert" | "new" | "unloop";

export type DragOrigin = {
  lineId: string;
  fromStationId: string;
  addedOnDragStart: boolean;
  mode: DragMode;
  insertAfterIndex?: number;
};

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

  getLine(lineId: string): PlayerLine | undefined {
    return this.lines.find((line) => line.id === lineId);
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

  isStationOnLine(stationId: string): boolean {
    return this.lines.some((line) => line.stationIds.includes(stationId));
  }

  getExtendableLinesAtStation(stationId: string): PlayerLine[] {
    return this.lines.filter(
      (line) =>
        !line.isLoop &&
        line.stationIds.length > 0 &&
        line.stationIds[line.stationIds.length - 1] === stationId,
    );
  }

  findEmptyLine(): PlayerLine | undefined {
    return this.lines.find((line) => line.stationIds.length === 0);
  }

  beginDragFromStation(stationId: string, lineId?: string): DragOrigin | null {
    const extendable = lineId
      ? this.getExtendableLinesAtStation(stationId).find((line) => line.id === lineId)
      : undefined;

    if (extendable) {
      this.activeLineId = extendable.id;
      return {
        lineId: extendable.id,
        fromStationId: stationId,
        addedOnDragStart: false,
        mode: "extend",
      };
    }

    if (!lineId) {
      const candidates = this.getExtendableLinesAtStation(stationId);
      if (candidates.length === 1) {
        this.activeLineId = candidates[0].id;
        return {
          lineId: candidates[0].id,
          fromStationId: stationId,
          addedOnDragStart: false,
          mode: "extend",
        };
      }
      if (candidates.length > 1) return null;
    }

    if (this.isStationOnLine(stationId)) return null;

    const emptyLine = this.findEmptyLine();
    if (!emptyLine) return null;

    this.activeLineId = emptyLine.id;
    emptyLine.stationIds.push(stationId);
    return {
      lineId: emptyLine.id,
      fromStationId: stationId,
      addedOnDragStart: true,
      mode: "new",
    };
  }

  beginInsertDrag(lineId: string, segmentIndex: number): DragOrigin | null {
    const line = this.getLine(lineId);
    if (!line || line.stationIds.length < 2) return null;

    const fromStationId = line.stationIds[segmentIndex];
    if (!fromStationId) return null;

    this.activeLineId = lineId;
    return {
      lineId,
      fromStationId,
      addedOnDragStart: false,
      mode: "insert",
      insertAfterIndex: segmentIndex,
    };
  }

  beginUnloopDrag(lineId: string): DragOrigin | null {
    const line = this.getLine(lineId);
    if (!line?.isLoop || !line.loopHandleStationId) return null;

    this.activeLineId = lineId;
    return {
      lineId,
      fromStationId: line.loopHandleStationId,
      addedOnDragStart: false,
      mode: "unloop",
    };
  }

  private segmentEndIndex(line: PlayerLine, segmentIndex: number): number {
    if (segmentIndex < line.stationIds.length - 1) return segmentIndex + 1;
    return line.isLoop ? 0 : -1;
  }

  canConnectDragTarget(origin: DragOrigin, targetStationId: string): boolean {
    if (origin.mode === "unloop") return false;
    if (origin.fromStationId === targetStationId) return false;

    const line = this.getLine(origin.lineId);
    if (!line) return false;
    if (line.isLoop && origin.mode !== "insert") return false;

    if (origin.mode === "insert" && origin.insertAfterIndex !== undefined) {
      const endIndex = this.segmentEndIndex(line, origin.insertAfterIndex);
      if (endIndex < 0) return false;
      if (targetStationId === line.stationIds[origin.insertAfterIndex]) return false;
      if (targetStationId === line.stationIds[endIndex]) return false;
      return !line.stationIds.includes(targetStationId);
    }

    const { stationIds } = line;
    if (stationIds.length === 0) return true;
    if (stationIds[stationIds.length - 1] !== origin.fromStationId) return false;

    const firstId = stationIds[0];
    if (targetStationId === firstId) {
      return stationIds.length >= 3;
    }

    return !stationIds.includes(targetStationId);
  }

  connectDragTarget(origin: DragOrigin, targetStationId: string): boolean {
    if (!this.canConnectDragTarget(origin, targetStationId)) return false;

    if (origin.mode === "insert" && origin.insertAfterIndex !== undefined) {
      return this.insertStationAt(origin.lineId, origin.insertAfterIndex, targetStationId);
    }

    return this.addStation(targetStationId);
  }

  insertStationAt(lineId: string, afterIndex: number, stationId: string): boolean {
    const line = this.getLine(lineId);
    if (!line) return false;

    const insertAt = afterIndex + 1;
    if (insertAt > line.stationIds.length) return false;

    if (stationId === line.stationIds[afterIndex]) return false;
    const endIndex = this.segmentEndIndex(line, afterIndex);
    if (endIndex >= 0 && stationId === line.stationIds[endIndex]) return false;
    if (line.stationIds.includes(stationId)) return false;

    line.isLoop = false;
    line.loopHandleStationId = undefined;
    line.stationIds.splice(insertAt, 0, stationId);
    return true;
  }

  cancelDrag(origin: DragOrigin): void {
    if (origin.mode !== "new" || !origin.addedOnDragStart) return;

    const line = this.getLine(origin.lineId);
    if (line && !line.isLoop && line.stationIds.length === 1) {
      line.stationIds.pop();
    }
  }

  unloopLine(lineId: string): boolean {
    const line = this.getLine(lineId);
    if (!line?.isLoop) return false;

    line.isLoop = false;
    line.loopHandleStationId = undefined;
    return true;
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
      line.loopHandleStationId = firstId;
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
    if (line.isLoop) return "Loop — drag the tail to open";
    if (line.stationIds.length === 0) return "Hold a station to start";
    if (line.stationIds.length === 1) return "1 station";
    return `${line.stationIds.length} stations — drag to extend or loop`;
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
