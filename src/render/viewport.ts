import { MAP_HEIGHT, MAP_WIDTH } from "../data/network.ts";
import type { Point } from "../model/types.ts";

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 3.2;

export class MapViewport {
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  apply(svg: SVGSVGElement): void {
    const width = MAP_WIDTH / this.zoom;
    const height = MAP_HEIGHT / this.zoom;
    svg.setAttribute("viewBox", `${this.panX} ${this.panY} ${width} ${height}`);
  }

  clientToWorld(svg: SVGSVGElement, clientX: number, clientY: number): Point {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const world = point.matrixTransform(matrix.inverse());
    return { x: world.x, y: world.y };
  }

  zoomAt(svg: SVGSVGElement, clientX: number, clientY: number, factor: number): void {
    const anchor = this.clientToWorld(svg, clientX, clientY);
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const rect = svg.getBoundingClientRect();
    const width = MAP_WIDTH / nextZoom;
    const height = MAP_HEIGHT / nextZoom;
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;

    this.zoom = nextZoom;
    this.panX = anchor.x - nx * width;
    this.panY = anchor.y - ny * height;
    this.clampPan();
    this.apply(svg);
  }

  panByScreenDelta(
    svg: SVGSVGElement,
    screenDx: number,
    screenDy: number,
    originClientX: number,
    originClientY: number,
  ): void {
    const before = this.clientToWorld(svg, originClientX, originClientY);
    const after = this.clientToWorld(svg, originClientX + screenDx, originClientY + screenDy);
    this.panX += before.x - after.x;
    this.panY += before.y - after.y;
    this.clampPan();
    this.apply(svg);
  }

  private clampPan(): void {
    const width = MAP_WIDTH / this.zoom;
    const height = MAP_HEIGHT / this.zoom;
    const margin = 60;
    this.panX = Math.min(MAP_WIDTH - width + margin, Math.max(-margin, this.panX));
    this.panY = Math.min(MAP_HEIGHT - height + margin, Math.max(-margin, this.panY));
  }
}
