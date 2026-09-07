import type { StationShape } from "../model/types.ts";
import { createStationShape } from "./stationShapes.ts";
import type { TrainRenderState } from "../game/trainSimulation.ts";

const TRAIN_LENGTH = 45;
const CARRIAGE_LENGTH = 38;
const TRAIN_WIDTH = 22;
const SLOT_SIZE = 5;

const SLOT_OFFSETS = [
  { x: -13, y: -5.5 },
  { x: -4, y: -5.5 },
  { x: 5, y: -5.5 },
  { x: 14, y: -5.5 },
  { x: -13, y: 5.5 },
  { x: -4, y: 5.5 },
];

export function createTrainElement(state: TrainRenderState): SVGGElement {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("pointer-events", "none");

  const scale = state.scale;
  const bodyLength = state.isCarriage ? CARRIAGE_LENGTH : TRAIN_LENGTH;

  group.setAttribute(
    "transform",
    `translate(${state.x} ${state.y}) rotate(${(state.angle * 180) / Math.PI}) scale(${scale})`,
  );

  const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  body.setAttribute("x", String(-bodyLength / 2));
  body.setAttribute("y", String(-TRAIN_WIDTH / 2));
  body.setAttribute("width", String(bodyLength));
  body.setAttribute("height", String(TRAIN_WIDTH));
  body.setAttribute("rx", state.isCarriage ? "4" : "5");
  body.setAttribute("fill", state.isCarriage ? "#f4f2ed" : "#ffffff");
  body.setAttribute("stroke", state.color);
  body.setAttribute("stroke-width", state.isCarriage ? "4" : "5");
  group.append(body);

  if (!state.isCarriage) {
    const nose = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    nose.setAttribute(
      "points",
      `${bodyLength / 2 - 2},${-TRAIN_WIDTH / 2 + 3} ${bodyLength / 2 + 6},0 ${bodyLength / 2 - 2},${TRAIN_WIDTH / 2 - 3}`,
    );
    nose.setAttribute("fill", state.color);
    group.append(nose);
  }

  state.car.passengers.forEach((passenger, index) => {
    if (index >= SLOT_OFFSETS.length) return;
    const offset = SLOT_OFFSETS[index];
    const icon = createStationShape(
      passenger.destinationShape as StationShape,
      offset.x,
      offset.y,
      SLOT_SIZE,
      {
        fill: "#ffffff",
        stroke: "#1a1a1e",
        strokeWidth: 2,
      },
    );
    group.append(icon);
  });

  return group;
}
