import { lines, stations } from "../data/network.ts";
import {
  pathTotalLength,
  pointAtPathLength,
  routeOctilinear,
} from "../geometry/octilinearRouter.ts";
import type { MetroLine, RoutedLine, Station } from "../model/types.ts";

const STATION_RADIUS = 9;
const LINE_WIDTH = 7;
const TRAIN_RADIUS = 5;

export class MapRenderer {
  private readonly mapEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly routesGroup: SVGGElement;
  private readonly stationsGroup: SVGGElement;
  private readonly trainsGroup: SVGGElement;
  private routedLines: RoutedLine[] = [];
  private animationFrame = 0;

  constructor(mapEl: HTMLElement, legendEl: HTMLElement) {
    this.mapEl = mapEl;
    this.legendEl = legendEl;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", "0 0 900 560");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "Looping metro map");

    this.routesGroup = this.createGroup("routes");
    this.stationsGroup = this.createGroup("stations");
    this.trainsGroup = this.createGroup("trains");

    this.svg.append(this.routesGroup, this.stationsGroup, this.trainsGroup);
    this.mapEl.replaceChildren(this.svg);

    this.routedLines = this.buildRoutedLines();
    this.drawRoutes();
    this.drawStations();
    this.drawTrains();
    this.drawLegend();
    this.startAnimation();
  }

  private createGroup(className: string): SVGGElement {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", className);
    return group;
  }

  private buildRoutedLines(): RoutedLine[] {
    const stationMap = new Map(stations.map((station) => [station.id, station]));

    return lines.map((line) => {
      const lineStations = line.stationIds
        .map((id) => stationMap.get(id))
        .filter((station): station is Station => Boolean(station));

      const pathD = routeOctilinear(lineStations);
      return {
        line,
        stations: lineStations,
        path: lineStations,
        pathD,
        totalLength: pathTotalLength(pathD),
      };
    });
  }

  private drawRoutes(): void {
    for (const routed of this.routedLines) {
      const track = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      track.setAttribute("d", routed.pathD);
      track.setAttribute("fill", "none");
      track.setAttribute("stroke", routed.line.color);
      track.setAttribute("stroke-width", String(LINE_WIDTH));
      track.setAttribute("stroke-linecap", "round");
      track.setAttribute("stroke-linejoin", "round");
      track.setAttribute("opacity", "0.95");
      this.routesGroup.append(track);
    }
  }

  private drawStations(): void {
    const sharedCounts = new Map<string, number>();
    for (const line of lines) {
      for (const stationId of line.stationIds) {
        sharedCounts.set(stationId, (sharedCounts.get(stationId) ?? 0) + 1);
      }
    }

    for (const station of stations) {
      const isInterchange = (sharedCounts.get(station.id) ?? 0) > 1;
      const radius = isInterchange ? STATION_RADIUS + 2 : STATION_RADIUS;

      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", String(station.x));
      circle.setAttribute("cy", String(station.y));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", "#f7f5f0");
      circle.setAttribute("stroke", "#1a1a1e");
      circle.setAttribute("stroke-width", "3");
      this.stationsGroup.append(circle);

      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.setAttribute("x", String(station.x));
      label.setAttribute("y", String(station.y - radius - 8));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#d8d4cb");
      label.setAttribute("font-size", "12");
      label.setAttribute("font-family", "Avenir Next, Segoe UI, system-ui, sans-serif");
      label.textContent = station.name;
      this.stationsGroup.append(label);
    }
  }

  private drawTrains(): void {
    for (const routed of this.routedLines) {
      const train = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      train.setAttribute("r", String(TRAIN_RADIUS));
      train.setAttribute("fill", "#ffffff");
      train.setAttribute("stroke", routed.line.color);
      train.setAttribute("stroke-width", "3");
      train.dataset.lineId = routed.line.id;
      this.trainsGroup.append(train);
    }
  }

  private drawLegend(): void {
    this.legendEl.replaceChildren(
      ...lines.map((line) => this.createLegendItem(line)),
    );
  }

  private createLegendItem(line: MetroLine): HTMLElement {
    const item = document.createElement("div");
    item.className = "legend-item";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = line.color;

    const label = document.createElement("span");
    label.textContent = line.name;

    item.append(swatch, label);
    return item;
  }

  private startAnimation(): void {
    const speeds = [0.045, 0.035, 0.03];
    const phaseOffsets = [0, 0.22, 0.47];

    const tick = () => {
      this.routedLines.forEach((routed, index) => {
        const train = this.trainsGroup.querySelector<SVGCircleElement>(
          `circle[data-line-id="${routed.line.id}"]`,
        );
        if (!train) return;

        const speed = speeds[index % speeds.length];
        const offset = phaseOffsets[index % phaseOffsets.length];
        const progress =
          ((performance.now() / 1000) * speed + offset) % 1;
        const point = pointAtPathLength(
          routed.pathD,
          progress * routed.totalLength,
        );

        train.setAttribute("cx", String(point.x));
        train.setAttribute("cy", String(point.y));
      });

      this.animationFrame = requestAnimationFrame(tick);
    };

    this.animationFrame = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
  }
}
