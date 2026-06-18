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
import {
  canApplyRouteChangeNow,
  pickJunctionForStationRemoval,
  remapTrainToPendingRoute,
} from "./pendingRoute.ts";
import type { Passenger, PlayerLine, Station, StationShape, Train } from "../model/types.ts";

export type DragMode = "extend" | "insert" | "new" | "unloop";
export type ExtendEnd = "head" | "tail";

export type DragOrigin = {
  lineId: string;
  fromStationId: string;
  addedOnDragStart: boolean;
  mode: DragMode;
  extendEnd?: ExtendEnd;
  insertAfterIndex?: number;
};

type ActiveRoute = {
  stationIds: string[];
  isLoop: boolean;
  loopHandleStationId?: string;
};

const MIN_LOOP_STATIONS = 3;

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
      activeStationIds: [],
      activeIsLoop: false,
    }));
    this.activeLineId = this.lines[0].id;

    for (let i = 0; i < INITIAL_STATION_COUNT; i += 1) {
      this.spawnStation("circle");
    }
  }

  private normalizeLineLoopState(line: PlayerLine): void {
    if (line.stationIds.length < MIN_LOOP_STATIONS) {
      line.isLoop = false;
      line.loopHandleStationId = undefined;
    }

    if (line.activeStationIds.length < MIN_LOOP_STATIONS) {
      line.activeIsLoop = false;
      line.activeLoopHandleStationId = undefined;
    }
  }

  getLines(): readonly PlayerLine[] {
    for (const line of this.lines) {
      this.normalizeLineLoopState(line);
    }
    return this.lines;
  }

  getLine(lineId: string): PlayerLine | undefined {
    const line = this.lines.find((entry) => entry.id === lineId);
    if (line) this.normalizeLineLoopState(line);
    return line;
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
    const line = this.lines.find((entry) => entry.id === this.activeLineId) ?? this.lines[0];
    this.normalizeLineLoopState(line);
    return line;
  }

  getActiveRoute(line: PlayerLine): ActiveRoute {
    this.normalizeLineLoopState(line);
    return {
      stationIds: line.activeStationIds,
      isLoop: line.activeIsLoop,
      loopHandleStationId: line.activeLoopHandleStationId,
    };
  }

  hasPendingRoute(line: PlayerLine): boolean {
    this.normalizeLineLoopState(line);
    return (
      line.pendingApplyStationId !== undefined ||
      line.stationIds.join() !== line.activeStationIds.join() ||
      line.isLoop !== line.activeIsLoop
    );
  }

  getActiveRouteShapes(lineId: string): Set<StationShape> {
    const line = this.getLine(lineId);
    if (!line) return new Set();

    const stationMap = new Map(this.stations.map((station) => [station.id, station]));
    const shapes = new Set<StationShape>();
    for (const stationId of line.activeStationIds) {
      const station = stationMap.get(stationId);
      if (station) shapes.add(station.shape);
    }
    return shapes;
  }

  isStationOnLine(stationId: string): boolean {
    return this.lines.some((line) => line.stationIds.includes(stationId));
  }

  private getExtendEnd(line: PlayerLine, stationId: string): ExtendEnd | null {
    this.normalizeLineLoopState(line);
    if (line.isLoop || line.stationIds.length === 0) return null;
    if (line.stationIds[line.stationIds.length - 1] === stationId) return "tail";
    if (line.stationIds[0] === stationId) return "head";
    return null;
  }

  getExtendableLinesAtStation(stationId: string): PlayerLine[] {
    return this.lines.filter((line) => this.getExtendEnd(line, stationId) !== null);
  }

  getRemovableLinesAtStation(stationId: string): PlayerLine[] {
    return this.lines.filter((line) => line.stationIds.includes(stationId));
  }

  findEmptyLine(): PlayerLine | undefined {
    return this.lines.find((line) => line.stationIds.length === 0);
  }

  beginDragFromStation(stationId: string, lineId?: string): DragOrigin | null {
    const extendable = lineId
      ? this.getExtendableLinesAtStation(stationId).find((line) => line.id === lineId)
      : undefined;

    if (extendable) {
      const extendEnd = this.getExtendEnd(extendable, stationId);
      if (!extendEnd) return null;

      this.activeLineId = extendable.id;
      return {
        lineId: extendable.id,
        fromStationId: stationId,
        addedOnDragStart: false,
        mode: "extend",
        extendEnd,
      };
    }

    if (!lineId) {
      const candidates = this.getExtendableLinesAtStation(stationId);
      if (candidates.length >= 1) {
        const preferred =
          candidates.find((line) => line.id === this.activeLineId) ?? candidates[0];
        const extendEnd = this.getExtendEnd(preferred, stationId);
        if (!extendEnd) return null;

        this.activeLineId = preferred.id;
        return {
          lineId: preferred.id,
          fromStationId: stationId,
          addedOnDragStart: false,
          mode: "extend",
          extendEnd,
        };
      }
    }

    if (this.isStationOnLine(stationId)) return null;

    const emptyLine = this.findEmptyLine();
    if (!emptyLine) return null;

    this.activeLineId = emptyLine.id;
    emptyLine.stationIds.push(stationId);
    this.syncActiveRoute(emptyLine);
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

    const fromStationId = line.loopHandleStationId;
    if (!this.unloopLine(lineId)) return null;
    return this.beginDragFromStation(fromStationId, lineId);
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

    const extendEnd = origin.extendEnd ?? "tail";
    if (extendEnd === "head") {
      if (stationIds[0] !== origin.fromStationId) return false;

      const lastId = stationIds[stationIds.length - 1];
      if (targetStationId === lastId) {
        return stationIds.length >= MIN_LOOP_STATIONS;
      }

      return !stationIds.includes(targetStationId);
    }

    if (stationIds[stationIds.length - 1] !== origin.fromStationId) return false;

    const firstId = stationIds[0];
    if (targetStationId === firstId) {
      return stationIds.length >= MIN_LOOP_STATIONS;
    }

    return !stationIds.includes(targetStationId);
  }

  connectDragTarget(origin: DragOrigin, targetStationId: string): boolean {
    if (!this.canConnectDragTarget(origin, targetStationId)) return false;

    const junctionStationId = origin.fromStationId;
    let changed = false;

    if (origin.mode === "insert" && origin.insertAfterIndex !== undefined) {
      changed = this.insertStationAt(origin.lineId, origin.insertAfterIndex, targetStationId);
    } else if (origin.mode === "extend" && origin.extendEnd === "head") {
      changed = this.prependStation(targetStationId);
    } else {
      changed = this.addStation(targetStationId);
    }

    if (changed) {
      this.queueRouteChange(origin.lineId, junctionStationId);
    }

    return changed;
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

    line.stationIds.splice(insertAt, 0, stationId);
    return true;
  }

  cancelDrag(origin: DragOrigin): void {
    if (origin.mode !== "new" || !origin.addedOnDragStart) return;

    const line = this.getLine(origin.lineId);
    if (line && !line.isLoop && line.stationIds.length === 1) {
      line.stationIds.pop();
      this.syncActiveRoute(line);
    }
  }

  unloopLine(lineId: string): boolean {
    const line = this.getLine(lineId);
    if (!line?.isLoop || !line.loopHandleStationId) return false;

    const junction = line.loopHandleStationId;
    line.isLoop = false;
    line.loopHandleStationId = undefined;
    this.queueRouteChange(lineId, junction);
    return true;
  }

  prependStation(stationId: string): boolean {
    const line = this.getActiveLine();
    if (line.isLoop) return false;

    const { stationIds } = line;
    if (stationIds.length === 0) {
      stationIds.push(stationId);
      this.syncActiveRoute(line);
      return true;
    }

    const firstId = stationIds[0];
    if (stationId === firstId) return false;

    const lastId = stationIds[stationIds.length - 1];
    if (stationId === lastId) {
      if (stationIds.length < MIN_LOOP_STATIONS) return false;
      line.isLoop = true;
      line.loopHandleStationId = firstId;
      return true;
    }

    if (stationIds.includes(stationId)) return false;

    stationIds.unshift(stationId);
    return true;
  }

  addStation(stationId: string): boolean {
    const line = this.getActiveLine();
    if (line.isLoop) return false;

    const { stationIds } = line;
    if (stationIds.length === 0) {
      stationIds.push(stationId);
      this.syncActiveRoute(line);
      return true;
    }

    const lastId = stationIds[stationIds.length - 1];
    if (stationId === lastId) return false;

    const firstId = stationIds[0];
    if (stationId === firstId) {
      if (stationIds.length < MIN_LOOP_STATIONS) return false;
      line.isLoop = true;
      line.loopHandleStationId = firstId;
      return true;
    }

    if (stationIds.includes(stationId)) return false;

    stationIds.push(stationId);
    return true;
  }

  queueRouteChange(lineId: string, junctionStationId: string): void {
    const line = this.getLine(lineId);
    if (!line) return;
    this.normalizeLineLoopState(line);

    if (line.activeStationIds.length < 2) {
      this.syncActiveRoute(line);
      return;
    }

    if (
      line.stationIds.join() === line.activeStationIds.join() &&
      line.isLoop === line.activeIsLoop
    ) {
      line.pendingApplyStationId = undefined;
      return;
    }

    line.pendingApplyStationId = junctionStationId;
  }

  syncActiveRoute(line: PlayerLine): void {
    this.normalizeLineLoopState(line);
    line.activeStationIds = [...line.stationIds];
    line.activeIsLoop = line.isLoop;
    line.activeLoopHandleStationId = line.isLoop
      ? line.loopHandleStationId
      : undefined;
    line.pendingApplyStationId = undefined;
  }

  tryApplyPendingRoute(lineId: string, train?: Train): boolean {
    const line = this.getLine(lineId);
    if (!line || !this.hasPendingRoute(line)) return false;

    const stationMap = this.getStationMap();
    if (!canApplyRouteChangeNow(train, line, stationMap)) return false;

    if (train) {
      remapTrainToPendingRoute(train, line, stationMap);
    }

    this.syncActiveRoute(line);
    return true;
  }

  finalizeRouteChange(lineId: string, train?: Train): void {
    this.tryApplyPendingRoute(lineId, train);
  }

  private getStationMap(): Map<string, Station> {
    return new Map(this.stations.map((station) => [station.id, station]));
  }

  removeStationFromLine(stationId: string, lineId?: string): boolean {
    const candidates = this.getRemovableLinesAtStation(stationId);
    const line = lineId
      ? candidates.find((entry) => entry.id === lineId)
      : candidates.find((entry) => entry.id === this.activeLineId) ?? candidates[0];

    if (!line) return false;

    const index = line.stationIds.indexOf(stationId);
    if (index < 0) return false;

    const junction = pickJunctionForStationRemoval(line, stationId);

    line.stationIds.splice(index, 1);
    this.normalizeLineLoopState(line);

    if (line.stationIds.length === 0) {
      this.syncActiveRoute(line);
      return true;
    }

    if (line.stationIds.length === 1 || line.activeStationIds.length < 2) {
      this.syncActiveRoute(line);
    } else if (junction) {
      this.queueRouteChange(line.id, junction);
    }

    return true;
  }

  boardPassenger(passengerId: string): boolean {
    const index = this.passengers.findIndex((passenger) => passenger.id === passengerId);
    if (index < 0) return false;
    this.passengers.splice(index, 1);
    return true;
  }

  undoLastStation(lineId?: string): boolean {
    const line = this.lines.find((entry) => entry.id === (lineId ?? this.activeLineId));
    if (line) this.normalizeLineLoopState(line);
    if (!line || line.isLoop || line.stationIds.length === 0) return false;
    line.stationIds.pop();
    this.syncActiveRoute(line);
    return true;
  }

  getLineStatus(line: PlayerLine): string {
    this.normalizeLineLoopState(line);
    if (this.hasPendingRoute(line)) return "Change pending at next stop";
    if (line.isLoop) return "Loop — drag the tail to open";
    if (line.stationIds.length === 0) return "Drag from a station to start";
    if (line.stationIds.length === 1) return "1 station";
    return `${line.stationIds.length} stations`;
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
