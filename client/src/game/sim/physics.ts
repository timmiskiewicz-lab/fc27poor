import { BALL_R, GOAL_DEPTH, GOAL_H, GOAL_HALF_W, HALF_L } from "../math";

export const GRAVITY = 9.81;
export const DRAG = 0.0125;
export const MAGNUS = 0.0065;
export const ROLL_A = 0.2;
export const ROLL_B = 0.42;
export const BOUNCE = 0.56;
const POST_R = 0.06;

export interface BallBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  sz: number;
}

export type BallHit = "post" | "bar" | "net" | "bounce" | null;

export function ballGrounded(b: BallBody): boolean {
  return b.y <= BALL_R + 0.02 && Math.abs(b.vy) < 0.6;
}

function integrate(b: BallBody, dt: number): BallHit {
  let hit: BallHit = null;
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  const grounded = b.y <= BALL_R + 0.005 && Math.abs(b.vy) < 0.9;
  let ax = -DRAG * speed * b.vx;
  let ay = -DRAG * speed * b.vy - GRAVITY;
  let az = -DRAG * speed * b.vz;
  if (!grounded) {
    ax += MAGNUS * (b.sy * b.vz - b.sz * b.vy);
    ay += MAGNUS * (b.sz * b.vx - b.sx * b.vz);
    az += MAGNUS * (b.sx * b.vy - b.sy * b.vx);
  }
  b.vx += ax * dt;
  b.vy += ay * dt;
  b.vz += az * dt;
  if (grounded) {
    b.vy = Math.max(b.vy, 0);
    const h = Math.hypot(b.vx, b.vz);
    if (h > 0) {
      const nh = Math.max(0, h - (ROLL_A * h + ROLL_B) * dt);
      b.vx *= nh / h;
      b.vz *= nh / h;
    }
    const decay = Math.exp(-3 * dt);
    b.sx *= decay;
    b.sy *= decay;
    b.sz *= decay;
  } else {
    const decay = Math.exp(-0.35 * dt);
    b.sx *= decay;
    b.sy *= decay;
    b.sz *= decay;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.y < BALL_R) {
    b.y = BALL_R;
    if (b.vy < -1.1) {
      b.vy = -b.vy * BOUNCE;
      b.vx *= 0.86;
      b.vz *= 0.86;
      b.sx *= 0.5;
      b.sy *= 0.6;
      b.sz *= 0.5;
      hit = "bounce";
    } else {
      b.vy = 0;
    }
  }
  return hit;
}

function postCollide(b: BallBody, px: number, pz: number): boolean {
  if (b.y > GOAL_H + BALL_R) return false;
  const dx = b.x - px;
  const dz = b.z - pz;
  const d = Math.hypot(dx, dz);
  const min = BALL_R + POST_R;
  if (d >= min || d < 1e-6) return false;
  const nx = dx / d;
  const nz = dz / d;
  b.x = px + nx * min;
  b.z = pz + nz * min;
  const vn = b.vx * nx + b.vz * nz;
  if (vn < 0) {
    b.vx -= (1 + 0.62) * vn * nx;
    b.vz -= (1 + 0.62) * vn * nz;
    b.vx *= 0.92;
    b.vz *= 0.92;
  }
  return true;
}

function barCollide(b: BallBody, bx: number): boolean {
  if (Math.abs(b.z) > GOAL_HALF_W + POST_R) return false;
  const dx = b.x - bx;
  const dy = b.y - GOAL_H;
  const d = Math.hypot(dx, dy);
  const min = BALL_R + POST_R;
  if (d >= min || d < 1e-6) return false;
  const nx = dx / d;
  const ny = dy / d;
  b.x = bx + nx * min;
  b.y = GOAL_H + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + 0.6) * vn * nx;
    b.vy -= (1 + 0.6) * vn * ny;
    b.vx *= 0.92;
  }
  return true;
}

function netCollide(b: BallBody, prevX: number, prevY: number, prevZ: number): boolean {
  const ax = Math.abs(b.x);
  if (ax < HALF_L || ax > HALF_L + GOAL_DEPTH + BALL_R * 2) return false;
  const sign = Math.sign(b.x);
  const wasInside = Math.abs(prevX) > HALF_L && Math.abs(prevZ) < GOAL_HALF_W && prevY < GOAL_H;
  let touched = false;
  if (wasInside) {
    const back = HALF_L + GOAL_DEPTH - BALL_R;
    if (ax > back) {
      b.x = sign * back;
      b.vx = -b.vx * 0.12;
      b.vz *= 0.45;
      b.vy *= 0.5;
      touched = true;
    }
    const side = GOAL_HALF_W - BALL_R;
    if (Math.abs(b.z) > side) {
      b.z = Math.sign(b.z) * side;
      b.vz = -b.vz * 0.15;
      b.vx *= 0.5;
      touched = true;
    }
    const roof = GOAL_H - BALL_R;
    if (b.y > roof) {
      b.y = roof;
      b.vy = -Math.abs(b.vy) * 0.15;
      b.vx *= 0.5;
      touched = true;
    }
    return touched;
  }
  if (ax < HALF_L + GOAL_DEPTH) {
    const outer = GOAL_HALF_W + BALL_R;
    if (Math.abs(prevZ) >= outer && Math.abs(b.z) < outer && b.y < GOAL_H) {
      b.z = Math.sign(prevZ) * outer;
      b.vz = -b.vz * 0.2;
      b.vx *= 0.6;
      touched = true;
    }
    const top = GOAL_H + BALL_R;
    if (prevY >= top && b.y < top && Math.abs(b.z) < GOAL_HALF_W) {
      b.y = top;
      b.vy = Math.abs(b.vy) * 0.2;
      b.vx *= 0.6;
      b.vz *= 0.6;
      touched = true;
    }
    const backOuter = HALF_L + GOAL_DEPTH + BALL_R;
    if (Math.abs(prevX) >= backOuter && ax < backOuter && Math.abs(b.z) < GOAL_HALF_W && b.y < GOAL_H) {
      b.x = sign * backOuter;
      b.vx = -b.vx * 0.2;
      touched = true;
    }
  }
  return touched;
}

export function stepBall(b: BallBody, dt: number, frame: boolean): BallHit {
  const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy, b.vz) * dt) / 0.12));
  const h = dt / steps;
  let result: BallHit = null;
  for (let i = 0; i < steps; i += 1) {
    const px = b.x;
    const py = b.y;
    const pz = b.z;
    const hit = integrate(b, h);
    if (hit && !result) result = hit;
    if (!frame) continue;
    for (const gx of [-HALF_L, HALF_L]) {
      if (Math.abs(b.x - gx) < 0.5) {
        if (postCollide(b, gx, GOAL_HALF_W) || postCollide(b, gx, -GOAL_HALF_W)) result = "post";
        if (barCollide(b, gx)) result = "bar";
      }
    }
    if (netCollide(b, px, py, pz) && result !== "post" && result !== "bar") result = "net";
  }
  return result;
}

export function simulateFlight(from: BallBody, time: number, out: { x: number; y: number; z: number }): void {
  const b = { ...from };
  const steps = Math.max(4, Math.ceil(time / 0.02));
  const h = time / steps;
  for (let i = 0; i < steps; i += 1) {
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    b.vx += (-DRAG * speed * b.vx + MAGNUS * (b.sy * b.vz - b.sz * b.vy)) * h;
    b.vy += (-DRAG * speed * b.vy - GRAVITY + MAGNUS * (b.sz * b.vx - b.sx * b.vz)) * h;
    b.vz += (-DRAG * speed * b.vz + MAGNUS * (b.sx * b.vy - b.sy * b.vx)) * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.z += b.vz * h;
  }
  out.x = b.x;
  out.y = b.y;
  out.z = b.z;
}

export function solveLaunch(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  time: number,
  spin: [number, number, number],
): [number, number, number] {
  let vx = (x1 - x0) / time;
  let vz = (z1 - z0) / time;
  let vy = (y1 - y0) / time + 0.5 * GRAVITY * time;
  const out = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 6; i += 1) {
    simulateFlight({ x: x0, y: y0, z: z0, vx, vy, vz, sx: spin[0], sy: spin[1], sz: spin[2] }, time, out);
    vx += ((x1 - out.x) / time) * 0.95;
    vy += ((y1 - out.y) / time) * 0.95;
    vz += ((z1 - out.z) / time) * 0.95;
  }
  return [vx, vy, vz];
}

export function rollDistance(v0: number, stopAt: number): number {
  let v = v0;
  let d = 0;
  const h = 1 / 60;
  for (let i = 0; i < 1200 && v > stopAt; i += 1) {
    const dec = DRAG * v * v + ROLL_A * v + ROLL_B;
    v -= dec * h;
    d += Math.max(0, v) * h;
  }
  return d;
}

export function rollTime(v0: number, dist: number): number {
  let v = v0;
  let d = 0;
  let t = 0;
  const h = 1 / 60;
  while (d < dist && v > 0.05 && t < 20) {
    v -= (DRAG * v * v + ROLL_A * v + ROLL_B) * h;
    d += Math.max(0, v) * h;
    t += h;
  }
  return d >= dist ? t : Infinity;
}

const ROLL_TABLE: number[] = [];
for (let v = 0; v <= 40; v += 0.5) ROLL_TABLE.push(rollDistance(v, 0.4));

/** Speed a ground pass should still have when it reaches the receiver. */
export function passArrive(dist: number, through: boolean): number {
  return through ? 8.6 + dist * 0.08 : 8.4 + dist * 0.16;
}

export function groundSpeedFor(dist: number, arrive: number): number {
  let lo = arrive;
  let hi = 38;
  for (let i = 0; i < 22; i += 1) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid, arrive) < dist) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function stopDistance(v0: number): number {
  const i = Math.min(ROLL_TABLE.length - 1, Math.max(0, v0 / 0.5));
  const a = Math.floor(i);
  const b = Math.min(ROLL_TABLE.length - 1, a + 1);
  return ROLL_TABLE[a] + (ROLL_TABLE[b] - ROLL_TABLE[a]) * (i - a);
}
