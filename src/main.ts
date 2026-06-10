import { MapRenderer } from "./render/MapRenderer.ts";

const mapEl = document.querySelector<HTMLElement>("#map");

if (!mapEl) {
  throw new Error("Map container is missing.");
}

new MapRenderer(mapEl);
