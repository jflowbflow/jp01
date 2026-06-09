import type { Point, StationShape } from "../model/types.ts";

type ShapeStyle = {
  fill: string;
  stroke: string;
  strokeWidth: number;
};

function regularPolygonPoints(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
): string {
  const points: string[] = [];
  const startAngle = -Math.PI / 2;

  for (let i = 0; i < sides; i += 1) {
    const angle = startAngle + (Math.PI * 2 * i) / sides;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }

  return points.join(" ");
}

export function createStationShape(
  shape: StationShape,
  x: number,
  y: number,
  radius: number,
  style: ShapeStyle,
): SVGElement {
  if (shape === "circle") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(x));
    circle.setAttribute("cy", String(y));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", style.fill);
    circle.setAttribute("stroke", style.stroke);
    circle.setAttribute("stroke-width", String(style.strokeWidth));
    return circle;
  }

  const sides =
    shape === "triangle"
      ? 3
      : shape === "square"
        ? 4
        : shape === "pentagon"
          ? 5
          : 6;

  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", regularPolygonPoints(x, y, radius, sides));
  polygon.setAttribute("fill", style.fill);
  polygon.setAttribute("stroke", style.stroke);
  polygon.setAttribute("stroke-width", String(style.strokeWidth));
  polygon.setAttribute("stroke-linejoin", "round");
  return polygon;
}

export function createHitArea(x: number, y: number, radius: number): SVGCircleElement {
  const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hitArea.setAttribute("cx", String(x));
  hitArea.setAttribute("cy", String(y));
  hitArea.setAttribute("r", String(radius + 10));
  hitArea.setAttribute("fill", "transparent");
  return hitArea;
}

export function passengerOffset(index: number, stationRadius: number): Point {
  const ring = Math.floor(index / 4);
  const slot = index % 4;
  const angle = (-Math.PI / 4) + (Math.PI / 2) * slot;
  const distance = stationRadius + 10 + ring * 9;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance + stationRadius * 0.35,
  };
}
