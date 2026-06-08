import type { MetroLine, Station } from "../model/types.ts";

export const stations: Station[] = [
  { id: "s1", name: "Harbor", x: 120, y: 300 },
  { id: "s2", name: "Market", x: 260, y: 180 },
  { id: "s3", name: "Plaza", x: 420, y: 120 },
  { id: "s4", name: "Museum", x: 620, y: 160 },
  { id: "s5", name: "Park", x: 760, y: 280 },
  { id: "s6", name: "Terminal", x: 700, y: 440 },
  { id: "s7", name: "Depot", x: 500, y: 520 },
  { id: "s8", name: "Square", x: 280, y: 460 },
  { id: "s9", name: "Bridge", x: 500, y: 300 },
  { id: "s10", name: "Heights", x: 360, y: 320 },
];

export const lines: MetroLine[] = [
  {
    id: "line-a",
    name: "Orange Loop",
    color: "#f28c28",
    stationIds: ["s1", "s2", "s3", "s10", "s8"],
  },
  {
    id: "line-b",
    name: "Blue Loop",
    color: "#4ea5ff",
    stationIds: ["s3", "s4", "s5", "s6", "s9"],
  },
  {
    id: "line-c",
    name: "Green Loop",
    color: "#5ec269",
    stationIds: ["s1", "s8", "s7", "s6", "s5", "s9", "s10", "s2"],
  },
];
