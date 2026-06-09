import { MapRenderer } from "./render/MapRenderer.ts";

const mapEl = document.querySelector<HTMLElement>("#map");
const legendEl = document.querySelector<HTMLElement>("#legend");
const statusEl = document.querySelector<HTMLElement>("#status");

if (!mapEl || !legendEl || !statusEl) {
  throw new Error("Map container elements are missing.");
}

new MapRenderer(mapEl, legendEl, statusEl);
