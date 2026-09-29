import { clamp } from './utils';

/**
 * Cubic bezier easing evaluator using standard CSS/AE cubic-bezier(x1, y1, x2, y2).
 * Fast Newton-Raphson solver with bisection fallback.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  x1 = clamp(x1, 0, 1);
  x2 = clamp(x2, 0, 1);

  if (x1 === y1 && x2 === y2) {
    return (t: number) => clamp(t, 0, 1);
  }

  // Pre-calculate polynomial coefficients
  // X(t) = 3*(1-t)^2*t*x1 + 3*(1-t)*t^2*x2 + t^3
  //      = (3*x1 - 3*x2 + 1)*t^3 + (-6*x1 + 3*x2)*t^2 + 3*x1*t
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  function sampleCurveX(t: number) {
    return ((ax * t + bx) * t + cx) * t;
  }

  function sampleCurveY(t: number) {
    return ((ay * t + by) * t + cy) * t;
  }

  function sampleCurveDerivativeX(t: number) {
    return (3 * ax * t + 2 * bx) * t + cx;
  }

  function solveCurveX(x: number): number {
    // Newton raphson
    let t2 = x;
    for (let i = 0; i < 8; i++) {
      const x2 = sampleCurveX(t2) - x;
      if (Math.abs(x2) < 1e-5) return t2;
      const d2 = sampleCurveDerivativeX(t2);
      if (Math.abs(d2) < 1e-5) break;
      t2 = t2 - x2 / d2;
    }

    // Fallback: bisection
    let t0 = 0.0;
    let t1 = 1.0;
    t2 = x;

    if (t2 < t0) return t0;
    if (t2 > t1) return t1;

    while (t0 < t1) {
      const x2 = sampleCurveX(t2);
      if (Math.abs(x2 - x) < 1e-5) return t2;
      if (x > x2) t0 = t2;
      else t1 = t2;
      t2 = (t1 - t0) * 0.5 + t0;
    }

    return t2;
  }

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleCurveY(solveCurveX(x));
  };
}

/**
 * Standard cubic bezier presets famous in After Effects, Alight Motion, and fandom edits.
 */
export const BEZIER_PRESETS: Record<string, [number, number, number, number]> = {
  // Classic AE / Alight Motion high-speed easing curves
  aeEase: [0.33, 0.0, 0.67, 1.0], // Easy Ease (default AE)
  aeFlow: [0.12, 0.85, 0.2, 1.0], // Smooth snappy fandom curve (fast in, long cushioned tail)
  aeSnap: [0.08, 0.82, 0.17, 1.0], // Super crisp snap (Spidey punch / whip)
  aeWhip: [0.65, 0.0, 0.05, 1.0], // Dramatic mid-ramp whip (S-curve)
  aeOvershoot: [0.34, 1.56, 0.64, 1.0], // Overshoot pop
  expoIn: [0.7, 0.0, 0.84, 0.0],
  expoOut: [0.16, 1.0, 0.3, 1.0],
  easeInOutQuint: [0.83, 0.0, 0.17, 1.0],
  linear: [0.0, 0.0, 1.0, 1.0],
};
