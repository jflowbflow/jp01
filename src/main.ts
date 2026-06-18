import { MapRenderer } from "./render/MapRenderer.ts";

const mapEl = document.querySelector<HTMLElement>("#map");
const linePickerEl = document.querySelector<HTMLElement>("#line-picker");
const removePickerEl = document.querySelector<HTMLElement>("#remove-picker");

if (!mapEl || !linePickerEl || !removePickerEl) {
  throw new Error("Map container elements are missing.");
}

new MapRenderer(mapEl, linePickerEl, removePickerEl);
