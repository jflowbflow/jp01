import { LINE_COLORS, TRAIN_SPEED } from './constants.js';
import { bezierLength, pointAtDistance, dist, bezierPoint } from './utils.js';

let nextLineId = 0;

export class Line {
  constructor(stations, colorIndex) {
    this.id = nextLineId++;
    this.stations = [...stations];
    this.color = LINE_COLORS[colorIndex % LINE_COLORS.length];
    this.colorIndex = colorIndex;
    this.trains = [];
    this.segments = [];
    this.totalLength = 0;
    this.rebuildSegments();
    this.spawnTrain();
  }

  rebuildSegments() {
    this.segments = [];
    this.totalLength = 0;
    const sts = this.stations;
    for (let i = 0; i < sts.length - 1; i++) {
      const seg = makeSegment(sts, i);
      seg.length = bezierLength(seg.p0, seg.p1, seg.p2, seg.p3);
      this.segments.push(seg);
      this.totalLength += seg.length;
    }
  }

  spawnTrain() {
    this.trains.push({
      distance: 0,
      direction: 1,
      capacity: 6,
      onboard: {},
      dwell: 0,
      atStation: this.stations[0]?.id ?? null,
    });
  }

  stationIndex(stationId) {
    return this.stations.findIndex(s => s.id === stationId);
  }

  isTerminal(stationId) {
    const idx = this.stationIndex(stationId);
    return idx === 0 || idx === this.stations.length - 1;
  }

  containsStation(stationId) {
    return this.stationIndex(stationId) !== -1;
  }

  /** Can we extend from this station? Must be a terminal. */
  canExtendFrom(stationId) {
    return this.isTerminal(stationId);
  }

  /** Insert station at segment index (between stations[i] and stations[i+1]) */
  insertStation(index, station) {
    this.stations.splice(index + 1, 0, station);
    this.rebuildSegments();
  }

  /** Append station at end */
  appendStation(station) {
    this.stations.push(station);
    this.rebuildSegments();
  }

  /** Prepend station at start */
  prependStation(station) {
    this.stations.unshift(station);
    this.rebuildSegments();
  }

  update(dt, game) {
    for (const train of this.trains) {
      this.updateTrain(train, dt, game);
    }
  }

  updateTrain(train, dt, game) {
    if (train.dwell > 0) {
      train.dwell -= dt;
      if (train.dwell <= 0) {
        train.dwell = 0;
        const st = game.getStation(train.atStation);
        if (st) this.exchangePassengers(train, st);
        train.atStation = null;
      }
      return;
    }

    const speed = TRAIN_SPEED * train.direction;
    train.distance += speed * dt;

    if (train.distance >= this.totalLength) {
      train.distance = this.totalLength;
      train.direction = -1;
      train.dwell = 0.6;
      train.atStation = this.stations[this.stations.length - 1].id;
      return;
    }
    if (train.distance <= 0) {
      train.distance = 0;
      train.direction = 1;
      train.dwell = 0.6;
      train.atStation = this.stations[0].id;
      return;
    }

    // Check if passing through a station
    for (let i = 1; i < this.stations.length - 1; i++) {
      const segBefore = this.segments[i - 1];
      const distAtStation = this.segments.slice(0, i).reduce((s, seg) => s + seg.length, 0);
      const threshold = 4;
      if (Math.abs(train.distance - distAtStation) < threshold && train.atStation !== this.stations[i].id) {
        train.dwell = 0.5;
        train.atStation = this.stations[i].id;
        train.distance = distAtStation;
        return;
      }
    }
  }

  exchangePassengers(train, station) {
    // Drop off passengers whose destination matches this station's shape
    const dest = station.shape;
    const drop = train.onboard[dest] || 0;
    if (drop > 0) {
      train.onboard[dest] = 0;
      // delivered — don't add back to station
    }

    // Pick up passengers going somewhere else
    const onboard = Object.values(train.onboard).reduce((s, n) => s + n, 0);
    let space = train.capacity - onboard;
    if (space <= 0) return;

    for (const shape of Object.keys(station.passengers)) {
      if (shape === station.shape) continue;
      const taken = station.takePassengers(shape, space);
      if (taken > 0) {
        train.onboard[shape] = (train.onboard[shape] || 0) + taken;
        space -= taken;
      }
      if (space <= 0) break;
    }
  }

  getTrainPosition(train) {
    return pointAtDistance(this.segments, train.distance);
  }

  /** Find closest point on line to a given point; returns { segmentIndex, t, point, dist, tangent } */
  hitTestLine(px, py, threshold = 14) {
    let best = null;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      for (let s = 0; s <= 30; s++) {
        const t = s / 30;
        const u = 1 - t;
        const pt = {
          x: u*u*u*seg.p0.x + 3*u*u*t*seg.p1.x + 3*u*t*t*seg.p2.x + t*t*t*seg.p3.x,
          y: u*u*u*seg.p0.y + 3*u*u*t*seg.p1.y + 3*u*t*t*seg.p2.y + t*t*t*seg.p3.y,
        };
        const d = dist({ x: px, y: py }, pt);
        if (d < threshold && (!best || d < best.dist)) {
          const eps = 0.04;
          const t0 = Math.max(0, t - eps);
          const t1 = Math.min(1, t + eps);
          const pA = bezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, t0);
          const pB = bezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, t1);
          const tdx = pB.x - pA.x;
          const tdy = pB.y - pA.y;
          const tl = Math.hypot(tdx, tdy) || 1;
          best = {
            segmentIndex: i,
            t,
            point: pt,
            dist: d,
            tangent: { x: tdx / tl, y: tdy / tl },
          };
        }
      }
    }
    return best;
  }
}

/** Mini Metro style smooth bezier between stations */
export function makeSegment(stations, index) {
  const a = stations[index];
  const b = stations[index + 1];
  const p0 = { x: a.x, y: a.y };
  const p3 = { x: b.x, y: b.y };

  const prev = index > 0 ? stations[index - 1] : null;
  const next = index < stations.length - 2 ? stations[index + 2] : null;

  const tension = 0.4;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  // Incoming tangent
  let inDx = dx, inDy = dy;
  if (prev) {
    inDx = a.x - prev.x;
    inDy = a.y - prev.y;
    const il = Math.hypot(inDx, inDy) || 1;
    inDx /= il; inDy /= il;
  }

  // Outgoing tangent
  let outDx = dx, outDy = dy;
  if (next) {
    outDx = next.x - b.x;
    outDy = next.y - b.y;
    const ol = Math.hypot(outDx, outDy) || 1;
    outDx /= ol; outDy /= ol;
  }

  const cpDist = len * tension;
  const p1 = {
    x: a.x + (dx + inDx) * 0.5 * cpDist,
    y: a.y + (dy + inDy) * 0.5 * cpDist,
  };
  const p2 = {
    x: b.x - (dx + outDx) * 0.5 * cpDist,
    y: b.y - (dy + outDy) * 0.5 * cpDist,
  };

  return { p0, p1, p2, p3, stationA: a.id, stationB: b.id, length: 0 };
}

/** Preview bezier from station to cursor/target — the "rubber hose" feel */
export function makeDragBezier(fromX, fromY, toX, toY, fromTangent = null) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const ndx = dx / len;
  const ndy = dy / len;

  let tdx = ndx, tdy = ndy;
  if (fromTangent) {
    tdx = (ndx + fromTangent.x) * 0.5;
    tdy = (ndy + fromTangent.y) * 0.5;
    const tl = Math.hypot(tdx, tdy) || 1;
    tdx /= tl; tdy /= tl;
  }

  const cpDist = Math.min(len * 0.45, 120);
  const p0 = { x: fromX, y: fromY };
  const p3 = { x: toX, y: toY };
  const p1 = { x: fromX + tdx * cpDist, y: fromY + tdy * cpDist };
  const p2 = { x: toX - ndx * cpDist, y: toY - ndy * cpDist };

  return { p0, p1, p2, p3 };
}
