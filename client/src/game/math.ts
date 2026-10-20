export const HALF_L = 52.5;
export const HALF_W = 34;
export const GOAL_HALF_W = 3.66;
export const GOAL_H = 2.44;
export const GOAL_DEPTH = 2.2;
export const BALL_R = 0.11;
export const BOX_DEPTH = 16.5;
export const BOX_HALF_W = 20.16;
export const SIX_DEPTH = 5.5;
export const SIX_HALF_W = 9.16;
export const PEN_SPOT = 11;
export const CIRCLE_R = 9.15;

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function len(x: number, z: number): number {
  return Math.hypot(x, z);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export function turnToward(current: number, target: number, maxDelta: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  gauss(): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
