import {
  pathAngleAtLength,
  pathTotalLength,
  pointAtPathLength,
  routeOctilinear,
  routeOctilinearOpen,
  stationStopsOnPath,
} from "../geometry/octilinearRouter.ts";
import type { Point, Station, Train, TrainCar, UpgradeType } from "../model/types.ts";
import {
  BASE_TRAIN_CAPACITY,
  BASE_TRAIN_SPEED,
  CAR_SPACING,
  THRUSTER_SPEED_BONUS,
} from "../model/types.ts";
import { getTrainAtStationOnLine, isTrainBlockingPendingRoute, remapTrainToPendingRoute } from "./pendingRoute.ts";
import {
  advancePassengerAfterAlight,
  shouldPassengerAlight,
  shouldPassengerBoard,
} from "./passengerRouting.ts";
import type { GameState } from "./GameState.ts";

const PASSENGER_TRANSFER_DELAY = 0.2;
const STATION_THRESHOLD = 10;
const TRAIN_TURN_RATE = 14;

function lerpAngle(current: number, target: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  const maxStep = TRAIN_TURN_RATE * dt;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

function trainPathAngle(
  pathD: string,
  distance: number,
  direction: 1 | -1,
  isLoop: boolean,
): number {
  return pathAngleAtLength(pathD, distance, direction, isLoop);
}

function snapTrainAngle(
  train: Train,
  pathD: string,
  isLoop: boolean,
): void {
  train.displayAngle = trainPathAngle(pathD, train.distance, train.direction, isLoop);
}

function updateTrainAngle(
  train: Train,
  pathD: string,
  isLoop: boolean,
  dt: number,
): void {
  train.displayAngle = lerpAngle(
    train.displayAngle,
    trainPathAngle(pathD, train.distance, train.direction, isLoop),
    dt,
  );
}

function carDistance(train: Train, carIndex: number): number {
  return train.distance - carIndex * CAR_SPACING * train.direction;
}

function reverseConsist(train: Train): void {
  train.cars.reverse();
}

export type TrainRenderState = {
  train: Train;
  car: TrainCar;
  carIndex: number;
  isCarriage: boolean;
  x: number;
  y: number;
  angle: number;
  color: string;
  scale: number;
};

export class TrainSimulation {
  private readonly trains = new Map<string, Train>();
  private nextTrainIndex = 1;

  getTrains(): readonly Train[] {
    return [...this.trains.values()];
  }

  getTrainsOnLine(lineId: string): Train[] {
    return this.getTrains().filter((train) => train.lineId === lineId);
  }

  getTrain(trainId: string): Train | undefined {
    return this.trains.get(trainId);
  }

  shouldShowPendingFade(lineId: string, game: GameState): boolean {
    const line = game.getLine(lineId);
    if (!line || !game.hasPendingRoute(line)) return false;

    const stationMap = new Map(game.getStations().map((station) => [station.id, station]));
    return this.getTrainsOnLine(lineId).some((train) =>
      isTrainBlockingPendingRoute(train, line, stationMap),
    );
  }

  getRepresentativeTrain(lineId: string): Train | undefined {
    return this.getTrainsOnLine(lineId)[0];
  }

  remapAllTrainsOnLine(lineId: string, game: GameState): void {
    const line = game.getLine(lineId);
    if (!line) return;

    const stationMap = new Map(game.getStations().map((station) => [station.id, station]));
    for (const train of this.getTrainsOnLine(lineId)) {
      remapTrainToPendingRoute(train, line, stationMap);
    }
  }

  applyUpgradeToNearestTrain(
    lineId: string,
    upgrade: UpgradeType,
    dropPoint: Point,
    game: GameState,
  ): boolean {
    const line = game.getLine(lineId);
    if (!line || line.activeStationIds.length < 2) return false;

    const lineTrains = this.getTrainsOnLine(lineId);
    if (lineTrains.length === 0) return false;

    const stationMap = new Map(game.getStations().map((s) => [s.id, s]));
    const route = game.getActiveRoute(line);
    const stations = route.stationIds
      .map((id) => stationMap.get(id))
      .filter((station): station is Station => Boolean(station));

    const pathD = route.isLoop
      ? routeOctilinear(stations)
      : routeOctilinearOpen(stations);
    if (!pathD) return false;

    let nearestTrain = lineTrains[0];
    let nearestGap = Infinity;

    for (const train of lineTrains) {
      for (let carIndex = 0; carIndex < train.cars.length; carIndex += 1) {
        const point = pointAtPathLength(pathD, carDistance(train, carIndex), route.isLoop);
        const gap = Math.hypot(point.x - dropPoint.x, point.y - dropPoint.y);
        if (gap < nearestGap) {
          nearestGap = gap;
          nearestTrain = train;
        }
      }
    }

    if (upgrade === "thruster") {
      nearestTrain.speed += THRUSTER_SPEED_BONUS;
      return true;
    }

    if (upgrade === "carriage") {
      nearestTrain.cars.push(this.createCar());
      return true;
    }

    if (upgrade === "train") {
      const totalLength = pathTotalLength(pathD);
      const offset = totalLength / (lineTrains.length + 1);
      const newTrain = this.createTrain(lineId, {
        distance: offset * lineTrains.length,
        direction: lineTrains.length % 2 === 0 ? 1 : -1,
      });
      this.trains.set(newTrain.id, newTrain);
      snapTrainAngle(newTrain, pathD, route.isLoop);
      return true;
    }

    return false;
  }

  update(
    dt: number,
    game: GameState,
    options: { applyPendingRoutes?: boolean } = {},
  ): { passengersChanged: boolean; routeApplied: boolean } {
    if (game.hasPendingUpgradeChoice()) {
      return { passengersChanged: false, routeApplied: false };
    }

    const applyPendingRoutes = options.applyPendingRoutes ?? true;
    let passengersChanged = false;
    let routeApplied = false;

    for (const line of game.getLines()) {
      if (line.activeStationIds.length < 2) {
        for (const train of this.getTrainsOnLine(line.id)) {
          this.trains.delete(train.id);
        }
        continue;
      }

      if (this.getTrainsOnLine(line.id).length === 0) {
        const train = this.createTrain(line.id);
        this.trains.set(train.id, train);
      }

      const lineTrains = this.getTrainsOnLine(line.id);
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

      for (const train of lineTrains) {
        const result = this.updateTrain(
          train,
          line,
          pathD,
          totalLength,
          route.isLoop,
          stations,
          stationMap,
          game,
          dt,
          applyPendingRoutes,
        );
        if (result.passengersChanged) passengersChanged = true;
        if (result.routeApplied) routeApplied = true;
      }
    }

    return { passengersChanged, routeApplied };
  }

  private updateTrain(
    train: Train,
    line: NonNullable<ReturnType<GameState["getLine"]>>,
    pathD: string,
    totalLength: number,
    isLoop: boolean,
    stations: Station[],
    stationMap: Map<string, Station>,
    game: GameState,
    dt: number,
    applyPendingRoutes: boolean,
  ): { passengersChanged: boolean; routeApplied: boolean } {
    const atStationId = getTrainAtStationOnLine(train, line, stationMap);
    const stoppedAtStation = atStationId !== null || train.stopStationId !== null;

    if (
      applyPendingRoutes &&
      stoppedAtStation &&
      game.tryApplyPendingRoute(line.id, train)
    ) {
      const updatedRoute = game.getActiveRoute(line);
      const updatedStations = updatedRoute.stationIds
        .map((id) => stationMap.get(id))
        .filter((station): station is Station => Boolean(station));
      const updatedPathD = updatedRoute.isLoop
        ? routeOctilinear(updatedStations)
        : routeOctilinearOpen(updatedStations);
      if (updatedPathD) {
        snapTrainAngle(train, updatedPathD, updatedRoute.isLoop);
      }
      return { passengersChanged: false, routeApplied: true };
    }

    if (train.stopStationId) {
      train.transferCooldown = Math.max(0, train.transferCooldown - dt);
      if (train.transferCooldown <= 0) {
        if (
          this.processConsistTransfer(
            train,
            train.stopStationId,
            game,
            stationMap,
          )
        ) {
          train.transferCooldown = PASSENGER_TRANSFER_DELAY;
          return { passengersChanged: true, routeApplied: false };
        }

        train.stopStationId = null;
        if (isLoop) {
          snapTrainAngle(train, pathD, true);
        }
      }
      return { passengersChanged: false, routeApplied: false };
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
      isLoop,
    );

    if (crossed) {
      train.distance = crossed.distance;
      if (applyPendingRoutes && game.tryApplyPendingRoute(line.id, train)) {
        const updatedRoute = game.getActiveRoute(line);
        const updatedStations = updatedRoute.stationIds
          .map((id) => stationMap.get(id))
          .filter((station): station is Station => Boolean(station));
        const updatedPathD = updatedRoute.isLoop
          ? routeOctilinear(updatedStations)
          : routeOctilinearOpen(updatedStations);
        if (updatedPathD) {
          snapTrainAngle(train, updatedPathD, updatedRoute.isLoop);
        }
        train.stopStationId = crossed.stationId;
        train.transferCooldown = PASSENGER_TRANSFER_DELAY;
        train.lastStationId = crossed.stationId;
        return { passengersChanged: false, routeApplied: true };
      }

      if (isLoop) {
        snapTrainAngle(train, pathD, true);
      }
      train.stopStationId = crossed.stationId;
      train.transferCooldown = PASSENGER_TRANSFER_DELAY;
      train.lastStationId = crossed.stationId;
      return { passengersChanged: false, routeApplied: false };
    }

    if (isLoop) {
      train.distance = ((nextDistance % totalLength) + totalLength) % totalLength;
      updateTrainAngle(train, pathD, true, dt);
    } else if (nextDistance >= totalLength) {
      train.distance = totalLength;
      if (train.direction > 0) {
        train.direction = -1;
        reverseConsist(train);
      }
    } else if (nextDistance <= 0) {
      train.distance = 0;
      if (train.direction < 0) {
        train.direction = 1;
        reverseConsist(train);
      }
    } else {
      train.distance = nextDistance;
      updateTrainAngle(train, pathD, false, dt);
    }

    return { passengersChanged: false, routeApplied: false };
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

      train.cars.forEach((car, carIndex) => {
        const distance = carDistance(train, carIndex);
        const point = pointAtPathLength(pathD, distance, route.isLoop);
        states.push({
          train,
          car,
          carIndex,
          isCarriage: carIndex > 0,
          x: point.x,
          y: point.y,
          angle: pathAngleAtLength(pathD, distance, train.direction, route.isLoop),
          color: line.color,
          scale,
        });
      });
    }

    return states;
  }

  private createCar(): TrainCar {
    const id = `car-${this.nextTrainIndex}`;
    this.nextTrainIndex += 1;
    return {
      id,
      passengers: [],
      capacity: BASE_TRAIN_CAPACITY,
    };
  }

  private createTrain(
    lineId: string,
    options: { distance?: number; direction?: 1 | -1 } = {},
  ): Train {
    const id = `${lineId}-t${this.nextTrainIndex}`;
    this.nextTrainIndex += 1;
    return {
      id,
      lineId,
      cars: [this.createCar()],
      distance: options.distance ?? 0,
      direction: options.direction ?? 1,
      displayAngle: 0,
      speed: BASE_TRAIN_SPEED,
      stopStationId: null,
      transferCooldown: 0,
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

  private processConsistTransfer(
    train: Train,
    stationId: string,
    game: GameState,
    stationMap: Map<string, Station>,
  ): boolean {
    const station = stationMap.get(stationId);
    if (!station) return false;

    for (const car of train.cars) {
      if (this.alightOnePassenger(car, stationId, station, game)) return true;
    }

    for (const car of train.cars) {
      if (this.boardOnePassenger(car, train.lineId, stationId, game)) return true;
    }

    return false;
  }

  private alightOnePassenger(
    car: TrainCar,
    stationId: string,
    station: Station,
    game: GameState,
  ): boolean {
    for (let index = 0; index < car.passengers.length; index += 1) {
      const passenger = car.passengers[index];
      if (!shouldPassengerAlight(passenger, stationId, station.shape)) continue;

      car.passengers.splice(index, 1);
      if (station.shape === passenger.destinationShape) {
        game.recordDelivery();
      } else {
        advancePassengerAfterAlight(passenger, stationId, station.shape);
        game.returnPassengerToPlatform(passenger);
      }
      return true;
    }

    return false;
  }

  private boardOnePassenger(
    car: TrainCar,
    lineId: string,
    stationId: string,
    game: GameState,
  ): boolean {
    const network = game.getTransitNetwork();
    const waiting = game.getPassengersAtStation(stationId);

    for (const passenger of waiting) {
      if (car.passengers.length >= car.capacity) return false;
      if (!shouldPassengerBoard(passenger, lineId, stationId, network)) continue;
      if (game.boardPassenger(passenger.id)) {
        car.passengers.push(passenger);
        return true;
      }
    }

    return false;
  }
}
