import { lineDefinitions } from "../data/network.ts";
import type { PlayerLine } from "../model/types.ts";

export class GameState {
  private readonly lines: PlayerLine[];
  private activeLineId: string;

  constructor() {
    this.lines = lineDefinitions.map((definition) => ({
      ...definition,
      stationIds: [],
      isLoop: false,
    }));
    this.activeLineId = this.lines[0].id;
  }

  getLines(): readonly PlayerLine[] {
    return this.lines;
  }

  getActiveLineId(): string {
    return this.activeLineId;
  }

  setActiveLine(lineId: string): void {
    if (this.lines.some((line) => line.id === lineId)) {
      this.activeLineId = lineId;
    }
  }

  getActiveLine(): PlayerLine {
    return this.lines.find((line) => line.id === this.activeLineId) ?? this.lines[0];
  }

  addStation(stationId: string): boolean {
    const line = this.getActiveLine();
    if (line.isLoop) return false;

    const { stationIds } = line;
    if (stationIds.length === 0) {
      stationIds.push(stationId);
      return true;
    }

    const lastId = stationIds[stationIds.length - 1];
    if (stationId === lastId) return false;

    const firstId = stationIds[0];
    if (stationId === firstId) {
      if (stationIds.length < 3) return false;
      line.isLoop = true;
      return true;
    }

    if (stationIds.includes(stationId)) return false;

    stationIds.push(stationId);
    return true;
  }

  undoLastStation(lineId?: string): boolean {
    const line = this.lines.find((entry) => entry.id === (lineId ?? this.activeLineId));
    if (!line || line.isLoop || line.stationIds.length === 0) return false;
    line.stationIds.pop();
    return true;
  }

  getLineStatus(line: PlayerLine): string {
    if (line.isLoop) return "Loop complete";
    if (line.stationIds.length === 0) return "Select stations";
    if (line.stationIds.length === 1) return "1 station";
    return `${line.stationIds.length} stations — return to start to loop`;
  }
}
