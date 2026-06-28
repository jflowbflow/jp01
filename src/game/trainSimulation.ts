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
import { getTrainAtStationOnLine, isTrainBlockingPendingRoute } from "./pendingRoute.ts";
import {
  advancePassengerAfterAlight,
  shouldPassengerAlight,
  shouldPassengerBoard,
} from "./passengerRouting.ts";
import type { GameState } from "./GameState.ts";

const DWELL_SECONDS = 0.55;
const STATION_THRESHOLD = 10;
const TRAIN_SPEED = 48;
const TRAIN_TURN_RATE = 14;

function lerpAngle(current: number, target: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  const maxStep = TRAIN_TURN_RATE * dt;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

export type TrainRenderState = {
  train: Train;
  x: number;
  y: number;
  angle: number;
  color: string;
  scale: number;
};

export class TrainSimulation {
  private readonly trains = new Map<string, Train>();

  getTrains(): readonly Train[] {
    return [...this.trains.values()];
  }

  getTrain(lineId: string): Train | undefined {
    return this.trains.get(lineId);
  }

  shouldShowPendingFade(lineId: string, game: GameState): boolean {
    const line = game.getLine(lineId);
    const train = this.trains.get(lineId);
    if (!line || !train || !game.hasPendingRoute(line)) return false;

    const stationMap = new Map(game.getStations().map((station) => [station.id, station]));
    return isTrainBlockingPendingRoute(train, line, stationMap);
  }

  update(
    dt: number,
    game: GameState,
    options: { applyPendingRoutes?: boolean } = {},
  ): { passengersChanged: boolean; routeApplied: boolean } {
    const applyPendingRoutes = options.applyPendingRoutes ?? true;
    let passengersChanged = false;
    let routeApplied = false;

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

      const atStationId = getTrainAtStationOnLine(train, line, stationMap);
      const stoppedAtStation = atStationId !== null || train.dwellRemaining > 0;

      if (
        applyPendingRoutes &&
        stoppedAtStation &&
        game.tryApplyPendingRoute(line.id, train)
      ) {
        routeApplied = true;
        const updatedRoute = game.getActiveRoute(line);
        const updatedStations = updatedRoute.stationIds
          .map((id) => stationMap.get(id))
          .filter((station): station is Station => Boolean(station));
        const updatedPathD = updatedRoute.isLoop
          ? routeOctilinear(updatedStations)
          : routeOctilinearOpen(updatedStations);
        if (updatedPathD) {
          train.displayAngle = pathAngleAtLength(updatedPathD, train.distance);
        }
        continue;
      }

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
        if (applyPendingRoutes && game.tryApplyPendingRoute(line.id, train)) {
          routeApplied = true;
          const updatedRoute = game.getActiveRoute(line);
          const updatedStations = updatedRoute.stationIds
            .map((id) => stationMap.get(id))
            .filter((station): station is Station => Boolean(station));
          const updatedPathD = updatedRoute.isLoop
            ? routeOctilinear(updatedStations)
            : routeOctilinearOpen(updatedStations);
          if (updatedPathD) {
            train.displayAngle = pathAngleAtLength(updatedPathD, train.distance);
          }
        } else {
          train.displayAngle = lerpAngle(
            train.displayAngle,
            pathAngleAtLength(pathD, train.distance),
            dt,
          );
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

      train.displayAngle = lerpAngle(
        train.displayAngle,
        pathAngleAtLength(pathD, train.distance),
        dt,
      );
    }

    return { passengersChanged, routeApplied };
  }

  getRenderStates(game: GameState, scale: number): TrainRenderState[] {
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
        scale,
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
        const travelDelta =
          train.direction > 0
            ? this.forwardDelta(from, to, totalLength)
            : this.backwardDelta(from, to, totalLength);
        const stopDelta =
          train.direction > 0
            ? this.forwardDelta(from, stop.distance, totalLength)
            : this.backwardDelta(from, stop.distance, totalLength);
        return stopDelta > 0 && stopDelta <= travelDelta + 0.5;
      }

      if (train.direction > 0) {
        return stop.distance > from + 0.5 && stop.distance <= to + 0.5;
      }

      return stop.distance < from - 0.5 && stop.distance >= to - 0.5;
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (!isLoop) {
        return train.direction > 0 ? a.distance - b.distance : b.distance - a.distance;
      }

      const deltaA =
        train.direction > 0
          ? this.forwardDelta(from, a.distance, totalLength)
          : this.backwardDelta(from, a.distance, totalLength);
      const deltaB =
        train.direction > 0
          ? this.forwardDelta(from, b.distance, totalLength)
          : this.backwardDelta(from, b.distance, totalLength);
      return deltaA - deltaB;
    });

    return candidates[0];
  }

  private forwardDelta(from: number, to: number, total: number): number {
    return ((to - from) % total + total) % total;
  }

  private backwardDelta(from: number, to: number, total: number): number {
    return ((from - to) % total + total) % total;
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

    const network = game.getTransitNetwork();
    const staying = [];

    for (const passenger of train.passengers) {
      if (!shouldPassengerAlight(passenger, stationId, station.shape)) {
        staying.push(passenger);
        continue;
      }

      changed = true;
      if (station.shape === passenger.destinationShape) {
        continue;
      }

      advancePassengerAfterAlight(passenger, stationId, station.shape);
      game.returnPassengerToPlatform(passenger);
    }

    train.passengers = staying;

    const waiting = game.getPassengersAtStation(stationId);

    for (const passenger of waiting) {
      if (train.passengers.length >= TRAIN_CAPACITY) break;
      if (!shouldPassengerBoard(passenger, train.lineId, stationId, network)) continue;
      if (game.boardPassenger(passenger.id)) {
        train.passengers.push(passenger);
        changed = true;
      }
    }

    return changed;
  }
}
