import {
  pathAngleAtLength,
  pathTotalLength,
  pointAtPathLength,
  routeOctilinear,
  routeOctilinearOpen,
  stationStopsOnPath,
} from "../geometry/octilinearRouter.ts";
import type { Station, Train } from "../model/types.ts";
import { TRAIN_CAPACITY } from "../model/types.ts";
import { isTrainOnJunctionSegment } from "./pendingRoute.ts";
import type { GameState } from "./GameState.ts";

const DWELL_SECONDS = 0.55;
const STATION_THRESHOLD = 10;
const TRAIN_SPEED = 48;

export type TrainRenderState = {
  train: Train;
  x: number;
  y: number;
  angle: number;
  color: string;
};

export class TrainSimulation {
  private readonly trains = new Map<string, Train>();

  getTrains(): readonly Train[] {
    return [...this.trains.values()];
  }

  getTrain(lineId: string): Train | undefined {
    return this.trains.get(lineId);
  }

  isTrainOnPendingJunctionSegment(lineId: string, game: GameState): boolean {
    const line = game.getLine(lineId);
    const train = this.trains.get(lineId);
    if (!line || !train || !game.hasPendingRoute(line)) return false;

    const stationMap = new Map(game.getStations().map((station) => [station.id, station]));
    return isTrainOnJunctionSegment(train, line, stationMap);
  }

  shouldShowPendingFade(lineId: string, game: GameState): boolean {
    if (!this.trains.has(lineId)) return false;
    return this.isTrainOnPendingJunctionSegment(lineId, game);
  }

  update(dt: number, game: GameState): boolean {
    let passengersChanged = false;

    for (const line of game.getLines()) {
      if (line.activeStationIds.length < 2) {
        this.trains.delete(line.id);
        continue;
      }

      if (!this.trains.has(line.id)) {
        this.trains.set(line.id, this.createTrain(line.id));
      }

      const train = this.trains.get(line.id)!;
      const route = game.getActiveRoute(line);
      const stationMap = new Map(game.getStations().map((s) => [s.id, s]));
      const stations = route.stationIds
        .map((id) => stationMap.get(id))
        .filter((station): station is Station => Boolean(station));

      const pathD = route.isLoop
        ? routeOctilinear(stations)
        : routeOctilinearOpen(stations);

      if (!pathD) continue;

      const totalLength = pathTotalLength(pathD);
      if (totalLength === 0) continue;

      if (train.dwellRemaining > 0) {
        train.dwellRemaining = Math.max(0, train.dwellRemaining - dt);
        continue;
      }

      const step = train.speed * dt;
      const nextDistance = train.distance + step * train.direction;
      const stops = stationStopsOnPath(pathD, stations);
      const crossed = this.findCrossedStop(
        train,
        stops,
        train.distance,
        nextDistance,
        totalLength,
        route.isLoop,
      );

      if (crossed) {
        train.distance = crossed.distance;
        train.displayAngle = pathAngleAtLength(pathD, train.distance);
        if (game.applyPendingAtStation(line.id, crossed.stationId)) {
          passengersChanged = true;
        }
        if (this.handleStationStop(train, crossed.stationId, game, stationMap)) {
          passengersChanged = true;
        }
        train.dwellRemaining = DWELL_SECONDS;
        train.lastStationId = crossed.stationId;
        continue;
      }

      if (route.isLoop) {
        train.distance = ((nextDistance % totalLength) + totalLength) % totalLength;
      } else if (nextDistance >= totalLength) {
        train.distance = totalLength;
        train.direction = -1;
      } else if (nextDistance <= 0) {
        train.distance = 0;
        train.direction = 1;
      } else {
        train.distance = nextDistance;
      }

      train.displayAngle = pathAngleAtLength(pathD, train.distance);
    }

    return passengersChanged;
  }

  getRenderStates(game: GameState): TrainRenderState[] {
    const states: TrainRenderState[] = [];
    const stationMap = new Map(game.getStations().map((s) => [s.id, s]));

    for (const train of this.trains.values()) {
      const line = game.getLine(train.lineId);
      if (!line) continue;

      const route = game.getActiveRoute(line);
      const stations = route.stationIds
        .map((id) => stationMap.get(id))
        .filter((station): station is Station => Boolean(station));

      if (stations.length < 2) continue;

      const pathD = route.isLoop
        ? routeOctilinear(stations)
        : routeOctilinearOpen(stations);

      if (!pathD) continue;

      const point = pointAtPathLength(pathD, train.distance);
      states.push({
        train,
        x: point.x,
        y: point.y,
        angle: train.displayAngle,
        color: line.color,
      });
    }

    return states;
  }

  private createTrain(lineId: string): Train {
    return {
      lineId,
      distance: 0,
      direction: 1,
      displayAngle: 0,
      speed: TRAIN_SPEED,
      passengers: [],
      dwellRemaining: 0,
      lastStationId: null,
    };
  }

  private canVisitStation(
    train: Train,
    stop: { stationId: string; distance: number },
    totalLength: number,
    isLoop: boolean,
  ): boolean {
    if (train.lastStationId !== stop.stationId) return true;

    const gap = Math.abs(train.distance - stop.distance);
    const effectiveGap = isLoop ? Math.min(gap, totalLength - gap) : gap;
    return effectiveGap > STATION_THRESHOLD * 2;
  }

  private findCrossedStop(
    train: Train,
    stops: { stationId: string; distance: number }[],
    from: number,
    to: number,
    totalLength: number,
    isLoop: boolean,
  ): { stationId: string; distance: number } | null {
    const candidates = stops.filter((stop) => {
      if (!this.canVisitStation(train, stop, totalLength, isLoop)) return false;

      if (isLoop) {
        const forward = this.forwardDelta(from, to, totalLength);
        const stopDelta = this.forwardDelta(from, stop.distance, totalLength);
        return stopDelta > 0 && stopDelta <= forward + 0.5;
      }

      if (train.direction > 0) {
        return stop.distance > from + 0.5 && stop.distance <= to + 0.5;
      }

      return stop.distance < from - 0.5 && stop.distance >= to - 0.5;
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) =>
      train.direction > 0 ? a.distance - b.distance : b.distance - a.distance,
    );

    return candidates[0];
  }

  private forwardDelta(from: number, to: number, total: number): number {
    return ((to - from) % total + total) % total;
  }

  private handleStationStop(
    train: Train,
    stationId: string,
    game: GameState,
    stationMap: Map<string, Station>,
  ): boolean {
    let changed = false;
    const station = stationMap.get(stationId);
    if (!station) return false;

    const before = train.passengers.length;
    train.passengers = train.passengers.filter(
      (passenger) => passenger.destinationShape !== station.shape,
    );
    if (train.passengers.length !== before) changed = true;

    const routeShapes = game.getActiveRouteShapes(train.lineId);
    const waiting = game.getPassengersAtStation(stationId);

    for (const passenger of waiting) {
      if (train.passengers.length >= TRAIN_CAPACITY) break;
      if (!routeShapes.has(passenger.destinationShape)) continue;
      if (game.boardPassenger(passenger.id)) {
        train.passengers.push(passenger);
        changed = true;
      }
    }

    return changed;
  }
}
