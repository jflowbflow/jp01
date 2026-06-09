import { GameState } from "../game/GameState.ts";
import { Simulation } from "../game/simulation.ts";
import { shapeLabel, stationRadius } from "../game/stationSpawner.ts";
import {
  pathTotalLength,
  pointAtPathLength,
  routeOctilinear,
  routeOctilinearOpen,
} from "../geometry/octilinearRouter.ts";
import type { Passenger, RoutedLine, Station } from "../model/types.ts";
import {
  createHitArea,
  createStationShape,
  passengerOffset,
} from "./stationShapes.ts";

const LINE_WIDTH = 7;
const TRAIN_RADIUS = 5;
const PASSENGER_SIZE = 4.5;

export class MapRenderer {
  private readonly mapEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly game = new GameState();
  private readonly simulation = new Simulation(this.game);
  private readonly svg: SVGSVGElement;
  private readonly routesGroup: SVGGElement;
  private readonly stationsGroup: SVGGElement;
  private readonly passengersGroup: SVGGElement;
  private readonly trainsGroup: SVGGElement;
  private routedLines: RoutedLine[] = [];
  private animationFrame = 0;
  private trainPhase = new Map<string, number>();
  private lastFrameTime = performance.now();

  constructor(mapEl: HTMLElement, legendEl: HTMLElement, statusEl: HTMLElement) {
    this.mapEl = mapEl;
    this.legendEl = legendEl;
    this.statusEl = statusEl;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", "0 0 900 560");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "Metro map builder");

    this.routesGroup = this.createGroup("routes");
    this.stationsGroup = this.createGroup("stations");
    this.passengersGroup = this.createGroup("passengers");
    this.trainsGroup = this.createGroup("trains");

    this.svg.append(
      this.routesGroup,
      this.stationsGroup,
      this.passengersGroup,
      this.trainsGroup,
    );
    this.mapEl.replaceChildren(this.svg);

    this.redrawStations();
    this.drawPassengers();
    this.refresh();
    this.startAnimation();

    window.addEventListener("keydown", this.onKeyDown);
  }

  private createGroup(className: string): SVGGElement {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", className);
    return group;
  }

  private getStationMap(): Map<string, Station> {
    return new Map(this.game.getStations().map((station) => [station.id, station]));
  }

  private getBaseRadius(): number {
    return stationRadius(this.game.getStations().length);
  }

  private refresh(): void {
    this.routedLines = this.buildRoutedLines();
    this.drawRoutes();
    this.drawTrains();
    this.drawLegend();
    this.updateStatus();
  }

  private buildRoutedLines(): RoutedLine[] {
    const stationMap = this.getStationMap();

    return this.game.getLines().flatMap((line) => {
      const lineStations = line.stationIds
        .map((id) => stationMap.get(id))
        .filter((station): station is Station => Boolean(station));

      if (lineStations.length < 2) return [];

      const pathD = line.isLoop
        ? routeOctilinear(lineStations)
        : routeOctilinearOpen(lineStations);

      if (!pathD) return [];

      return [
        {
          line,
          stations: lineStations,
          pathD,
          totalLength: pathTotalLength(pathD),
        },
      ];
    });
  }

  private drawRoutes(): void {
    this.routesGroup.replaceChildren();
    const stationMap = this.getStationMap();

    for (const routed of this.routedLines) {
      const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
      track.setAttribute("d", routed.pathD);
      track.setAttribute("fill", "none");
      track.setAttribute("stroke", routed.line.color);
      track.setAttribute("stroke-width", String(LINE_WIDTH));
      track.setAttribute("stroke-linecap", "round");
      track.setAttribute("stroke-linejoin", "round");
      track.setAttribute("opacity", "0.95");
      this.routesGroup.append(track);
    }

    const active = this.game.getActiveLine();
    if (!active.isLoop && active.stationIds.length === 1) {
      const station = stationMap.get(active.stationIds[0]);
      if (!station) return;

      const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      marker.setAttribute("cx", String(station.x));
      marker.setAttribute("cy", String(station.y));
      marker.setAttribute("r", "4");
      marker.setAttribute("fill", active.color);
      marker.setAttribute("opacity", "0.8");
      this.routesGroup.append(marker);
    }
  }

  private drawStations(): void {
    const active = this.game.getActiveLine();
    const baseRadius = this.getBaseRadius();

    for (const station of this.game.getStations()) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "station");
      group.style.cursor = "pointer";

      const onActiveLine = active.stationIds.includes(station.id);
      const isStart =
        active.stationIds.length > 0 && active.stationIds[0] === station.id;
      const radius =
        onActiveLine && !active.isLoop ? baseRadius + 2 : baseRadius;

      const hitArea = createHitArea(station.x, station.y, radius);
      hitArea.dataset.stationId = station.id;

      const shape = createStationShape(station.shape, station.x, station.y, radius, {
        fill: "#f7f5f0",
        stroke: onActiveLine ? active.color : "#1a1a1e",
        strokeWidth: onActiveLine ? 4 : 3,
      });
      shape.setAttribute("pointer-events", "none");

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(station.x));
      label.setAttribute("y", String(station.y - radius - 8));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#d8d4cb");
      label.setAttribute("font-size", String(Math.max(10, radius + 1)));
      label.setAttribute(
        "font-family",
        "Avenir Next, Segoe UI, system-ui, sans-serif",
      );
      label.setAttribute("pointer-events", "none");
      label.textContent =
        isStart && active.stationIds.length > 1
          ? `${shapeLabel(station.shape)} ${station.name} ↺`
          : `${shapeLabel(station.shape)} ${station.name}`;

      group.append(hitArea, shape, label);
      group.addEventListener("click", () => this.onStationClick(station.id));
      group.addEventListener("mouseenter", () => {
        shape.setAttribute("fill", "#fffdf8");
      });
      group.addEventListener("mouseleave", () => {
        shape.setAttribute("fill", "#f7f5f0");
      });

      this.stationsGroup.append(group);
    }
  }

  private redrawStations(): void {
    this.stationsGroup.replaceChildren();
    this.drawStations();
  }

  private drawPassengers(): void {
    this.passengersGroup.replaceChildren();
    const stationMap = this.getStationMap();
    const baseRadius = this.getBaseRadius();

    const passengersByStation = new Map<string, Passenger[]>();
    for (const passenger of this.game.getPassengers()) {
      const queue = passengersByStation.get(passenger.stationId) ?? [];
      queue.push(passenger);
      passengersByStation.set(passenger.stationId, queue);
    }

    for (const [stationId, queue] of passengersByStation) {
      const station = stationMap.get(stationId);
      if (!station) continue;

      queue.forEach((passenger, index) => {
        const offset = passengerOffset(index, baseRadius);
        const x = station.x + offset.x;
        const y = station.y + offset.y;

        const icon = createStationShape(
          passenger.destinationShape,
          x,
          y,
          PASSENGER_SIZE,
          {
            fill: "#ffffff",
            stroke: "#1a1a1e",
            strokeWidth: 1.5,
          },
        );
        icon.setAttribute("pointer-events", "none");
        icon.setAttribute("opacity", "0.95");
        this.passengersGroup.append(icon);
      });
    }
  }

  private drawTrains(): void {
    this.trainsGroup.replaceChildren();

    for (const routed of this.routedLines) {
      const train = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      train.setAttribute("r", String(TRAIN_RADIUS));
      train.setAttribute("fill", "#ffffff");
      train.setAttribute("stroke", routed.line.color);
      train.setAttribute("stroke-width", "3");
      train.dataset.lineId = routed.line.id;
      this.trainsGroup.append(train);

      if (!this.trainPhase.has(routed.line.id)) {
        this.trainPhase.set(routed.line.id, Math.random());
      }
    }
  }

  private drawLegend(): void {
    const activeId = this.game.getActiveLineId();

    this.legendEl.replaceChildren(
      ...this.game.getLines().map((line) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `legend-item${line.id === activeId ? " legend-item--active" : ""}${line.stationIds.length === 0 ? " legend-item--empty" : ""}`;
        item.setAttribute("aria-pressed", String(line.id === activeId));

        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.background = line.color;
        if (line.stationIds.length === 0) {
          swatch.style.opacity = "0.35";
        }

        const text = document.createElement("span");
        text.className = "legend-text";
        text.innerHTML = `<strong>${line.name}</strong><span>${this.game.getLineStatus(line)}</span>`;

        item.append(swatch, text);
        item.addEventListener("click", () => {
          this.game.setActiveLine(line.id);
          this.redrawStations();
          this.refresh();
        });

        return item;
      }),
    );
  }

  private updateStatus(): void {
    const active = this.game.getActiveLine();
    const built = this.game.getLines().filter((line) => line.stationIds.length > 0).length;
    const loops = this.game.getLines().filter((line) => line.isLoop).length;
    const unlocked = this.game
      .getUnlockedShapes()
      .map((shape) => shapeLabel(shape))
      .join(" ");

    this.statusEl.textContent =
      `Week ${this.game.getWeek()} · ${this.game.getStations().length} stations · ` +
      `Shapes: ${unlocked} · ` +
      `Active: ${active.name}. Click stations to draw routes. ` +
      `Lines: ${built}/3 · Loops: ${loops}/3 · Undo: Backspace`;
  }

  private onStationClick(stationId: string): void {
    if (this.game.addStation(stationId)) {
      this.redrawStations();
      this.refresh();
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Backspace") return;
    event.preventDefault();
    if (this.game.undoLastStation()) {
      this.redrawStations();
      this.refresh();
    }
  };

  private startAnimation(): void {
    const speeds = [0.045, 0.035, 0.03];

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;

      this.game.advanceTime(dt);
      const update = this.simulation.update(dt);

      if (update.stationsChanged) {
        this.redrawStations();
        this.refresh();
        const latest = this.game.getStations().at(-1);
        if (latest) {
          this.simulation.onStationSpawned(latest.id);
        }
      } else if (update.passengersChanged) {
        this.drawPassengers();
        this.updateStatus();
      }

      this.routedLines.forEach((routed, index) => {
        const train = this.trainsGroup.querySelector<SVGCircleElement>(
          `circle[data-line-id="${routed.line.id}"]`,
        );
        if (!train || routed.totalLength === 0) return;

        const speed = speeds[index % speeds.length];
        const phase = this.trainPhase.get(routed.line.id) ?? 0;
        const time = now / 1000;

        let distance: number;
        if (routed.line.isLoop) {
          const progress = (time * speed + phase) % 1;
          distance = progress * routed.totalLength;
        } else {
          const progress =
            (Math.sin((time + phase * 10) * speed * Math.PI * 2) + 1) / 2;
          distance = progress * routed.totalLength;
        }

        const point = pointAtPathLength(routed.pathD, distance);
        train.setAttribute("cx", String(point.x));
        train.setAttribute("cy", String(point.y));
      });

      this.animationFrame = requestAnimationFrame(tick);
    };

    this.animationFrame = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
