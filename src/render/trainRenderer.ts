import type { StationShape } from "../model/types.ts";
import { createStationShape } from "./stationShapes.ts";
import type { TrainRenderState } from "../game/trainSimulation.ts";

const TRAIN_LENGTH = 28;
const TRAIN_WIDTH = 14;
const SLOT_SIZE = 3.2;

const SLOT_OFFSETS = [
  { x: -8, y: -3.5 },
  { x: -2.5, y: -3.5 },
  { x: 3, y: -3.5 },
  { x: 8.5, y: -3.5 },
  { x: -8, y: 3.5 },
  { x: -2.5, y: 3.5 },
];

export function createTrainElement(state: TrainRenderState): SVGGElement {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("pointer-events", "none");

  const angleDeg = (state.angle * 180) / Math.PI;
  const flip = state.train.direction < 0 ? -1 : 1;
  group.setAttribute(
    "transform",
    `translate(${state.x} ${state.y}) rotate(${angleDeg}) scale(${flip} 1)`,
  );

  const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  body.setAttribute("x", String(-TRAIN_LENGTH / 2));
  body.setAttribute("y", String(-TRAIN_WIDTH / 2));
  body.setAttribute("width", String(TRAIN_LENGTH));
  body.setAttribute("height", String(TRAIN_WIDTH));
  body.setAttribute("rx", "3");
  body.setAttribute("fill", "#ffffff");
  body.setAttribute("stroke", state.color);
  body.setAttribute("stroke-width", "3");
  group.append(body);

  state.train.passengers.forEach((passenger, index) => {
    if (index >= SLOT_OFFSETS.length) return;
    const offset = SLOT_OFFSETS[index];
    const icon = createStationShape(
      passenger.destinationShape as StationShape,
      offset.x * flip,
      offset.y,
      SLOT_SIZE,
      {
        fill: "#ffffff",
        stroke: "#1a1a1e",
        strokeWidth: 1,
      },
    );
    group.append(icon);
  });

  return group;
}
