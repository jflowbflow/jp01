import { MapRenderer } from "./render/MapRenderer.ts";

const appEl = document.querySelector<HTMLElement>("#app");
const mapEl = document.querySelector<HTMLElement>("#map");
const linePickerEl = document.querySelector<HTMLElement>("#line-picker");

if (!appEl || !mapEl || !linePickerEl) {
  throw new Error("Map container elements are missing.");
}

new MapRenderer(appEl, mapEl, linePickerEl);
