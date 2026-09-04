import { MapRenderer } from "./render/MapRenderer.ts";

const mapEl = document.querySelector<HTMLElement>("#map");
const linePickerEl = document.querySelector<HTMLElement>("#line-picker");

if (!mapEl || !linePickerEl) {
  throw new Error("Map container elements are missing.");
}

new MapRenderer(mapEl, linePickerEl);
