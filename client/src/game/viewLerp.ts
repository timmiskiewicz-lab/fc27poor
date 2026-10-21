import type { MatchView, PlayerView } from "../../../shared/state";
import { lerp, lerpAngle } from "./math";

function lerpPlayer(a: PlayerView, b: PlayerView, t: number): PlayerView {
  const same = a.act === b.act;
  return {
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    vx: lerp(a.vx, b.vx, t),
    vz: lerp(a.vz, b.vz, t),
    act: t < 0.5 ? a.act : b.act,
    at: same ? lerp(a.at, b.at, t) : t < 0.5 ? a.at : b.at,
    aa: t < 0.5 ? a.aa : b.aa,
    on: t < 0.5 ? a.on : b.on,
  };
}

/** Blends positions and continuous values; discrete state comes from whichever side is nearer. */
export function lerpView(a: MatchView, b: MatchView, t: number): MatchView {
  const near = t < 0.5 ? a : b;
  const teleport = a.cut !== b.cut || a.half !== b.half;
  const k = teleport ? (t < 0.5 ? 0 : 1) : t;
  return {
    ...near,
    ball: [lerp(a.ball[0], b.ball[0], k), lerp(a.ball[1], b.ball[1], k), lerp(a.ball[2], b.ball[2], k)],
    ballV: [lerp(a.ballV[0], b.ballV[0], k), lerp(a.ballV[1], b.ballV[1], k), lerp(a.ballV[2], b.ballV[2], k)],
    players: a.players.map((p, i) => lerpPlayer(p, b.players[i] ?? p, k)),
    refs: a.refs.map((p, i) => lerpPlayer(p, b.refs[i] ?? p, k)),
    clock: lerp(a.clock, b.clock, k),
    charge: [lerp(a.charge[0], b.charge[0], k), lerp(a.charge[1], b.charge[1], k)],
    seats: near.seats.map((s) => {
      const from = a.seats.find((q) => q.slot === s.slot);
      const to = b.seats.find((q) => q.slot === s.slot);
      if (!from || !to || from.player !== to.player) return s;
      return { ...s, cd: lerp(from.cd, to.cd, k), hold: lerp(from.hold, to.hold, k), charge: lerp(from.charge, to.charge, k) };
    }),
  };
}
