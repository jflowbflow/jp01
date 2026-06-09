import { MAP_HEIGHT, MAP_WIDTH } from "../data/network.ts";
import type { Point, Station } from "../model/types.ts";

export function loopHandleTip(station: Station, length = 26): Point {
  const centerX = MAP_WIDTH / 2;
  const centerY = MAP_HEIGHT / 2;
  const angle = Math.atan2(station.y - centerY, station.x - centerX);
  return {
    x: station.x + Math.cos(angle) * length,
    y: station.y + Math.sin(angle) * length,
  };
}

export function loopHandlePath(station: Station): string {
  const tip = loopHandleTip(station);
  return `M ${station.x} ${station.y} L ${tip.x} ${tip.y}`;
}
