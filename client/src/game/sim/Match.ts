import { ROSTERS, shortName, type PlayerInfo } from "../../../../shared/rosters";
import { PLAYER_COLORS } from "../../../../shared/protocol";
import { ACT, CELEBRATION, SIGNATURE_CELEBRATION, emptyStats, type GoalInfo, type MatchEvent, type MatchMode, type MatchStats, type MatchView, type PlayerView, type RestartKind } from "../../../../shared/state";
import { BALL_R, BOX_DEPTH, BOX_HALF_W, GOAL_H, GOAL_HALF_W, HALF_L, HALF_W, PEN_SPOT, Rng, clamp, lerp, round2, round3, smooth, turnToward, wrapAngle } from "../math";
import { EMPTY_INPUT, type InputFrame, type MatchConfig } from "../types";
import { TeamAI } from "./ai";
import { GRAVITY, groundSpeedFor, passArrive, rollTime, simulateFlight, solveLaunch, stepBall, type BallBody } from "./physics";

export type KickKind = "pass" | "through" | "lob" | "cross" | "shot" | "header" | "clear" | "throw" | "gkthrow" | "punt" | "touch" | "tackle" | "deflect" | "save";

export type PState = "run" | "kick" | "slide" | "fallen" | "dive" | "celebrate" | "throwin" | "header" | "tackle" | "hold" | "stumble" | "off" | "wait" | "volley";

export interface KickPlan {
  kind: KickKind;
  power: number;
  tx: number;
  tz: number;
  ty: number;
  receiver: number;
  curl: number;
  ai: boolean;
}

export interface Player {
  id: number;
  team: 0 | 1;
  slot: number;
  info: PlayerInfo;
  name: string;
  gk: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  top: number;
  acc: number;
  agility: number;
  state: PState;
  st: number;
  dur: number;
  aa: number;
  dirX: number;
  dirZ: number;
  speed0: number;
  cool: number;
  touchT: number;
  wx: number;
  wz: number;
  sprint: boolean;
  jockey: boolean;
  face: boolean;
  faceX: number;
  faceZ: number;
  dwx: number;
  dwz: number;
  tx: number;
  tz: number;
  runT: number;
  runX: number;
  runZ: number;
  think: number;
  yellow: number;
  sent: boolean;
  on: boolean;
  won: boolean;
  hits: number[];
  queue: { kind: KickKind; power: number; ax: number; az: number; t: number } | null;
  holdT: number;
  react: number;
  saveLock: number;
  fatigue: number;
  willSave: boolean;
  planShot: object | null;
}

export interface Ball extends BallBody {
  owner: number;
  held: boolean;
  lastTeam: 0 | 1;
  lastId: number;
  kind: KickKind;
  kickT: number;
  target: number;
  offside: number[] | null;
  offTeam: number;
  backPass: boolean;
  shot: { team: 0 | 1; id: number; roll: number; resolved: boolean } | null;
  restart: RestartKind | null;
  freeTaker: number;
  shooter: number;
  penalty: boolean;
  inField: boolean;
  outT: number;
}

export interface Official {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  act: number;
  st: number;
  aa: number;
}

interface Restart {
  kind: RestartKind;
  team: 0 | 1;
  x: number;
  z: number;
  taker: number;
}

interface Charge {
  kind: "pass" | "shoot" | "through" | "lob" | null;
  t: number;
}

interface HumanSeat {
  slot: number;
  team: 0 | 1;
  player: number;
  color: string;
  name: string;
  handsCd: number;
  handsLeft: number;
  prev: InputFrame;
  charge: Charge;
  switchT: number;
  switchAge: number;
  switchCycle: number[];
}

const H = 1 / 120;
const GOAL_CELEBRATION = 7.5;
export const JOG = 0.64;
const BRAKE = 9.5;
const OUT_LINE = HALF_L + BALL_R;
const SIDE_LINE = HALF_W + BALL_R;

type ButtonKey = "pass" | "shoot" | "through" | "lob" | "slide" | "switchP" | "skip" | "jockey" | "sprint" | "hands";

export class Match {
  readonly players: Player[] = [];
  readonly ball: Ball;
  readonly refs: Official[] = [];
  readonly humans: [boolean, boolean];
  readonly seats: HumanSeat[] = [];
  readonly useRules: boolean;
  readonly config: MatchConfig;
  readonly rng: Rng;
  readonly ai: [TeamAI, TeamAI];
  readonly halfLen: number;
  mode: MatchMode = "kickoff";
  pausedFrom: MatchMode = "play";
  modeT = 0;
  modeDur = 0;
  clock = 0;
  half: 1 | 2 = 1;
  score: [number, number] = [0, 0];
  attack: [number, number] = [1, -1];
  control: [number, number] = [9, 20];
  restart: Restart | null = null;
  firstKickoff: 0 | 1 = 0;
  cut = 0;
  time = 0;
  goals: GoalInfo[] = [];
  stats: MatchStats = emptyStats();
  replaySkip = false;
  private acc = 0;
  private events: MatchEvent[] = [];
  private charge: [Charge, Charge] = [
    { kind: null, t: 0 },
    { kind: null, t: 0 },
  ];
  private pendingCard: { id: number; red: boolean; shown: boolean } | null = null;
  private kickoffWhistled = false;
  private refFocus: { x: number; z: number } | null = null;
  private lastTouchTeam: 0 | 1 = 0;
  private flagSide = -1;
  private goalPending: { team: 0 | 1; own: boolean } | null = null;
  /** Seconds after a penalty kick in which the keeper can still dive. */
  private penWindow = 0;

  constructor(config: MatchConfig) {
    this.config = config;
    this.humans = [false, false];
    this.useRules = config.rules !== false;
    this.halfLen = Math.max(60, config.halfMinutes * 60);
    this.rng = new Rng(config.seed ?? (Date.now() & 0xffffff));
    const clubs = [config.leftClub, config.rightClub];
    for (const team of [0, 1] as const) {
      const roster = ROSTERS[clubs[team]];
      for (let slot = 0; slot < 11; slot += 1) {
        this.players.push(this.makePlayer(team * 11 + slot, team, slot, roster[slot]));
      }
    }
    this.ball = {
      x: 0,
      y: BALL_R,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      sx: 0,
      sy: 0,
      sz: 0,
      owner: -1,
      held: false,
      lastTeam: 0,
      lastId: -1,
      kind: "touch",
      kickT: 9,
      target: -1,
      offside: null,
      offTeam: -1,
      backPass: false,
      shot: null,
      restart: null,
      freeTaker: -1,
      shooter: -1,
      penalty: false,
      inField: true,
      outT: 0,
    };
    for (let i = 0; i < 3; i += 1) this.refs.push({ x: 0, z: i === 0 ? -8 : i === 1 ? HALF_W + 1.2 : -HALF_W - 1.2, vx: 0, vz: 0, yaw: 0, act: 0, st: 0, aa: 0 });
    this.ai = [new TeamAI(this, 0), new TeamAI(this, 1)];
    this.buildSeats(config);
    this.firstKickoff = this.rng.chance(0.5) ? 0 : 1;
    this.setupKickoff(this.firstKickoff);
  }

  private makePlayer(id: number, team: 0 | 1, slot: number, info: PlayerInfo): Player {
    const s = info.stats;
    return {
      id,
      team,
      slot,
      info,
      name: shortName(info),
      gk: slot === 0,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      yaw: 0,
      top: 5.9 + s.pac * 0.042,
      acc: 4.4 + s.pac * 0.04,
      agility: clamp((s.dri * 0.6 + s.pac * 0.4) / 100, 0.3, 1),
      state: "run",
      st: 0,
      dur: 0,
      aa: 0,
      dirX: 1,
      dirZ: 0,
      speed0: 0,
      cool: 0,
      touchT: 0,
      wx: 0,
      wz: 0,
      sprint: false,
      jockey: false,
      face: false,
      faceX: 0,
      faceZ: 0,
      dwx: 0,
      dwz: 0,
      tx: 0,
      tz: 0,
      runT: 0,
      runX: 0,
      runZ: 0,
      think: 0,
      yellow: 0,
      sent: false,
      on: true,
      won: false,
      hits: [],
      queue: null,
      holdT: 0,
      react: 0,
      saveLock: 0,
      fatigue: 0,
      willSave: false,
      planShot: null,
    };
  }

  // ---------------------------------------------------------------- helpers

  emit(event: MatchEvent): void {
    this.events.push(event);
  }

  pullEvents(): MatchEvent[] {
    const list = this.events;
    this.events = [];
    return list;
  }

  depth(team: number, x: number): number {
    return x * this.attack[team] + HALF_L;
  }

  side(team: number, z: number): number {
    return z * this.attack[team];
  }

  worldX(team: number, d: number): number {
    return this.attack[team] * (d - HALF_L);
  }

  worldZ(team: number, s: number): number {
    return this.attack[team] * s;
  }

  goalX(team: number): number {
    return this.attack[team] * HALF_L;
  }

  ownGoalX(team: number): number {
    return -this.attack[team] * HALF_L;
  }

  teamOf(id: number): 0 | 1 {
    return id < 11 ? 0 : 1;
  }

  mates(team: number): Player[] {
    return this.players.filter((p) => p.team === team && p.on);
  }

  opponents(team: number): Player[] {
    return this.players.filter((p) => p.team !== team && p.on);
  }

  keeper(team: number): Player {
    return this.players[team * 11];
  }

  owner(): Player | null {
    return this.ball.owner >= 0 ? this.players[this.ball.owner] : null;
  }

  possessionTeam(): number {
    const o = this.owner();
    if (o) return o.team;
    if (this.ball.kickT < 2.5 && this.ball.target >= 0) return this.teamOf(this.ball.target);
    return -1;
  }

  isHuman(p: Player): boolean {
    return this.seats.some((s) => s.player === p.id);
  }

  /** Removes a disconnected person. Their footballer goes back to the AI. */
  dropSeat(slot: number): void {
    const index = this.seats.findIndex((s) => s.slot === slot);
    if (index < 0) return;
    this.seats.splice(index, 1);
    this.humans[0] = this.seats.some((s) => s.team === 0);
    this.humans[1] = this.seats.some((s) => s.team === 1);
    this.syncControl();
  }

  private buildSeats(config: MatchConfig): void {
    const list = config.seats?.length
      ? config.seats
      : ([0, 1] as const)
          .filter((team) => config.humans[team])
          .map((team) => ({ slot: team, team, name: team === 0 ? "Gracz 1" : "Gracz 2", color: PLAYER_COLORS[team] }));
    const taken = [0, 0];
    const order = [9, 10, 8, 7, 6, 5, 4, 1, 2, 3, 0];
    for (const spec of list) {
      const n = taken[spec.team];
      taken[spec.team] += 1;
      this.seats.push({
        slot: spec.slot,
        team: spec.team,
        player: spec.team * 11 + order[Math.min(n, order.length - 1)],
        color: spec.color,
        name: spec.name,
        handsCd: 0,
        handsLeft: 0,
        prev: { ...EMPTY_INPUT },
        charge: { kind: null, t: 0 },
        switchT: 0,
        switchAge: 9,
        switchCycle: [],
      });
    }
    this.humans[0] = this.seats.some((s) => s.team === 0);
    this.humans[1] = this.seats.some((s) => s.team === 1);
    this.syncControl();
  }

  private syncControl(): void {
    for (const team of [0, 1] as const) {
      const first = this.seats.find((s) => s.team === team);
      if (first) this.control[team] = first.player;
    }
  }

  private seatsOn(team: 0 | 1): HumanSeat[] {
    return this.seats.filter((s) => s.team === team);
  }

  /** Moves a person onto a footballer nobody else already controls. */
  private setSeat(seat: HumanSeat, playerId: number): void {
    if (this.seats.some((s) => s !== seat && s.player === playerId)) return;
    seat.player = playerId;
    this.syncControl();
  }

  /** Gives a restart to the only person on that side, or to the one standing closest. */
  private claim(team: 0 | 1, playerId: number): void {
    const mine = this.seatsOn(team);
    if (!mine.length) return;
    if (mine.length === 1) {
      this.setSeat(mine[0], playerId);
      return;
    }
    if (mine.some((s) => s.player === playerId)) return;
    const spot = this.players[playerId];
    let best = mine[0];
    let bestD = Infinity;
    for (const s of mine) {
      const q = this.players[s.player];
      const d = Math.hypot(q.x - spot.x, q.z - spot.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    this.setSeat(best, playerId);
  }

  inBox(team: number, x: number, z: number): boolean {
    const d = this.depth(team, x);
    return d >= 0 && d <= BOX_DEPTH && Math.abs(z) <= BOX_HALF_W;
  }

  active(p: Player): boolean {
    return p.on && !p.sent;
  }

  canAct(p: Player): boolean {
    return this.active(p) && (p.state === "run" || p.state === "hold");
  }

  pressureOn(p: Player): number {
    let best = 99;
    for (const o of this.players) {
      if (o.team === p.team || !o.on) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < best) best = d;
    }
    return clamp(1 - (best - 0.8) / 4.5, 0, 1);
  }

  nearestOpponent(p: Player): { player: Player | null; dist: number } {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const o of this.players) {
      if (o.team === p.team || !o.on || o.state === "fallen") continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return { player: best, dist: bestD };
  }

  secondLastDepth(defTeam: number, attTeam: number): number {
    const depths: number[] = [];
    for (const p of this.players) {
      if (p.team !== defTeam || !p.on) continue;
      depths.push(this.depth(attTeam, p.x));
    }
    depths.sort((a, b) => b - a);
    return depths[1] ?? HALF_L;
  }

  // ---------------------------------------------------------------- loop

  step(dt: number, inputs: ReadonlyArray<InputFrame | null>): void {
    if (this.mode === "paused") return;
    this.acc += Math.min(dt, 0.06);
    while (this.acc >= H) {
      this.tick(H, inputs);
      this.acc -= H;
    }
  }

  togglePause(): void {
    if (this.mode === "paused") {
      this.mode = this.pausedFrom;
      return;
    }
    if (this.mode === "fulltime") return;
    this.pausedFrom = this.mode;
    this.mode = "paused";
  }

  skipReplay(): void {
    if (this.mode === "replay" || (this.mode === "goal" && this.modeT > 1.2)) this.replaySkip = true;
  }

  private tick(h: number, inputs: ReadonlyArray<InputFrame | null>): void {
    this.time += h;
    this.modeT += h;
    if (this.penWindow > 0) this.penWindow = Math.max(0, this.penWindow - h);
    this.flow(h);
    if (this.mode === "replay") {
      for (const seat of this.seats) {
        const input = inputs[seat.slot];
        if (input && ((input.skip && !seat.prev.skip) || (input.pass && !seat.prev.pass) || (input.shoot && !seat.prev.shoot))) this.replaySkip = true;
        if (input) seat.prev = { ...input };
      }
      return;
    }
    for (const p of this.players) {
      p.wx = 0;
      p.wz = 0;
      p.sprint = false;
      p.jockey = false;
      p.face = false;
    }
    for (const t of [0, 1] as const) this.ai[t].update(h);
    for (const seat of this.seats) this.tickHands(seat, h);
    for (const seat of this.seats) {
      const input = inputs[seat.slot] ?? null;
      if (input) this.human(seat, input, h);
      else seat.charge.kind = null;
    }
    for (const p of this.players) this.updatePlayer(p, h);
    this.separate();
    this.updateBall(h);
    for (const p of this.players) if (p.gk && p.on) this.keeperReact(p, h);
    if (this.mode === "play") {
      this.contacts(h);
      this.rules();
    }
    this.officials(h);
    const team = this.possessionTeam();
    if (this.mode === "play") {
      if (team >= 0) this.stats.possession[team] += h;
      else this.stats.possession[this.lastTouchTeam] += h * 0.5;
    }
  }

  // ---------------------------------------------------------------- match flow

  private flow(h: number): void {
    if (this.mode === "play" || this.mode === "stoppage" || this.mode === "setpiece") {
      if (!(this.mode === "setpiece" && this.restart?.kind === "penalty")) this.clock += h;
    }
    if (this.mode === "play" && this.clock >= this.halfLen) {
      const danger = Math.abs(this.ball.x) > 30 && this.clock < this.halfLen + 8;
      if (!danger) this.endHalf();
    }
    if ((this.mode === "stoppage" || this.mode === "setpiece") && this.clock >= this.halfLen + 0.5 && this.restart?.kind !== "penalty" && this.restart?.kind !== "kickoff") {
      this.endHalf();
      return;
    }
    if (this.mode === "kickoff") {
      if (!this.kickoffWhistled && this.modeT > 1.1) {
        this.kickoffWhistled = true;
        this.emit({ k: "whistle", n: 1 });
      }
    }
    if (this.mode === "stoppage") {
      if (this.pendingCard && !this.pendingCard.shown && this.modeT > 0.9) this.showCard();
      if (this.modeT >= this.modeDur) this.setupRestart();
    }
    if (this.mode === "setpiece" && this.restart) {
      if (this.restart.kind === "penalty" && this.modeT > 1.4 && this.modeT - h <= 1.4) this.emit({ k: "whistle", n: 1 });
      if (this.restart.kind === "freekick" && this.modeT > 1.2 && this.modeT - h <= 1.2) this.emit({ k: "whistle", n: 1 });
    }
    if (this.mode === "goal" && (this.modeT > GOAL_CELEBRATION || (this.replaySkip && this.modeT > 1.8))) {
      this.mode = "replay";
      this.modeT = 0;
      this.replaySkip = false;
      this.emit({ k: "replay" });
    }
    if (this.mode === "replay" && (this.replaySkip || this.modeT > 7.5)) {
      const conceded = this.goalPending ? ((1 - this.goalPending.team) as 0 | 1) : 0;
      this.goalPending = null;
      this.setupKickoff(conceded);
    }
    if (this.mode === "halftime" && this.modeT > 4) {
      this.half = 2;
      this.clock = 0;
      this.attack = [-this.attack[0], -this.attack[1]];
      this.setupKickoff((1 - this.firstKickoff) as 0 | 1);
    }
  }

  private endHalf(): void {
    this.ball.owner = -1;
    this.ball.held = false;
    this.restart = null;
    this.pendingCard = null;
    this.modeT = 0;
    if (this.half === 1) {
      this.mode = "halftime";
      this.emit({ k: "whistle", n: 2 });
      this.emit({ k: "banner", text: "Przerwa", sub: `${this.score[0]} : ${this.score[1]}`, tone: "info" });
    } else {
      this.mode = "fulltime";
      this.emit({ k: "whistle", n: 3 });
      this.emit({ k: "banner", text: "Koniec meczu", sub: `${this.score[0]} : ${this.score[1]}`, tone: "info" });
    }
  }

  private resetPlayerStates(): void {
    for (const p of this.players) {
      if (!p.on) continue;
      p.state = "run";
      p.st = 0;
      p.vx = 0;
      p.vz = 0;
      p.cool = 0;
      p.queue = null;
      p.runT = 0;
      p.react = 0;
      p.saveLock = 0;
    }
    this.charge[0].kind = null;
    this.charge[1].kind = null;
  }

  private placeBall(x: number, y: number, z: number): void {
    const b = this.ball;
    b.x = x;
    b.y = y;
    b.z = z;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.sx = 0;
    b.sy = 0;
    b.sz = 0;
    b.owner = -1;
    b.held = false;
    b.target = -1;
    b.offside = null;
    b.shot = null;
    b.backPass = false;
    b.kickT = 9;
  }

  setupKickoff(team: 0 | 1): void {
    this.resetPlayerStates();
    this.mode = "kickoff";
    this.modeT = 0;
    this.kickoffWhistled = false;
    this.cut += 1;
    this.placeBall(0, BALL_R, 0);
    const taker = this.players[team * 11 + 9];
    this.restart = { kind: "kickoff", team, x: 0, z: 0, taker: taker.id };
    for (const p of this.players) {
      if (!p.on) continue;
      const pos = this.ai[p.team].kickoffSpot(p, p.team === team);
      p.x = pos.x;
      p.z = pos.z;
      p.yaw = this.attack[p.team] > 0 ? 0 : Math.PI;
    }
    if (taker.on) {
      taker.x = -this.attack[team] * 0.35;
      taker.z = 0.25;
      taker.yaw = Math.atan2(-0.25, this.attack[team] * 0.35);
      taker.state = "wait";
    }
    this.ball.freeTaker = taker.id;
    this.lastTouchTeam = team;
    this.ball.lastTeam = team;
    for (const t of [0, 1] as const) this.claim(t, t === team ? taker.id : this.players[t * 11 + 9].on ? t * 11 + 9 : t * 11 + 6);
    this.refs[0].x = -this.attack[team] * 6;
    this.refs[0].z = -10;
  }

  stoppage(kind: RestartKind, team: 0 | 1, x: number, z: number, dur: number): void {
    if (this.mode !== "play") return;
    this.debug?.("stop", { kind, team, lastKind: this.ball.kind, lastTeam: this.ball.lastTeam, target: this.ball.target });
    this.mode = "stoppage";
    this.modeT = 0;
    this.modeDur = dur;
    this.restart = { kind, team, x, z, taker: -1 };
    this.ball.target = -1;
    this.ball.shot = null;
    for (const p of this.players) {
      p.queue = null;
      p.runT = 0;
    }
    this.charge[0].kind = null;
    this.charge[1].kind = null;
    this.refFocus = { x, z };
  }

  private setupRestart(): void {
    const r = this.restart;
    if (!r) return;
    if (r.kind === "kickoff") {
      this.setupKickoff(r.team);
      return;
    }
    this.resetPlayerStates();
    this.mode = "setpiece";
    this.modeT = 0;
    this.cut += 1;
    const atk = this.attack[r.team];
    let bx = r.x;
    let bz = r.z;
    if (r.kind === "throwin") {
      bx = clamp(r.x, -HALF_L + 1, HALF_L - 1);
      bz = Math.sign(r.z || 1) * HALF_W;
    } else if (r.kind === "corner") {
      bx = Math.sign(r.x) * (HALF_L - 0.45);
      bz = Math.sign(r.z || 1) * (HALF_W - 0.45);
    } else if (r.kind === "goalkick") {
      bx = this.ownGoalX(r.team) + atk * 5.5;
      bz = Math.sign(r.z || 1) * 5;
    } else if (r.kind === "penalty") {
      bx = this.goalX(r.team) - atk * PEN_SPOT;
      bz = 0;
    } else {
      bx = clamp(r.x, -HALF_L + 0.5, HALF_L - 0.5);
      bz = clamp(r.z, -HALF_W + 0.5, HALF_W - 0.5);
      if (this.inBox(1 - r.team, bx, bz) && r.kind === "indirect") {
        bx = this.goalX(r.team) - atk * BOX_DEPTH;
      }
    }
    r.x = bx;
    r.z = bz;
    const taker = this.ai[r.team].chooseTaker(r.kind, bx, bz);
    r.taker = taker.id;
    this.ai[0].placeSetpiece(r);
    this.ai[1].placeSetpiece(r);
    this.placeBall(bx, r.kind === "throwin" ? 2.15 : BALL_R, bz);
    this.ball.freeTaker = taker.id;
    if (r.kind === "throwin") {
      this.ball.held = true;
      taker.x = bx;
      taker.z = Math.sign(bz) * (HALF_W + 0.35);
      taker.yaw = Math.atan2(-Math.sign(bz), 0.0001 * atk);
      taker.state = "throwin";
    } else {
      const gx = r.kind === "goalkick" ? bx + atk * 20 : this.goalX(r.team);
      const dx = gx - bx;
      const dz = (r.kind === "corner" ? 0 : r.kind === "goalkick" ? bz * 2 : 0) - bz;
      const d = Math.hypot(dx, dz) || 1;
      const back = r.kind === "penalty" ? 1.4 : 1.0;
      taker.x = bx - (dx / d) * back;
      taker.z = bz - (dz / d) * back;
      if (r.kind === "corner") {
        taker.x = bx + Math.sign(bx) * 0.9;
        taker.z = bz + Math.sign(bz) * 0.6;
      }
      taker.yaw = Math.atan2(bz - taker.z, bx - taker.x);
      taker.state = "wait";
    }
    for (const t of [0, 1] as const) {
      if (t === r.team) this.claim(t, taker.id);
      else if (r.kind === "penalty") this.claim(t, this.keeper(t).id);
      else this.claim(t, this.bestDefenderFor(t, bx, bz));
    }
    const names: Record<RestartKind, string> = {
      kickoff: "Środek",
      throwin: "Aut",
      corner: "Rzut rożny",
      goalkick: "Od bramki",
      freekick: "Rzut wolny",
      indirect: "Rzut wolny pośredni",
      penalty: "Rzut karny",
    };
    if (r.kind !== "throwin" && r.kind !== "goalkick") this.emit({ k: "banner", text: names[r.kind], sub: taker.name, tone: "info" });
  }

  private bestDefenderFor(team: 0 | 1, x: number, z: number): number {
    let best = this.control[team];
    let bestD = Infinity;
    for (const p of this.players) {
      if (p.team !== team || !p.on || p.gk) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- humans

  private tickHands(seat: HumanSeat, h: number): void {
    seat.handsCd = Math.max(0, seat.handsCd - h);
    if (seat.handsLeft <= 0) return;
    seat.handsLeft = Math.max(0, seat.handsLeft - h);
    const still = this.ball.owner === seat.player && this.ball.held;
    if (!still || seat.handsLeft <= 0) {
      if (this.ball.owner === seat.player && this.ball.held) this.ball.held = false;
      seat.handsLeft = 0;
      return;
    }
    const p = this.players[seat.player];
    if (p.state === "run") p.state = "hold";
  }

  private human(seat: HumanSeat, inp: InputFrame, h: number): void {
    const team = seat.team;
    const prev = seat.prev;
    const edge = (k: ButtonKey) => inp[k] && !prev[k];
    seat.prev = { ...inp };
    seat.switchAge += h;
    if (seat.switchT > 0) seat.switchT -= h;
    if (this.mode === "goal" && this.modeT > 1.2 && (edge("skip") || edge("pass") || edge("shoot"))) this.replaySkip = true;
    if (this.mode === "halftime" || this.mode === "fulltime" || this.mode === "goal") return;
    let p = this.players[seat.player];
    if (!p.on) {
      this.setSeat(seat, this.bestDefenderFor(team, this.ball.x, this.ball.z));
      p = this.players[seat.player];
    }
    const settingTaker = (this.mode === "setpiece" || this.mode === "kickoff") && this.restart?.taker === p.id;
    if (edge("switchP") && !settingTaker && !(this.ball.owner === p.id) && !this.keepingPenalty(p)) {
      this.manualSwitch(seat);
      p = this.players[seat.player];
    }
    this.autoSwitch(seat, inp);
    p = this.players[seat.player];
    if (this.keepingPenalty(p)) {
      this.keepPenalty(seat, p, inp, edge, h);
      return;
    }
    if (edge("hands") && this.mode === "play" && !p.gk && this.ball.owner === p.id && !this.ball.held && seat.handsCd <= 0 && seat.handsLeft <= 0) {
      this.ball.held = true;
      this.ball.vx = this.ball.vy = this.ball.vz = 0;
      p.state = "hold";
      p.st = 0;
      seat.handsLeft = 5;
      seat.handsCd = 40;
    }
    const ax = Math.hypot(inp.ax, inp.az) > 0.15 ? inp.ax : Math.hypot(inp.mx, inp.mz) > 0.2 ? inp.mx : Math.cos(p.yaw);
    const az = Math.hypot(inp.ax, inp.az) > 0.15 ? inp.az : Math.hypot(inp.mx, inp.mz) > 0.2 ? inp.mz : Math.sin(p.yaw);
    const al = Math.hypot(ax, az) || 1;
    const aimX = ax / al;
    const aimZ = az / al;
    const frozen = this.mode === "kickoff" || (this.mode === "setpiece" && this.restart?.taker === p.id);
    if (!frozen) {
      p.wx = inp.mx;
      p.wz = inp.mz;
      p.sprint = inp.sprint;
      p.jockey = inp.jockey;
    } else if (settingTaker && this.restart?.kind !== "throwin") {
      p.face = true;
      p.faceX = aimX;
      p.faceZ = aimZ;
    }
    const own = this.owner();
    const oppBall = (own && own.team !== team) || (this.ball.held && this.ball.owner >= 0 && this.teamOf(this.ball.owner) !== team);
    if (this.mode === "stoppage") {
      seat.charge.kind = null;
      return;
    }
    if (oppBall && !settingTaker) {
      seat.charge.kind = null;
      if (edge("slide") && this.canAct(p) && !p.gk) this.startSlide(p, inp.mx, inp.mz);
      if (edge("shoot") && this.canAct(p)) this.standTackle(p);
      if (inp.pass && own && this.canAct(p)) {
        const gx = this.ownGoalX(team);
        const dx = gx - own.x;
        const dz = -own.z;
        const dl = Math.hypot(dx, dz) || 1;
        const cx = own.x + (dx / dl) * 1.6 + own.vx * 0.25;
        const cz = own.z + (dz / dl) * 1.6 + own.vz * 0.25;
        const mx = cx - p.x;
        const mz = cz - p.z;
        const ml = Math.hypot(mx, mz);
        const userBias = Math.hypot(inp.mx, inp.mz) > 0.3 ? 0.35 : 0;
        if (ml > 0.15) {
          const k = Math.min(1, ml / 2.5);
          p.wx = (mx / ml) * k * (1 - userBias) + inp.mx * userBias;
          p.wz = (mz / ml) * k * (1 - userBias) + inp.mz * userBias;
        }
        p.jockey = ml < 4.5;
        p.face = true;
        p.faceX = own.x - p.x;
        p.faceZ = own.z - p.z;
      }
      return;
    }
    if (edge("slide") && !inp.lob && this.canAct(p) && !p.gk && this.ball.owner !== p.id && !settingTaker) {
      this.startSlide(p, inp.mx, inp.mz);
      if (p.state === "slide") {
        seat.charge.kind = null;
        return;
      }
    }
    const c = seat.charge;
    const keys: Array<"shoot" | "pass" | "through" | "lob"> = ["shoot", "pass", "through", "lob"];
    if (!c.kind) {
      for (const k of keys) {
        if (edge(k)) {
          c.kind = k;
          c.t = 0;
          break;
        }
      }
    }
    if (c.kind) {
      const held = inp[c.kind];
      if (held) c.t += h;
      const limit = c.kind === "shoot" ? 1.15 : 1.0;
      if (!held || c.t > limit + 0.45) {
        const power = clamp(c.t / limit, 0.08, 1);
        const kind: KickKind = c.kind === "shoot" ? "shot" : c.kind === "pass" ? "pass" : c.kind === "through" ? "through" : "lob";
        c.kind = null;
        this.humanFire(p, kind, power, aimX, aimZ);
      }
    }
  }

  chargeOf(team: number): number {
    const c = this.seats.find((s) => s.team === team)?.charge ?? this.charge[team];
    if (!c.kind) return -1;
    return clamp(c.t / (c.kind === "shoot" ? 1.15 : 1.0), 0, 1);
  }

  chargeKind(team: number): number {
    const c = this.seats.find((s) => s.team === team)?.charge ?? this.charge[team];
    return c.kind === "shoot" ? 1 : c.kind === "pass" ? 2 : c.kind === "through" ? 3 : c.kind === "lob" ? 4 : 0;
  }

  private keepingPenalty(p: Player): boolean {
    const r = this.restart;
    const setup = this.mode === "setpiece" && r !== null && r.kind === "penalty" && p.gk && p.team !== r.team;
    return setup || (this.penWindow > 0 && p.gk && this.ball.penalty && this.isHuman(p));
  }

  /** The defending person shuffles along the goal line and dives on a kick button. */
  private keepPenalty(seat: HumanSeat, p: Player, inp: InputFrame, edge: (k: ButtonKey) => boolean, h: number): void {
    seat.charge.kind = null;
    const line = this.ownGoalX(p.team) - Math.sign(this.ownGoalX(p.team) || 1) * 0.55;
    p.x += (line - p.x) * Math.min(1, h * 8);
    p.wx = 0;
    p.wz = inp.mz;
    p.sprint = false;
    p.z = clamp(p.z + inp.mz * h * 6.5, -(GOAL_HALF_W - 0.35), GOAL_HALF_W - 0.35);
    p.yaw = Math.atan2(-p.z * 0.15, this.attack[p.team]);
    if (p.state === "dive" || !(edge("slide") || edge("shoot") || edge("pass"))) return;
    const dir = Math.abs(inp.mz) > 0.25 ? Math.sign(inp.mz) : Math.abs(inp.az) > 0.25 ? Math.sign(inp.az) : 0;
    p.state = "dive";
    p.st = 0;
    p.dur = 1.35;
    p.dirX = Math.sign(this.ownGoalX(p.team) - p.x) * 0.05;
    p.dirZ = dir;
    p.speed0 = dir === 0 ? 1.4 : 7.2;
    p.aa = 1.15;
    p.willSave = true;
    p.planShot = this.ball.shot;
  }

  private humanFire(p: Player, kind: KickKind, power: number, ax: number, az: number): void {
    if (this.ownsForKick(p)) {
      const plan = this.planHuman(p, kind, power, ax, az);
      this.strike(p, plan);
      return;
    }
    p.queue = { kind, power, ax, az, t: 0.75 };
  }

  private ownsForKick(p: Player): boolean {
    const b = this.ball;
    if ((this.mode === "setpiece" || this.mode === "kickoff") && this.restart?.taker === p.id) return this.setpieceReady();
    if (b.owner !== p.id) return false;
    if (b.held) return true;
    return Math.hypot(b.x - p.x, b.z - p.z) < 1.05 && b.y < 1.0;
  }

  setpieceReady(): boolean {
    if (this.mode === "kickoff") return this.modeT > 1.15;
    if (this.mode !== "setpiece" || !this.restart) return false;
    const k = this.restart.kind;
    return this.modeT > (k === "penalty" ? 1.5 : k === "freekick" ? 1.25 : 0.7);
  }

  private manualSwitch(seat: HumanSeat): void {
    const team = seat.team;
    const b = this.ball;
    const fx = b.x + b.vx * 0.35;
    const fz = b.z + b.vz * 0.35;
    const ownGoal = this.ownGoalX(team);
    const list = this.players
      .filter((p) => p.team === team && p.on && !p.gk && p.state !== "off" && !this.seats.some((s) => s !== seat && s.player === p.id))
      .map((p) => {
        const d = Math.hypot(p.x - fx, p.z - fz);
        const goalSide = Math.abs(p.x - ownGoal) < Math.abs(fx - ownGoal) ? -2.5 : 0;
        return { id: p.id, score: d + goalSide };
      })
      .sort((a, b2) => a.score - b2.score)
      .map((e) => e.id);
    let pick: number | undefined;
    if (seat.switchAge < 1.1 && seat.switchCycle.length) {
      const cycle = seat.switchCycle;
      const index = cycle.indexOf(seat.player);
      pick = cycle[(index + 1) % Math.min(cycle.length, 4)];
    } else {
      seat.switchCycle = list;
      pick = list.find((id) => id !== seat.player);
    }
    if (pick !== undefined) {
      this.setSeat(seat, pick);
      seat.switchT = 1.4;
      seat.switchAge = 0;
    }
  }

  private autoSwitch(seat: HumanSeat, inp: InputFrame): void {
    const team = seat.team;
    if (this.seatsOn(team).length > 1) return;
    const o = this.owner();
    if (o && o.team === team && seat.player !== o.id) {
      if (!o.gk || this.ball.held) {
        this.setSeat(seat, o.id);
        return;
      }
    }
    const current = this.players[seat.player];
    if (current.gk && !(this.ball.owner === current.id) && !this.keepingPenalty(current)) {
      this.setSeat(seat, this.bestDefenderFor(team, this.ball.x, this.ball.z));
      return;
    }
    if (seat.switchT > 0 || (o && o.team === team)) return;
    if (this.mode !== "play") return;
    if (this.ball.target >= 0 && this.teamOf(this.ball.target) === team) return;
    const b = this.ball;
    const fx = b.x + b.vx * 0.5;
    const fz = b.z + b.vz * 0.5;
    const mine = Math.hypot(current.x - fx, current.z - fz);
    if (mine < 13 || (inp.sprint && mine < 22)) return;
    let best = current.id;
    let bestD = mine;
    for (const p of this.players) {
      if (p.team !== team || !p.on || p.gk) continue;
      const d = Math.hypot(p.x - fx, p.z - fz);
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    if (best !== current.id && bestD + 7 < mine) {
      this.setSeat(seat, best);
      seat.switchT = 1.0;
    }
  }

  // ---------------------------------------------------------------- kicks

  planHuman(p: Player, kind: KickKind, power: number, ax: number, az: number): KickPlan {
    const b = this.ball;
    if (this.mode === "setpiece" && this.restart?.kind === "throwin") {
      kind = kind === "shot" ? "lob" : kind;
    }
    if (p.gk && b.held && (kind === "shot" || kind === "lob")) {
      const dist = 35 + power * 32;
      return { kind: "punt", power, tx: clamp(b.x + ax * dist, -HALF_L + 2, HALF_L - 2), tz: clamp(b.z + az * dist, -HALF_W + 2, HALF_W - 2), ty: 0, receiver: -1, curl: 0, ai: false };
    }
    if (p.gk && b.held && kind === "pass") kind = "gkthrow";
    if (kind === "shot") {
      const gx = this.goalX(p.team);
      const sgn = Math.sign(gx);
      let tz: number;
      const toward = ax * sgn;
      if (toward > 0.12) {
        const t = (gx - b.x) / ax;
        tz = b.z + az * t;
      } else {
        tz = Math.sign(az || -b.z || 1) * 3.0;
      }
      tz = clamp(tz, -3.3, 3.3);
      const ty = 0.25 + power * 1.3 + Math.max(0, power - 0.78) * 5.2;
      const dist = Math.hypot(gx - b.x, tz - b.z);
      const curl = dist < 26 && power < 0.85 && Math.abs(tz) > 1.8 ? -Math.sign(tz) * sgn * (0.6 - power * 0.5) : 0;
      return { kind: "shot", power, tx: gx + sgn * 0.4, tz, ty, receiver: -1, curl, ai: false };
    }
    const receiver = this.pickReceiver(p, kind, ax, az);
    const wideCross = kind === "lob" && Math.abs(b.z) > 14 && this.depth(p.team, b.x) > 70;
    if (!receiver) {
      const dist = kind === "lob" ? 12 + power * 45 : kind === "through" ? 10 + power * 30 : 6 + power * 34;
      return { kind: wideCross ? "cross" : kind, power, tx: b.x + ax * dist, tz: b.z + az * dist, ty: 0, receiver: -1, curl: 0, ai: false };
    }
    return this.planToReceiver(p, receiver, wideCross ? "cross" : kind, power, false);
  }

  pickReceiver(p: Player, kind: KickKind, ax: number, az: number): Player | null {
    let best: Player | null = null;
    let bestScore = -Infinity;
    const maxD = kind === "lob" ? 70 : 55;
    for (const q of this.players) {
      if (q.team !== p.team || q.id === p.id || !q.on || q.state === "fallen") continue;
      const dx = q.x + q.vx * 0.3 - p.x;
      const dz = q.z + q.vz * 0.3 - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.5 || d > maxD) continue;
      const cos = (dx * ax + dz * az) / d;
      if (cos < 0.74) continue;
      let score = cos * 3.2 - d / 45;
      if (kind === "through") score += (this.depth(p.team, q.x) - this.depth(p.team, p.x)) / 30 + Math.max(0, q.vx * this.attack[p.team]) * 0.05;
      if (q.gk) score -= 1.2;
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
    return best;
  }

  planToReceiver(p: Player, q: Player, kind: KickKind, power: number, ai: boolean): KickPlan {
    const b = this.ball;
    let tx = q.x;
    let tz = q.z;
    let ty = 0;
    const atk = this.attack[p.team];
    if (kind === "through") {
      const qs = Math.hypot(q.vx, q.vz);
      let dx = qs > 2.5 ? q.vx / qs : atk;
      let dz = qs > 2.5 ? q.vz / qs : 0;
      const fwd = dx * atk;
      if (fwd < 0.3) {
        dx = dx * 0.4 + atk * 0.6;
        dz *= 0.4;
        const l = Math.hypot(dx, dz);
        dx /= l;
        dz /= l;
      }
      const run = q.top * 0.92;
      let lead = 4 + power * 8;
      for (let i = 0; i < 4; i += 1) {
        tx = q.x + dx * lead;
        tz = q.z + dz * lead;
        const d = Math.hypot(tx - b.x, tz - b.z);
        const tb = Math.min(4, rollTime(groundSpeedFor(d, passArrive(d, true)), d));
        lead = clamp((tb + 0.15) * run * (0.8 + power * 0.35), 3, 22);
      }
      tx = q.x + dx * lead;
      tz = q.z + dz * lead;
    } else if (kind === "lob" || kind === "cross" || kind === "throw" || kind === "punt" || kind === "clear") {
      const d = Math.hypot(q.x - b.x, q.z - b.z);
      const flight = 0.9 + d * 0.035;
      tx = q.x + q.vx * flight * 0.85;
      tz = q.z + q.vz * flight * 0.85;
      ty = kind === "cross" ? 1.55 : kind === "throw" ? 0.6 : 0.2;
    } else {
      for (let i = 0; i < 2; i += 1) {
        const d = Math.hypot(tx - b.x, tz - b.z);
        const v0 = groundSpeedFor(d, passArrive(d, false));
        const t = Math.min(3, rollTime(v0, d));
        tx = q.x + q.vx * t * 0.8;
        tz = q.z + q.vz * t * 0.8;
      }
    }
    tx = clamp(tx, -HALF_L - 1, HALF_L + 1);
    tz = clamp(tz, -HALF_W + 0.5, HALF_W - 0.5);
    return { kind, power, tx, tz, ty, receiver: q.id, curl: 0, ai };
  }

  strike(p: Player, plan: KickPlan): void {
    const b = this.ball;
    const s = p.info.stats;
    const restartKind = this.mode === "setpiece" || this.mode === "kickoff" ? (this.restart?.kind ?? null) : null;
    const errMul = plan.ai ? this.ai[p.team].errorMul : 0.9;
    const pressure = restartKind ? 0 : this.pressureOn(p);
    let dx = plan.tx - b.x;
    let dz = plan.tz - b.z;
    let d = Math.hypot(dx, dz) || 0.01;
    const face = Math.atan2(dz, dx);
    const bodyAngle = Math.abs(wrapAngle(face - p.yaw));
    const speedP = Math.hypot(p.vx, p.vz);
    const header = b.y > 1.15 && !b.held;
    const volley = !header && b.y > 0.45 && !b.held;
    let kind = plan.kind;
    if (header && (kind === "pass" || kind === "through" || kind === "lob" || kind === "cross")) kind = "header";
    if (header && kind === "shot") kind = "header";
    if (restartKind === "throwin") kind = "throw";
    const spin: [number, number, number] = [0, 0, 0];
    b.sx = 0;
    b.sy = 0;
    b.sz = 0;
    let groundPass = kind === "pass" || kind === "through" || kind === "gkthrow" || kind === "touch";
    if (header && plan.kind !== "shot") groundPass = false;
    if (groundPass && !header) {
      let v0 = groundSpeedFor(d, passArrive(d, kind === "through"));
      if (!plan.ai && kind !== "gkthrow") v0 = Math.max(v0, lerp(v0, groundSpeedFor(10 + plan.power * 50, 7.5), 0.35));
      if (kind === "gkthrow") v0 = Math.min(v0, 20);
      v0 = clamp(v0, 6, 33);
      const err = (Math.pow(1 - s.pas / 100, 1.3) * 0.11 + bodyAngle * 0.03 + pressure * 0.035 + Math.max(0, speedP - 6) * 0.006 + (volley ? 0.05 : 0)) * errMul;
      const ang = face + this.rng.gauss() * err;
      v0 *= 1 + this.rng.gauss() * err * 0.5;
      b.vx = Math.cos(ang) * v0;
      b.vz = Math.sin(ang) * v0;
      b.vy = volley ? 1.5 : 0;
      if (b.y < BALL_R + 0.01) b.y = BALL_R;
    } else if (kind === "shot" || (kind === "header" && plan.kind === "shot")) {
      const isHeader = kind === "header";
      let v = isHeader ? 10 + plan.power * 7 + s.phy * 0.03 : 14 + plan.power * 14 + s.sho * 0.05;
      if (volley) v *= 0.96;
      const latErr =
        (Math.pow(1 - s.sho / 100, 1.15) * 0.085 + Math.pow(plan.power, 3) * 0.03 + Math.min(bodyAngle, 2) * 0.05 + pressure * 0.045 + Math.max(0, speedP - 7) * 0.008 + (volley ? 0.05 : 0) + (isHeader ? 0.05 : 0)) *
        errMul;
      const dist = Math.hypot(plan.tx - b.x, plan.tz - b.z);
      const tz = plan.tz + this.rng.gauss() * latErr * dist;
      let ty = isHeader ? clamp(plan.ty * 0.55, 0.15, 1.6) : plan.ty;
      ty += this.rng.gauss() * (0.18 + plan.power * plan.power * 0.35 + pressure * 0.2) * errMul;
      ty = Math.max(0.12, ty);
      const T = Math.hypot(dist, ty - b.y) / (v * 0.9);
      if (plan.curl) spin[1] = plan.curl * 32;
      const [vx, vy, vz] = solveLaunch(b.x, b.y, b.z, plan.tx, ty, tz, T, spin);
      b.vx = vx;
      b.vy = vy;
      b.vz = vz;
      b.sy = spin[1];
      kind = isHeader ? "header" : "shot";
      b.shot = { team: p.team, id: p.id, roll: this.rng.next(), resolved: false };
      b.shooter = p.id;
      b.penalty = restartKind === "penalty";
      this.stats.shots[p.team] += 1;
      if (Math.abs(p.z) < 20 && this.depth(p.team, b.x) > 88 && plan.power > 0.7) this.emit({ k: "ooh" });
    } else {
      let apex: number;
      let ty = plan.ty;
      if (kind === "cross") apex = clamp(2.5 + d * 0.045, 2.8, 5.8);
      else if (kind === "throw") apex = clamp(2.4 + d * 0.05, 2.6, 4.2);
      else if (kind === "clear") apex = clamp(8 + d * 0.12, 9, 18);
      else if (kind === "punt") apex = clamp(12 + d * 0.08, 13, 22);
      else if (kind === "header") apex = plan.receiver >= 0 ? b.y + 0.2 : Math.max(b.y + 0.8, 3 + d * 0.1);
      else apex = clamp(2.1 + d * 0.085 + plan.power * 1.6, 2.7, 11);
      if (kind === "throw") d = Math.min(d, 9 + s.phy * 0.17);
      const err = (Math.pow(1 - s.pas / 100, 1.2) * 0.12 + pressure * 0.04 + bodyAngle * 0.025 + (kind === "header" ? 0.08 : 0)) * errMul;
      const ang = face + this.rng.gauss() * err * 0.7;
      const dd = d * (1 + this.rng.gauss() * err * 0.5);
      const tx = b.x + Math.cos(ang) * dd;
      const tz = b.z + Math.sin(ang) * dd;
      apex = Math.max(apex, b.y + 0.3, ty + 0.3);
      const vy0 = Math.sqrt(2 * GRAVITY * Math.max(0.2, apex - b.y));
      const T = vy0 / GRAVITY + Math.sqrt((2 * Math.max(0.05, apex - ty)) / GRAVITY);
      spin[0] = 0;
      const [vx, vy, vz] = solveLaunch(b.x, b.y, b.z, tx, ty, tz, T, spin);
      b.vx = vx;
      b.vy = vy;
      b.vz = vz;
      dx = tx - b.x;
      dz = tz - b.z;
    }
    if (b.y < BALL_R) b.y = BALL_R;
    b.owner = -1;
    b.held = false;
    b.lastTeam = p.team;
    b.lastId = p.id;
    this.lastTouchTeam = p.team;
    b.kind = kind;
    b.kickT = 0;
    b.target = plan.receiver;
    b.restart = restartKind;
    b.backPass = kind === "pass" || kind === "through" || kind === "lob" || kind === "clear" || kind === "cross" || kind === "touch";
    if (restartKind === "throwin") {
      b.backPass = true;
      b.inField = false;
      b.outT = 0;
    }
    if (restartKind === "throwin" || restartKind === "corner" || restartKind === "goalkick") b.offside = null;
    else this.snapshotOffside(p);
    if (b.freeTaker === p.id && restartKind) p.cool = 0.9;
    else p.cool = 0.26;
    if (!restartKind) b.freeTaker = -1;
    p.queue = null;
    p.holdT = 0;
    const anim: PState = header ? "header" : volley ? "volley" : kind === "throw" ? "throwin" : "kick";
    p.state = anim;
    p.st = 0;
    p.dur = anim === "header" ? 0.6 : anim === "throwin" ? 0.6 : 0.42;
    p.aa = kind === "gkthrow" ? -1 : kind === "punt" ? 2 + plan.power : plan.power;
    if (anim === "kick" && kind !== "gkthrow") {
      const sp = Math.hypot(dx, dz) || 1;
      p.face = true;
      p.faceX = dx / sp;
      p.faceZ = dz / sp;
    }
    if (kind !== "shot" && kind !== "header") this.stats.passes[p.team] += 1;
    this.debug?.("kick", { kind, id: p.id, team: p.team, recv: plan.receiver, d: Math.hypot(plan.tx - b.x, plan.tz - b.z), v: Math.hypot(b.vx, b.vy, b.vz), ai: plan.ai });
    this.emit({ k: "kick", power: clamp(Math.hypot(b.vx, b.vy, b.vz) / 32, 0.1, 1) });
    if (this.mode === "setpiece" || this.mode === "kickoff") {
      if (restartKind === "penalty") {
        this.penWindow = 0.55;
        const gk = this.keeper(1 - p.team);
        if (gk.state === "dive" && gk.willSave) gk.planShot = b.shot;
      }
      this.mode = "play";
      this.modeT = 0;
      this.restart = null;
    }
    const kicker = this.seats.find((s) => s.player === p.id);
    if (kicker) kicker.handsLeft = 0;
    if (kicker && this.seatsOn(p.team).length === 1 && plan.receiver >= 0 && kind !== "shot") {
      this.setSeat(kicker, plan.receiver);
      kicker.switchT = 0.6;
    }
  }

  // ---------------------------------------------------------------- tackles

  startSlide(p: Player, wx: number, wz: number): void {
    if (!this.canAct(p) || p.cool > 0.2 || this.mode !== "play") return;
    if (this.ball.owner === p.id) return;
    let dx = Math.cos(p.yaw);
    let dz = Math.sin(p.yaw);
    const s = Math.hypot(p.vx, p.vz);
    if (s > 1.5) {
      dx = p.vx / s;
      dz = p.vz / s;
    }
    const wl = Math.hypot(wx, wz);
    if (wl > 0.3) {
      const blend = s > 5 ? 0.35 : 0.8;
      dx = dx * (1 - blend) + (wx / wl) * blend;
      dz = dz * (1 - blend) + (wz / wl) * blend;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    }
    p.state = "slide";
    p.st = 0;
    p.dur = 1.15;
    p.dirX = dx;
    p.dirZ = dz;
    p.speed0 = Math.max(5.2, s + 1.4);
    p.won = false;
    p.hits = [];
    p.yaw = Math.atan2(dz, dx);
    p.queue = null;
  }

  standTackle(p: Player): void {
    if (!this.canAct(p) || p.cool > 0.1 || this.mode !== "play") return;
    p.state = "tackle";
    p.st = 0;
    p.dur = 0.5;
    p.won = false;
    p.hits = [];
    const o = this.owner();
    if (o && o.team !== p.team) {
      const dx = this.ball.x - p.x;
      const dz = this.ball.z - p.z;
      if (Math.hypot(dx, dz) < 3) p.yaw = Math.atan2(dz, dx);
    }
  }

  private resolveStandTackle(p: Player): void {
    const b = this.ball;
    const fx = Math.cos(p.yaw);
    const fz = Math.sin(p.yaw);
    const rx = p.x + fx * 0.78;
    const rz = p.z + fz * 0.78;
    const o = this.owner();
    const dBall = Math.hypot(b.x - rx, b.z - rz);
    if (o && o.team !== p.team && !b.held) {
      if (dBall < 0.85 && b.y < 0.8) {
        const behind = this.fromBehind(p, o);
        const gap = Math.hypot(b.x - o.x, b.z - o.z);
        const chance = clamp(0.5 + (p.info.stats.def - o.info.stats.dri) * 0.013 + (gap > 0.6 ? 0.22 : 0) - (behind ? 0.3 : 0) + this.ai[p.team].tackleBonus, 0.1, 0.92);
        this.stats.tackles[p.team] += 1;
        if (this.rng.chance(chance)) {
          this.emit({ k: "tackle" });
          o.state = "stumble";
          o.st = 0;
          o.dur = 0.55;
          o.cool = 0.5;
          if (this.rng.chance(0.5)) {
            b.owner = p.id;
            this.gainPossession(p, false);
          } else {
            b.owner = -1;
            b.vx = fx * this.rng.range(3, 7) + this.rng.gauss() * 1.5;
            b.vz = fz * this.rng.range(3, 7) + this.rng.gauss() * 1.5;
            b.vy = 0.4;
            b.lastTeam = p.team;
            b.lastId = p.id;
            this.touchedBy(p);
          }
          p.cool = 0.25;
          return;
        }
        const dOwner = Math.hypot(o.x - rx, o.z - rz);
        if (dOwner < 0.8 && this.rng.chance(behind ? 0.55 : 0.14)) {
          this.foul(p, o, "stand");
          return;
        }
        p.cool = 0.55;
        return;
      }
      const dOwner = Math.hypot(o.x - rx, o.z - rz);
      if (dOwner < 0.55 && this.rng.chance(0.35)) {
        this.foul(p, o, "stand");
        return;
      }
    }
    p.cool = 0.4;
  }

  fromBehind(tackler: Player, victim: Player): boolean {
    const vs = Math.hypot(victim.vx, victim.vz);
    const hx = vs > 1 ? victim.vx / vs : Math.cos(victim.yaw);
    const hz = vs > 1 ? victim.vz / vs : Math.sin(victim.yaw);
    const dx = tackler.x - victim.x;
    const dz = tackler.z - victim.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * hx + dz * hz) / d < -0.55;
  }

  private slideContacts(p: Player): void {
    if (p.st < 0.04 || p.st > 0.62) return;
    const b = this.ball;
    const fx = p.x + p.dirX * 0.72;
    const fz = p.z + p.dirZ * 0.72;
    if (!p.won && !b.held && b.y < 0.55) {
      const db = Math.min(Math.hypot(b.x - fx, b.z - fz), Math.hypot(b.x - p.x - p.dirX * 0.3, b.z - p.z - p.dirZ * 0.3));
      if (db < 0.6) {
        p.won = true;
        const o = this.owner();
        if (o && o.team !== p.team) {
          o.state = "stumble";
          o.st = 0;
          o.dur = 0.5;
          o.cool = 0.5;
        }
        const sp = Math.max(4.5, p.speed0 * (1.05 - p.st));
        const side = this.rng.gauss() * 1.6;
        b.owner = -1;
        b.vx = p.dirX * sp - p.dirZ * side;
        b.vz = p.dirZ * sp + p.dirX * side;
        b.vy = 0.6;
        b.lastTeam = p.team;
        b.lastId = p.id;
        b.kickT = 0;
        b.kind = "tackle";
        b.target = -1;
        b.backPass = false;
        this.lastTouchTeam = p.team;
        this.stats.tackles[p.team] += 1;
        this.emit({ k: "tackle" });
        this.touchedBy(p);
      }
    }
    for (const q of this.players) {
      if (q.team === p.team || !q.on || q.state === "fallen" || q.state === "off" || p.hits.includes(q.id)) continue;
      if (q.gk && this.ball.held && this.ball.owner === q.id) continue;
      const d1 = Math.hypot(q.x - fx, q.z - fz);
      const d2 = Math.hypot(q.x - p.x - p.dirX * 0.3, q.z - p.z - p.dirZ * 0.3);
      if (Math.min(d1, d2) > 0.58) continue;
      p.hits.push(q.id);
      if (!p.won) {
        this.foul(p, q, "slide");
        return;
      }
      if (this.rng.chance(0.4)) {
        q.state = "fallen";
        q.st = 0;
        q.dur = 1.1;
        q.aa = this.fromBehind(p, q) ? 1 : -1;
      } else {
        q.state = "stumble";
        q.st = 0;
        q.dur = 0.5;
      }
    }
  }

  foul(off: Player, victim: Player, kind: "slide" | "stand"): void {
    if (this.mode !== "play" || !this.useRules) return;
    const b = this.ball;
    const hadBall = b.owner === victim.id || Math.hypot(b.x - victim.x, b.z - victim.z) < 2.5;
    const behind = this.fromBehind(off, victim);
    victim.state = "fallen";
    victim.st = 0;
    victim.dur = 1.7;
    victim.aa = behind ? 1 : -1;
    if (b.owner === victim.id) b.owner = -1;
    this.stats.fouls[off.team] += 1;
    const atkTeam = victim.team;
    const fx = clamp(victim.x, -HALF_L + 0.3, HALF_L - 0.3);
    const fz = clamp(victim.z, -HALF_W + 0.3, HALF_W - 0.3);
    const penalty = this.inBox(off.team, fx, fz);
    const vs = Math.hypot(off.vx, off.vz);
    let severity = kind === "slide" ? 0.18 : 0.04;
    if (behind) severity += kind === "slide" ? 0.3 : 0.18;
    if (vs > 7) severity += 0.1;
    if (!hadBall) severity += 0.12;
    let red = false;
    let yellow = this.rng.chance(clamp(severity, 0, 0.85));
    if (this.rng.chance(severity * severity * 0.07)) red = true;
    const goalDist = Math.hypot(this.goalX(atkTeam) - fx, fz);
    if (hadBall && goalDist < 25) {
      let coverers = 0;
      for (const q of this.players) {
        if (q.team !== off.team || !q.on || q.id === off.id || q.gk) continue;
        if (this.depth(atkTeam, q.x) > this.depth(atkTeam, fx) - 1 && Math.abs(q.z - fz) < 16) coverers += 1;
      }
      if (coverers === 0) {
        if (penalty && kind !== "slide") yellow = true;
        else red = true;
      }
    }
    if (yellow && !red && off.yellow >= 1) red = true;
    if (yellow || red) this.pendingCard = { id: off.id, red, shown: false };
    this.emit({ k: "whistle", n: 1 });
    this.emit({ k: "banner", text: penalty ? "Rzut karny!" : "Faul", sub: `${off.name} na ${victim.name}`, tone: penalty ? "red" : "info" });
    this.stoppage(penalty ? "penalty" : "freekick", atkTeam, fx, fz, yellow || red ? 3.6 : 2.0);
  }

  private showCard(): void {
    const c = this.pendingCard;
    if (!c) return;
    c.shown = true;
    const p = this.players[c.id];
    if (c.red) {
      p.yellow = Math.max(p.yellow, 1) + (p.yellow >= 1 ? 1 : 0);
      p.sent = true;
      p.state = "off";
      p.st = 0;
      this.stats.reds[p.team] += 1;
      if (p.yellow >= 2) this.stats.yellows[p.team] += 1;
      this.emit({ k: "banner", text: p.yellow >= 2 ? "Druga żółta, czerwona kartka" : "Czerwona kartka", sub: p.name, tone: "red" });
    } else {
      p.yellow += 1;
      this.stats.yellows[p.team] += 1;
      this.emit({ k: "banner", text: "Żółta kartka", sub: p.name, tone: "yellow" });
    }
    this.emit({ k: "card", id: p.id, red: c.red });
    const ref = this.refs[0];
    ref.act = ACT.card;
    ref.st = 0;
    ref.aa = c.red ? 2 : 1;
    const sent = this.seats.find((s) => s.player === p.id);
    if (sent) this.setSeat(sent, this.bestDefenderFor(p.team, this.ball.x, this.ball.z));
  }

  // ---------------------------------------------------------------- players

  private updatePlayer(p: Player, h: number): void {
    if (!p.on) return;
    p.st += h;
    if (p.cool > 0) p.cool -= h;
    if (p.queue) {
      p.queue.t -= h;
      if (p.queue.t <= 0) p.queue = null;
    }
    if (this.ball.owner === p.id) p.holdT += h;
    if (p.saveLock > 0) p.saveLock -= h;
    switch (p.state) {
      case "off": {
        const tz = Math.sign(p.z || 1) * (HALF_W + 4);
        const dz = tz - p.z;
        p.vx = 0;
        p.vz = Math.sign(dz) * 2.2;
        p.z += p.vz * h;
        p.yaw = Math.atan2(p.vz, 0.0001);
        if (Math.abs(dz) < 0.3 || p.st > 14) {
          p.on = false;
          p.x = 0;
          p.z = 60;
        }
        return;
      }
      case "slide": {
        const k = Math.max(0, 1 - p.st / 0.72);
        const sp = p.speed0 * k;
        p.vx = p.dirX * sp;
        p.vz = p.dirZ * sp;
        p.x += p.vx * h;
        p.z += p.vz * h;
        if (this.mode === "play") this.slideContacts(p);
        if (p.st >= p.dur) this.toRun(p, 0.2);
        this.bound(p);
        return;
      }
      case "dive": {
        const flight = p.st < 0.5;
        const sp = flight ? p.speed0 * (1 - p.st * 0.8) : 0;
        p.vx = p.dirX * sp;
        p.vz = p.dirZ * sp;
        p.x += p.vx * h;
        p.z += p.vz * h;
        if (p.st >= p.dur) this.toRun(p, 0);
        return;
      }
      case "fallen":
      case "throwin":
      case "wait": {
        p.vx *= Math.exp(-8 * h);
        p.vz *= Math.exp(-8 * h);
        p.x += p.vx * h;
        p.z += p.vz * h;
        if (p.face) p.yaw = turnToward(p.yaw, Math.atan2(p.faceZ, p.faceX), 3 * h);
        if (p.state === "fallen" && p.st >= p.dur) this.toRun(p, 0);
        if (p.state === "throwin" && this.mode === "play" && p.st > 0.6) this.toRun(p, 0);
        if (p.state === "wait" && this.mode === "play") this.toRun(p, 0);
        return;
      }
      case "tackle": {
        if (!p.won && p.st >= 0.13) {
          p.won = true;
          this.resolveStandTackle(p);
        }
        if (p.state === "tackle" && p.st >= p.dur) this.toRun(p, 0);
        break;
      }
      case "kick":
      case "header":
      case "volley":
      case "stumble":
        if (p.st >= p.dur) this.toRun(p, 0);
        break;
      case "celebrate":
        break;
      default:
        break;
    }
    if (this.mode === "kickoff") {
      p.vx = 0;
      p.vz = 0;
      if (p.face) p.yaw = turnToward(p.yaw, Math.atan2(p.faceZ, p.faceX), 3 * h);
      return;
    }
    this.locomote(p, h);
    this.bound(p);
  }

  private toRun(p: Player, cool: number): void {
    p.state = this.ball.held && this.ball.owner === p.id ? "hold" : "run";
    p.st = 0;
    p.cool = Math.max(p.cool, cool);
  }

  private bound(p: Player): void {
    p.x = clamp(p.x, -HALF_L - 4, HALF_L + 4);
    p.z = clamp(p.z, -HALF_W - 4, HALF_W + 4);
  }

  private locomote(p: Player, h: number): void {
    const b = this.ball;
    const owner = b.owner === p.id && !b.held;
    let wx = p.wx;
    let wz = p.wz;
    let wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
      wl = 1;
    }
    let top = p.top * (p.sprint ? 1 : JOG) * (1 - p.fatigue * 0.12);
    if (owner) top *= p.sprint ? 0.9 + p.info.stats.dri * 0.0008 : 0.97;
    if (p.state === "kick" || p.state === "volley") top *= p.st < 0.25 ? 0.45 : 0.8;
    if (p.state === "header") top *= 0.6;
    if (p.state === "tackle") top *= 0.3;
    if (p.state === "stumble") top *= 0.4;
    if (p.state === "hold") top *= 0.6;
    if (p.state === "celebrate") top = p.top * 0.9;
    if (owner && wl > 0.1) {
      p.dwx = wx / wl;
      p.dwz = wz / wl;
      const dx = b.x + b.vx * 0.12 - p.x;
      const dz = b.z + b.vz * 0.12 - p.z;
      const dd = Math.hypot(dx, dz);
      const ahead = dx * p.dwx + dz * p.dwz;
      if (dd > 0.55 && ahead < dd * 0.8 && b.y < 0.3) {
        const k = smooth(0.55, 1.4, dd);
        wx = lerp(wx, (dx / dd) * wl, k);
        wz = lerp(wz, (dz / dd) * wl, k);
      }
    }
    if (p.jockey && !owner) {
      top = Math.min(top, 3.4 + p.info.stats.def * 0.008);
      const tvx = wx * top;
      const tvz = wz * top;
      const dvx = tvx - p.vx;
      const dvz = tvz - p.vz;
      const dl = Math.hypot(dvx, dvz);
      const maxDv = (p.acc + 1.5) * h;
      if (dl > maxDv) {
        p.vx += (dvx / dl) * maxDv;
        p.vz += (dvz / dl) * maxDv;
      } else {
        p.vx = tvx;
        p.vz = tvz;
      }
      p.x += p.vx * h;
      p.z += p.vz * h;
      const fy = p.face ? Math.atan2(p.faceZ, p.faceX) : Math.hypot(p.vx, p.vz) > 0.5 ? Math.atan2(p.vz, p.vx) : p.yaw;
      p.yaw = turnToward(p.yaw, fy, 8 * h);
      return;
    }
    const s = Math.hypot(p.vx, p.vz);
    let heading = s > 0.05 ? Math.atan2(p.vz, p.vx) : p.yaw;
    let ns = s;
    if (wl < 0.06) {
      const kneeSlide = p.state === "celebrate" && p.aa === CELEBRATION.kneeSlide;
      ns = Math.max(0, s - (kneeSlide ? 3.6 : BRAKE) * h);
    } else {
      const want = Math.atan2(wz, wx);
      const diff = wrapAngle(want - heading);
      const frac = clamp(s / 9.5, 0, 1);
      const omega = lerp(13, 2.2 + p.agility * 2.2, Math.pow(frac, 1.15)) * (owner ? 0.85 : 1);
      if (Math.abs(diff) > 2.0 && s > 3.2) {
        ns = Math.max(0, s - (BRAKE + 1.5) * h);
        heading = turnToward(heading, want, omega * 0.3 * h);
      } else {
        heading = s < 0.3 ? want : turnToward(heading, want, omega * h);
        const target = top * wl * (1 - 0.3 * smooth(0.5, 1.6, Math.abs(diff)));
        if (ns < target) {
          const a = p.acc * (1 - (0.55 * ns) / Math.max(top, 1));
          ns = Math.min(target, ns + Math.max(0.8, a) * h);
        } else {
          ns = Math.max(target, ns - BRAKE * 0.7 * h);
        }
      }
    }
    p.vx = Math.cos(heading) * ns;
    p.vz = Math.sin(heading) * ns;
    p.x += p.vx * h;
    p.z += p.vz * h;
    if (p.sprint && ns > p.top * 0.8) p.fatigue = Math.min(1, p.fatigue + h * 0.012);
    else p.fatigue = Math.max(0, p.fatigue - h * 0.02);
    let faceTarget: number | null = null;
    if (p.face) faceTarget = Math.atan2(p.faceZ, p.faceX);
    else if (ns > 0.5) faceTarget = heading;
    else if (wl > 0.1) faceTarget = Math.atan2(wz, wx);
    if (faceTarget !== null) p.yaw = turnToward(p.yaw, faceTarget, (ns > 4 ? 7 : 11) * h);
  }

  private separate(): void {
    const list = this.players;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      if (!a.on || a.state === "off") continue;
      for (let j = i + 1; j < list.length; j += 1) {
        const c = list[j];
        if (!c.on || c.state === "off") continue;
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        const d2 = dx * dx + dz * dz;
        const min = a.state === "fallen" || c.state === "fallen" || a.state === "slide" || c.state === "slide" || a.state === "dive" || c.state === "dive" ? 0.35 : 0.62;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        const fa = a.state === "wait" || a.state === "throwin" ? 0 : 1;
        const fc = c.state === "wait" || c.state === "throwin" ? 0 : 1;
        const sum = fa + fc || 1;
        a.x -= nx * push * 2 * (fa / sum);
        a.z -= nz * push * 2 * (fa / sum);
        c.x += nx * push * 2 * (fc / sum);
        c.z += nz * push * 2 * (fc / sum);
      }
    }
  }

  // ---------------------------------------------------------------- ball

  private updateBall(h: number): void {
    const b = this.ball;
    b.kickT += h;
    if (this.mode === "kickoff" || this.mode === "setpiece") {
      const r = this.restart;
      if (r && r.kind === "throwin") {
        const t = this.players[r.taker];
        b.x = t.x + Math.cos(t.yaw) * 0.05;
        b.z = t.z + Math.sin(t.yaw) * 0.05;
        b.y = 2.18;
      }
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      return;
    }
    if (b.held && b.owner >= 0) {
      const g = this.players[b.owner];
      if (g.state === "dive") {
        const k = clamp(g.st / 0.45, 0, 1);
        b.x = g.x + g.dirX * lerp(0.9, 0.45, k);
        b.z = g.z + g.dirZ * lerp(0.9, 0.45, k);
        b.y = lerp(Math.max(0.3, g.aa), 0.32, k);
      } else {
        b.x = g.x + Math.cos(g.yaw) * 0.32;
        b.z = g.z + Math.sin(g.yaw) * 0.32;
        b.y = 1.05;
      }
      b.vx = g.vx;
      b.vy = 0;
      b.vz = g.vz;
      if (this.mode === "play" && g.holdT > 7.5) this.ai[g.team].releaseKeeper(g, true);
      return;
    }
    if (b.owner >= 0) {
      this.dribble(this.players[b.owner], h);
      if (b.owner >= 0 && this.ball.y < BALL_R + 0.01 && Math.abs(this.ball.vy) < 0.01 && this.closeControl(this.players[b.owner])) return;
    }
    const px = b.x;
    const hit = stepBall(b, h, true);
    if (hit === "post" || hit === "bar") {
      this.emit({ k: "post" });
      this.emit({ k: "ooh" });
      b.target = -1;
    }
    if (hit === "net" && Math.abs(px) > HALF_L) this.emit({ k: "net" });
  }

  private closeControl(p: Player): boolean {
    const s = Math.hypot(p.vx, p.vz);
    return s < 2.4 || (p.jockey && s < 4.5) || p.state === "kick";
  }

  private dribble(p: Player, h: number): void {
    const b = this.ball;
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.5 || b.y > 2.6 || !this.active(p) || p.state === "fallen" || p.state === "slide" || p.state === "dive") {
      b.owner = -1;
      return;
    }
    const speed = Math.hypot(p.vx, p.vz);
    const fx = Math.cos(p.yaw);
    const fz = Math.sin(p.yaw);
    if (b.y > BALL_R + 0.03) {
      const off = 0.45 + speed * 0.12;
      const tx = p.x + fx * off + p.vx * 0.15;
      const tz = p.z + fz * off + p.vz * 0.15;
      const k = 1 - Math.exp(-6 * h);
      b.vx += ((tx - b.x) / 0.3 - b.vx) * k;
      b.vz += ((tz - b.z) / 0.3 - b.vz) * k;
      if (b.y < 0.35 && b.vy < 0) {
        b.y = BALL_R;
        b.vy = 0;
      }
      return;
    }
    if (this.closeControl(p)) {
      const off = 0.4 + speed * 0.07;
      const tx = p.x + fx * off;
      const tz = p.z + fz * off;
      const k = 1 - Math.exp(-14 * h);
      const nx = b.x + (tx - b.x) * k;
      const nz = b.z + (tz - b.z) * k;
      b.vx = (nx - b.x) / h;
      b.vz = (nz - b.z) / h;
      b.x = nx;
      b.z = nz;
      b.y = BALL_R;
      b.vy = 0;
      p.touchT += h;
      if (p.touchT > 0.45 && speed > 0.6) {
        p.touchT = 0;
        this.emit({ k: "touch" });
      }
      return;
    }
    p.touchT += h;
    const hx = speed > 0.5 ? p.vx / speed : fx;
    const hz = speed > 0.5 ? p.vz / speed : fz;
    const ahead = dx * hx + dz * hz;
    const interval = p.sprint ? 0.52 : 0.34;
    const turning = (p.dwx || p.dwz) && Math.abs(wrapAngle(Math.atan2(p.dwz, p.dwx) - Math.atan2(hz, hx))) > 0.6 && p.touchT > 0.12;
    if (dist < 0.95 && b.y < 0.5 && (ahead < 0.42 || p.touchT > interval || turning) && p.state !== "kick") {
      let tx = p.dwx || hx;
      let tz = p.dwz || hz;
      const want = Math.atan2(tz, tx);
      const cur = Math.atan2(hz, hx);
      const maxTurn = p.sprint ? 0.9 : 1.3;
      const rawDiff = wrapAngle(want - cur);
      const dragBack = Math.abs(rawDiff) > maxTurn + 0.25 && (Math.hypot(p.wx, p.wz) > 0.3 || Math.abs(b.z) > HALF_W - 4 || Math.abs(b.x) > HALF_L - 4);
      const diff = dragBack ? rawDiff : clamp(rawDiff, -maxTurn, maxTurn);
      const ang = cur + diff;
      tx = Math.cos(ang);
      tz = Math.sin(ang);
      const dri = p.info.stats.dri;
      const ratio = p.sprint ? 1.42 - dri * 0.0026 : 1.2 - dri * 0.0016;
      let sp = speed * ratio + 0.45 + this.rng.gauss() * (1 - dri / 100) * 0.4;
      if (dragBack) {
        sp = 0.6 + dri * 0.012;
        p.cool = 0;
      }
      b.vx = tx * sp;
      b.vz = tz * sp;
      b.vy = 0;
      if (ahead < 0.35) {
        b.x = p.x + tx * 0.42;
        b.z = p.z + tz * 0.42;
      }
      p.touchT = 0;
      this.emit({ k: "touch" });
    }
  }

  // ---------------------------------------------------------------- contacts

  private contacts(h: number): void {
    const b = this.ball;
    if (b.held) return;
    for (const p of this.players) {
      if (!p.queue || !this.active(p) || p.cool > 0) continue;
      if (p.state !== "run" && p.state !== "hold") continue;
      const dx = b.x - p.x;
      const dz = b.z - p.z;
      const d = Math.hypot(dx, dz);
      const mine = b.owner === p.id;
      const loose = b.owner < 0;
      if (!mine && !loose) continue;
      const footOk = d < 1.0 && b.y < 1.05;
      const headOk = d < 0.75 && b.y >= 1.05 && b.y < 2.5 && loose;
      if (footOk || headOk) {
        const q = p.queue;
        p.queue = null;
        if (loose) {
          if (this.offsideTouch(p)) return;
          this.gainPossession(p, true);
        }
        const plan = this.planHuman(p, q.kind, q.power, q.ax, q.az);
        this.strike(p, plan);
        return;
      }
    }
    const o = this.owner();
    if (o && !this.closeControl(o)) {
      const gap = Math.hypot(b.x - o.x, b.z - o.z);
      if (gap > 0.6) {
        for (const q of this.players) {
          if (q.team === o.team || !this.canAct(q) || q.cool > 0 || q.gk) continue;
          const d = Math.hypot(b.x - q.x, b.z - q.z);
          if (d < 0.5 && this.rng.chance(h * (4 + q.info.stats.def * 0.06))) {
            b.owner = -1;
            this.touchBall(q);
            return;
          }
        }
      }
    }
    if (b.owner >= 0) return;
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (!this.active(p) || p.cool > 0) continue;
      if (p.state !== "run" && p.state !== "hold" && p.state !== "stumble" && p.state !== "kick") continue;
      if (p.state === "kick" && p.st < 0.3) continue;
      if (b.freeTaker === p.id && b.kickT < 3 && b.restart) continue;
      const dx = b.x - p.x;
      const dz = b.z - p.z;
      const d = Math.hypot(dx, dz);
      const hands = p.gk && this.canHandle(p);
      const reach = hands ? 1.05 : 0.62;
      const maxH = hands ? 2.65 : 2.45;
      if (d > reach || b.y > maxH) continue;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) this.touchBall(best);
  }

  canHandle(p: Player): boolean {
    const b = this.ball;
    if (!p.gk || !this.inBox(p.team, b.x, b.z) || !this.inBox(p.team, p.x, p.z)) return false;
    if (b.lastTeam === p.team && b.backPass && b.lastId !== p.id) return false;
    return true;
  }

  private touchBall(p: Player): void {
    const b = this.ball;
    const relX = b.vx - p.vx;
    const relY = b.vy;
    const relZ = b.vz - p.vz;
    const rel = Math.hypot(relX, relY, relZ);
    const s = p.info.stats;
    if (p.gk && this.canHandle(p)) {
      if (b.shot && !b.shot.resolved && b.shot.team !== p.team) {
        const planned = p.planShot === b.shot;
        const ok = planned ? p.willSave : this.rng.chance(clamp(0.75 + (s.gk - 80) * 0.015 - Math.max(0, rel - 20) * 0.03, 0.15, 0.9));
        b.shot.resolved = true;
        if (!ok) {
          p.saveLock = 0.5;
          p.cool = 0.4;
          b.vx *= 0.95;
          b.vz += this.rng.gauss() * 0.8;
          return;
        }
        this.stats.saves[p.team] += 1;
        this.stats.onTarget[1 - p.team] += 1;
        this.emit({ k: "save", team: p.team });
      }
      const limit = 21 + (s.gk - 80) * 0.25;
      if (rel < limit && b.y < 2.5) {
        if (this.offsideTouch(p)) return;
        b.owner = p.id;
        b.held = true;
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        p.state = "hold";
        p.st = 0;
        this.gainPossession(p, false);
        return;
      }
      this.parry(p);
      return;
    }
    if (this.offsideTouch(p)) return;
    const head = b.y > 1.5;
    const chest = b.y > 0.75 && !head;
    let limit = head ? 8 + s.dri * 0.06 : chest ? 10 + s.dri * 0.07 : 12 + s.dri * 0.13;
    if (b.target === p.id) limit += 4;
    if (b.shot && b.shot.team !== p.team) limit -= 6;
    if (head) {
      const contested = this.nearestOpponent(p).dist < 1.8;
      const pd = this.depth(p.team, b.x);
      const attackBox = pd > 86 && Math.abs(b.z) < 18 && (b.kind === "cross" || b.lastTeam === p.team);
      const ownBox = pd < 22 && b.lastTeam !== p.team;
      const wantsHeader = !this.isHuman(p) && (attackBox || ownBox || contested || rel > limit);
      if (wantsHeader && this.ai[p.team].headerChoice(p)) return;
      if (rel > limit) {
        this.deflect(p, 0.35, true);
        return;
      }
    }
    if (rel <= limit) {
      b.owner = p.id;
      const fx = Math.cos(p.yaw);
      const fz = Math.sin(p.yaw);
      const heavy = (0.7 + rel * 0.045) * (1.3 - s.dri / 100);
      b.vx = p.vx + fx * heavy + this.rng.gauss() * heavy * 0.35;
      b.vz = p.vz + fz * heavy + this.rng.gauss() * heavy * 0.35;
      b.vy = b.y > BALL_R + 0.05 ? Math.min(0, b.vy * 0.15) : 0;
      this.gainPossession(p, false);
      return;
    }
    this.deflect(p, 0.32, false);
  }

  private deflect(p: Player, rest: number, head: boolean): void {
    const b = this.ball;
    let nx = b.x - p.x;
    let nz = b.z - p.z;
    const nl = Math.hypot(nx, nz);
    if (nl < 0.01) {
      nx = Math.cos(p.yaw);
      nz = Math.sin(p.yaw);
    } else {
      nx /= nl;
      nz /= nl;
    }
    this.debug?.("deflect", { id: p.id, team: p.team, target: b.target, kind: b.kind, rel: Math.hypot(b.vx - p.vx, b.vy, b.vz - p.vz), y: b.y, head });
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= (1 + rest) * vn * nx;
      b.vz -= (1 + rest) * vn * nz;
    }
    b.vx = b.vx * 0.55 + this.rng.gauss() * 1.2 + p.vx * 0.3;
    b.vz = b.vz * 0.55 + this.rng.gauss() * 1.2 + p.vz * 0.3;
    b.vy = head ? Math.abs(b.vy) * 0.3 + 1.5 : b.vy * 0.4;
    if (b.shot && b.shot.team !== p.team) {
      b.shot.resolved = true;
      this.emit({ k: "ooh" });
    }
    b.lastTeam = p.team;
    b.lastId = p.id;
    b.kind = "deflect";
    b.target = -1;
    b.backPass = false;
    this.lastTouchTeam = p.team;
    p.cool = 0.25;
    this.touchedBy(p);
  }

  private parry(p: Player): void {
    const b = this.ball;
    const out = this.attack[p.team];
    const side = Math.sign(b.z - p.z || this.rng.next() - 0.5);
    if (b.y > 2.0 && Math.abs(b.x) > HALF_L - 2) {
      b.vx = -out * this.rng.range(1, 3);
      b.vy = this.rng.range(3, 6);
      b.vz = side * this.rng.range(0.5, 2);
    } else if (p.state === "dive" && Math.abs(b.x) > HALF_L - 3 && this.rng.chance(0.45)) {
      const pz = Math.sign(b.z || side) * (GOAL_HALF_W + 1.5);
      b.vx = -out * this.rng.range(2, 5);
      b.vy = this.rng.range(0.5, 2.5);
      b.vz = (pz - b.z) * this.rng.range(2.5, 4);
    } else {
      b.vx = out * this.rng.range(3, 9);
      b.vy = this.rng.range(0.8, 4);
      b.vz = side * this.rng.range(3, 8);
    }
    b.lastTeam = p.team;
    b.lastId = p.id;
    b.kind = "save";
    b.target = -1;
    b.backPass = false;
    b.shot = null;
    this.lastTouchTeam = p.team;
    p.cool = 0.5;
    this.touchedBy(p);
  }

  gainPossession(p: Player, firstTime: boolean): void {
    const b = this.ball;
    const prevTeam = b.lastTeam;
    const wasPass = b.kind === "pass" || b.kind === "through" || b.kind === "lob" || b.kind === "cross" || b.kind === "throw" || b.kind === "gkthrow";
    this.debug?.("gain", { id: p.id, team: p.team, prevTeam, kind: b.kind, target: b.target, kickT: b.kickT });
    if (wasPass && prevTeam === p.team && b.lastId !== p.id && b.kickT < 6) this.stats.passesOk[p.team] += 1;
    if (b.shot && b.shot.team !== p.team && !b.shot.resolved) b.shot.resolved = true;
    b.owner = p.id;
    b.lastTeam = p.team;
    b.lastId = p.id;
    b.target = -1;
    b.kind = "touch";
    b.backPass = false;
    b.shot = null;
    b.restart = null;
    b.shooter = -1;
    b.penalty = false;
    this.lastTouchTeam = p.team;
    p.holdT = 0;
    p.touchT = 0;
    p.runT = 0;
    this.touchedBy(p);
    if (!firstTime) this.emit({ k: "touch" });
  }

  private touchedBy(p: Player): void {
    const b = this.ball;
    if (b.offside && p.team !== b.offTeam) b.offside = null;
    if (b.freeTaker >= 0 && b.freeTaker !== p.id) b.freeTaker = -1;
  }

  private offsideTouch(p: Player): boolean {
    const b = this.ball;
    if (!b.offside || b.offTeam !== p.team) return false;
    if (b.offside.includes(p.id)) {
      this.callOffside(p);
      return true;
    }
    b.offside = null;
    return false;
  }

  private snapshotOffside(kicker: Player): void {
    const b = this.ball;
    const team = kicker.team;
    const line = Math.max(this.secondLastDepth(1 - team, team), this.depth(team, b.x), HALF_L);
    const list: number[] = [];
    for (const q of this.players) {
      if (q.team !== team || !q.on || q.id === kicker.id) continue;
      if (this.depth(team, q.x) > line + 0.2) list.push(q.id);
    }
    b.offside = list.length ? list : null;
    b.offTeam = team;
  }

  private callOffside(p: Player): void {
    if (!this.useRules) {
      this.ball.offside = null;
      return;
    }
    this.stats.offsides[p.team] += 1;
    this.flagSide = p.x > 0 ? 1 : 2;
    const lin = this.refs[this.flagSide];
    lin.act = ACT.flag;
    lin.st = 0;
    this.emit({ k: "whistle", n: 1 });
    this.emit({ k: "banner", text: "Spalony", sub: p.name, tone: "offside" });
    this.ball.offside = null;
    this.stoppage("indirect", (1 - p.team) as 0 | 1, p.x, p.z, 2.0);
  }

  // ---------------------------------------------------------------- keeper

  private keeperReact(p: Player, h: number): void {
    const b = this.ball;
    if (this.mode !== "play" || p.state === "dive" || p.saveLock > 0) return;
    if (b.penalty && this.isHuman(p)) return;
    if (b.owner >= 0 || b.held || !b.shot || b.shot.team === p.team || b.shot.resolved) {
      p.react = 0;
      return;
    }
    const gx = this.ownGoalX(p.team);
    const sgn = Math.sign(gx);
    if (b.vx * sgn < 5) return;
    const tPlane = (p.x - b.x) / b.vx;
    if (tPlane < -0.05 || tPlane > 1.8) return;
    const pred = { x: 0, y: 0, z: 0 };
    simulateFlight(b, Math.max(0.01, tPlane), pred);
    const tGoal = (gx - b.x) / b.vx;
    const predG = { x: 0, y: 0, z: 0 };
    simulateFlight(b, Math.max(0.01, tGoal), predG);
    const onTarget = Math.abs(predG.z) < GOAL_HALF_W + 0.25 && predG.y < GOAL_H + 0.3;
    if (!onTarget) return;
    p.react += h;
    const reaction = this.ai[p.team].gkReaction(p);
    if (p.react < reaction || p.planShot === b.shot) return;
    p.planShot = b.shot;
    const py = Math.max(BALL_R, pred.y);
    const dz = pred.z - p.z;
    const dx = pred.x - p.x;
    const lateral = Math.hypot(dx, dz);
    const need = Math.hypot(lateral, Math.max(0, py - 1.7) * 0.9);
    const gk = p.info.stats.gk;
    const time = Math.max(0, tPlane);
    const reach = 0.95 + clamp(time - 0.05, 0, 0.6) * (6.0 + (gk - 80) * 0.08);
    const ratio = need / reach;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const bonus = (gk - 82) * 0.01 + this.ai[p.team].saveBonus;
    const pSave =
      ratio >= 1.3
        ? 0
        : ratio >= 1
          ? clamp((0.22 + bonus) * (1.3 - ratio) / 0.3, 0, 0.3)
          : clamp(0.98 - Math.pow(ratio, 3) * 0.78 - Math.max(0, speed - 26) * 0.016 + bonus, 0.05, 0.98);
    p.willSave = this.rng.chance(pSave);
    if (need < 0.6) {
      p.runX = pred.x;
      p.runZ = pred.z;
      p.runT = 0.3;
      return;
    }
    p.state = "dive";
    p.st = 0;
    p.dur = 1.35;
    const l = lateral || 1;
    p.dirX = dx / l;
    p.dirZ = dz / l;
    const flight = Math.max(0.12, time - 0.04);
    let sp = clamp((lateral - 0.95) / (flight * 0.82), 1.2, 9 + (gk - 80) * 0.06);
    if (!p.willSave) sp *= this.rng.range(0.45, 0.72);
    p.speed0 = sp;
    p.aa = clamp(py, 0.15, 2.4);
    p.yaw = Math.atan2(b.z - p.z, b.x - p.x);
  }

  diveContact(p: Player): void {
    const b = this.ball;
    if (p.state !== "dive" || p.st > (this.isHuman(p) ? 1.05 : 0.75) || b.owner >= 0 || b.held) return;
    if (!this.inBox(p.team, b.x, b.z)) return;
    const reach = 1.05 + (p.info.stats.gk - 80) * 0.006;
    const hx = p.x + p.dirX * reach;
    const hz = p.z + p.dirZ * reach;
    const hy = p.aa;
    const ax = p.x;
    const ay = 0.35;
    const az = p.z;
    const sx = hx - ax;
    const sy = hy - ay;
    const sz = hz - az;
    const sl = sx * sx + sy * sy + sz * sz || 1;
    const t = clamp(((b.x - ax) * sx + (b.y - ay) * sy + (b.z - az) * sz) / sl, 0, 1);
    const cx = ax + sx * t;
    const cy = ay + sy * t;
    const cz = az + sz * t;
    const d = Math.hypot(b.x - cx, b.y - cy, b.z - cz);
    const shotLive = b.shot && b.shot.team !== p.team && !b.shot.resolved;
    const humanSave = this.isHuman(p) && p.willSave;
    if (d > (shotLive && (p.willSave || humanSave) ? (humanSave ? 0.9 : 0.62) : 0.4)) return;
    const rel = Math.hypot(b.vx - p.vx, b.vy, b.vz - p.vz);
    if (shotLive && b.shot) {
      b.shot.resolved = true;
      if (!(p.willSave && (p.planShot === b.shot || humanSave))) {
        if (this.rng.chance(0.3)) {
          b.vx *= 0.9;
          b.vz += this.rng.gauss() * 1.2;
          b.vy += 0.5;
        }
        p.saveLock = 1;
        return;
      }
      this.stats.saves[p.team] += 1;
      this.stats.onTarget[1 - p.team] += 1;
      this.emit({ k: "save", team: p.team });
    }
    if (rel < 17 + (p.info.stats.gk - 80) * 0.2 && t < 0.7 && this.canHandle(p)) {
      b.owner = p.id;
      b.held = true;
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      this.gainPossession(p, false);
      return;
    }
    this.parry(p);
  }

  // ---------------------------------------------------------------- rules

  private rules(): void {
    const b = this.ball;
    for (const p of this.players) if (p.gk && p.state === "dive") this.diveContact(p);
    if (this.mode !== "play") return;
    if (!b.inField) {
      if (Math.abs(b.z) < HALF_W - BALL_R && Math.abs(b.x) < HALF_L) {
        b.inField = true;
      } else {
        b.outT += H;
        if (b.outT > 1.2 || b.y <= BALL_R + 0.01) {
          const team = this.lastTouchTeam;
          b.inField = true;
          this.emit({ k: "banner", text: "Aut", sub: "powtórka wyrzutu", tone: "info" });
          this.stoppage("throwin", team, b.x, b.z, 0.8);
        }
        return;
      }
    }
    if (Math.abs(b.z) > SIDE_LINE && !(Math.abs(b.x) > HALF_L)) {
      const team = (1 - this.lastTouchTeam) as 0 | 1;
      this.emit({ k: "banner", text: "Aut", sub: "", tone: "info" });
      this.ball.owner = -1;
      this.ball.held = false;
      this.stoppage("throwin", team, b.x, b.z, 1.1);
      return;
    }
    if (Math.abs(b.x) > OUT_LINE) {
      const sign = Math.sign(b.x);
      const inGoal = Math.abs(b.z) < GOAL_HALF_W - 0.02 && b.y < GOAL_H - 0.02;
      const defending = (this.ownGoalX(0) * sign > 0 ? 0 : 1) as 0 | 1;
      const attacking = (1 - defending) as 0 | 1;
      b.owner = -1;
      b.held = false;
      if (inGoal) {
        const shooter = b.shooter >= 0 && this.teamOf(b.shooter) === attacking ? b.shooter : -1;
        if (shooter >= 0 && !(b.shot && b.shot.resolved && this.lastTouchTeam === defending)) this.stats.onTarget[attacking] += 1;
        const own = shooter < 0 && this.lastTouchTeam === defending;
        this.goal(attacking, own, b.lastId, shooter);
        return;
      }
      if (this.lastTouchTeam === defending) {
        this.stats.corners[attacking] += 1;
        this.stoppage("corner", attacking, sign * HALF_L, b.z, 1.4);
      } else {
        this.stoppage("goalkick", defending, sign * HALF_L, b.z, 1.4);
      }
      return;
    }
  }

  private goal(team: 0 | 1, own: boolean, lastId: number, shooter: number): void {
    const scorerId = own ? lastId : shooter >= 0 && this.teamOf(shooter) === team ? shooter : lastId >= 0 && this.teamOf(lastId) === team ? lastId : -1;
    const minute = Math.min(this.half === 1 ? 45 : 90, Math.floor((this.clock / this.halfLen) * 45) + (this.half === 2 ? 45 : 0) + 1);
    this.score[team] += 1;
    const pen = this.ball.penalty && shooter >= 0;
    this.goals.push({ team, id: scorerId, minute, own, pen });
    this.goalPending = { team, own };
    this.mode = "goal";
    this.modeT = 0;
    this.restart = null;
    this.ball.shot = null;
    this.ball.target = -1;
    this.emit({ k: "goal", team, id: scorerId });
    const name = scorerId >= 0 ? this.players[scorerId].name : "";
    this.emit({ k: "banner", text: own ? "Samobój!" : "GOL!", sub: `${name} ${minute}'`, tone: "goal" });
    const celebrant = own ? -1 : scorerId;
    this.replaySkip = false;
    for (const p of this.players) {
      if (!p.on) continue;
      p.queue = null;
      if (p.team === team) {
        p.state = "celebrate";
        p.st = 0;
        p.aa = p.id === celebrant ? this.celebrationStyle(p) : 0;
      } else if (p.state !== "fallen" && p.state !== "off") {
        p.state = "run";
      }
    }
    this.celebrant = celebrant;
  }

  /** Signature celebrations for a few stars, otherwise a random pick (see CELEBRATION in shared/state). */
  private celebrationStyle(p: Player): number {
    const own = SIGNATURE_CELEBRATION[p.info.name];
    if (own !== undefined && this.rng.chance(0.65)) return own;
    const pool: number[] = [CELEBRATION.kneeSlide, CELEBRATION.airplane, CELEBRATION.jumpSpin, CELEBRATION.badgeKiss, CELEBRATION.roar, CELEBRATION.pointSky, CELEBRATION.cupEar, CELEBRATION.armsWide];
    if (p.info.stats.pac >= 85 && p.info.look.height < 1.84) pool.push(CELEBRATION.backflip);
    return pool[Math.floor(this.rng.next() * pool.length)];
  }

  celebrant = -1;
  debug: ((tag: string, data: Record<string, unknown>) => void) | null = null;

  // ---------------------------------------------------------------- officials

  private officials(h: number): void {
    const b = this.ball;
    const ref = this.refs[0];
    ref.st += h;
    let tx: number;
    let tz: number;
    if ((this.mode === "stoppage" || this.mode === "setpiece") && this.refFocus) {
      const r = this.restart;
      if (this.mode === "setpiece" && r && (r.kind === "freekick" || r.kind === "indirect") && Math.hypot(this.goalX(r.team) - r.x, r.z) < 32) {
        const gx = this.goalX(r.team);
        const dx = gx - r.x;
        const dz = -r.z;
        const dl = Math.hypot(dx, dz) || 1;
        tx = r.x + (dx / dl) * 9.15 - (dz / dl) * 2.5;
        tz = r.z + (dz / dl) * 9.15 + (dx / dl) * 2.5;
      } else if (this.mode === "setpiece" && r?.kind === "penalty") {
        tx = r.x - this.attack[r.team] * 2.5;
        tz = 6;
      } else {
        tx = this.refFocus.x - Math.sign(this.refFocus.x || 1) * 3;
        tz = this.refFocus.z + (this.refFocus.z > 0 ? -3.5 : 3.5);
      }
    } else if (this.mode === "kickoff") {
      tx = ref.x;
      tz = ref.z;
    } else {
      const play = this.possessionTeam() >= 0 ? this.attack[this.possessionTeam()] : Math.sign(b.vx || 1);
      tx = b.x - play * 9;
      tz = b.z > 0 ? b.z - 14 : b.z + 14;
      tz = clamp(tz, -26, 26);
      tx = clamp(tx, -40, 40);
    }
    for (const p of this.players) {
      if (!p.on) continue;
      const d = Math.hypot(p.x - ref.x, p.z - ref.z);
      if (d < 3) {
        tx += ((ref.x - p.x) / (d || 1)) * 2;
        tz += ((ref.z - p.z) / (d || 1)) * 2;
      }
    }
    const db = Math.hypot(b.x - tx, b.z - tz);
    if (db < 5 && this.mode === "play") {
      tx += ((tx - b.x) / (db || 1)) * (5 - db);
      tz += ((tz - b.z) / (db || 1)) * (5 - db);
    }
    this.moveOfficial(ref, tx, tz, 7.2, h, b.x, b.z);
    if (ref.act === ACT.card && ref.st > 2.2) ref.act = ACT.run;
    if (ref.act === ACT.card && this.pendingCard) {
      const p = this.players[this.pendingCard.id];
      ref.yaw = Math.atan2(p.z - ref.z, p.x - ref.x);
    }
    for (let i = 1; i <= 2; i += 1) {
      const lin = this.refs[i];
      lin.st += h;
      const half = i === 1 ? 1 : -1;
      const zLine = i === 1 ? HALF_W + 1.3 : -HALF_W - 1.3;
      let lx = 0;
      for (let t = 0; t < 2; t += 1) {
        const ownX = this.ownGoalX(t);
        if (Math.sign(ownX) !== half) continue;
        const line = this.secondLastDepth(t, 1 - t);
        lx = this.worldX(1 - t, line);
        const bx = b.x;
        if (Math.sign(bx) === half && Math.abs(bx) > Math.abs(lx)) lx = bx;
      }
      lx = half > 0 ? clamp(lx, 0, HALF_L) : clamp(lx, -HALF_L, 0);
      this.moveOfficial(lin, lx, zLine, 6.5, h, b.x, b.z);
      if (lin.act === ACT.flag && lin.st > 2.4) lin.act = ACT.run;
    }
  }

  private moveOfficial(o: Official, tx: number, tz: number, top: number, h: number, lookX: number, lookZ: number): void {
    const dx = tx - o.x;
    const dz = tz - o.z;
    const d = Math.hypot(dx, dz);
    const want = Math.min(top, d * 1.4);
    const tvx = d > 0.05 ? (dx / d) * want : 0;
    const tvz = d > 0.05 ? (dz / d) * want : 0;
    const k = 1 - Math.exp(-3 * h);
    o.vx += (tvx - o.vx) * k;
    o.vz += (tvz - o.vz) * k;
    o.x += o.vx * h;
    o.z += o.vz * h;
    const sp = Math.hypot(o.vx, o.vz);
    const look = sp > 3 ? Math.atan2(o.vz, o.vx) : Math.atan2(lookZ - o.z, lookX - o.x);
    if (o.act !== ACT.card) o.yaw = turnToward(o.yaw, look, 5 * h);
  }

  // ---------------------------------------------------------------- views

  private actOf(p: Player): { act: number; aa: number } {
    switch (p.state) {
      case "kick":
        return { act: ACT.kick, aa: p.aa };
      case "volley":
        return { act: ACT.volley, aa: p.aa };
      case "header":
        return { act: ACT.header, aa: p.aa };
      case "slide":
        return { act: ACT.slide, aa: 0 };
      case "fallen":
        return { act: ACT.fallen, aa: (p.aa >= 0 ? 1 : -1) * p.dur };
      case "dive": {
        const rx = -Math.sin(p.yaw);
        const rz = Math.cos(p.yaw);
        const side = p.dirX * rx + p.dirZ * rz >= 0 ? 1 : -1;
        return { act: ACT.dive, aa: side * (1 + clamp(p.aa, 0, 2.5) / 2.5) };
      }
      case "celebrate":
        return { act: ACT.celebrate, aa: p.aa };
      case "throwin":
        return { act: ACT.throwin, aa: this.mode === "play" ? 1 : 0 };
      case "tackle":
        return { act: ACT.tackle, aa: 0 };
      case "hold":
        return { act: ACT.hold, aa: 0 };
      case "stumble":
        return { act: ACT.stumble, aa: 0 };
      case "off":
        return { act: ACT.off, aa: 0 };
      case "wait":
        return { act: ACT.wait, aa: 0 };
      default:
        if (p.jockey) return { act: ACT.jockey, aa: 0 };
        if (p.gk && Math.hypot(p.vx, p.vz) < 1.5 && this.mode === "play" && Math.abs(this.ball.x - this.ownGoalX(p.team)) < 30 && this.possessionTeam() !== p.team) return { act: ACT.gkset, aa: 0 };
        return { act: ACT.run, aa: 0 };
    }
  }

  toView(): MatchView {
    const players: PlayerView[] = this.players.map((p) => {
      const a = this.actOf(p);
      return { x: round3(p.x), z: round3(p.z), yaw: round3(p.yaw), vx: round2(p.vx), vz: round2(p.vz), act: a.act, at: round2(p.st), aa: round2(a.aa), on: p.on };
    });
    const refs: PlayerView[] = this.refs.map((o) => ({ x: round3(o.x), z: round3(o.z), yaw: round3(o.yaw), vx: round2(o.vx), vz: round2(o.vz), act: o.act, at: round2(o.st), aa: o.aa, on: true }));
    const b = this.ball;
    return {
      ball: [round3(b.x), round3(b.y), round3(b.z)],
      ballV: [round2(b.vx), round2(b.vy), round2(b.vz)],
      owner: b.owner,
      held: b.held,
      players,
      refs,
      control: [this.control[0], this.control[1]],
      charge: [round2(this.chargeOf(0)), round2(this.chargeOf(1))],
      chargeKind: [this.chargeKind(0), this.chargeKind(1)],
      score: [this.score[0], this.score[1]],
      clock: round2(this.clock),
      halfLen: this.halfLen,
      half: this.half,
      mode: this.mode,
      attack: [this.attack[0], this.attack[1]],
      restart: this.restart?.kind ?? null,
      restartTeam: this.restart?.team ?? -1,
      cut: this.cut,
      cards: this.players.map((p) => (p.sent ? 2 : p.yellow > 0 ? 1 : 0)),
      goals: this.goals.slice(),
      stats: this.stats,
      aim: [0, 0, 0, 0],
      rules: this.useRules,
      seats: this.seats.map((s) => ({
        slot: s.slot,
        team: s.team,
        player: s.player,
        color: s.color,
        name: s.name,
        cd: round2(s.handsCd),
        hold: round2(s.handsLeft),
        charge: round2(s.charge.kind ? clamp(s.charge.t / (s.charge.kind === "shoot" ? 1.15 : 1), 0, 1) : -1),
        chargeKind: s.charge.kind === "shoot" ? 1 : s.charge.kind === "pass" ? 2 : s.charge.kind === "through" ? 3 : s.charge.kind === "lob" ? 4 : 0,
      })),
    };
  }
}
