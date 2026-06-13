import { GameState, type DragOrigin } from "../game/GameState.ts";
import { buildPendingSegments, diffRemovedActiveSegments, isTrainOccupyingSegment, isTrainOnAffectedSegments } from "../game/pendingRoute.ts";
import { Simulation } from "../game/simulation.ts";
import { TrainSimulation } from "../game/trainSimulation.ts";
import { mapScale, stationRadius } from "../game/stationSpawner.ts";
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
const PREVIEW_DASH = "10 8";
const BOUNCE_MS = 220;
const DRAG_START_PX = 5;
const HOLD_CANCEL_PX = 22;
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

type RemovePicker = {
  stationId: string;
  lines: PlayerLine[];
};

export class MapRenderer {
  private readonly mapEl: HTMLElement;
  private readonly pickerEl: HTMLElement;
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
  private activeRoutedLines: RoutedLine[] = [];
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private drag: DragState | null = null;
  private bounce: BounceState | null = null;
  private pendingPointer: PendingPointer | null = null;
  private removePicker: RemovePicker | null = null;
  private undoHoldStationId: string | null = null;
  private undoHoldProgress = 0;
  private hoveredStationId: string | null = null;
  private pendingStationRedraw = false;
  private stationShapeElements = new Map<string, SVGElement>();

  constructor(mapEl: HTMLElement, pickerEl: HTMLElement) {
    this.mapEl = mapEl;
    this.pickerEl = pickerEl;
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

    this.svg.append(
      this.routesGroup,
      this.routeHitsGroup,
      this.previewGroup,
      this.handlesGroup,
      this.stationsGroup,
      this.passengersGroup,
      this.trainsGroup,
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

  private getMapScale(): number {
    return mapScale(this.game.getStations().length);
  }

  private getLineWidth(): number {
    return LINE_WIDTH * this.getMapScale();
  }

  private getRouteHitWidth(): number {
    return ROUTE_HIT_WIDTH * this.getMapScale();
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
      this.removePicker !== null
    );
  }

  private refresh(): void {
    this.activeRoutedLines = this.buildRoutedLines("active");
    this.drawRoutes();
    this.drawRouteHits();
    this.drawLoopHandles();
    this.drawTrains();
    this.drawPreview();
  }

  private getDisplayRoute(line: PlayerLine): {
    stationIds: string[];
    isLoop: boolean;
    loopHandleStationId?: string;
  } {
    if (line.stationIds.length >= 2) {
      return {
        stationIds: line.stationIds,
        isLoop: line.isLoop,
        loopHandleStationId: line.loopHandleStationId,
      };
    }

    return this.game.getActiveRoute(line);
  }

  private buildRoutedLines(kind: "active" | "pending"): RoutedLine[] {
    const stationMap = this.getStationMap();

    return this.game.getLines().flatMap((line) => {
      if (kind === "pending" && !this.game.hasPendingRoute(line)) return [];

      const route =
        kind === "active"
          ? this.getDisplayRoute(line)
          : {
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

  private appendRouteTrack(
    parent: SVGGElement,
    pathD: string,
    color: string,
    opacity = "0.95",
  ): void {
    const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
    track.setAttribute("d", pathD);
    track.setAttribute("fill", "none");
    track.setAttribute("stroke", color);
    track.setAttribute("stroke-width", String(this.getLineWidth()));
    track.setAttribute("stroke-linecap", "round");
    track.setAttribute("stroke-linejoin", "round");
    track.setAttribute("opacity", opacity);
    track.setAttribute("pointer-events", "none");
    parent.append(track);
  }

  private getInsertSegmentEndStation(
    line: { stationIds: string[]; isLoop: boolean },
    segmentIndex: number,
    stationMap: Map<string, Station>,
  ): Station | undefined {
    if (segmentIndex < line.stationIds.length - 1) {
      return stationMap.get(line.stationIds[segmentIndex + 1]);
    }
    if (line.isLoop) {
      return stationMap.get(line.stationIds[0]);
    }
    return undefined;
  }

  private segmentDirectedKey(fromId: string, toId: string): string {
    return `${fromId}>${toId}`;
  }

  private drawRouteSegments(
    parent: SVGGElement,
    route: { stationIds: string[]; isLoop: boolean },
    color: string,
    fadedSegmentKeys: Set<string>,
  ): void {
    const stationMap = this.getStationMap();
    const segmentCount = route.isLoop
      ? route.stationIds.length
      : route.stationIds.length - 1;

    for (let index = 0; index < segmentCount; index += 1) {
      const fromId = route.stationIds[index];
      const toId =
        index < route.stationIds.length - 1
          ? route.stationIds[index + 1]
          : route.stationIds[0];

      const from = stationMap.get(fromId);
      const to = stationMap.get(toId);
      if (!from || !to) continue;

      const pathD = routeOctilinearOpen([from, to]);
      if (!pathD) continue;

      const faded = fadedSegmentKeys.has(this.segmentDirectedKey(fromId, toId));
      this.appendRouteTrack(
        parent,
        pathD,
        color,
        faded ? String(PENDING_ROUTE_OPACITY) : "0.95",
      );
    }
  }

  private drawActiveRouteSegments(
    parent: SVGGElement,
    line: PlayerLine,
    color: string,
    fadedSegmentKeys: Set<string>,
  ): void {
    this.drawRouteSegments(parent, this.game.getActiveRoute(line), color, fadedSegmentKeys);
  }

  private getDraggingSegment():
    | { lineId: string; fromId: string; toId: string }
    | null {
    const origin =
      this.drag?.origin.mode === "insert"
        ? this.drag.origin
        : this.bounce?.origin.mode === "insert"
          ? this.bounce.origin
          : undefined;

    if (!origin || origin.insertAfterIndex === undefined) {
      return null;
    }

    const line = this.game.getLine(origin.lineId);
    if (!line) return null;

    const fromId = line.stationIds[origin.insertAfterIndex];
    if (!fromId) return null;

    let toId: string | undefined;
    if (origin.insertAfterIndex < line.stationIds.length - 1) {
      toId = line.stationIds[origin.insertAfterIndex + 1];
    } else if (line.isLoop) {
      toId = line.stationIds[0];
    }

    if (!toId) return null;

    return { lineId: line.id, fromId, toId };
  }

  private isTrainOnDraggingSegment(): boolean {
    const segment = this.getDraggingSegment();
    if (!segment) return false;

    const line = this.game.getLine(segment.lineId);
    const train = this.trainSimulation.getTrain(segment.lineId);
    if (!line || !train) return false;

    return isTrainOccupyingSegment(train, line, this.getStationMap(), segment);
  }

  private isSegmentDragActive(): boolean {
    return (
      this.drag?.origin.mode === "insert" ||
      this.bounce?.origin.mode === "insert"
    );
  }

  private shouldRedrawRoutesForSegmentDrag(): boolean {
    return this.isSegmentDragActive() && this.isTrainOnDraggingSegment();
  }

  private drawRoutes(): void {
    this.routesGroup.replaceChildren();
    const stationMap = this.getStationMap();
    const draggingSegment = this.getDraggingSegment();
    const fadeDraggedSegment = draggingSegment !== null && this.isTrainOnDraggingSegment();
    const fadedActiveLineIds = new Set<string>();

    for (const routed of this.activeRoutedLines) {
      const line = routed.line;
      const train = this.trainSimulation.getTrain(line.id);
      const fadeOldSegments =
        train !== undefined &&
        this.game.hasPendingRoute(line) &&
        isTrainOnAffectedSegments(train, line, stationMap);

      if (fadeOldSegments) {
        fadedActiveLineIds.add(line.id);
        const fadedKeys = new Set(
          diffRemovedActiveSegments(line).map((segment) =>
            this.segmentDirectedKey(segment.fromId, segment.toId),
          ),
        );
        this.drawActiveRouteSegments(this.routesGroup, line, line.color, fadedKeys);
        continue;
      }

      if (
        fadeDraggedSegment &&
        draggingSegment &&
        draggingSegment.lineId === line.id
      ) {
        const fadedKeys = new Set([
          this.segmentDirectedKey(draggingSegment.fromId, draggingSegment.toId),
        ]);
        this.drawRouteSegments(
          this.routesGroup,
          this.getDisplayRoute(line),
          line.color,
          fadedKeys,
        );
        continue;
      }

      this.appendRouteTrack(this.routesGroup, routed.pathD, routed.line.color, "0.95");
    }

    for (const line of this.game.getLines()) {
      if (!fadedActiveLineIds.has(line.id)) continue;
      if (!this.game.hasPendingRoute(line)) continue;
      if (!this.trainSimulation.getTrain(line.id)) continue;

      for (const segment of buildPendingSegments(line, stationMap)) {
        this.appendRouteTrack(this.routesGroup, segment.pathD, line.color, "0.95");
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
        hit.setAttribute("stroke-width", String(this.getRouteHitWidth()));
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
      stub.setAttribute("stroke-width", String(this.getLineWidth()));
      stub.setAttribute("stroke-linecap", "round");
      stub.setAttribute("pointer-events", "none");

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", geometry.stubPath);
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", String(this.getRouteHitWidth()));
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
          PASSENGER_SIZE * this.getMapScale(),
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

    for (const state of this.trainSimulation.getRenderStates(this.game, this.getMapScale())) {
      this.trainsGroup.append(createTrainElement(state));
    }
  }

  private drawPreview(): void {
    this.previewGroup.replaceChildren();

    const stationMap = this.getStationMap();
    let lineColor = this.game.getActiveLine().color;
    const legs: [Point, Point][] = [];
    let dashed = false;

    const drag = this.drag;
    const bounce = this.bounce;

    if (drag) {
      const line = this.game.getLine(drag.origin.lineId);
      if (!line) return;

      lineColor = line.color;
      dashed = !drag.snapTargetId;

      if (drag.origin.mode === "insert" && drag.origin.insertAfterIndex !== undefined) {
        const fromStation = stationMap.get(drag.origin.fromStationId);
        const toStation = this.getInsertSegmentEndStation(
          line,
          drag.origin.insertAfterIndex,
          stationMap,
        );
        if (!fromStation || !toStation) return;

        const hinge = drag.snapTargetId
          ? (stationMap.get(drag.snapTargetId) ?? { x: drag.x, y: drag.y })
          : { x: drag.x, y: drag.y };

        legs.push([fromStation, hinge], [hinge, toStation]);
      } else {
        let fromPoint: Point | undefined;

        if (drag.origin.mode === "unloop") {
          fromPoint = this.getLoopHandleTip(drag.origin.lineId) ?? undefined;
        } else {
          fromPoint = stationMap.get(drag.origin.fromStationId);
        }

        if (!fromPoint) return;

        const endPoint = drag.snapTargetId
          ? stationMap.get(drag.snapTargetId)
          : undefined;

        if (!endPoint) {
          legs.push([fromPoint, { x: drag.x, y: drag.y }]);
        } else {
          legs.push([fromPoint, endPoint]);
        }
      }
    } else if (bounce) {
      const line = this.game.getLine(bounce.lineId);
      if (!line) return;

      lineColor = line.color;

      const elapsed = performance.now() - bounce.startTime;
      const t = Math.min(1, elapsed / BOUNCE_MS);
      const eased = 1 - (1 - t) ** 3;
      const hinge = {
        x: bounce.from.x + (bounce.to.x - bounce.from.x) * eased,
        y: bounce.from.y + (bounce.to.y - bounce.from.y) * eased,
      };

      if (bounce.origin.mode === "insert" && bounce.origin.insertAfterIndex !== undefined) {
        const fromStation = stationMap.get(bounce.origin.fromStationId);
        const toStation = this.getInsertSegmentEndStation(
          line,
          bounce.origin.insertAfterIndex,
          stationMap,
        );
        if (!fromStation || !toStation) return;

        legs.push([fromStation, hinge], [hinge, toStation]);
      } else {
        const station = stationMap.get(bounce.origin.fromStationId);
        if (!station) return;

        const fromPoint =
          bounce.origin.mode === "unloop"
            ? (this.getLoopHandleTip(bounce.lineId) ?? station)
            : station;

        legs.push([fromPoint, hinge]);
      }
    }

    for (const [fromPoint, endPoint] of legs) {
      const pathD = routeOctilinearOpen([fromPoint, endPoint]);
      if (!pathD) continue;

      const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
      preview.setAttribute("d", pathD);
      preview.setAttribute("fill", "none");
      preview.setAttribute("stroke", lineColor);
      preview.setAttribute("stroke-width", String(this.getLineWidth()));
      preview.setAttribute("stroke-linecap", "round");
      preview.setAttribute("stroke-linejoin", "round");
      preview.setAttribute("opacity", "0.95");
      if (dashed) {
        preview.setAttribute("stroke-dasharray", PREVIEW_DASH);
      }
      preview.setAttribute("pointer-events", "none");
      this.previewGroup.append(preview);
    }
  }

  private finishInteractionRefresh(): void {
    if (this.pendingStationRedraw) {
      this.pendingStationRedraw = false;
    }
    for (const line of this.game.getLines()) {
      this.game.finalizeRouteChange(line.id, this.trainSimulation.getTrain(line.id));
    }
    this.redrawStations();
    this.refresh();
  }

  private afterRouteChange(lineId: string): void {
    this.game.finalizeRouteChange(lineId, this.trainSimulation.getTrain(lineId));
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
  }

  private clearUndoHold(): void {
    this.undoHoldStationId = null;
    this.undoHoldProgress = 0;
  }

  private startDrag(origin: DragOrigin, pointerId: number, x: number, y: number): void {
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
    if (origin.mode === "insert") {
      this.drawRoutes();
    }
    this.redrawStations();
  }

  private tryStartStationDrag(
    stationId: string,
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    const origin = this.game.beginDragFromStation(stationId);
    if (!origin) return;

    const station = this.getStationMap().get(stationId);
    const point = station ?? this.clientToWorld(clientX, clientY);
    this.startDrag(origin, pointerId, point.x, point.y);
  }

  private showRemovePicker(stationId: string, lines: PlayerLine[]): void {
    this.removePicker = { stationId, lines };
    this.pickerEl.hidden = false;
    this.pickerEl.replaceChildren(
      ...lines.map((line) => {
        const button = document.createElement("button");
        button.type = "button";
        button.style.background = line.color;
        button.setAttribute("aria-label", `Remove from ${line.name}`);
        button.addEventListener("click", () => this.pickRemoveLine(line.id));
        return button;
      }),
    );
  }

  private hideRemovePicker(): void {
    this.removePicker = null;
    this.pickerEl.hidden = true;
    this.pickerEl.replaceChildren();
  }

  private pickRemoveLine(lineId: string): void {
    if (!this.removePicker) return;

    const { stationId } = this.removePicker;
    this.hideRemovePicker();
    this.clearUndoHold();

    if (this.game.removeStationFromLine(stationId, lineId)) {
      this.afterRouteChange(lineId);
      this.finishInteractionRefresh();
    }
  }

  private tryRemoveHold(stationId: string): void {
    const removable = this.game.getRemovableLinesAtStation(stationId);
    if (removable.length === 0) return;

    this.clearUndoHold();

    if (removable.length > 1) {
      this.showRemovePicker(stationId, removable);
      this.redrawStations();
      return;
    }

    if (this.game.removeStationFromLine(stationId, removable[0].id)) {
      this.afterRouteChange(removable[0].id);
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

    if (pending.kind === "station" && pending.stationId) {
      const canRemove = this.game.getRemovableLinesAtStation(pending.stationId).length > 0;

      if (canRemove) {
        this.undoHoldStationId = pending.stationId;
        this.undoHoldProgress = Math.min(1, elapsed / UNDO_HOLD_MS);
        this.redrawStations();

        if (elapsed >= UNDO_HOLD_MS) {
          this.pendingPointer = null;
          this.tryRemoveHold(pending.stationId);
          return;
        }

        if (moved < HOLD_CANCEL_PX) {
          return;
        }

        this.clearUndoHold();
      }
    }

    if (moved > DRAG_START_PX) {
      this.pendingPointer = null;
      this.startPendingDrag(pending);
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag || this.bounce) return;

    const target = event.target as Element;
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

    event.preventDefault();
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
      if (this.drag.origin.mode === "insert") {
        this.drawRoutes();
      }
      if (snapTargetId !== previousSnap) {
        this.redrawStations();
        if (snapTargetId) this.tryAutoAnchor();
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
    if (this.pendingPointer && event.pointerId === this.pendingPointer.pointerId) {
      this.pendingPointer = null;
      this.clearUndoHold();
      this.redrawStations();
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
    if (lastId && this.game.removeStationFromLine(lastId, active.id)) {
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
      let trainUpdate = { passengersChanged: false, routeApplied: false };

      if (worldUpdate.stationsChanged) {
        const latest = this.game.getStations().at(-1);
        if (latest) this.simulation.onStationSpawned(latest.id);

        if (this.isInteracting()) {
          this.pendingStationRedraw = true;
        } else {
          this.redrawStations();
          this.refresh();
        }
      } else if (
        (worldUpdate.passengersChanged || trainUpdate.passengersChanged) &&
        !this.isInteracting()
      ) {
        this.drawPassengers();
      }

      if (this.bounce) {
        this.drawPreview();
        if (this.bounce.origin.mode === "insert" && this.isTrainOnDraggingSegment()) {
          this.drawRoutes();
        }
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
        trainUpdate = this.trainSimulation.update(dt, this.game);
        this.activeRoutedLines = this.buildRoutedLines("active");
        if (
          trainUpdate.routeApplied ||
          this.game.getLines().some((line) => this.game.hasPendingRoute(line)) ||
          this.shouldRedrawRoutesForSegmentDrag()
        ) {
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
