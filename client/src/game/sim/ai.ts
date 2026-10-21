import { CELEBRATION, type RestartKind } from "../../../../shared/state";
import { BALL_R, BOX_DEPTH, CIRCLE_R, GOAL_HALF_W, HALF_L, HALF_W, clamp, lerp } from "../math";
import type { KickKind, KickPlan, Match, Player } from "./Match";
import { groundSpeedFor, passArrive, stepBall } from "./physics";

const SHAPE: number[][] = [
  [3, 0, 8, 0],
  [21, 24, 52, 30],
  [15, 8.5, 34, 12],
  [15, -8.5, 34, -12],
  [21, -24, 52, -30],
  [32, 12, 64, 15],
  [25, 0, 50, 0],
  [32, -12, 64, -15],
  [44, 25, 84, 27],
  [48, 0, 89, 1],
  [44, -25, 84, -27],
];

const LEVEL = {
  err: [1.55, 1.2, 1.0, 0.82],
  react: [0.3, 0.23, 0.18, 0.15],
  save: [-0.14, -0.05, 0, 0.05],
  tackle: [-0.12, -0.04, 0.02, 0.07],
  think: [0.44, 0.32, 0.24, 0.17],
  noise: [0.26, 0.16, 0.1, 0.05],
  press: [0.65, 0.85, 1.0, 1.15],
  takerDelay: [1.9, 1.6, 1.3, 1.1],
};

interface Opt {
  kind: KickKind | "dribble" | "hold";
  score: number;
  plan: KickPlan | null;
  dx: number;
  dz: number;
  sprint: boolean;
}

interface PathPoint {
  x: number;
  y: number;
  z: number;
  t: number;
}

export class TeamAI {
  readonly m: Match;
  readonly team: 0 | 1;
  readonly level: number;
  errorMul: number;
  saveBonus: number;
  tackleBonus: number;
  private planT = 0;
  private path: PathPoint[] = [];
  private chaser = -1;
  private presser = -1;
  private cover = -1;
  private supports: number[] = [];
  private marks = new Map<number, number>();
  private lineDepth = 20;
  private offLine = 70;
  private decisions = new Map<number, Opt>();
  private takerWait = 0;
  private clock = 0;
  private goalsSeen = 0;
  private celebrationArrived = false;
  private celebrationTarget: [number, number] | null = null;
  private celebrationArrivedAt = 0;

  constructor(m: Match, team: 0 | 1) {
    this.m = m;
    this.team = team;
    const d = clamp(Math.round(m.config.difficulty), 0, 3);
    this.level = m.humans[team] ? Math.max(2, d) : d;
    this.errorMul = LEVEL.err[this.level];
    this.saveBonus = LEVEL.save[this.level];
    this.tackleBonus = LEVEL.tackle[this.level];
  }

  gkReaction(p: Player): number {
    return LEVEL.react[this.level] + (90 - p.info.stats.gk) * 0.003;
  }

  // ------------------------------------------------------------ geometry

  private d(x: number): number {
    return this.m.depth(this.team, x);
  }

  private s(z: number): number {
    return this.m.side(this.team, z);
  }

  private wx(d: number): number {
    return this.m.worldX(this.team, d);
  }

  private wz(s: number): number {
    return this.m.worldZ(this.team, s);
  }

  private nearestOppDist(x: number, z: number): number {
    let best = 99;
    for (const o of this.m.players) {
      if (o.team === this.team || !o.on || o.state === "fallen") continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  // ------------------------------------------------------------ update

  update(h: number): void {
    const m = this.m;
    this.clock += h;
    this.planT -= h;
    if (this.planT <= 0) {
      this.planT = 0.12;
      this.plan();
    }
    for (const p of m.players) {
      if (p.team !== this.team || !p.on || p.state === "off") continue;
      if (m.isHuman(p)) continue;
      this.drive(p, h);
    }
    this.setpieceTaker(h);
  }

  private predict(): void {
    const b = this.m.ball;
    this.path.length = 0;
    const sim = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, sx: b.sx, sy: b.sy, sz: b.sz };
    if (b.owner >= 0) {
      const o = this.m.players[b.owner];
      for (let i = 0; i <= 25; i += 1) this.path.push({ x: o.x + o.vx * i * 0.1, y: BALL_R, z: o.z + o.vz * i * 0.1, t: i * 0.1 });
      return;
    }
    this.path.push({ x: sim.x, y: sim.y, z: sim.z, t: 0 });
    for (let i = 1; i <= 30; i += 1) {
      stepBall(sim, 0.1, false);
      this.path.push({ x: sim.x, y: sim.y, z: sim.z, t: i * 0.1 });
    }
  }

  intercept(p: Player): { t: number; x: number; z: number } {
    const react = 0.12;
    const top = p.top * 0.96;
    const reachH = p.gk && this.m.canHandle(p) ? 2.5 : 1.9;
    for (const pt of this.path) {
      if (pt.y > reachH) continue;
      if (Math.abs(pt.x) > HALF_L + 1 || Math.abs(pt.z) > HALF_W + 1) break;
      const d = Math.max(0, Math.hypot(pt.x - p.x, pt.z - p.z) - 0.55);
      const vel = Math.hypot(p.vx, p.vz);
      const tReach = react + (d > 0 ? d / Math.max(top, vel) + (vel < 2 ? 0.25 : 0) : 0);
      if (tReach <= pt.t) return { t: pt.t, x: pt.x, z: pt.z };
    }
    const last = this.path[this.path.length - 1];
    const d = Math.hypot(last.x - p.x, last.z - p.z);
    return { t: last.t + d / top, x: last.x, z: last.z };
  }

  private plan(): void {
    const m = this.m;
    this.predict();
    const b = m.ball;
    const mates = m.players.filter((p) => p.team === this.team && p.on && !p.sent);
    const opp = 1 - this.team;
    this.offLine = Math.max(this.d(0), m.secondLastDepth(opp, this.team));
    const ballD = this.d(b.x);
    const owner = m.owner();
    const posTeam = m.possessionTeam();
    const carrierPressured = owner && owner.team !== this.team ? m.pressureOn(owner) > 0.4 : false;
    this.lineDepth = clamp(Math.min(ballD - 14, 38), 10, 38);
    if (owner && owner.team !== this.team && !carrierPressured && ballD < 60) this.lineDepth = Math.max(9, this.lineDepth - 4);
    let deepest = 105;
    for (const o of m.players) {
      if (o.team === this.team || !o.on || o.gk) continue;
      deepest = Math.min(deepest, this.d(o.x));
    }
    if (ballD < 50) this.lineDepth = Math.min(this.lineDepth, Math.max(7, deepest - 1));
    this.chaser = -1;
    this.presser = -1;
    this.cover = -1;
    this.supports = [];
    this.marks.clear();
    if (m.mode !== "play") return;
    const loose = b.owner < 0;
    if (loose) {
      let best: Player | null = null;
      let bestT = Infinity;
      for (const p of mates) {
        if (p.state === "fallen" || p.state === "slide") continue;
        if (p.gk && !m.inBox(this.team, this.path[Math.min(8, this.path.length - 1)].x, this.path[Math.min(8, this.path.length - 1)].z)) continue;
        const it = this.intercept(p);
        const t = it.t + (p.gk ? 0.2 : 0);
        if (t < bestT) {
          bestT = t;
          best = p;
        }
      }
      const targeted = b.target >= 0 ? m.players[b.target] : null;
      if (targeted && targeted.team === this.team) this.chaser = targeted.id;
      else if (best) this.chaser = best.id;
    }
    if (posTeam === this.team || (owner && owner.team === this.team)) {
      const carrier = owner && owner.team === this.team ? owner : b.target >= 0 ? m.players[b.target] : null;
      if (carrier) this.planSupport(carrier, mates);
      this.planRuns(carrier, mates, 0.12);
    } else if (owner && owner.team !== this.team) {
      this.planPress(owner, mates);
    } else if (posTeam >= 0 && posTeam !== this.team && b.target >= 0) {
      const recv = m.players[b.target];
      this.planPress(recv, mates);
    }
  }

  private planSupport(carrier: Player, mates: Player[]): void {
    const m = this.m;
    const atk = m.attack[this.team];
    const spots: { x: number; z: number; score: number }[] = [];
    const cd = this.d(carrier.x);
    for (const ang of [-1.25, -0.7, -0.3, 0.3, 0.7, 1.25, 2.3, -2.3]) {
      for (const r of [9, 14]) {
        const dx = Math.cos(ang) * atk;
        const dz = Math.sin(ang);
        const x = carrier.x + dx * r;
        const z = carrier.z + dz * r;
        if (Math.abs(z) > HALF_W - 2 || Math.abs(x) > HALF_L - 3) continue;
        if (this.d(x) > this.offLine - 0.8) continue;
        const open = clamp(this.nearestOppDist(x, z) / 7, 0, 1);
        const risk = this.laneRisk(carrier.x, carrier.z, x, z, 13, false);
        const prog = (this.d(x) - cd) / 20;
        spots.push({ x, z, score: open * 0.8 - risk * 1.2 + prog * 0.35 });
      }
    }
    spots.sort((a, b) => b.score - a.score);
    const used = new Set<number>();
    for (const spot of spots.slice(0, 4)) {
      if (this.supports.length >= 2) break;
      let best: Player | null = null;
      let bestD = Infinity;
      for (const p of mates) {
        if (p.id === carrier.id || p.gk || used.has(p.id) || p.runT > 0 || p.slot === 9) continue;
        const d = Math.hypot(p.x - spot.x, p.z - spot.z);
        if (d < bestD && d < 22) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        used.add(best.id);
        this.supports.push(best.id);
        best.tx = spot.x;
        best.tz = spot.z;
      }
    }
  }

  private planRuns(carrier: Player | null, mates: Player[], dt: number): void {
    const m = this.m;
    if (!carrier) return;
    const cd = this.d(carrier.x);
    for (const p of mates) {
      if (p.id === carrier.id || p.gk) continue;
      if (p.runT > 0) {
        p.runT -= dt;
        continue;
      }
      const runner = p.slot === 8 || p.slot === 9 || p.slot === 10 ? 1 : p.slot === 5 || p.slot === 7 ? 0.35 : p.slot === 1 || p.slot === 4 ? 0.25 : 0;
      if (!runner) continue;
      const pd = this.d(p.x);
      if (cd < 30 || cd > 92) continue;
      if (pd > this.offLine - 0.3 || pd < this.offLine - 12) continue;
      if (p.slot === 1 || p.slot === 4) {
        const sameSide = Math.sign(this.s(carrier.z)) === Math.sign(this.s(p.z));
        if (!sameSide || cd < 55) continue;
      }
      const rate = runner * 0.55 * LEVEL.press[this.level];
      if (!m.rng.chance(rate * dt)) continue;
      const ps = this.s(p.z);
      const runD = clamp(this.offLine + m.rng.range(9, 17), 0, 101);
      let runS = ps * 0.75;
      if (p.slot === 9) runS = ps + m.rng.range(-6, 6);
      if (p.slot === 1 || p.slot === 4) runS = Math.sign(ps) * 26;
      p.runT = m.rng.range(1.8, 2.8);
      p.runX = this.wx(runD);
      p.runZ = this.wz(clamp(runS, -30, 30));
    }
  }

  private planPress(carrier: Player, mates: Player[]): void {
    const m = this.m;
    const goalX = m.ownGoalX(this.team);
    const ranked = mates
      .filter((p) => !p.gk && p.state !== "fallen" && p.state !== "slide")
      .map((p) => {
        const d = Math.hypot(p.x - carrier.x, p.z - carrier.z);
        const goalSide = Math.abs(p.x - goalX) < Math.abs(carrier.x - goalX) ? 0 : 4;
        return { p, score: d + goalSide };
      })
      .sort((a, b) => a.score - b.score);
    const ballD = this.d(carrier.x);
    const pressRange = (ballD < 40 ? 28 : ballD < 70 ? 20 : 15) * LEVEL.press[this.level];
    if (ranked[0] && ranked[0].score < pressRange) this.presser = ranked[0].p.id;
    if (ranked[1] && ranked[1].score < pressRange + 10) this.cover = ranked[1].p.id;
    const threats = m.players.filter((o) => o.team !== this.team && o.on && !o.gk && o.id !== carrier.id);
    const free = mates.filter((p) => !p.gk && p.id !== this.presser && p.id !== this.cover);
    threats.sort((a, b) => this.d(a.x) - this.d(b.x));
    for (const o of threats) {
      const od = this.d(o.x);
      if (od > 62) continue;
      let best: Player | null = null;
      let bestD = Infinity;
      for (const p of free) {
        if (this.marks.has(p.id)) continue;
        const f = this.formation(p, false);
        const d = Math.hypot(f.x - o.x, f.z - o.z);
        const limit = p.slot >= 1 && p.slot <= 4 ? 16 : 12;
        if (d < limit && d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) this.marks.set(best.id, o.id);
    }
  }

  laneRisk(fx: number, fz: number, tx: number, tz: number, speed: number, lofted: boolean): number {
    const dx = tx - fx;
    const dz = tz - fz;
    const L2 = dx * dx + dz * dz || 1;
    const L = Math.sqrt(L2);
    let risk = 0;
    for (const o of this.m.players) {
      if (o.team === this.team || !o.on || o.state === "fallen" || o.state === "off") continue;
      let t = clamp(((o.x - fx) * dx + (o.z - fz) * dz) / L2, 0, 1);
      if (lofted) t = Math.max(t, 0.85);
      const cx = fx + dx * t;
      const cz = fz + dz * t;
      const dist = Math.hypot(o.x - cx, o.z - cz);
      const tBall = (L * t) / speed + (lofted ? 0.6 : 0);
      const tOpp = 0.2 + Math.max(0, dist - 0.7) / (o.top * 0.85);
      const r = 1 / (1 + Math.exp((tOpp - tBall) * 5));
      if (r > risk) risk = r;
    }
    return risk;
  }

  // ------------------------------------------------------------ positions

  formation(p: Player, attacking: boolean): { x: number; z: number } {
    const m = this.m;
    const b = m.ball;
    const [dDef, sDef, dAtt, sAtt] = SHAPE[p.slot];
    const ballD = this.d(b.x);
    const ballS = this.s(b.z);
    let d: number;
    let s: number;
    if (attacking) {
      const f = clamp((ballD - 18) / 60, 0, 1);
      d = lerp(dDef + 4, dAtt, f) + (ballD - lerp(25, 75, f)) * 0.15;
      s = sAtt * lerp(0.85, 1, f) + ballS * 0.16;
      if (p.slot !== 0 && p.runT <= 0) d = Math.min(d, this.offLine - 0.8);
    } else {
      d = dDef + (ballD - 32) * 0.48;
      s = sDef * 0.76 + ballS * 0.38;
      if (p.slot >= 1 && p.slot <= 4) d = this.lineDepth + (p.slot === 1 || p.slot === 4 ? 1.5 : 0);
      if (p.slot >= 5 && p.slot <= 7) d = clamp(d, this.lineDepth + 7, this.lineDepth + 22);
      if (p.slot >= 8) d = Math.max(d, this.lineDepth + 18);
    }
    const wob = this.clock * 0.35 + p.id * 1.7;
    d += Math.sin(wob) * 1.2;
    s += Math.cos(wob * 0.8) * 1.2;
    d = clamp(d, 2, 102);
    s = clamp(s, -31.5, 31.5);
    return { x: this.wx(d), z: this.wz(s) };
  }

  kickoffSpot(p: Player, kicking: boolean): { x: number; z: number } {
    const [dDef, sDef] = SHAPE[p.slot];
    let d = Math.min(dDef + 6, 49);
    let s = sDef * 0.95;
    if (p.slot >= 8) d = 47;
    if (p.slot === 9) {
      d = kicking ? 52 : 42;
      s = kicking ? 0 : 2;
    }
    if (p.slot === 6) d = kicking ? 40 : 34;
    if (p.slot === 0) d = 2;
    const x = this.wx(d);
    const z = this.wz(s);
    if (!kicking) {
      const r = Math.hypot(x, z);
      if (r < CIRCLE_R + 0.6) {
        const k = (CIRCLE_R + 0.6) / (r || 1);
        return { x: x * k, z: z * k || this.wz(CIRCLE_R + 0.6) };
      }
    }
    return { x, z };
  }

  chooseTaker(kind: RestartKind, bx: number, bz: number): Player {
    const m = this.m;
    const mates = m.players.filter((p) => p.team === this.team && p.on && !p.sent);
    const outfield = mates.filter((p) => !p.gk);
    const by = (score: (p: Player) => number) => outfield.reduce((a, b) => (score(b) > score(a) ? b : a), outfield[0]);
    if (kind === "goalkick") return m.keeper(this.team).on ? m.keeper(this.team) : outfield[0];
    if (kind === "penalty") return by((p) => p.info.stats.sho * 1.2 + p.info.stats.pas * 0.2);
    if (kind === "corner") return by((p) => (p.slot >= 5 && p.slot !== 9 ? p.info.stats.pas : 0));
    if (kind === "throwin") return by((p) => -Math.hypot(p.x - bx, p.z - bz) + (p.slot === 1 || p.slot === 4 ? 6 : 0));
    const gd = Math.hypot(m.goalX(this.team) - bx, bz);
    if (kind === "freekick" && gd < 32) return by((p) => p.info.stats.sho + p.info.stats.pas * 0.6 + (p.slot === 9 ? -10 : 0));
    return by((p) => -Math.hypot(p.x - bx, p.z - bz) + p.info.stats.pas * 0.1);
  }

  placeSetpiece(r: { kind: RestartKind; team: 0 | 1; x: number; z: number; taker: number }): void {
    const m = this.m;
    const attackingSide = r.team === this.team;
    const mates = m.players.filter((p) => p.team === this.team && p.on && !p.sent);
    const atkTeam = r.team;
    const A = (d: number, s: number) => ({ x: m.worldX(atkTeam, d), z: m.worldZ(atkTeam, s) });
    const bx = r.x;
    const bz = r.z;
    const near = Math.sign(m.side(atkTeam, bz) || 1);
    const spots = new Map<number, { x: number; z: number }>();
    if (r.kind === "corner") {
      if (attackingSide) {
        const order = [9, 2, 3, 6, 10, 8, 5, 7, 1, 4];
        const cs = [A(99.5, near * 3), A(100, -near * 4), A(94, 0), A(98, -near * 1), A(92, -near * 7), A(87, near * 8), A(85, -near * 10), A(80, 0), A(58, 12), A(58, -12)];
        let i = 0;
        for (const slot of order) {
          const p = mates.find((q) => q.slot === slot && q.id !== r.taker);
          if (p && i < cs.length) spots.set(p.id, cs[i++]);
        }
      } else {
        const order = [3, 2, 6, 1, 4, 5, 7, 9, 8, 10];
        const cs = [A(100.5, near * 2.5), A(100, -near * 2), A(98.5, 0), A(101, near * 5), A(99, -near * 5), A(95, near * 2), A(94, -near * 3), A(90, 0), A(70, near * 15), A(70, -near * 15)];
        let i = 0;
        for (const slot of order) {
          const p = mates.find((q) => q.slot === slot);
          if (p && i < cs.length) spots.set(p.id, cs[i++]);
        }
      }
    } else if (r.kind === "penalty") {
      let i = 0;
      for (const p of mates) {
        if (p.id === r.taker || p.gk) continue;
        const s = -16 + (i % 9) * 4 + (attackingSide ? 1 : -1);
        const d = 84.5 - (i >= 9 ? 2 : 0) - (attackingSide ? 0 : 1);
        spots.set(p.id, A(d, s));
        i += 1;
      }
    } else if (r.kind === "goalkick") {
      for (const p of mates) {
        if (p.id === r.taker) continue;
        if (attackingSide) {
          const base: Record<number, [number, number]> = { 1: [26, 28], 2: [12, 17], 3: [12, -17], 4: [26, -28], 5: [38, 12], 6: [30, 0], 7: [38, -12], 8: [55, 26], 9: [58, 0], 10: [55, -26] };
          const v = base[p.slot] ?? [30, 0];
          spots.set(p.id, A(v[0], v[1]));
        } else {
          const f = this.formation(p, false);
          const dd = m.depth(atkTeam, f.x);
          spots.set(p.id, { x: m.worldX(atkTeam, Math.max(dd, 18)), z: f.z });
        }
      }
    } else if (r.kind === "throwin") {
      for (const p of mates) {
        if (p.id === r.taker) continue;
        const f = this.formation(p, attackingSide);
        spots.set(p.id, { x: lerp(p.x, f.x, 0.5), z: lerp(p.z, f.z, 0.5) });
      }
      if (attackingSide) {
        const close = mates
          .filter((p) => p.id !== r.taker && !p.gk)
          .sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz))
          .slice(0, 2);
        const inward = -Math.sign(bz);
        close.forEach((p, i) => spots.set(p.id, { x: bx + m.attack[atkTeam] * (i === 0 ? 5 : -4), z: bz + inward * (i === 0 ? 6 : 9) }));
      }
    } else {
      const gx = m.goalX(atkTeam);
      const gd = Math.hypot(gx - bx, bz);
      const dangerous = gd < 34;
      for (const p of mates) {
        if (p.id === r.taker) continue;
        const f = this.formation(p, attackingSide);
        spots.set(p.id, f);
      }
      if (dangerous) {
        if (attackingSide) {
          const runners = mates.filter((p) => p.id !== r.taker && !p.gk && p.slot !== 1 && p.slot !== 4).slice(0, 7);
          runners.forEach((p, i) => {
            const d = clamp(m.depth(atkTeam, bx) + 6, 86, 95);
            spots.set(p.id, A(d + (i % 2) * 2, -12 + i * 4));
          });
        } else if (r.kind === "freekick") {
          const count = gd < 20 ? 4 : gd < 26 ? 3 : 2;
          const dx = gx - bx;
          const dz = -bz;
          const dl = Math.hypot(dx, dz) || 1;
          const ux = dx / dl;
          const uz = dz / dl;
          const cx = bx + ux * 9.15;
          const cz = bz + uz * 9.15;
          const wall = mates.filter((p) => !p.gk).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)).slice(0, count);
          const nearPost = Math.sign(bz || 1);
          wall.forEach((p, i) => {
            const off = (i - (count - 1) / 2) * 0.62 + nearPost * 0.5;
            spots.set(p.id, { x: cx - uz * off, z: cz + ux * off });
          });
          const others = mates.filter((p) => !p.gk && !wall.includes(p));
          others.forEach((p, i) => {
            const d = clamp(m.depth(atkTeam, bx) + 5, 86, 98);
            spots.set(p.id, A(d + (i % 2) * 3, -14 + i * 4.2));
          });
        }
      }
    }
    const gk = m.keeper(this.team);
    if (gk.on && gk.id !== r.taker) {
      if (!attackingSide && (r.kind === "penalty" || r.kind === "corner" || r.kind === "freekick" || r.kind === "indirect")) {
        const lineX = m.goalX(atkTeam) - m.attack[atkTeam] * 0.3;
        const z = r.kind === "penalty" ? 0 : clamp(bz * 0.08, -1.2, 1.2) - (r.kind === "freekick" ? Math.sign(bz) * 0.6 : 0);
        spots.set(gk.id, { x: lineX, z });
      } else {
        spots.set(gk.id, this.formation(gk, attackingSide));
      }
    }
    const minDist = r.kind === "throwin" ? 2 : r.kind === "penalty" ? 9.15 : 9.15;
    for (const p of mates) {
      if (p.id === r.taker) continue;
      let spot = spots.get(p.id) ?? this.formation(p, attackingSide);
      if (!attackingSide && !(p.gk && r.kind === "penalty")) {
        const dx = spot.x - bx;
        const dz = spot.z - bz;
        const d = Math.hypot(dx, dz);
        if (d < minDist && !(r.kind === "freekick" && Math.abs(d - 9.15) < 0.4)) {
          const k = minDist / (d || 1);
          spot = { x: bx + dx * k, z: bz + dz * k };
        }
      }
      if (r.kind === "goalkick" && !attackingSide) {
        if (m.inBox(atkTeam, spot.x, spot.z)) spot = { x: m.worldX(atkTeam, BOX_DEPTH + 1.5), z: spot.z };
      }
      spot.x = clamp(spot.x, -HALF_L + 0.3, HALF_L - 0.3);
      spot.z = clamp(spot.z, -HALF_W + 0.3, HALF_W - 0.3);
      p.x = spot.x;
      p.z = spot.z;
      p.tx = spot.x;
      p.tz = spot.z;
      p.yaw = Math.atan2(bz - p.z, bx - p.x);
    }
    this.takerWait = 0;
  }

  // ------------------------------------------------------------ driving

  private moveTo(p: Player, tx: number, tz: number, urgency: number, faceBall: boolean): void {
    const m = this.m;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    const b = m.ball;
    if (d < 0.4) {
      p.wx = 0;
      p.wz = 0;
      if (faceBall) {
        p.face = true;
        p.faceX = b.x - p.x;
        p.faceZ = b.z - p.z;
      }
      return;
    }
    const sprint = (urgency > 0.6 && d > 3) || (urgency > 0.3 && d > 14);
    const arrive = clamp(d / (sprint ? 4 : 2.5), 0.25, 1);
    p.wx = (dx / d) * arrive;
    p.wz = (dz / d) * arrive;
    p.sprint = sprint;
    if (faceBall && d < 5 && urgency < 0.5) {
      const bx = b.x - p.x;
      const bz = b.z - p.z;
      const ahead = (dx * bx + dz * bz) / (d * (Math.hypot(bx, bz) || 1));
      if (ahead < 0.2) {
        p.jockey = true;
        p.face = true;
        p.faceX = bx;
        p.faceZ = bz;
      }
    }
  }

  private drive(p: Player, h: number): void {
    const m = this.m;
    const b = m.ball;
    if (p.state === "fallen" || p.state === "slide" || p.state === "dive") return;
    if (m.mode === "goal") {
      this.celebrate(p);
      return;
    }
    if (m.mode === "halftime" || m.mode === "fulltime") {
      const tx = m.worldX(this.team, 40);
      this.moveTo(p, lerp(p.x, tx, 0.3), p.z * 0.9, 0, false);
      p.wx *= 0.4;
      p.wz *= 0.4;
      return;
    }
    if (m.mode === "kickoff") return;
    if (m.mode === "setpiece") {
      if (m.restart && m.restart.taker === p.id) return;
      this.moveTo(p, p.tx, p.tz, 0, true);
      return;
    }
    if (m.mode === "stoppage") {
      const f = this.formation(p, m.restart?.team === this.team);
      this.moveTo(p, f.x, f.z, 0, true);
      p.wx *= 0.6;
      p.wz *= 0.6;
      return;
    }
    if (p.gk) {
      this.keeper(p, h);
      return;
    }
    if (b.owner === p.id && !b.held) {
      this.carrier(p, h);
      return;
    }
    const owner = m.owner();
    const ours = owner ? owner.team === this.team : b.target >= 0 && m.teamOf(b.target) === this.team;
    if (p.id === this.chaser && b.owner < 0) {
      const it = this.intercept(p);
      const tx = it.x;
      const tz = it.z;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) {
        const bx = b.x - p.x;
        const bz = b.z - p.z;
        const bl = Math.hypot(bx, bz) || 1;
        p.wx = bx / bl;
        p.wz = bz / bl;
        p.sprint = Math.hypot(b.vx, b.vz) > 3;
      } else {
        this.moveTo(p, tx, tz, 1, false);
      }
      if (b.target === p.id && Math.hypot(b.vx, b.vz) > 4) {
        p.face = d < 2;
        p.faceX = -b.vx;
        p.faceZ = -b.vz;
      }
      return;
    }
    if (ours) {
      if (p.runT > 0) {
        this.moveTo(p, p.runX, p.runZ, 1, false);
        return;
      }
      if (this.supports.includes(p.id)) {
        this.moveTo(p, p.tx, p.tz, 0.35, true);
        return;
      }
      const f = this.formation(p, true);
      this.moveTo(p, f.x, f.z, 0.25, true);
      return;
    }
    if (owner && owner.team !== this.team) {
      if (p.id === this.presser) {
        this.press(p, owner, h);
        return;
      }
      if (p.id === this.cover) {
        const gx = m.ownGoalX(this.team);
        const dx = gx - owner.x;
        const dz = -owner.z * 0.6;
        const dl = Math.hypot(dx, dz) || 1;
        this.moveTo(p, owner.x + (dx / dl) * 7, owner.z + (dz / dl) * 7, 0.6, true);
        return;
      }
      const markId = this.marks.get(p.id);
      if (markId !== undefined) {
        const o = m.players[markId];
        const gx = m.ownGoalX(this.team);
        const dx = gx - o.x;
        const dz = -o.z;
        const dl = Math.hypot(dx, dz) || 1;
        const bx = b.x - o.x;
        const bz = b.z - o.z;
        const bl = Math.hypot(bx, bz) || 1;
        const tight = this.d(o.x) < 35 ? 1.6 : 2.6;
        let tx = o.x + (dx / dl) * tight + (bx / bl) * 1.2;
        let tz = o.z + (dz / dl) * tight + (bz / bl) * 1.2;
        if (p.slot >= 1 && p.slot <= 4) {
          const lineX = m.worldX(this.team, this.lineDepth);
          if (this.d(tx) > this.lineDepth + 4) tx = lerp(tx, lineX, 0.6);
        }
        this.moveTo(p, tx, tz, this.d(o.x) < 40 ? 0.7 : 0.45, true);
        return;
      }
    }
    const f = this.formation(p, false);
    this.moveTo(p, f.x, f.z, b.target >= 0 ? 0.5 : 0.35, true);
  }

  private press(p: Player, o: Player, h: number): void {
    const m = this.m;
    const b = m.ball;
    const gx = m.ownGoalX(this.team);
    const dx = gx - o.x;
    const dz = -o.z;
    const dl = Math.hypot(dx, dz) || 1;
    const dist = Math.hypot(o.x - p.x, o.z - p.z);
    const lead = clamp(dist / 9, 0.1, 0.6);
    const cx = o.x + o.vx * lead + (dx / dl) * (dist > 4 ? 1.4 : 1.0);
    const cz = o.z + o.vz * lead + (dz / dl) * (dist > 4 ? 1.4 : 1.0);
    const ex = cx - p.x;
    const ez = cz - p.z;
    const el = Math.hypot(ex, ez);
    if (el > 0.2) {
      const k = clamp(el / 2, 0.3, 1);
      p.wx = (ex / el) * k;
      p.wz = (ez / el) * k;
    }
    p.sprint = dist > 4.5;
    if (dist < 4.2) {
      p.jockey = dist > 1.6 || o.vx * (gx - o.x) > 0;
      p.face = true;
      p.faceX = b.x - p.x;
      p.faceZ = b.z - p.z;
    }
    if (p.cool > 0 || !m.canAct(p)) return;
    const gap = Math.hypot(b.x - o.x, b.z - o.z);
    const ballDist = Math.hypot(b.x - p.x, b.z - p.z);
    const def = p.info.stats.def;
    const aggression = LEVEL.press[this.level];
    if (ballDist < 1.25) {
      const rate = (0.9 + def / 60 + (gap > 0.6 ? 2 : 0)) * aggression;
      if (m.rng.chance(rate * h)) m.standTackle(p);
      return;
    }
    const os = Math.hypot(o.vx, o.vz);
    if (ballDist < 2.8 && ballDist > 1.4 && os > 4.5 && !m.fromBehind(p, o)) {
      const inBox = m.inBox(this.team, o.x, o.z);
      const rate = (inBox ? 0.1 : 0.45) * aggression * (def / 85);
      if (m.rng.chance(rate * h)) {
        const sx = b.x + b.vx * 0.15 - p.x;
        const sz = b.z + b.vz * 0.15 - p.z;
        p.yaw = Math.atan2(sz, sx);
        m.startSlide(p, sx, sz);
      }
    }
  }

  private celebrate(p: Player): void {
    const m = this.m;
    if (m.goals.length !== this.goalsSeen) {
      this.goalsSeen = m.goals.length;
      this.celebrationArrived = false;
      this.celebrationTarget = null;
    }
    if (p.state !== "celebrate") {
      p.wx *= 0;
      const f = this.formation(p, false);
      this.moveTo(p, lerp(p.x, f.x, 0.5), lerp(p.z, f.z, 0.5), 0, false);
      p.wx *= 0.35;
      p.wz *= 0.35;
      return;
    }
    const c = m.celebrant >= 0 ? m.players[m.celebrant] : null;
    if (c && c.id === p.id) {
      if (!this.celebrationTarget) {
        const cx = Math.sign(m.goalX(this.team)) * (HALF_L - 4);
        const cz = Math.sign(p.z || 1) * (HALF_W - 4);
        const cd = Math.hypot(cx - p.x, cz - p.z);
        const k = cd > 20 ? 20 / cd : 1;
        this.celebrationTarget = [p.x + (cx - p.x) * k, p.z + (cz - p.z) * k];
      }
      const [tx, tz] = this.celebrationTarget;
      const d = Math.hypot(tx - p.x, tz - p.z);
      const sp = Math.hypot(p.vx, p.vz);
      const stopAt = p.aa === CELEBRATION.kneeSlide ? Math.max(2, (sp * sp) / 7.2 + 0.5) : 2;
      if (d > stopAt && !this.celebrationArrived) this.moveTo(p, tx, tz, 0.8, false);
      else {
        if (!this.celebrationArrived) this.celebrationArrivedAt = m.modeT;
        this.celebrationArrived = true;
        p.wx = 0;
        p.wz = 0;
        if (p.aa !== CELEBRATION.kneeSlide || Math.hypot(p.vx, p.vz) < 0.5) {
          p.face = true;
          p.faceX = p.x;
          p.faceZ = p.z;
        }
      }
      return;
    }
    if (p.gk) {
      p.face = true;
      p.faceX = (c?.x ?? 0) - p.x;
      p.faceZ = (c?.z ?? 0) - p.z;
      return;
    }
    if (c) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      const ring = this.celebrationArrived && m.modeT - this.celebrationArrivedAt > 1.8 ? 1.05 : 3.2;
      if (d > ring + 0.35 && m.modeT > 0.5) this.moveTo(p, c.x + (dx / d) * ring, c.z + (dz / d) * ring, 0.7, false);
      else {
        p.wx = 0;
        p.wz = 0;
        p.face = true;
        p.faceX = c.x - p.x;
        p.faceZ = c.z - p.z;
      }
    }
  }

  // ------------------------------------------------------------ keeper

  private keeper(p: Player, h: number): void {
    const m = this.m;
    const b = m.ball;
    if (b.owner === p.id) {
      if (b.held) {
        p.face = true;
        p.faceX = m.attack[this.team];
        p.faceZ = -p.z * 0.05;
        if (p.holdT > 1.4 + m.rng.next() * 0.02) this.releaseKeeper(p, false);
        return;
      }
      this.carrier(p, h);
      return;
    }
    const gx = m.ownGoalX(this.team);
    const atk = m.attack[this.team];
    if (p.runT > 0) {
      p.runT -= h;
      this.moveTo(p, p.runX, p.runZ, 1, false);
      p.face = true;
      p.faceX = b.x - p.x;
      p.faceZ = b.z - p.z;
      return;
    }
    if (b.shot && b.shot.team !== this.team) {
      const dx = b.x - p.x;
      const dz = b.z - p.z;
      p.face = true;
      p.faceX = dx;
      p.faceZ = dz;
    }
    if (this.chaser === p.id && b.owner < 0) {
      const it = this.intercept(p);
      if (m.inBox(this.team, it.x, it.z)) {
        this.moveTo(p, it.x, it.z, 1, false);
        return;
      }
    }
    const bx = b.x;
    const bz = b.z;
    const dGoal = Math.hypot(bx - gx, bz);
    const owner = m.owner();
    let r = clamp(1 + dGoal * 0.07, 1, 5.5);
    if (owner && owner.team !== this.team && dGoal < 16 && Math.abs(bz) < 14) {
      r = clamp(dGoal - 3.5, 1.2, 7);
      const pd = m.pressureOn(owner);
      if (pd < 0.3 && dGoal < 12) r = clamp(dGoal - 1.8, 1.5, 9);
    }
    const ux = (bx - gx) / (dGoal || 1);
    const uz = bz / (dGoal || 1);
    let tx = gx + ux * r;
    let tz = uz * r;
    tz = clamp(tz, -GOAL_HALF_W + 0.4, GOAL_HALF_W - 0.4);
    if (atk > 0) tx = Math.max(tx, gx + 0.4);
    else tx = Math.min(tx, gx - 0.4);
    this.moveTo(p, tx, tz, dGoal < 20 ? 0.7 : 0.3, true);
    if (Math.hypot(tx - p.x, tz - p.z) < 3) {
      p.jockey = true;
      p.face = true;
      p.faceX = bx - p.x;
      p.faceZ = bz - p.z;
    }
  }

  releaseKeeper(p: Player, force: boolean): void {
    const m = this.m;
    if (m.ball.owner !== p.id) return;
    const mates = m.players.filter((q) => q.team === this.team && q.on && !q.gk && !q.sent);
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const q of mates) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < 8 || d > 40) continue;
      const open = this.nearestOppDist(q.x, q.z);
      const risk = this.laneRisk(p.x, p.z, q.x, q.z, 12, false);
      const score = open / 8 - risk * 1.5 - d / 60;
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
    if (best && bestScore > 0.3 && m.rng.chance(0.75)) {
      m.strike(p, m.planToReceiver(p, best, "gkthrow", 0.5, true));
      return;
    }
    if (!force && p.holdT < 3 && !best) return;
    const forwards = mates.filter((q) => q.slot >= 8).sort((a, b) => this.nearestOppDist(b.x, b.z) - this.nearestOppDist(a.x, a.z));
    const t = forwards[0] ?? mates[0];
    if (t) m.strike(p, m.planToReceiver(p, t, "punt", 0.8, true));
  }

  headerChoice(p: Player): boolean {
    const m = this.m;
    const b = m.ball;
    const pd = this.d(p.x);
    const gx = m.goalX(this.team);
    if (pd > 86 && Math.abs(p.z) < 16 && b.lastTeam === this.team) {
      const gk = m.keeper(1 - this.team);
      const tz = gk.z > 0 ? -2.6 : 2.6;
      m.strike(p, { kind: "shot", power: 0.6, tx: gx + Math.sign(gx) * 0.3, tz, ty: 0.9, receiver: -1, curl: 0, ai: true });
      return true;
    }
    if (pd < 35 || b.lastTeam !== this.team) {
      const atk = m.attack[this.team];
      const tx = p.x + atk * m.rng.range(14, 22);
      const tz = clamp(p.z * 1.3 + m.rng.gauss() * 6, -30, 30);
      m.strike(p, { kind: "header", power: 0.8, tx, tz, ty: 0, receiver: -1, curl: 0, ai: true });
      return true;
    }
    let best: Player | null = null;
    let bestD = Infinity;
    for (const q of m.players) {
      if (q.team !== this.team || q.id === p.id || !q.on || q.gk) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > 5 && d < 18 && d < bestD) {
        bestD = d;
        best = q;
      }
    }
    if (best) {
      m.strike(p, { kind: "header", power: 0.5, tx: best.x, tz: best.z, ty: 0, receiver: best.id, curl: 0, ai: true });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ carrier

  private carrier(p: Player, h: number): void {
    const m = this.m;
    const b = m.ball;
    p.think -= h;
    let opt = this.decisions.get(p.id);
    const pressure = m.pressureOn(p);
    if (!opt || p.think <= 0 || (pressure > 0.75 && opt.kind === "dribble" && p.think < 0.12)) {
      opt = this.decide(p);
      this.decisions.set(p.id, opt);
      p.think = LEVEL.think[this.level] * (0.75 + m.rng.next() * 0.5);
    }
    const minHold = pressure > 0.7 ? 0.08 : 0.28;
    if (opt.plan && p.holdT >= minHold) {
      const dist = Math.hypot(b.x - p.x, b.z - p.z);
      if (dist < 1.0 && b.y < 1.0 && (p.state === "run" || p.state === "hold")) {
        m.strike(p, opt.plan);
        this.decisions.delete(p.id);
        return;
      }
    }
    let dx = opt.dx;
    let dz = opt.dz;
    if (opt.plan) {
      dx = opt.plan.tx - p.x;
      dz = opt.plan.tz - p.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      p.wx = dx * 0.5;
      p.wz = dz * 0.5;
      p.sprint = false;
      return;
    }
    const fence = this.fence(p.x + p.vx * 0.6, p.z + p.vz * 0.6, dx, dz);
    p.wx = fence.x;
    p.wz = fence.z;
    p.sprint = opt.sprint && fence.free;
    p.jockey = opt.kind === "hold";
  }

  private fence(x: number, z: number, dx: number, dz: number): { x: number; z: number; free: boolean } {
    const margin = 4.2;
    let free = true;
    const ez = HALF_W - margin - Math.abs(z);
    if (ez < 0 && dz * Math.sign(z) > -0.2) {
      dz = -Math.sign(z) * clamp(-ez / margin, 0.35, 1);
      free = false;
    }
    const ex = HALF_L - margin - Math.abs(x);
    const inGoalMouth = Math.abs(z) < 9;
    if (ex < 0 && dx * Math.sign(x) > -0.2 && !inGoalMouth) {
      dx = -Math.sign(x) * clamp(-ex / margin, 0.35, 1);
      free = false;
    }
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l, free };
  }

  private decide(p: Player): Opt {
    const m = this.m;
    const b = m.ball;
    const atk = m.attack[this.team];
    const s = p.info.stats;
    const pressure = m.pressureOn(p);
    const noise = () => m.rng.gauss() * LEVEL.noise[this.level];
    const pd = this.d(b.x);
    const opts: Opt[] = [];
    const gx = m.goalX(this.team);
    const gdx = Math.abs(gx - b.x);
    const gDist = Math.hypot(gdx, b.z);
    if (gDist < 34 && !p.gk) {
      const a1 = Math.atan2(GOAL_HALF_W - b.z, gdx);
      const a2 = Math.atan2(-GOAL_HALF_W - b.z, gdx);
      const vis = Math.abs(a1 - a2);
      let xg = clamp(vis * vis * 1.3, 0, 0.8);
      let blockers = 0;
      for (const o of m.players) {
        if (o.team === this.team || !o.on || o.gk) continue;
        const od = Math.abs(gx - o.x);
        if (od > gdx || Math.sign(gx - o.x) !== Math.sign(gx - b.x)) continue;
        const t = 1 - od / gdx;
        const zl = b.z + (0 - b.z) * t;
        const half = GOAL_HALF_W * t + 0.4;
        if (Math.abs(o.z - zl) < half + 0.4) blockers += 1;
      }
      xg *= Math.pow(0.62, blockers);
      const score = xg * 3.4 * (0.55 + s.sho / 220) + (gDist < 12 ? 0.3 : 0) - (gDist > 24 ? 0.25 : 0) + noise();
      const gk = m.keeper(1 - this.team);
      const gkSide = gk.z - b.z * (1 - Math.min(1, Math.abs(gk.x - gx) / gdx));
      let tz = gkSide > 0 ? -m.rng.range(2.2, 3.1) : m.rng.range(2.2, 3.1);
      if (Math.abs(gkSide) < 0.4) tz = (m.rng.chance(0.5) ? 1 : -1) * m.rng.range(2.2, 3.1);
      const high = m.rng.chance(0.3);
      const power = clamp(0.5 + gDist / 50 + m.rng.range(-0.08, 0.1), 0.45, 0.92);
      const ty = high ? m.rng.range(1.5, 2.15) : m.rng.range(0.25, 0.8);
      const curl = gDist < 25 && Math.abs(b.z) > 4 && m.rng.chance(0.45) ? -Math.sign(tz) * Math.sign(gx) * 0.45 : 0;
      opts.push({ kind: "shot", score, plan: { kind: "shot", power, tx: gx + Math.sign(gx) * 0.4, tz, ty, receiver: -1, curl, ai: true }, dx: 0, dz: 0, sprint: false });
    }
    for (const q of m.players) {
      if (q.team !== this.team || q.id === p.id || !q.on || q.state === "fallen" || q.sent) continue;
      if (q.gk && (pressure < 0.6 || pd > 40)) continue;
      const qd = this.d(q.x);
      const line = this.offLine + 0.2 + Math.abs(m.rng.gauss()) * [1.6, 1.1, 0.7, 0.45][this.level];
      const kinds: KickKind[] = [];
      if (qd <= line) kinds.push("pass");
      if ((q.runT > 0 || q.slot >= 8) && qd <= line + 0.1 && qd > pd - 5) kinds.push("through");
      const wide = Math.abs(b.z) > 15 && pd > 76;
      if (wide && qd > 86 && Math.abs(q.z) < 12 && qd <= line) kinds.push("cross");
      if (!wide && qd > pd + 18 && qd <= line && (q.slot >= 8 || q.runT > 0)) kinds.push("lob");
      for (const kind of kinds) {
        const plan = m.planToReceiver(p, q, kind, kind === "through" ? 0.5 : 0.6, true);
        const L = Math.hypot(plan.tx - b.x, plan.tz - b.z);
        if (L < 4 || L > (kind === "lob" || kind === "cross" ? 50 : 42)) continue;
        if (Math.abs(plan.tx) > HALF_L - 0.5 || Math.abs(plan.tz) > HALF_W - 0.5) continue;
        const lofted = kind === "lob" || kind === "cross";
        const speed = lofted ? 16 : groundSpeedFor(L, passArrive(L, kind === "through")) * 0.78;
        const risk = this.laneRisk(b.x, b.z, plan.tx, plan.tz, speed, lofted);
        const td = this.d(plan.tx);
        const progress = clamp((td - pd) / 25, -1, 1);
        const tgDist = Math.hypot(gx - plan.tx, plan.tz);
        const threat = clamp((td - 55) / 45, 0, 1) * 0.5 + clamp(1 - tgDist / 30, 0, 1) * 0.7;
        const open = clamp(this.nearestOppDist(plan.tx, plan.tz) / 7, 0, 1);
        let score = 0.28 + 0.42 * progress + 0.55 * threat + 0.28 * open - 1.55 * risk - (L > 30 ? (L - 30) * 0.018 : 0) + Math.min(0.25, p.holdT * 0.08);
        if (progress < -0.1 && pressure < 0.35) score -= 0.12;
        if (kind === "through") score += 0.02 - risk * 0.5;
        if (kind === "cross") score += 0.15 - (Math.abs(q.z) > 8 ? 0.1 : 0);
        if (kind === "lob") score -= 0.15;
        if (q.gk) score -= 0.25;
        score += noise();
        opts.push({ kind, score, plan, dx: 0, dz: 0, sprint: false });
      }
    }
    if (pd < 18 && pressure > 0.7 && !p.gk) {
      const tx = b.x + atk * m.rng.range(30, 45);
      const tz = clamp(b.z * 1.4 + m.rng.gauss() * 8, -30, 30);
      opts.push({ kind: "clear", score: 0.15 + pressure * 0.35 + noise(), plan: { kind: "clear", power: 0.9, tx, tz, ty: 0, receiver: -1, curl: 0, ai: true }, dx: 0, dz: 0, sprint: false });
    }
    if (p.gk) {
      const t = m.players.filter((q) => q.team === this.team && q.slot >= 8 && q.on)[0];
      if (t) opts.push({ kind: "punt", score: 0.25 + pressure * 0.5, plan: m.planToReceiver(p, t, "lob", 0.9, true), dx: 0, dz: 0, sprint: false });
    }
    let bestDir = { dx: atk, dz: 0, score: -Infinity, space: 0 };
    const baseAng = Math.atan2(-b.z * 0.25, gx - b.x);
    for (const off of [-1.4, -0.9, -0.45, 0, 0.45, 0.9, 1.4]) {
      const ang = baseAng + off;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      let space = 14;
      for (const o of m.players) {
        if (o.team === this.team || !o.on) continue;
        const ox = o.x - p.x;
        const oz = o.z - p.z;
        const along = ox * dx + oz * dz;
        if (along < -0.5) continue;
        const across = Math.abs(ox * dz - oz * dx);
        const dist = Math.hypot(ox, oz);
        if (across < 2.2 + along * 0.25) space = Math.min(space, dist);
      }
      for (const look of [3, 6, 9]) {
        const ex = p.x + dx * look;
        const ez = p.z + dz * look;
        if (Math.abs(ez) > HALF_W - 2.5 || (Math.abs(ex) > HALF_L - 2 && Math.abs(ez) > 9)) {
          space = Math.min(space, look * 0.5);
          break;
        }
      }
      const fwd = dx * atk;
      const sc = space / 14 + fwd * 0.45 - Math.abs(off) * 0.05;
      if (sc > bestDir.score) bestDir = { dx, dz, score: sc, space };
    }
    const dribbleScore =
      0.12 + clamp(bestDir.space / 10, 0, 1) * 0.5 * (s.dri / 88) + bestDir.dx * atk * 0.12 - pressure * 0.45 * (1.25 - s.dri / 100) - Math.max(0, p.holdT - 2) * 0.12 + (pd > 80 ? 0.1 : 0) + noise();
    opts.push({ kind: "dribble", score: dribbleScore, plan: null, dx: bestDir.dx, dz: bestDir.dz, sprint: bestDir.space > 6 && pd < 92 });
    if (pressure > 0.6) {
      const nearest = m.nearestOpponent(p).player;
      if (nearest) {
        const ax = p.x - nearest.x;
        const az = p.z - nearest.z;
        const al = Math.hypot(ax, az) || 1;
        opts.push({ kind: "hold", score: 0.05 + (s.phy - 70) * 0.005 + noise(), plan: null, dx: ax / al, dz: az / al, sprint: false });
      }
    }
    opts.sort((a, b2) => b2.score - a.score);
    return opts[0];
  }

  // ------------------------------------------------------------ set pieces

  private setpieceTaker(h: number): void {
    const m = this.m;
    const r = m.restart;
    if (!r || (m.mode !== "setpiece" && m.mode !== "kickoff") || r.team !== this.team) return;
    if (!m.setpieceReady()) return;
    const taker = m.players[r.taker];
    const human = m.isHuman(taker);
    this.takerWait += h;
    if (human && this.takerWait < 12) return;
    const delay = LEVEL.takerDelay[this.level] * (r.kind === "kickoff" ? 0.5 : r.kind === "throwin" ? 0.8 : 1);
    if (this.takerWait < delay) return;
    this.takeSetpiece(taker, r.kind);
  }

  private takeSetpiece(p: Player, kind: RestartKind): void {
    const m = this.m;
    const mates = m.players.filter((q) => q.team === this.team && q.on && q.id !== p.id && !q.sent);
    const b = m.ball;
    const gx = m.goalX(this.team);
    if (kind === "kickoff") {
      const t = mates.find((q) => q.slot === 6) ?? mates[0];
      m.strike(p, m.planToReceiver(p, t, "pass", 0.4, true));
      return;
    }
    if (kind === "penalty") {
      const side = m.rng.chance(0.5) ? 1 : -1;
      const high = m.rng.chance(0.35);
      const plan: KickPlan = { kind: "shot", power: m.rng.range(0.55, 0.78), tx: gx + Math.sign(gx) * 0.4, tz: side * m.rng.range(1.9, 3.0), ty: high ? m.rng.range(1.3, 2.0) : m.rng.range(0.2, 0.6), receiver: -1, curl: 0, ai: true };
      const gk = m.keeper(1 - this.team);
      if (gk.on && !m.isHuman(gk) && m.rng.chance(0.85)) {
        const guess = m.rng.chance(0.5 + (gk.info.stats.gk - 80) * 0.01) ? Math.sign(plan.tz) : -Math.sign(plan.tz);
        gk.state = "dive";
        gk.st = -0.05;
        gk.dur = 1.4;
        gk.dirX = 0;
        gk.dirZ = guess;
        gk.speed0 = 5.6;
        gk.aa = plan.ty;
      }
      m.strike(p, plan);
      return;
    }
    if (kind === "corner") {
      const targets = mates.filter((q) => m.inBox(1 - this.team, q.x, q.z));
      if (targets.length && m.rng.chance(0.85)) {
        const t = targets.sort((a, c) => c.info.stats.phy + c.info.look.height * 40 - (a.info.stats.phy + a.info.look.height * 40))[Math.floor(m.rng.next() * Math.min(3, targets.length))];
        m.strike(p, m.planToReceiver(p, t, "cross", 0.7, true));
        return;
      }
      const near = mates.sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
      m.strike(p, m.planToReceiver(p, near, "pass", 0.4, true));
      return;
    }
    if (kind === "goalkick") {
      const backs = mates.filter((q) => q.slot >= 1 && q.slot <= 3);
      const open = backs.filter((q) => this.nearestOppDist(q.x, q.z) > 7);
      if (open.length && m.rng.chance(0.65)) {
        m.strike(p, m.planToReceiver(p, open[Math.floor(m.rng.next() * open.length)], "pass", 0.5, true));
        return;
      }
      const fw = mates.filter((q) => q.slot >= 8);
      const t = fw[Math.floor(m.rng.next() * fw.length)] ?? mates[0];
      m.strike(p, m.planToReceiver(p, t, "lob", 0.9, true));
      return;
    }
    if (kind === "throwin") {
      let best: Player | null = null;
      let bestScore = -Infinity;
      for (const q of mates) {
        if (q.gk) continue;
        const d = Math.hypot(q.x - b.x, q.z - b.z);
        if (d > 22 || d < 3) continue;
        const score = this.nearestOppDist(q.x, q.z) / 6 - d / 30 + (this.d(q.x) - this.d(b.x)) / 40;
        if (score > bestScore) {
          bestScore = score;
          best = q;
        }
      }
      const t = best ?? mates[0];
      m.strike(p, m.planToReceiver(p, t, "throw", 0.5, true));
      return;
    }
    const gd = Math.hypot(gx - b.x, b.z);
    if (kind === "freekick" && gd < 28 && Math.abs(b.z) < 22) {
      const gk = m.keeper(1 - this.team);
      const tz = gk.z > b.z * 0.05 ? -m.rng.range(2.3, 3.1) : m.rng.range(2.3, 3.1);
      const curl = -Math.sign(tz) * Math.sign(gx) * 0.8;
      m.strike(p, { kind: "shot", power: m.rng.range(0.6, 0.75), tx: gx + Math.sign(gx) * 0.4, tz, ty: m.rng.range(1.55, 2.2), receiver: -1, curl, ai: true });
      return;
    }
    if (gd < 40) {
      const targets = mates.filter((q) => m.inBox(1 - this.team, q.x, q.z));
      if (targets.length) {
        m.strike(p, m.planToReceiver(p, targets[Math.floor(m.rng.next() * targets.length)], "cross", 0.7, true));
        return;
      }
    }
    let best: Player | null = null;
    let bestScore = -Infinity;
    for (const q of mates) {
      if (q.gk) continue;
      const d = Math.hypot(q.x - b.x, q.z - b.z);
      if (d < 5 || d > 35) continue;
      const score = this.nearestOppDist(q.x, q.z) / 6 + (this.d(q.x) - this.d(b.x)) / 30 - this.laneRisk(b.x, b.z, q.x, q.z, 14, false) * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
    m.strike(p, m.planToReceiver(p, best ?? mates[0], "pass", 0.5, true));
  }
}
