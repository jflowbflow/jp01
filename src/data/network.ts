import type { LineDefinition, Station } from "../model/types.ts";

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

export const lineDefinitions: LineDefinition[] = [
  { id: "line-a", name: "Orange Line", color: "#f28c28" },
  { id: "line-b", name: "Blue Line", color: "#4ea5ff" },
  { id: "line-c", name: "Green Line", color: "#5ec269" },
];
