export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Cubic bezier point at t */
export function bezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Approximate bezier length via subdivision */
export function bezierLength(p0, p1, p2, p3, steps = 20) {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const pt = bezierPoint(p0, p1, p2, p3, i / steps);
    len += dist(prev, pt);
    prev = pt;
  }
  return len;
}

/** Point on polyline of beziers at distance d along total path */
export function pointAtDistance(segments, d) {
  let remaining = d;
  for (const seg of segments) {
    const len = seg.length;
    if (remaining <= len) {
      const t = len > 0 ? remaining / len : 0;
      return {
        point: bezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, t),
        angle: tangentAngle(seg, t),
        segment: seg,
        t,
      };
    }
    remaining -= len;
  }
  const last = segments[segments.length - 1];
  return {
    point: last.p3,
    angle: tangentAngle(last, 1),
    segment: last,
    t: 1,
  };
}

function tangentAngle(seg, t) {
  const eps = 0.01;
  const t0 = clamp(t - eps, 0, 1);
  const t1 = clamp(t + eps, 0, 1);
  const a = bezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, t0);
  const b = bezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, t1);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}
