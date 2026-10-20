import { Match } from "../client/src/game/sim/Match";
import type { ClubId } from "../shared/clubs";

const clubs: ClubId[] = ["real", "barca", "city", "liverpool", "bayern", "psg", "juve", "atleti"];
const games = Number(process.argv[2] ?? 4);
const halfMinutes = Number(process.argv[3] ?? 6);
const level = Number(process.argv[4] ?? 2);
const totals: Record<string, number> = {};
const add = (k: string, v: number) => (totals[k] = (totals[k] ?? 0) + v);

for (let g = 0; g < games; g += 1) {
  const left = clubs[g % clubs.length];
  const right = clubs[(g + 3) % clubs.length];
  const m = new Match({ leftClub: left, rightClub: right, humans: [false, false], halfMinutes, difficulty: level, seed: 1234 + g * 77 });
  const modes: Record<string, number> = {};
  const banners: Record<string, number> = {};
  let still = 0;
  let maxStill = 0;
  let nan = false;
  let speedSum = 0;
  let speedN = 0;
  let steps = 0;
  const started = Date.now();
  while (m.mode !== "fulltime" && steps < 200000) {
    m.step(1 / 60, [null, null]);
    steps += 1;
    modes[m.mode] = (modes[m.mode] ?? 0) + 1 / 60;
    for (const e of m.pullEvents()) {
      if (e.k === "banner") banners[e.text] = (banners[e.text] ?? 0) + 1;
      if (e.k === "replay") m.skipReplay();
    }
    const b = m.ball;
    if (!Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz)) nan = true;
    for (const p of m.players) {
      if (!Number.isFinite(p.x + p.z + p.vx + p.vz + p.yaw)) nan = true;
      if (m.mode === "play" && p.on && !p.gk) {
        speedSum += Math.hypot(p.vx, p.vz);
        speedN += 1;
      }
    }
    if (m.mode === "play" && Math.hypot(b.vx, b.vz) < 0.2 && b.owner < 0) still += 1 / 60;
    else still = 0;
    maxStill = Math.max(maxStill, still);
  }
  const s = m.stats;
  const poss = s.possession[0] / Math.max(1, s.possession[0] + s.possession[1]);
  console.log(
    `${left} ${m.score[0]}:${m.score[1]} ${right} | strzały ${s.shots.join("/")} celne ${s.onTarget.join("/")} | podania ${s.passesOk[0]}/${s.passes[0]} ${s.passesOk[1]}/${s.passes[1]} | posiadanie ${(poss * 100).toFixed(0)}% | faule ${s.fouls.join("/")} żółte ${s.yellows.join("/")} czerwone ${s.reds.join("/")} | rożne ${s.corners.join("/")} spalone ${s.offsides.join("/")} obrony ${s.saves.join("/")}`,
  );
  console.log(
    `   tryby ${Object.entries(modes)
      .map(([k, v]) => `${k}:${v.toFixed(0)}s`)
      .join(" ")} | komunikaty ${JSON.stringify(banners)} | stoi piłka max ${maxStill.toFixed(1)}s | śr. prędkość ${(speedSum / Math.max(1, speedN)).toFixed(2)} | NaN ${nan} | ${Date.now() - started}ms`,
  );
  console.log(`   gole ${m.goals.map((x) => `${m.players[x.id]?.name ?? "?"} ${x.minute}'${x.own ? " (sam.)" : ""}${x.pen ? " (k)" : ""}`).join(", ")}`);
  add("goals", m.score[0] + m.score[1]);
  add("shots", s.shots[0] + s.shots[1]);
  add("onTarget", s.onTarget[0] + s.onTarget[1]);
  add("passes", s.passes[0] + s.passes[1]);
  add("passesOk", s.passesOk[0] + s.passesOk[1]);
  add("fouls", s.fouls[0] + s.fouls[1]);
  add("offsides", s.offsides[0] + s.offsides[1]);
  add("corners", s.corners[0] + s.corners[1]);
}
console.log("na mecz:", Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, (v / games).toFixed(1)])));
