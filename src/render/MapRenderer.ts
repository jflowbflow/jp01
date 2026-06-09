import { GameState, type DragOrigin } from "../game/GameState.ts";
import { Simulation } from "../game/simulation.ts";
import { shapeLabel, stationRadius } from "../game/stationSpawner.ts";
import {
  pathTotalLength,
  pointAtPathLength,
  routeOctilinear,
  routeOctilinearOpen,
} from "../geometry/octilinearRouter.ts";
import type { Passenger, PlayerLine, Point, RoutedLine, Station } from "../model/types.ts";
import { loopHandlePath, loopHandleTip } from "./loopHandle.ts";
import {
  createHitArea,
  createStationShape,
  passengerOffset,
} from "./stationShapes.ts";
import { MapViewport } from "./viewport.ts";

const LINE_WIDTH = 7;
const ROUTE_HIT_WIDTH = 22;
const TRAIN_RADIUS = 5;
const PASSENGER_SIZE = 4.5;
const BOUNCE_MS = 280;
const HOLD_MS = 320;
const HOLD_CANCEL_PX = 12;

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
  origin: DragOrigin;
};

type PendingHold = {
  kind: "station" | "segment" | "handle";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startedAt: number;
  stationId?: string;
  lineId?: string;
  segmentIndex?: number;
};

type PanState = {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
};

type LinePicker = {
  stationId: string;
  lines: PlayerLine[];
  pointerId: number;
};

export class MapRenderer {
  private readonly mapEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly game = new GameState();
  private readonly simulation = new Simulation(this.game);
  private readonly viewport = new MapViewport();
  private readonly svg: SVGSVGElement;
  private readonly routesGroup: SVGGElement;
  private readonly routeHitsGroup: SVGGElement;
  private readonly previewGroup: SVGGElement;
  private readonly handlesGroup: SVGGElement;
  private readonly stationsGroup: SVGGElement;
  private readonly passengersGroup: SVGGElement;
  private readonly trainsGroup: SVGGElement;
  private readonly pickerGroup: SVGGElement;
  private routedLines: RoutedLine[] = [];
  private animationFrame = 0;
  private trainPhase = new Map<string, number>();
  private lastFrameTime = performance.now();
  private drag: DragState | null = null;
  private bounce: BounceState | null = null;
  private pendingHold: PendingHold | null = null;
  private pan: PanState | null = null;
  private linePicker: LinePicker | null = null;
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
    this.routeHitsGroup = this.createGroup("route-hits");
    this.previewGroup = this.createGroup("preview");
    this.handlesGroup = this.createGroup("handles");
    this.stationsGroup = this.createGroup("stations");
    this.passengersGroup = this.createGroup("passengers");
    this.trainsGroup = this.createGroup("trains");
    this.pickerGroup = this.createGroup("picker");

    this.svg.append(
      this.routesGroup,
      this.routeHitsGroup,
      this.previewGroup,
      this.handlesGroup,
      this.stationsGroup,
      this.passengersGroup,
      this.trainsGroup,
      this.pickerGroup,
    );
    this.mapEl.replaceChildren(this.svg);
    this.viewport.apply(this.svg);

    this.svg.addEventListener("pointerdown", this.onPointerDown);
    this.svg.addEventListener("pointermove", this.onPointerMove);
    this.svg.addEventListener("pointerup", this.onPointerUp);
    this.svg.addEventListener("pointercancel", this.onPointerUp);
    this.mapEl.addEventListener("wheel", this.onWheel, { passive: false });

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

  private clientToWorld(clientX: number, clientY: number): Point {
    return this.viewport.clientToWorld(this.svg, clientX, clientY);
  }

  private findStationAt(clientX: number, clientY: number): Station | null {
    const point = this.clientToWorld(clientX, clientY);
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
    return (
      this.drag !== null ||
      this.bounce !== null ||
      this.pendingHold !== null ||
      this.linePicker !== null
    );
  }

  private refresh(): void {
    this.routedLines = this.buildRoutedLines();
    this.drawRoutes();
    this.drawRouteHits();
    this.drawLoopHandles();
    this.drawTrains();
    this.drawLegend();
    this.updateStatus();
    this.drawPreview();
    this.drawLinePicker();
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

    for (const routed of this.routedLines) {
      const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
      track.setAttribute("d", routed.pathD);
      track.setAttribute("fill", "none");
      track.setAttribute("stroke", routed.line.color);
      track.setAttribute("stroke-width", String(LINE_WIDTH));
      track.setAttribute("stroke-linecap", "round");
      track.setAttribute("stroke-linejoin", "round");
      track.setAttribute("opacity", "0.95");
      track.setAttribute("pointer-events", "none");
      this.routesGroup.append(track);
    }
  }

  private drawRouteHits(): void {
    this.routeHitsGroup.replaceChildren();
    const stationMap = this.getStationMap();

    for (const line of this.game.getLines()) {
      if (line.stationIds.length < 2) continue;

      const segmentCount = line.isLoop
        ? line.stationIds.length
        : line.stationIds.length - 1;

      for (let index = 0; index < segmentCount; index += 1) {
        const fromId = line.stationIds[index];
        const toId =
          index < line.stationIds.length - 1
            ? line.stationIds[index + 1]
            : line.stationIds[0];

        const from = stationMap.get(fromId);
        const to = stationMap.get(toId);
        if (!from || !to) continue;

        const pathD = routeOctilinearOpen([from, to]);
        if (!pathD) continue;

        const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hit.setAttribute("d", pathD);
        hit.setAttribute("fill", "none");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", String(ROUTE_HIT_WIDTH));
        hit.setAttribute("stroke-linecap", "round");
        hit.setAttribute("stroke-linejoin", "round");
        hit.style.cursor = "grab";
        hit.dataset.lineId = line.id;
        hit.dataset.segmentIndex = String(index);
        this.routeHitsGroup.append(hit);
      }
    }
  }

  private drawLoopHandles(): void {
    this.handlesGroup.replaceChildren();
    const stationMap = this.getStationMap();

    for (const line of this.game.getLines()) {
      if (!line.isLoop || !line.loopHandleStationId) continue;

      const station = stationMap.get(line.loopHandleStationId);
      if (!station) continue;

      const tip = loopHandleTip(station);
      const stem = document.createElementNS("http://www.w3.org/2000/svg", "path");
      stem.setAttribute("d", loopHandlePath(station));
      stem.setAttribute("fill", "none");
      stem.setAttribute("stroke", line.color);
      stem.setAttribute("stroke-width", String(LINE_WIDTH));
      stem.setAttribute("stroke-linecap", "round");
      stem.setAttribute("pointer-events", "none");

      const knob = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      knob.setAttribute("cx", String(tip.x));
      knob.setAttribute("cy", String(tip.y));
      knob.setAttribute("r", "8");
      knob.setAttribute("fill", "#f7f5f0");
      knob.setAttribute("stroke", line.color);
      knob.setAttribute("stroke-width", "3");
      knob.style.cursor = "grab";
      knob.dataset.loopHandle = line.id;

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hit.setAttribute("cx", String(tip.x));
      hit.setAttribute("cy", String(tip.y));
      hit.setAttribute("r", "16");
      hit.setAttribute("fill", "transparent");
      hit.style.cursor = "grab";
      hit.dataset.loopHandle = line.id;

      this.handlesGroup.append(stem, knob, hit);
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

      const lineColors = this.game
        .getLines()
        .filter((line) => line.stationIds.includes(station.id))
        .map((line) => line.color);
      const onActiveLine = active.stationIds.includes(station.id);
      const isDragSource = this.drag?.origin.fromStationId === station.id;
      const isSnapTarget = this.drag?.snapTargetId === station.id;
      const radius =
        onActiveLine && !active.isLoop ? baseRadius + 2 : baseRadius;

      const hitArea = createHitArea(station.x, station.y, radius);
      hitArea.dataset.stationId = station.id;

      const hovered = this.hoveredStationId === station.id;
      const stroke =
        isSnapTarget || isDragSource
          ? active.color
          : lineColors.length === 1
            ? lineColors[0]
            : lineColors.length > 1
              ? "#f0c040"
              : onActiveLine
                ? active.color
                : "#1a1a1e";

      const shape = createStationShape(station.shape, station.x, station.y, radius, {
        fill: hovered || isSnapTarget ? "#fffdf8" : "#f7f5f0",
        stroke,
        strokeWidth: isSnapTarget || lineColors.length > 1 ? 4 : 3,
      });
      shape.setAttribute("pointer-events", "none");
      this.stationShapeElements.set(station.id, shape);

      group.append(hitArea, shape);
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
        const icon = createStationShape(
          passenger.destinationShape,
          station.x + offset.x,
          station.y + offset.y,
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
      train.setAttribute("pointer-events", "none");
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
    let fromPoint: Point | undefined;
    let endPoint: Point | undefined;

    const drag = this.drag;
    const bounce = this.bounce;

    if (drag) {
      const line = this.game.getLine(drag.origin.lineId);
      if (!line) return;

      lineColor = line.color;

      if (drag.origin.mode === "unloop") {
        const station = stationMap.get(drag.origin.fromStationId);
        if (!station) return;
        fromPoint = loopHandleTip(station);
      } else {
        const station = stationMap.get(drag.origin.fromStationId);
        if (!station) return;
        fromPoint = station;
      }

      const snapStation = drag.snapTargetId
        ? stationMap.get(drag.snapTargetId)
        : undefined;
      endPoint = snapStation ?? { x: drag.x, y: drag.y };
    } else if (bounce) {
      const line = this.game.getLine(bounce.lineId);
      if (!line) return;

      lineColor = line.color;
      const station = stationMap.get(bounce.origin.fromStationId);
      if (!station) return;

      fromPoint =
        bounce.origin.mode === "unloop"
          ? loopHandleTip(station)
          : station;

      const elapsed = performance.now() - bounce.startTime;
      const t = Math.min(1, elapsed / BOUNCE_MS);
      const eased = 1 - (1 - t) ** 3;
      endPoint = {
        x: bounce.from.x + (bounce.to.x - bounce.from.x) * eased,
        y: bounce.from.y + (bounce.to.y - bounce.from.y) * eased,
      };
    }

    if (!fromPoint || !endPoint) return;

    const pathD = routeOctilinearOpen([fromPoint, endPoint]);
    if (!pathD) return;

    const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
    preview.setAttribute("d", pathD);
    preview.setAttribute("fill", "none");
    preview.setAttribute("stroke", lineColor);
    preview.setAttribute("stroke-width", String(LINE_WIDTH));
    preview.setAttribute("stroke-linecap", "round");
    preview.setAttribute("stroke-linejoin", "round");
    preview.setAttribute("opacity", bounce ? "0.55" : "0.8");
    preview.setAttribute("stroke-dasharray", bounce ? "none" : "10 8");
    preview.setAttribute("pointer-events", "none");
    this.previewGroup.append(preview);
  }

  private drawLinePicker(): void {
    this.pickerGroup.replaceChildren();
    if (!this.linePicker) return;

    const station = this.getStationMap().get(this.linePicker.stationId);
    if (!station) return;

    const count = this.linePicker.lines.length;
    this.linePicker.lines.forEach((line, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2) / count) * index;
      const x = station.x + Math.cos(angle) * 34;
      const y = station.y + Math.sin(angle) * 34;

      const button = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      button.setAttribute("cx", String(x));
      button.setAttribute("cy", String(y));
      button.setAttribute("r", "11");
      button.setAttribute("fill", line.color);
      button.setAttribute("stroke", "#f7f5f0");
      button.setAttribute("stroke-width", "3");
      button.style.cursor = "pointer";
      button.dataset.pickerLineId = line.id;
      button.dataset.pickerStationId = this.linePicker!.stationId;
      this.pickerGroup.append(button);
    });
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

    let hint = "Hold a station or line, then drag. Scroll to zoom.";
    if (this.linePicker) hint = "Choose a line color to drag from.";
    else if (this.drag?.origin.mode === "insert") hint = "Release on a station to insert.";
    else if (this.drag?.origin.mode === "unloop") hint = "Release to open the loop.";
    else if (this.drag) hint = "Release on a station to connect.";

    this.statusEl.textContent =
      `Week ${this.game.getWeek()} · ${this.game.getStations().length} stations · ` +
      `Shapes: ${unlocked} · Active: ${active.name}. ${hint} ` +
      `Lines: ${built}/3 · Loops: ${loops}/3 · Undo: Backspace`;
  }

  private finishInteractionRefresh(): void {
    if (this.pendingStationRedraw) {
      this.pendingStationRedraw = false;
    }
    this.redrawStations();
    this.refresh();
  }

  private startDrag(origin: DragOrigin, pointerId: number, x: number, y: number): void {
    this.linePicker = null;
    this.pendingHold = null;
    this.drag = {
      origin,
      pointerId,
      x,
      y,
      snapTargetId: null,
    };
    this.svg.setPointerCapture(pointerId);
    this.svg.style.cursor = "grabbing";
    this.drawPreview();
    this.redrawStations();
    this.updateStatus();
  }

  private activatePendingHold(): void {
    const pending = this.pendingHold;
    if (!pending) return;

    if (pending.kind === "segment" && pending.lineId !== undefined && pending.segmentIndex !== undefined) {
      const origin = this.game.beginInsertDrag(pending.lineId, pending.segmentIndex);
      if (origin) {
        const point = this.clientToWorld(pending.startClientX, pending.startClientY);
        this.startDrag(origin, pending.pointerId, point.x, point.y);
      }
      return;
    }

    if (pending.kind === "handle" && pending.lineId) {
      const origin = this.game.beginUnloopDrag(pending.lineId);
      if (origin) {
        const station = this.getStationMap().get(origin.fromStationId);
        const point = station ? loopHandleTip(station) : this.clientToWorld(pending.startClientX, pending.startClientY);
        this.startDrag(origin, pending.pointerId, point.x, point.y);
      }
      return;
    }

    if (pending.kind === "station" && pending.stationId) {
      const lines = this.game.getExtendableLinesAtStation(pending.stationId);
      if (lines.length > 1) {
        this.linePicker = {
          stationId: pending.stationId,
          lines,
          pointerId: pending.pointerId,
        };
        this.pendingHold = null;
        this.drawLinePicker();
        this.updateStatus();
        return;
      }

      const origin = this.game.beginDragFromStation(pending.stationId);
      if (origin) {
        const point = this.clientToWorld(pending.startClientX, pending.startClientY);
        this.startDrag(origin, pending.pointerId, point.x, point.y);
      }
    }
  }

  private tryPickLineFromPointer(clientX: number, clientY: number): string | null {
    if (!this.linePicker) return null;

    const point = this.clientToWorld(clientX, clientY);
    const station = this.getStationMap().get(this.linePicker.stationId);
    if (!station) return null;

    for (const line of this.linePicker.lines) {
      const index = this.linePicker.lines.indexOf(line);
      const angle = (-Math.PI / 2) + ((Math.PI * 2) / this.linePicker.lines.length) * index;
      const x = station.x + Math.cos(angle) * 34;
      const y = station.y + Math.sin(angle) * 34;
      if (Math.hypot(point.x - x, point.y - y) <= 14) {
        return line.id;
      }
    }

    return null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag || this.bounce) return;

    const target = event.target as Element;
    const pickerLineId = target.closest<SVGElement>("[data-picker-line-id]")?.dataset.pickerLineId;
    const pickerStationId = target.closest<SVGElement>("[data-picker-station-id]")?.dataset.pickerStationId;

    if (pickerLineId && pickerStationId) {
      event.preventDefault();
      const origin = this.game.beginDragFromStation(pickerStationId, pickerLineId);
      if (origin) {
        const point = this.clientToWorld(event.clientX, event.clientY);
        this.startDrag(origin, event.pointerId, point.x, point.y);
      }
      return;
    }

    const loopHandleLineId = target.closest<SVGElement>("[data-loop-handle]")?.dataset.loopHandle;
    if (loopHandleLineId) {
      event.preventDefault();
      this.pendingHold = {
        kind: "handle",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startedAt: performance.now(),
        lineId: loopHandleLineId,
      };
      this.svg.setPointerCapture(event.pointerId);
      return;
    }

    const segmentEl = target.closest<SVGElement>("[data-segment-index]");
    const segmentLineId = segmentEl?.dataset.lineId;
    const segmentIndex = segmentEl?.dataset.segmentIndex;
    if (segmentLineId && segmentIndex !== undefined) {
      event.preventDefault();
      this.pendingHold = {
        kind: "segment",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startedAt: performance.now(),
        lineId: segmentLineId,
        segmentIndex: Number(segmentIndex),
      };
      this.svg.setPointerCapture(event.pointerId);
      return;
    }

    const stationId = target.closest<SVGElement>("[data-station-id]")?.dataset.stationId;
    if (stationId) {
      event.preventDefault();
      this.linePicker = null;
      this.pendingHold = {
        kind: "station",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startedAt: performance.now(),
        stationId,
      };
      this.svg.setPointerCapture(event.pointerId);
      return;
    }

    this.linePicker = null;
    this.pan = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    this.svg.setPointerCapture(event.pointerId);
    this.svg.style.cursor = "grabbing";
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      const point = this.clientToWorld(event.clientX, event.clientY);
      const hovered = this.findStationAt(event.clientX, event.clientY);
      const previousSnap = this.drag.snapTargetId;
      const snapTargetId =
        hovered &&
        hovered.id !== this.drag.origin.fromStationId &&
        this.game.canConnectDragTarget(this.drag.origin, hovered.id)
          ? hovered.id
          : null;

      this.drag = { ...this.drag, x: point.x, y: point.y, snapTargetId };
      this.drawPreview();
      if (snapTargetId !== previousSnap) this.redrawStations();
      return;
    }

    if (this.pan && event.pointerId === this.pan.pointerId) {
      const dx = event.clientX - this.pan.lastClientX;
      const dy = event.clientY - this.pan.lastClientY;
      this.viewport.panByScreenDelta(
        this.svg,
        dx,
        dy,
        this.pan.lastClientX,
        this.pan.lastClientY,
      );
      this.pan.lastClientX = event.clientX;
      this.pan.lastClientY = event.clientY;
      return;
    }

    if (this.linePicker && event.pointerId === this.linePicker.pointerId) {
      const picked = this.tryPickLineFromPointer(event.clientX, event.clientY);
      if (picked) {
        const origin = this.game.beginDragFromStation(this.linePicker.stationId, picked);
        if (origin) {
          const point = this.clientToWorld(event.clientX, event.clientY);
          this.startDrag(origin, event.pointerId, point.x, point.y);
        }
      }
      return;
    }

    if (this.pendingHold && event.pointerId === this.pendingHold.pointerId) {
      const moved = Math.hypot(
        event.clientX - this.pendingHold.startClientX,
        event.clientY - this.pendingHold.startClientY,
      );

      if (moved > HOLD_CANCEL_PX && performance.now() - this.pendingHold.startedAt < HOLD_MS) {
        if (this.pendingHold.kind === "station") {
          this.pendingHold = null;
          this.pan = {
            pointerId: event.pointerId,
            lastClientX: event.clientX,
            lastClientY: event.clientY,
          };
          return;
        }
      }

      if (performance.now() - this.pendingHold.startedAt >= HOLD_MS) {
        this.activatePendingHold();
      }
      return;
    }

    if (!this.isInteracting()) {
      const hovered = this.findStationAt(event.clientX, event.clientY);
      this.updateStationHover(hovered?.id ?? null);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pan && event.pointerId === this.pan.pointerId) {
      this.pan = null;
      this.svg.style.cursor = "";
      this.svg.releasePointerCapture(event.pointerId);
      return;
    }

    if (this.pendingHold && event.pointerId === this.pendingHold.pointerId) {
      this.pendingHold = null;
      this.svg.releasePointerCapture(event.pointerId);
      return;
    }

    if (this.linePicker && event.pointerId === this.linePicker.pointerId && !this.drag) {
      this.linePicker = null;
      this.drawLinePicker();
      this.updateStatus();
      this.svg.releasePointerCapture(event.pointerId);
      return;
    }

    if (!this.drag || event.pointerId !== this.drag.pointerId) return;

    const { origin, x, y, snapTargetId } = this.drag;
    this.drag = null;
    this.svg.releasePointerCapture(event.pointerId);
    this.svg.style.cursor = "";

    if (origin.mode === "unloop") {
      this.game.unloopLine(origin.lineId);
      this.finishInteractionRefresh();
      return;
    }

    if (snapTargetId && this.game.connectDragTarget(origin, snapTargetId)) {
      this.finishInteractionRefresh();
      return;
    }

    const stationMap = this.getStationMap();
    const fromStation = stationMap.get(origin.fromStationId);
    if (!fromStation) {
      this.game.cancelDrag(origin);
      this.finishInteractionRefresh();
      return;
    }

    this.bounce = {
      lineId: origin.lineId,
      from: { x, y },
      to: { x: fromStation.x, y: fromStation.y },
      startTime: performance.now(),
      origin,
    };

    this.drawPreview();
    this.redrawStations();
    this.updateStatus();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    this.viewport.zoomAt(this.svg, event.clientX, event.clientY, factor);
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
        if (latest) this.simulation.onStationSpawned(latest.id);

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
          this.game.cancelDrag(this.bounce.origin);
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
          distance = ((time * speed + phase) % 1) * routed.totalLength;
        } else {
          distance =
            ((Math.sin((time + phase * 10) * speed * Math.PI * 2) + 1) / 2) *
            routed.totalLength;
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
    this.svg.removeEventListener("pointerdown", this.onPointerDown);
    this.svg.removeEventListener("pointermove", this.onPointerMove);
    this.svg.removeEventListener("pointerup", this.onPointerUp);
    this.svg.removeEventListener("pointercancel", this.onPointerUp);
    this.mapEl.removeEventListener("wheel", this.onWheel);
  }
}
