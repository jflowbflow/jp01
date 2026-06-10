import { GameState, type DragOrigin } from "../game/GameState.ts";
import { buildPendingSegments } from "../game/pendingRoute.ts";
import { Simulation } from "../game/simulation.ts";
import { TrainSimulation } from "../game/trainSimulation.ts";
import { shapeLabel, stationRadius } from "../game/stationSpawner.ts";
import {
  pathTotalLength,
  routeOctilinear,
  routeOctilinearOpen,
} from "../geometry/octilinearRouter.ts";
import type { Passenger, PlayerLine, Point, RoutedLine, Station } from "../model/types.ts";
import { loopHandleGeometryForLine } from "./loopHandle.ts";
import {
  createHitArea,
  createStationShape,
  passengerOffset,
} from "./stationShapes.ts";
import { createTrainElement } from "./trainRenderer.ts";
import { MapViewport } from "./viewport.ts";

const LINE_WIDTH = 7;
const ROUTE_HIT_WIDTH = 22;
const PASSENGER_SIZE = 4.5;
const PENDING_ROUTE_OPACITY = 0.32;
const BOUNCE_MS = 220;
const DRAG_START_PX = 5;
const UNDO_HOLD_MS = 480;

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

type PendingPointer = {
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
  mode: "extend" | "undo";
};

export class MapRenderer {
  private readonly mapEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly game = new GameState();
  private readonly simulation = new Simulation(this.game);
  private readonly trainSimulation = new TrainSimulation();
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
  private activeRoutedLines: RoutedLine[] = [];
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private drag: DragState | null = null;
  private bounce: BounceState | null = null;
  private pendingPointer: PendingPointer | null = null;
  private pan: PanState | null = null;
  private linePicker: LinePicker | null = null;
  private undoHoldStationId: string | null = null;
  private undoHoldProgress = 0;
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
      this.pendingPointer !== null ||
      this.linePicker !== null
    );
  }

  private refresh(): void {
    this.activeRoutedLines = this.buildRoutedLines("active");
    this.drawRoutes();
    this.drawRouteHits();
    this.drawLoopHandles();
    this.drawTrains();
    this.drawLegend();
    this.updateStatus();
    this.drawPreview();
    this.drawLinePicker();
  }

  private buildRoutedLines(kind: "active" | "pending"): RoutedLine[] {
    const stationMap = this.getStationMap();

    return this.game.getLines().flatMap((line) => {
      if (kind === "pending" && !this.game.hasPendingRoute(line)) return [];

      const route =
        kind === "active" ? this.game.getActiveRoute(line) : {
          stationIds: line.stationIds,
          isLoop: line.isLoop,
        };

      const lineStations = route.stationIds
        .map((id) => stationMap.get(id))
        .filter((station): station is Station => Boolean(station));

      if (lineStations.length < 2) return [];

      const pathD = route.isLoop
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

    for (const routed of this.activeRoutedLines) {
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

    const stationMap = this.getStationMap();

    for (const line of this.game.getLines()) {
      if (!this.trainSimulation.shouldShowPendingFade(line.id, this.game)) continue;

      for (const segment of buildPendingSegments(line, stationMap)) {
        const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
        track.setAttribute("d", segment.pathD);
        track.setAttribute("fill", "none");
        track.setAttribute("stroke", line.color);
        track.setAttribute("stroke-width", String(LINE_WIDTH));
        track.setAttribute("stroke-linecap", "round");
        track.setAttribute("stroke-linejoin", "round");
        track.setAttribute("opacity", String(PENDING_ROUTE_OPACITY));
        track.setAttribute("pointer-events", "none");
        this.routesGroup.append(track);
      }
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

      const geometry = loopHandleGeometryForLine(
        line.stationIds,
        line.loopHandleStationId,
        stationMap,
      );
      if (!geometry) continue;

      const stub = document.createElementNS("http://www.w3.org/2000/svg", "path");
      stub.setAttribute("d", geometry.stubPath);
      stub.setAttribute("fill", "none");
      stub.setAttribute("stroke", line.color);
      stub.setAttribute("stroke-width", String(LINE_WIDTH));
      stub.setAttribute("stroke-linecap", "round");
      stub.setAttribute("pointer-events", "none");

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", geometry.stubPath);
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", String(ROUTE_HIT_WIDTH));
      hit.setAttribute("stroke-linecap", "round");
      hit.style.cursor = "grab";
      hit.dataset.loopHandle = line.id;

      this.handlesGroup.append(stub, hit);
    }
  }

  private getLoopHandleTip(lineId: string): Point | null {
    const line = this.game.getLine(lineId);
    if (!line?.loopHandleStationId) return null;

    return (
      loopHandleGeometryForLine(
        line.stationIds,
        line.loopHandleStationId,
        this.getStationMap(),
      )?.tip ?? null
    );
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
      const isUndoHold = this.undoHoldStationId === station.id;
      const radius =
        isUndoHold
          ? baseRadius + 2 + this.undoHoldProgress * 3
          : onActiveLine && !active.isLoop
            ? baseRadius + 2
            : baseRadius;

      const hitArea = createHitArea(station.x, station.y, radius);
      hitArea.dataset.stationId = station.id;

      const hovered = this.hoveredStationId === station.id;
      const stroke = isUndoHold
        ? "#e85d5d"
        : isSnapTarget || isDragSource
          ? active.color
          : lineColors.length === 1
            ? lineColors[0]
            : lineColors.length > 1
              ? "#f0c040"
              : onActiveLine
                ? active.color
                : "#1a1a1e";

      const shape = createStationShape(station.shape, station.x, station.y, radius, {
        fill: hovered || isSnapTarget || isUndoHold ? "#fffdf8" : "#f7f5f0",
        stroke,
        strokeWidth: isSnapTarget || isUndoHold || lineColors.length > 1 ? 4 : 3,
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

    for (const state of this.trainSimulation.getRenderStates(this.game)) {
      this.trainsGroup.append(createTrainElement(state));
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
        const tip = this.getLoopHandleTip(drag.origin.lineId);
        if (!tip) return;
        fromPoint = tip;
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
          ? (this.getLoopHandleTip(bounce.lineId) ?? station)
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

    let hint = "Drag off a station to draw. Hold an endpoint to undo. Scroll to zoom.";
    if (this.linePicker?.mode === "undo") hint = "Choose a line to retract.";
    else if (this.linePicker) hint = "Choose a line color to extend.";
    else if (this.undoHoldStationId) hint = "Hold to remove the last segment…";
    else if (this.drag?.origin.mode === "insert") hint = "Drag to a station to insert.";
    else if (this.drag?.origin.mode === "unloop") hint = "Release to open the loop.";
    else if (this.drag) hint = "Drag over stations to connect.";

    this.statusEl.textContent =
      `Week ${this.game.getWeek()} · ${this.game.getStations().length} stations · ` +
      `Shapes: ${unlocked} · Active: ${active.name}. ${hint} ` +
      `Lines: ${built}/3 · Loops: ${loops}/3`;
  }

  private finishInteractionRefresh(): void {
    if (this.pendingStationRedraw) {
      this.pendingStationRedraw = false;
    }
    for (const line of this.game.getLines()) {
      this.game.finalizeRouteChange(
        line.id,
        this.trainSimulation.getTrain(line.id) !== undefined,
      );
    }
    this.redrawStations();
    this.refresh();
  }

  private afterRouteChange(lineId: string): void {
    this.game.finalizeRouteChange(
      lineId,
      this.trainSimulation.getTrain(lineId) !== undefined,
    );
  }

  private tryAutoAnchor(): void {
    if (!this.drag?.snapTargetId) return;

    const { origin, snapTargetId, pointerId } = this.drag;
    if (!this.game.connectDragTarget(origin, snapTargetId)) return;

    this.afterRouteChange(origin.lineId);

    const station = this.getStationMap().get(snapTargetId);
    const line = this.game.getLine(origin.lineId);

    if (!station || !line) {
      this.drag = null;
      this.finishInteractionRefresh();
      return;
    }

    if (origin.mode === "insert" || line.isLoop) {
      this.drag = null;
      this.finishInteractionRefresh();
      return;
    }

    const nextOrigin = this.game.beginDragFromStation(snapTargetId, origin.lineId);
    if (!nextOrigin) {
      this.drag = null;
      this.finishInteractionRefresh();
      return;
    }

    this.drag = {
      origin: nextOrigin,
      pointerId,
      x: station.x,
      y: station.y,
      snapTargetId: null,
    };

    this.activeRoutedLines = this.buildRoutedLines("active");
    this.drawRoutes();
    this.drawPreview();
    this.redrawStations();
    this.updateStatus();
  }

  private clearUndoHold(): void {
    this.undoHoldStationId = null;
    this.undoHoldProgress = 0;
  }

  private startDrag(origin: DragOrigin, pointerId: number, x: number, y: number): void {
    this.linePicker = null;
    this.pendingPointer = null;
    this.clearUndoHold();
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

  private tryStartStationDrag(
    stationId: string,
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    const extendable = this.game.getExtendableLinesAtStation(stationId);
    if (extendable.length > 1) {
      this.linePicker = {
        stationId,
        lines: extendable,
        pointerId,
        mode: "extend",
      };
      this.drawLinePicker();
      this.updateStatus();
      return;
    }

    const origin = this.game.beginDragFromStation(stationId);
    if (!origin) return;

    const station = this.getStationMap().get(stationId);
    const point = station ?? this.clientToWorld(clientX, clientY);
    this.startDrag(origin, pointerId, point.x, point.y);
  }

  private tryUndoHold(stationId: string, pointerId: number): void {
    const undoable = this.game.getUndoableLinesAtStation(stationId);
    if (undoable.length === 0) return;

    this.clearUndoHold();

    if (undoable.length > 1) {
      this.linePicker = {
        stationId,
        lines: undoable,
        pointerId,
        mode: "undo",
      };
      this.drawLinePicker();
      this.updateStatus();
      return;
    }

    if (this.game.undoFromEndpoint(stationId, undoable[0].id)) {
      this.afterRouteChange(undoable[0].id);
      this.finishInteractionRefresh();
    }
  }

  private startPendingDrag(pending: PendingPointer): void {
    if (pending.kind === "segment" && pending.lineId !== undefined && pending.segmentIndex !== undefined) {
      const origin = this.game.beginInsertDrag(pending.lineId, pending.segmentIndex);
      if (!origin) return;
      const point = this.clientToWorld(pending.startClientX, pending.startClientY);
      this.startDrag(origin, pending.pointerId, point.x, point.y);
      return;
    }

    if (pending.kind === "handle" && pending.lineId) {
      const origin = this.game.beginUnloopDrag(pending.lineId);
      if (!origin) return;
      const tip = this.getLoopHandleTip(origin.lineId);
      const point = tip ?? this.clientToWorld(pending.startClientX, pending.startClientY);
      this.startDrag(origin, pending.pointerId, point.x, point.y);
      return;
    }

    if (pending.kind === "station" && pending.stationId) {
      this.tryStartStationDrag(
        pending.stationId,
        pending.pointerId,
        pending.startClientX,
        pending.startClientY,
      );
    }
  }

  private processPendingPointer(event: PointerEvent): void {
    const pending = this.pendingPointer;
    if (!pending || event.pointerId !== pending.pointerId) return;

    const moved = Math.hypot(
      event.clientX - pending.startClientX,
      event.clientY - pending.startClientY,
    );
    const elapsed = performance.now() - pending.startedAt;

    if (moved > DRAG_START_PX) {
      this.pendingPointer = null;
      this.clearUndoHold();
      this.startPendingDrag(pending);
      return;
    }

    if (pending.kind === "station" && pending.stationId) {
      const canUndo = this.game.getUndoableLinesAtStation(pending.stationId).length > 0;
      if (canUndo) {
        this.undoHoldStationId = pending.stationId;
        this.undoHoldProgress = Math.min(1, elapsed / UNDO_HOLD_MS);
        this.redrawStations();
        this.updateStatus();
      }

      if (elapsed >= UNDO_HOLD_MS && canUndo) {
        this.pendingPointer = null;
        this.tryUndoHold(pending.stationId, pending.pointerId);
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

  private applyLinePickerChoice(lineId: string, pointerId: number, clientX: number, clientY: number): void {
    if (!this.linePicker) return;

    const { stationId, mode } = this.linePicker;
    this.linePicker = null;
    this.drawLinePicker();

    if (mode === "undo") {
      if (this.game.undoFromEndpoint(stationId, lineId)) {
        this.afterRouteChange(lineId);
        this.finishInteractionRefresh();
      }
      return;
    }

    const origin = this.game.beginDragFromStation(stationId, lineId);
    if (!origin) return;

    const station = this.getStationMap().get(stationId);
    const point = station ?? this.clientToWorld(clientX, clientY);
    this.startDrag(origin, pointerId, point.x, point.y);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag || this.bounce) return;

    const target = event.target as Element;
    const pickerLineId = target.closest<SVGElement>("[data-picker-line-id]")?.dataset.pickerLineId;
    const pickerStationId = target.closest<SVGElement>("[data-picker-station-id]")?.dataset.pickerStationId;

    if (pickerLineId && pickerStationId) {
      event.preventDefault();
      this.applyLinePickerChoice(pickerLineId, event.pointerId, event.clientX, event.clientY);
      return;
    }

    const loopHandleLineId = target.closest<SVGElement>("[data-loop-handle]")?.dataset.loopHandle;
    if (loopHandleLineId) {
      event.preventDefault();
      this.pendingPointer = {
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
      this.pendingPointer = {
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
      this.clearUndoHold();
      this.pendingPointer = {
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
      if (snapTargetId !== previousSnap) {
        this.redrawStations();
        if (snapTargetId) this.tryAutoAnchor();
      }
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
        this.applyLinePickerChoice(picked, event.pointerId, event.clientX, event.clientY);
      }
      return;
    }

    if (this.pendingPointer && event.pointerId === this.pendingPointer.pointerId) {
      this.processPendingPointer(event);
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

    if (this.pendingPointer && event.pointerId === this.pendingPointer.pointerId) {
      this.pendingPointer = null;
      this.clearUndoHold();
      this.redrawStations();
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
      this.afterRouteChange(origin.lineId);
      this.finishInteractionRefresh();
      return;
    }

    if (snapTargetId && this.game.connectDragTarget(origin, snapTargetId)) {
      this.afterRouteChange(origin.lineId);
      this.finishInteractionRefresh();
      return;
    }

    if (snapTargetId) {
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
    const active = this.game.getActiveLine();
    const lastId = active.stationIds.at(-1);
    if (lastId && this.game.undoFromEndpoint(lastId, active.id)) {
      this.afterRouteChange(active.id);
      this.finishInteractionRefresh();
    }
  };

  private startAnimation(): void {
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;

      this.game.advanceTime(dt);
      const worldUpdate = this.simulation.update(dt);
      let trainPassengersChanged = false;

      if (worldUpdate.stationsChanged) {
        const latest = this.game.getStations().at(-1);
        if (latest) this.simulation.onStationSpawned(latest.id);

        if (this.isInteracting()) {
          this.pendingStationRedraw = true;
        } else {
          this.redrawStations();
          this.refresh();
        }
      } else if ((worldUpdate.passengersChanged || trainPassengersChanged) && !this.isInteracting()) {
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

      const hasActiveRoutes = this.game.getLines().some(
        (line) => line.activeStationIds.length >= 2,
      );
      if (hasActiveRoutes) {
        trainPassengersChanged = this.trainSimulation.update(dt, this.game);
        this.activeRoutedLines = this.buildRoutedLines("active");
        if (this.game.getLines().some((line) => this.trainSimulation.shouldShowPendingFade(line.id, this.game))) {
          this.drawRoutes();
        }
        this.drawTrains();
      }

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
