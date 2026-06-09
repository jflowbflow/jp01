import { GameState, type DragOrigin } from "../game/GameState.ts";
import { Simulation } from "../game/simulation.ts";
import { shapeLabel, stationRadius } from "../game/stationSpawner.ts";
import {
  pathTotalLength,
  pointAtPathLength,
  routeOctilinear,
  routeOctilinearOpen,
} from "../geometry/octilinearRouter.ts";
import type { Passenger, Point, RoutedLine, Station } from "../model/types.ts";
import {
  createHitArea,
  createStationShape,
  passengerOffset,
} from "./stationShapes.ts";

const LINE_WIDTH = 7;
const TRAIN_RADIUS = 5;
const PASSENGER_SIZE = 4.5;
const BOUNCE_MS = 280;

type DragState = {
  origin: DragOrigin;
  pointerId: number;
  x: number;
  y: number;
  snapTargetId: string | null;
};

type BounceState = {
  lineId: string;
  from: Point;
  to: Point;
  startTime: number;
  addedOnDragStart: boolean;
};

export class MapRenderer {
  private readonly mapEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly game = new GameState();
  private readonly simulation = new Simulation(this.game);
  private readonly svg: SVGSVGElement;
  private readonly routesGroup: SVGGElement;
  private readonly previewGroup: SVGGElement;
  private readonly stationsGroup: SVGGElement;
  private readonly passengersGroup: SVGGElement;
  private readonly trainsGroup: SVGGElement;
  private routedLines: RoutedLine[] = [];
  private animationFrame = 0;
  private trainPhase = new Map<string, number>();
  private lastFrameTime = performance.now();
  private drag: DragState | null = null;
  private bounce: BounceState | null = null;
  private hoveredStationId: string | null = null;
  private pendingStationRedraw = false;
  private stationShapeElements = new Map<string, SVGElement>();

  constructor(mapEl: HTMLElement, legendEl: HTMLElement, statusEl: HTMLElement) {
    this.mapEl = mapEl;
    this.legendEl = legendEl;
    this.statusEl = statusEl;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", "0 0 900 560");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "Metro map builder");
    this.svg.style.touchAction = "none";

    this.routesGroup = this.createGroup("routes");
    this.previewGroup = this.createGroup("preview");
    this.stationsGroup = this.createGroup("stations");
    this.passengersGroup = this.createGroup("passengers");
    this.trainsGroup = this.createGroup("trains");

    this.svg.append(
      this.routesGroup,
      this.previewGroup,
      this.stationsGroup,
      this.passengersGroup,
      this.trainsGroup,
    );
    this.mapEl.replaceChildren(this.svg);

    this.stationsGroup.addEventListener("pointerdown", this.onStationPointerDown);
    this.svg.addEventListener("pointermove", this.onPointerMove);
    this.svg.addEventListener("pointerup", this.onPointerUp);
    this.svg.addEventListener("pointercancel", this.onPointerUp);

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

  private clientToSvg(clientX: number, clientY: number): Point {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };

    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  private findStationAt(clientX: number, clientY: number): Station | null {
    const point = this.clientToSvg(clientX, clientY);
    const hitRadius = this.getBaseRadius() + 14;
    let closest: Station | null = null;
    let closestDistance = Infinity;

    for (const station of this.game.getStations()) {
      const distance = Math.hypot(station.x - point.x, station.y - point.y);
      if (distance <= hitRadius && distance < closestDistance) {
        closest = station;
        closestDistance = distance;
      }
    }

    return closest;
  }

  private isInteracting(): boolean {
    return this.drag !== null || this.bounce !== null;
  }

  private refresh(): void {
    this.routedLines = this.buildRoutedLines();
    this.drawRoutes();
    this.drawTrains();
    this.drawLegend();
    this.updateStatus();
    this.drawPreview();
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
      if (station) {
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        marker.setAttribute("cx", String(station.x));
        marker.setAttribute("cy", String(station.y));
        marker.setAttribute("r", "4");
        marker.setAttribute("fill", active.color);
        marker.setAttribute("opacity", "0.8");
        this.routesGroup.append(marker);
      }
    }
  }

  private drawStations(): void {
    const active = this.game.getActiveLine();
    const baseRadius = this.getBaseRadius();
    this.stationShapeElements.clear();

    for (const station of this.game.getStations()) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "station");
      group.style.cursor = "grab";

      const onActiveLine = active.stationIds.includes(station.id);
      const isStart =
        active.stationIds.length > 0 && active.stationIds[0] === station.id;
      const isDragSource = this.drag?.origin.fromStationId === station.id;
      const isSnapTarget = this.drag?.snapTargetId === station.id;
      const radius =
        onActiveLine && !active.isLoop ? baseRadius + 2 : baseRadius;

      const hitArea = createHitArea(station.x, station.y, radius);
      hitArea.dataset.stationId = station.id;

      const hovered = this.hoveredStationId === station.id;
      const shape = createStationShape(station.shape, station.x, station.y, radius, {
        fill: hovered || isSnapTarget ? "#fffdf8" : "#f7f5f0",
        stroke: isSnapTarget
          ? active.color
          : onActiveLine
            ? active.color
            : isDragSource
              ? active.color
              : "#1a1a1e",
        strokeWidth: isSnapTarget || (onActiveLine && !active.isLoop) ? 4 : 3,
      });
      shape.setAttribute("pointer-events", "none");
      this.stationShapeElements.set(station.id, shape);

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
      this.stationsGroup.append(group);
    }
  }

  private redrawStations(): void {
    this.stationsGroup.replaceChildren();
    this.drawStations();
  }

  private updateStationHover(stationId: string | null): void {
    if (this.hoveredStationId === stationId) return;

    const previous = this.hoveredStationId;
    this.hoveredStationId = stationId;

    if (previous) {
      const prevShape = this.stationShapeElements.get(previous);
      if (prevShape && previous !== this.drag?.snapTargetId) {
        prevShape.setAttribute("fill", "#f7f5f0");
      }
    }

    if (stationId) {
      const shape = this.stationShapeElements.get(stationId);
      if (shape && stationId !== this.drag?.snapTargetId) {
        shape.setAttribute("fill", "#fffdf8");
      }
    }
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

  private drawPreview(): void {
    this.previewGroup.replaceChildren();

    const stationMap = this.getStationMap();
    let lineColor = this.game.getActiveLine().color;
    let fromStation: Station | undefined;
    let endPoint: Point | undefined;

    const drag = this.drag;
    const bounce = this.bounce;

    if (drag) {
      const line = this.game.getLines().find((entry) => entry.id === drag.origin.lineId);
      if (!line) return;

      lineColor = line.color;
      fromStation = stationMap.get(drag.origin.fromStationId);
      const snapStation = drag.snapTargetId
        ? stationMap.get(drag.snapTargetId)
        : undefined;
      endPoint = snapStation ?? { x: drag.x, y: drag.y };
    } else if (bounce) {
      const line = this.game.getLines().find((entry) => entry.id === bounce.lineId);
      if (!line) return;

      lineColor = line.color;
      const fromStationId = line.stationIds[line.stationIds.length - 1];
      fromStation = fromStationId ? stationMap.get(fromStationId) : undefined;

      const elapsed = performance.now() - bounce.startTime;
      const t = Math.min(1, elapsed / BOUNCE_MS);
      const eased = 1 - (1 - t) ** 3;
      endPoint = {
        x: bounce.from.x + (bounce.to.x - bounce.from.x) * eased,
        y: bounce.from.y + (bounce.to.y - bounce.from.y) * eased,
      };
    }

    if (!fromStation || !endPoint) return;

    const pathD = routeOctilinearOpen([fromStation, endPoint]);
    if (!pathD) return;

    const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
    preview.setAttribute("d", pathD);
    preview.setAttribute("fill", "none");
    preview.setAttribute("stroke", lineColor);
    preview.setAttribute("stroke-width", String(LINE_WIDTH));
    preview.setAttribute("stroke-linecap", "round");
    preview.setAttribute("stroke-linejoin", "round");
    preview.setAttribute("opacity", this.bounce ? "0.55" : "0.75");
    preview.setAttribute("stroke-dasharray", this.bounce ? "none" : "10 8");
    this.previewGroup.append(preview);
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
          if (this.isInteracting()) return;
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

    const dragHint = this.drag
      ? "Release on a station to connect."
      : "Drag between stations to draw routes.";

    this.statusEl.textContent =
      `Week ${this.game.getWeek()} · ${this.game.getStations().length} stations · ` +
      `Shapes: ${unlocked} · ` +
      `Active: ${active.name}. ${dragHint} ` +
      `Lines: ${built}/3 · Loops: ${loops}/3 · Undo: Backspace`;
  }

  private finishInteractionRefresh(): void {
    if (this.pendingStationRedraw) {
      this.redrawStations();
      this.pendingStationRedraw = false;
    } else {
      this.redrawStations();
    }
    this.refresh();
  }

  private onStationPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.isInteracting()) return;

    const target = (event.target as Element).closest<SVGElement>("[data-station-id]");
    if (!target) return;

    const stationId = target.dataset.stationId;
    if (!stationId) return;

    const origin = this.game.beginDragFrom(stationId);
    if (!origin) return;

    event.preventDefault();
    event.stopPropagation();
    this.svg.setPointerCapture(event.pointerId);

    const point = this.clientToSvg(event.clientX, event.clientY);
    this.drag = {
      origin,
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      snapTargetId: null,
    };

    this.svg.style.cursor = "grabbing";
    this.drawPreview();
    this.redrawStations();
    this.updateStatus();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      const point = this.clientToSvg(event.clientX, event.clientY);
      const hovered = this.findStationAt(event.clientX, event.clientY);
      const previousSnap = this.drag.snapTargetId;
      const snapTargetId =
        hovered &&
        hovered.id !== this.drag.origin.fromStationId &&
        this.game.canConnectDragTarget(this.drag.origin.fromStationId, hovered.id)
          ? hovered.id
          : null;

      this.drag = {
        ...this.drag,
        x: point.x,
        y: point.y,
        snapTargetId,
      };

      this.drawPreview();
      if (snapTargetId !== previousSnap) {
        this.redrawStations();
      }
      return;
    }

    if (!this.isInteracting()) {
      const hovered = this.findStationAt(event.clientX, event.clientY);
      this.updateStationHover(hovered?.id ?? null);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;

    const { origin, x, y, snapTargetId } = this.drag;
    this.drag = null;
    this.svg.releasePointerCapture(event.pointerId);
    this.svg.style.cursor = "";

    if (
      snapTargetId &&
      this.game.canConnectDragTarget(origin.fromStationId, snapTargetId) &&
      this.game.addStation(snapTargetId)
    ) {
      this.finishInteractionRefresh();
      return;
    }

    const stationMap = this.getStationMap();
    const fromStation = stationMap.get(origin.fromStationId);
    if (!fromStation) {
      this.game.cancelDrag(origin.addedOnDragStart);
      this.finishInteractionRefresh();
      return;
    }

    this.bounce = {
      lineId: origin.lineId,
      from: { x, y },
      to: { x: fromStation.x, y: fromStation.y },
      startTime: performance.now(),
      addedOnDragStart: origin.addedOnDragStart,
    };

    this.drawPreview();
    this.redrawStations();
    this.updateStatus();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Backspace" || this.isInteracting()) return;
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
        const latest = this.game.getStations().at(-1);
        if (latest) {
          this.simulation.onStationSpawned(latest.id);
        }

        if (this.isInteracting()) {
          this.pendingStationRedraw = true;
        } else {
          this.redrawStations();
          this.refresh();
        }
      } else if (update.passengersChanged && !this.isInteracting()) {
        this.drawPassengers();
        this.updateStatus();
      }

      if (this.bounce) {
        this.drawPreview();
        if (now - this.bounce.startTime >= BOUNCE_MS) {
          this.game.cancelDrag(this.bounce.addedOnDragStart);
          this.bounce = null;
          this.previewGroup.replaceChildren();
          this.finishInteractionRefresh();
        }
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
    this.stationsGroup.removeEventListener("pointerdown", this.onStationPointerDown);
    this.svg.removeEventListener("pointermove", this.onPointerMove);
    this.svg.removeEventListener("pointerup", this.onPointerUp);
    this.svg.removeEventListener("pointercancel", this.onPointerUp);
  }
}
