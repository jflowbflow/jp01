import { STATION_RADIUS, LINE_WIDTH, TRAIN_RADIUS, SNAP_RADIUS, SHAPES } from './constants.js';
import { bezierPoint, easeOutBack } from './utils.js';

const SHAPE_COLORS = {
  circle: '#c0392b',
  square: '#2980b9',
  triangle: '#f39c12',
  diamond: '#27ae60',
  cross: '#8e44ad',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  clear() {
    this.ctx.fillStyle = '#e8e4df';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  drawWater() {
  }

  drawLines(lines) {
    for (const line of lines) {
      this.drawLine(line);
    }
  }

  drawLine(line) {
    const ctx = this.ctx;
    if (line.segments.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = line.color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.beginPath();

    const first = line.segments[0];
    ctx.moveTo(first.p0.x, first.p0.y);
    for (const seg of line.segments) {
      ctx.bezierCurveTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y, seg.p3.x, seg.p3.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawDragPreview(drag, snapTarget, snapT) {
    if (!drag?.previewBezier) return;
    const ctx = this.ctx;
    const { p0, p1, p2, p3 } = drag.previewBezier;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Ghost line underneath
    ctx.strokeStyle = drag.color + '55';
    ctx.lineWidth = LINE_WIDTH + 4;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();

    // Main preview line
    ctx.strokeStyle = drag.color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();

    // Endpoint dot at cursor
    ctx.fillStyle = drag.color;
    ctx.beginPath();
    ctx.arc(p3.x, p3.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Snap ring on target
    if (snapTarget && snapT > 0) {
      const r = STATION_RADIUS + 6 + snapT * 8;
      ctx.strokeStyle = drag.color + Math.round(snapT * 180).toString(16).padStart(2, '0');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(snapTarget.x, snapTarget.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawTrains(lines) {
    for (const line of lines) {
      for (const train of line.trains) {
        const { point } = line.getTrainPosition(train);
        this.drawTrain(point.x, point.y, line.color, train);
      }
    }
  }

  drawTrain(x, y, color, train) {
    const ctx = this.ctx;
    const onboard = Object.values(train.onboard).reduce((s, n) => s + n, 0);

    ctx.save();
    ctx.fillStyle = '#e8e4df';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, TRAIN_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (onboard > 0) {
      ctx.fillStyle = color;
      ctx.font = '9px Jost, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(onboard, x, y);
    }
    ctx.restore();
  }

  drawStations(stations) {
    for (const st of stations) {
      this.drawStation(st);
    }
  }

  drawStation(st) {
    const ctx = this.ctx;
    const scale = st.isNew ? easeOutBack(st.newAnim) : 1;
    const r = STATION_RADIUS * scale;
    const color = SHAPE_COLORS[st.shape] || '#333';

    ctx.save();
    ctx.translate(st.x, st.y);

    // Overload warning
    const total = st.totalPassengers();
    if (total > 12) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
      ctx.strokeStyle = `rgba(192, 57, 43, ${0.3 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 10 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Snap pulse
    if (st.pulse > 0) {
      ctx.strokeStyle = `rgba(90, 86, 82, ${st.pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4 + (1 - st.pulse) * 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // White fill
    ctx.fillStyle = '#e8e4df';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;

    this.drawShape(st.shape, r);

    ctx.restore();

    // Passenger shapes waiting
    this.drawPassengerPips(st, color);
  }

  drawShape(shape, r) {
    const ctx = this.ctx;
    const s = r * 0.55;

    ctx.beginPath();
    switch (shape) {
      case 'circle':
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        break;
      case 'square':
        ctx.rect(-s, -s, s * 2, s * 2);
        break;
      case 'triangle': {
        ctx.moveTo(0, -s);
        ctx.lineTo(s, s * 0.85);
        ctx.lineTo(-s, s * 0.85);
        ctx.closePath();
        break;
      }
      case 'diamond':
        ctx.moveTo(0, -s);
        ctx.lineTo(s, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s, 0);
        ctx.closePath();
        break;
      case 'cross': {
        const t = s * 0.35;
        ctx.moveTo(-t, -s);
        ctx.lineTo(t, -s);
        ctx.lineTo(t, -t);
        ctx.lineTo(s, -t);
        ctx.lineTo(s, t);
        ctx.lineTo(t, t);
        ctx.lineTo(t, s);
        ctx.lineTo(-t, s);
        ctx.lineTo(-t, t);
        ctx.lineTo(-s, t);
        ctx.lineTo(-s, -t);
        ctx.lineTo(-t, -t);
        ctx.closePath();
        break;
      }
    }
    ctx.fill();
    ctx.stroke();
  }

  drawPassengerPips(st, stationColor) {
    const ctx = this.ctx;
    const entries = Object.entries(st.passengers);
    if (entries.length === 0) return;

    const total = st.totalPassengers();
    const maxShow = 12;
    let shown = 0;
    const pipR = 4;
    const startAngle = -Math.PI / 2;
    const ring = STATION_RADIUS + 10;

    for (const [shape, count] of entries) {
      const color = SHAPE_COLORS[shape] || '#333';
      for (let i = 0; i < count && shown < maxShow; i++) {
        const angle = startAngle + (shown / Math.min(total, maxShow)) * Math.PI * 2;
        const px = st.x + Math.cos(angle) * ring;
        const py = st.y + Math.sin(angle) * ring;

        ctx.fillStyle = '#e8e4df';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, pipR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Tiny shape inside
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(0.3, 0.3);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        this.drawShape(shape, pipR);
        ctx.restore();

        shown++;
      }
    }

    if (total > maxShow) {
      ctx.fillStyle = '#5a5652';
      ctx.font = '10px Jost, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`+${total - maxShow}`, st.x, st.y + STATION_RADIUS + 22);
    }
  }
}
