import {
  SHAPES, LINE_COLORS, INITIAL_STATIONS, INITIAL_LINES,
  STATION_SPAWN_INTERVAL, PASSENGER_SPAWN_RATE, MIN_STATION_DIST, MAP_PADDING,
} from './constants.js';
import { Station } from './Station.js';
import { Line } from './Line.js';
import { randomChoice, randomRange, dist } from './utils.js';

export class Game {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.stations = [];
    this.lines = [];
    this.running = false;
    this.paused = false;
    this.gameOver = false;
    this.week = 1;
    this.weekTimer = 0;
    this.weekDuration = 30;
    this.stationSpawnTimer = STATION_SPAWN_INTERVAL * 0.5;
    this.linesRemaining = INITIAL_LINES;
    this.nextColorIndex = 0;
    this.time = 0;
    this.usedColors = 0;
  }

  nextLineColor() {
    return LINE_COLORS[this.nextColorIndex % LINE_COLORS.length];
  }

  start() {
    this.stations = [];
    this.lines = [];
    this.running = true;
    this.paused = false;
    this.gameOver = false;
    this.week = 1;
    this.weekTimer = 0;
    this.stationSpawnTimer = STATION_SPAWN_INTERVAL;
    this.linesRemaining = INITIAL_LINES;
    this.nextColorIndex = 0;
    this.usedColors = 0;
    this.time = 0;

    for (let i = 0; i < INITIAL_STATIONS; i++) {
      this.spawnStation(true);
    }
  }

  spawnStation(initial = false) {
    const pos = this.findSpawnPosition();
    if (!pos) return null;

    const usedShapes = this.stations.map(s => s.shape);
    let shape = randomChoice(SHAPES);
    // Prefer variety early on
    if (initial && usedShapes.length > 0) {
      const available = SHAPES.filter(s => !usedShapes.includes(s));
      if (available.length > 0) shape = randomChoice(available);
    }

    const station = new Station(pos.x, pos.y, shape);
    this.stations.push(station);
    return station;
  }

  findSpawnPosition(attempts = 80) {
    for (let i = 0; i < attempts; i++) {
      const x = randomRange(MAP_PADDING, this.w - MAP_PADDING);
      const y = randomRange(MAP_PADDING, this.h - MAP_PADDING);
      let ok = true;
      for (const st of this.stations) {
        if (dist({ x, y }, st) < MIN_STATION_DIST) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, y };
    }
    return null;
  }

  hitTestLines(px, py) {
    let best = null;
    for (const line of this.lines) {
      const hit = line.hitTestLine(px, py);
      if (hit && (!best || hit.dist < best.dist)) {
        best = { line, ...hit };
      }
    }
    return best;
  }

  getStation(id) {
    return this.stations.find(s => s.id === id);
  }

  commitConnection(drag, target) {
    const { mode, fromStation, line, fromEnd, segmentIndex } = drag;

    if (mode === 'new') {
      const colorIdx = this.nextColorIndex++;
      const newLine = new Line([fromStation, target], colorIdx);
      this.lines.push(newLine);
      this.linesRemaining--;
      this.playConnectAnim();
      return;
    }

    if (mode === 'extend' && line) {
      if (fromEnd === 'end') {
        line.appendStation(target);
      } else {
        line.prependStation(target);
      }
      this.playConnectAnim();
      return;
    }

    if (mode === 'branch') {
      const colorIdx = this.nextColorIndex++;
      const newLine = new Line([fromStation, target], colorIdx);
      this.lines.push(newLine);
      this.linesRemaining--;
      this.playConnectAnim();
      return;
    }

    if (mode === 'insert' && line) {
      // Drag from line to station inserts that station into the line
      if (!line.containsStation(target.id)) {
        line.insertStation(segmentIndex, target);
        this.playConnectAnim();
      }
      return;
    }
  }

  playConnectAnim() {
    // Placeholder for future haptic/sound; stations could pulse
  }

  update(dt) {
    if (!this.running || this.paused || this.gameOver) return;

    this.time += dt;
    this.weekTimer += dt;

    if (this.weekTimer >= this.weekDuration) {
      this.weekTimer = 0;
      this.week++;
      this.linesRemaining++;
      this.stationSpawnTimer = Math.min(this.stationSpawnTimer, 5);
    }

    // Spawn new stations
    this.stationSpawnTimer -= dt;
    if (this.stationSpawnTimer <= 0) {
      this.spawnStation();
      this.stationSpawnTimer = STATION_SPAWN_INTERVAL * randomRange(0.8, 1.2);
    }

    // Spawn passengers
    for (const st of this.stations) {
      st.spawnTimer -= dt;
      if (st.spawnTimer <= 0) {
        const rate = PASSENGER_SPAWN_RATE * (1 + this.week * 0.08);
        st.spawnTimer = 1 / rate;
        const dest = randomChoice(SHAPES.filter(s => s !== st.shape));
        st.addPassenger(dest);
      }
      st.update(dt);
    }

    // Update lines and trains
    for (const line of this.lines) {
      line.update(dt, this);
    }

    // Check game over
    for (const st of this.stations) {
      if (st.isOverloaded()) {
        this.gameOver = true;
        this.running = false;
        return;
      }
    }
  }

  getHud() {
    return {
      week: this.week,
      linesRemaining: this.linesRemaining,
      gameOver: this.gameOver,
      paused: this.paused,
    };
  }
}
