import { MapRenderer } from "./render/MapRenderer.ts";

const mapEl = document.querySelector<HTMLElement>("#map");
const legendEl = document.querySelector<HTMLElement>("#legend");

if (!mapEl || !legendEl) {
  throw new Error("Map container elements are missing.");
}

new MapRenderer(mapEl, legendEl);
