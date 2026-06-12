import { MapRenderer } from "./render/MapRenderer.ts";

const mapEl = document.querySelector<HTMLElement>("#map");
const pickerEl = document.querySelector<HTMLElement>("#line-picker");

if (!mapEl || !pickerEl) {
  throw new Error("Map container elements are missing.");
}

new MapRenderer(mapEl, pickerEl);
