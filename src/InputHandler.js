import { SNAP_RADIUS, STATION_RADIUS } from './constants.js';
import { dist, easeOutCubic } from './utils.js';
import { makeDragBezier } from './Line.js';

/**
 * Handles Mini Metro-style line dragging:
 * - Click station → drag rubber-hose preview to another station
 * - Click line segment → branch/insert station into line
 * - Snap with easing when near valid target
 * - Visual pulse feedback on snap
 */
export class InputHandler {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.dragging = false;
    this.drag = null;
    this.mouse = { x: 0, y: 0 };
    this.snapTarget = null;
    this.snapT = 0; // 0-1 eased snap blend
    this.smoothX = 0;
    this.smoothY = 0;

    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  findStationAt(x, y, excludeId = null) {
    let best = null;
    for (const st of this.game.stations) {
      if (st.id === excludeId) continue;
      const d = dist({ x, y }, st);
      if (d < STATION_RADIUS + 10 && (!best || d < best.dist)) {
        best = { station: st, dist: d };
      }
    }
    return best?.station ?? null;
  }

  onDown(e) {
    if (!this.game.running || this.game.paused) return;
    const pos = this.getPos(e);
    this.mouse = pos;

    const station = this.findStationAt(pos.x, pos.y);
    if (station) {
      this.startDragFromStation(station, pos);
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Check line hit for insertion/branching
    const lineHit = this.game.hitTestLines(pos.x, pos.y);
    if (lineHit) {
      this.startDragFromLine(lineHit, pos);
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  startDragFromStation(station, pos) {
    if (this.game.linesRemaining <= 0 && !this.getLineForStation(station)) return;

    const existingLine = this.getLineForStation(station);
    let mode = 'new';
    let line = null;
    let fromEnd = null;

    if (existingLine) {
      if (existingLine.canExtendFrom(station.id)) {
        mode = 'extend';
        line = existingLine;
        fromEnd = existingLine.stations[0].id === station.id ? 'start' : 'end';
      } else {
        // Middle station — can still branch if lines remain
        if (this.game.linesRemaining <= 0) return;
        mode = 'branch';
      }
    } else {
      if (this.game.linesRemaining <= 0) return;
      mode = 'new';
    }

    this.dragging = true;
    this.canvas.classList.add('dragging');
    this.drag = {
      mode,
      fromStation: station,
      line,
      fromEnd,
      startX: station.x,
      startY: station.y,
      currentX: pos.x,
      currentY: pos.y,
      previewBezier: null,
      color: line?.color ?? this.game.nextLineColor(),
    };
    this.snapTarget = null;
    this.snapT = 0;
    this.smoothX = station.x;
    this.smoothY = station.y;
  }

  startDragFromLine(lineHit, pos) {
    if (this.game.linesRemaining <= 0) return;

    this.dragging = true;
    this.canvas.classList.add('dragging');
    this.drag = {
      mode: 'insert',
      fromStation: null,
      line: lineHit.line,
      segmentIndex: lineHit.segmentIndex,
      insertPoint: lineHit.point,
      startX: lineHit.point.x,
      startY: lineHit.point.y,
      currentX: pos.x,
      currentY: pos.y,
      previewBezier: null,
      color: lineHit.line.color,
    };
    this.snapTarget = null;
    this.snapT = 0;
    this.smoothX = lineHit.point.x;
    this.smoothY = lineHit.point.y;
    this.lineTangent = lineHit.tangent;
  }

  getLineForStation(station) {
    for (const line of this.game.lines) {
      if (line.containsStation(station.id)) return line;
    }
    return null;
  }

  onMove(e) {
    const pos = this.getPos(e);
    this.mouse = pos;

    if (!this.dragging || !this.drag) return;

    const fromId = this.drag.fromStation?.id;
    const candidate = this.findStationAt(pos.x, pos.y, fromId);

    // Validate snap target
    let validTarget = null;
    if (candidate) {
      validTarget = this.isValidTarget(candidate) ? candidate : null;
    }

    if (validTarget && validTarget !== this.snapTarget) {
      validTarget.pulseSnap();
    }

    // Smooth snap easing
    if (validTarget) {
      this.snapT = Math.min(1, this.snapT + 0.18);
      this.snapTarget = validTarget;
    } else {
      this.snapT = Math.max(0, this.snapT - 0.12);
      if (this.snapT <= 0) this.snapTarget = null;
    }

    const snapEased = easeOutCubic(this.snapT);
    let targetX = pos.x;
    let targetY = pos.y;
    if (this.snapTarget) {
      targetX = targetX + (this.snapTarget.x - targetX) * snapEased;
      targetY = targetY + (this.snapTarget.y - targetY) * snapEased;
    }

    // Rubber-hose lag: preview tip eases toward cursor for tactile weight
    const hoseSpeed = this.snapTarget ? 0.35 : 0.22;
    this.smoothX += (targetX - this.smoothX) * hoseSpeed;
    this.smoothY += (targetY - this.smoothY) * hoseSpeed;

    this.drag.currentX = this.smoothX;
    this.drag.currentY = this.smoothY;

    const tangent = this.getFromTangent();
    this.drag.previewBezier = makeDragBezier(
      this.drag.startX, this.drag.startY,
      targetX, targetY,
      tangent
    );
  }

  getFromTangent() {
    if (!this.drag) return null;
    const d = this.drag;

    if (d.mode === 'insert' && this.lineTangent) {
      return this.lineTangent;
    }

    if (d.mode === 'extend' && d.line && d.fromStation) {
      const idx = d.line.stationIndex(d.fromStation.id);
      const sts = d.line.stations;
      if (d.fromEnd === 'end' && idx > 0) {
        const prev = sts[idx - 1];
        const dx = d.fromStation.x - prev.x;
        const dy = d.fromStation.y - prev.y;
        const l = Math.hypot(dx, dy) || 1;
        return { x: dx / l, y: dy / l };
      }
      if (d.fromEnd === 'start' && idx < sts.length - 1) {
        const next = sts[idx + 1];
        const dx = next.x - d.fromStation.x;
        const dy = next.y - d.fromStation.y;
        const l = Math.hypot(dx, dy) || 1;
        return { x: dx / l, y: dy / l };
      }
    }
    return null;
  }

  isValidTarget(station) {
    const d = this.drag;
    if (!d) return false;

    if (d.fromStation && station.id === d.fromStation.id) return false;

    if (d.mode === 'new') {
      // Can't connect to station already on same new line (only one station so far)
      return true;
    }

    if (d.mode === 'extend' && d.line) {
      if (d.line.containsStation(station.id)) {
        // Can only connect to adjacent station on same line (backtrack) — skip
        const idx = d.line.stationIndex(station.id);
        const fromIdx = d.line.stationIndex(d.fromStation.id);
        if (Math.abs(idx - fromIdx) === 1) return false;
      }
      return true;
    }

    if (d.mode === 'branch') {
      return !d.fromStation || station.id !== d.fromStation.id;
    }

    if (d.mode === 'insert') {
      return true;
    }

    return true;
  }

  onUp(e) {
    if (!this.dragging) return;
    this.canvas.classList.remove('dragging');

    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}

    const d = this.drag;
    const target = this.snapTarget;

    if (target && this.isValidTarget(target)) {
      this.game.commitConnection(d, target);
    }

    this.dragging = false;
    this.drag = null;
    this.snapTarget = null;
    this.snapT = 0;
  }

  getDragState() {
    return {
      dragging: this.dragging,
      drag: this.drag,
      snapTarget: this.snapTarget,
      snapT: this.snapT,
      mouse: this.mouse,
    };
  }

  /** Draw snap radius indicator when dragging */
  shouldShowSnapRing() {
    return this.dragging && this.snapTarget;
  }
}
