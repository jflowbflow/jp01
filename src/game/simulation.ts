import {
  BASE_PASSENGER_SPAWN_INTERVAL,
  BASE_STATION_SPAWN_INTERVAL,
  INITIAL_STATION_COUNT,
  MAX_STATIONS,
  MIN_STATION_SPAWN_INTERVAL,
} from "../data/network.ts";
import type { GameState } from "./GameState.ts";

export type SimulationUpdate = {
  stationsChanged: boolean;
  passengersChanged: boolean;
};

export class Simulation {
  private stationSpawnTimer = 2.5;
  private passengerTimers = new Map<string, number>();

  constructor(private readonly game: GameState) {
    for (const station of game.getStations()) {
      this.passengerTimers.set(station.id, 1 + Math.random() * 2);
    }
  }

  update(dt: number): SimulationUpdate {
    let stationsChanged = false;
    let passengersChanged = false;

    if (this.game.getStations().length < MAX_STATIONS) {
      this.stationSpawnTimer -= dt;
      if (this.stationSpawnTimer <= 0) {
        if (this.game.spawnStation()) {
          stationsChanged = true;
        }
        this.stationSpawnTimer = this.nextStationSpawnInterval();
      }
    }

    for (const station of this.game.getStations()) {
      let timer = this.passengerTimers.get(station.id) ?? BASE_PASSENGER_SPAWN_INTERVAL;
      timer -= dt;

      if (timer <= 0) {
        if (this.game.spawnPassengerAt(station.id)) {
          passengersChanged = true;
        }
        timer = this.nextPassengerSpawnInterval(station.id);
      }

      this.passengerTimers.set(station.id, timer);
    }

    const stationIds = new Set(this.game.getStations().map((station) => station.id));
    for (const id of this.passengerTimers.keys()) {
      if (!stationIds.has(id)) {
        this.passengerTimers.delete(id);
      }
    }

    return { stationsChanged, passengersChanged };
  }

  onStationSpawned(stationId: string): void {
    this.passengerTimers.set(stationId, 0.8 + Math.random() * 1.5);
  }

  private nextStationSpawnInterval(): number {
    const count = this.game.getStations().length;
    const progress = Math.min(
      1,
      Math.max(0, (count - INITIAL_STATION_COUNT) / (MAX_STATIONS - INITIAL_STATION_COUNT)),
    );
    return (
      BASE_STATION_SPAWN_INTERVAL -
      (BASE_STATION_SPAWN_INTERVAL - MIN_STATION_SPAWN_INTERVAL) * progress +
      Math.random() * 1.5
    );
  }

  private nextPassengerSpawnInterval(stationId: string): number {
    const queueSize = this.game.getPassengersAtStation(stationId).length;
    const pressure = Math.min(queueSize * 0.35, 1.4);
    return BASE_PASSENGER_SPAWN_INTERVAL + Math.random() * 2 - pressure;
  }
}
