import { pickKits, type Club } from "../../shared/clubs";
import type { LobbyState, RulesMode, SideName } from "../../shared/protocol";
import { ROSTERS, SLOT_POS, shortName, teamRatings } from "../../shared/rosters";
import type { MatchEvent, MatchView } from "../../shared/state";
import { HALF_L, HALF_W } from "./game/math";
import { crestDataUrl } from "./render/textures";
import { CAMS, DIFFICULTY, HALF_OPTIONS, QUALITY, type Settings } from "./settings";

export interface Chip {
  id: string;
  label: string;
  side: SideName | null;
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

export function updateHtml(current: string, next: string, notes: string, busy: string, error: string): string {
  const status = busy || error;
  return `<section class="menu-card">
    <p class="eyebrow">Aktualizacja</p>
    <h2>Nowa wersja</h2>
    <p class="lead">Masz ${esc(current)}, a dostępna jest ${esc(next)}. Zainstalować ją teraz? Gra się zamknie i uruchomi instalator.</p>
    ${notes ? `<p class="help">${esc(notes)}</p>` : ""}
    ${status ? `<p id="update-status" class="${error ? "note" : "help"}">${esc(status)}</p><div class="update-bar"><em id="update-bar-fill"></em></div>` : `<p id="update-status" class="help" hidden></p>`}
    ${busy ? "" : `<div class="stack">
      <button data-act="update-yes">Zaktualizuj</button>
      ${error ? `<button data-act="update-open" class="ghost">Otwórz stronę wydania</button>` : ""}
      <button data-act="update-no" class="ghost">Nie teraz</button>
    </div>`}
  </section>`;
}

export function toast(message: string): void {
  const host = document.getElementById("toasts");
  if (!host) return;
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  host.append(item);
  window.setTimeout(() => item.remove(), 3200);
}

const crestCache = new Map<string, string>();
function crest(club: Club, size = 96): string {
  const key = `${club.id}:${size}`;
  let url = crestCache.get(key);
  if (!url) {
    url = crestDataUrl(club.crest, size);
    crestCache.set(key, url);
  }
  return url;
}

export function matchClock(v: Pick<MatchView, "clock" | "halfLen" | "half">): { main: string; extra: string } {
  const base = (v.half - 1) * 45 * 60;
  const t = (v.clock / v.halfLen) * 45 * 60;
  const capped = Math.min(t, 45 * 60);
  const total = Math.floor(base + capped);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const over = t - 45 * 60;
  return { main: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, extra: over > 0 ? `+${Math.max(1, Math.ceil(over / 60))}` : "" };
}

export function menuHtml(): string {
  return `<div class="menu-main">
    <div class="brand"><span class="brand-top">FC 27</span><span class="brand-sub">Poor Edition</span></div>
    <nav class="main-nav">
      <button data-act="local" class="tile hero"><b>Szybki mecz</b><small>Z botem albo we dwóch na jednym ekranie</small></button>
      <button data-act="free" class="tile"><b>Bez zasad</b><small>Bez fauli, kartek i spalonych</small></button>
      <button data-act="online" class="tile"><b>Online</b><small>Stwórz pokój albo wpisz kod kolegi</small></button>
      <button data-act="settings" class="tile"><b>Ustawienia</b><small>Czas, poziom, kamera, grafika</small></button>
      <button data-act="controls" class="tile"><b>Sterowanie</b><small>Klawiatura, mysz i pad</small></button>
    </nav>
  </div>`;
}

export function gateHtml(note: string, busy: boolean): string {
  const off = busy ? "disabled" : "";
  return `<div class="menu-wrap"><section class="menu-card">
    <p class="eyebrow">Online</p>
    <h1>Pokój</h1>
    <p class="lead">Bez kont i bez serwera. Kto stworzy pokój, ten jest hostem: mecz liczy jego komputer, a on dostaje kod z 6 cyfr. Do jednego meczu może wejść do 8 osób.</p>
    <label>Twoja nazwa<input id="nick" name="name" maxlength="16" autocomplete="nickname" placeholder="np. Tymek" required ${off} /></label>
    <div class="stack"><button data-act="host" ${off}>Stwórz pokój</button></div>
    <form data-form="join">
      <label>Kod pokoju<input name="code" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required ${off} /></label>
      <button type="submit" ${off}>Dołącz</button>
    </form>
    ${note ? `<p class="note">${esc(note)}</p>` : ""}
    <p class="help">Przy dołączaniu dostajesz swój kolor. Tryb meczu (z zasadami albo bez) ustawia host w pokoju.</p>
    <div class="stack"><button data-act="back" class="ghost" type="button">Wróć</button></div>
  </section></div>`;
}

function chipHtml(chip: Chip): string {
  return `<span class="chip">${esc(chip.label)}</span>`;
}

function personChip(name: string, color: string, you: boolean): string {
  return `<span class="chip"><i class="dot" style="background:${esc(color)}"></i>${esc(you ? `Ty · ${name}` : name)}</span>`;
}

function onlineChips(lobby: LobbyState | null, side: SideName | null, you: number): string {
  if (!lobby) return "";
  return lobby.players
    .filter((person) => person.side === side)
    .map((person) => personChip(person.name, person.color, person.slot === you))
    .join("");
}

function rulesToggle(rules: RulesMode, host: boolean): string {
  const lock = host ? "" : "disabled";
  return `<div class="modes">
    <button data-act="rules" data-arg="full" class="${rules === "full" ? "on" : ""}" ${lock}>Zasady</button>
    <button data-act="rules" data-arg="free" class="${rules === "free" ? "on" : ""}" ${lock}>Bez zasad</button>
  </div>
  <p class="help">${rules === "free" ? "Bez fauli, kartek i spalonych. Auty, rożne i gole zostają." : "Pełne zasady: faule, kartki, spalone, karne."}</p>`;
}

export function sidesHtml(opts: { online: boolean; lobby: LobbyState | null; chips: Chip[]; note: string; canAdvance: boolean; host: boolean; you?: number; rules?: RulesMode }): string {
  const you = opts.you ?? 0;
  const leftChips = opts.online ? onlineChips(opts.lobby, "left", you) : opts.chips.filter((c) => c.side === "left").map(chipHtml).join("");
  const rightChips = opts.online ? onlineChips(opts.lobby, "right", you) : opts.chips.filter((c) => c.side === "right").map(chipHtml).join("");
  const midChips = opts.online ? onlineChips(opts.lobby, null, you) : opts.chips.filter((c) => c.side === null).map(chipHtml).join("");
  const code = opts.lobby?.code ?? "";
  const waiting = opts.online && (opts.lobby?.players.length ?? 0) < 2;
  return `<div class="sides">
    <div class="half left" data-act="assign" data-arg="left">
      <div><p class="kicker">Gospodarze</p><strong>LEWA</strong></div>
      <div class="slot">${leftChips || '<span class="chip bot">Bot</span>'}</div>
    </div>
    <div class="center-col">
      ${
        opts.online && code
          ? `<p class="kicker">Kod pokoju</p><div class="code">${esc(code)}</div>${rulesToggle(opts.lobby?.rules ?? "full", opts.host)}<p class="help">${
              waiting ? "Podaj ten kod kolegom (do 8 osób). Kolorowa kropka to kolor gracza." : "A / D albo lewy drążek wybiera stronę. Na jednej stronie może stanąć kilka osób."
            }</p>`
          : `<p class="kicker">Urządzenia</p><p class="help">A / D przesuwa klawiaturę WASD, strzałki ← → przesuwają klawiaturę strzałek, drążek swój pad. W dół wraca na środek. Pusta strona to bot. Dwie osoby mogą grać na jednej klawiaturze.</p>${rulesToggle(opts.rules ?? "full", true)}`
      }
      <div class="slot">${midChips}</div>
      ${opts.note ? `<p class="note">${esc(opts.note)}</p>` : ""}
      ${!opts.online || opts.host ? `<button data-act="advance" ${opts.canAdvance ? "" : "disabled"}>Dalej</button>` : `<p class="help">Czekam, aż host przejdzie dalej.</p>`}
      <button data-act="back" class="ghost">Wróć</button>
    </div>
    <div class="half right" data-act="assign" data-arg="right">
      <div><p class="kicker">Goście</p><strong>PRAWA</strong></div>
      <div class="slot">${rightChips || '<span class="chip bot">Bot</span>'}</div>
    </div>
  </div>`;
}

function ratingBar(label: string, v: number): string {
  return `<div class="rate"><span>${label}</span><i><em style="width:${Math.max(0, Math.min(100, (v - 50) * 2))}%"></em></i><b>${v}</b></div>`;
}

function lineup(club: Club): string {
  return ROSTERS[club.id]
    .map((p, i) => `<li><span class="pos">${SLOT_POS[i]}</span><span class="num">${p.num}</span><span class="nm">${esc(shortName(p))}</span><span class="ovr">${p.ovr}</span></li>`)
    .join("");
}

export function clubsHtml(opts: {
  left: Club;
  right: Club;
  focus: SideName;
  leftLabel: string;
  rightLabel: string;
  canStart: boolean;
  help: string;
  rules?: RulesMode;
  rulesHost?: boolean;
  allowLeft: boolean;
  allowRight: boolean;
  settings: Settings;
}): string {
  const kits = pickKits(opts.left, opts.right);
  const card = (side: SideName, club: Club, label: string, allow: boolean, kitShirt: string) => {
    const r = teamRatings(club.id);
    return `<article class="club-card ${side} ${opts.focus === side ? "focus" : ""}" data-act="focus" data-arg="${side}" style="--club:${kitShirt}">
      <header>
        <img class="crest" src="${crest(club)}" alt="" />
        <div><p class="kicker">${esc(label)}</p><h2>${esc(club.name)}</h2><p class="stadium">${esc(club.stadium)}</p></div>
      </header>
      <div class="ratings">${ratingBar("ATA", r.att)}${ratingBar("POM", r.mid)}${ratingBar("OBR", r.def)}<div class="ovr-big">${r.ovr}<small>OVR</small></div></div>
      <ol class="xi">${lineup(club)}</ol>
      ${allow ? `<div class="arrows"><button data-act="cycle" data-arg="${side}:-1">◀</button><button data-act="cycle" data-arg="${side}:1">▶</button></div>` : ""}
    </article>`;
  };
  const s = opts.settings;
  return `<div class="clubs">
    ${card("left", opts.left, opts.leftLabel, opts.allowLeft, kits[0].shirt)}
    <div class="club-actions">
      <p class="eyebrow">Wybór drużyn</p>
      <p class="vs">VS</p>
      <p class="help">${esc(opts.help)}</p>
      <div class="quick">
        <span>${s.halfMinutes} min połowa</span><span>${esc(DIFFICULTY[s.difficulty])}</span>
      </div>
      ${opts.rules ? rulesToggle(opts.rules, opts.rulesHost !== false) : ""}
      ${opts.canStart ? `<button data-act="start">${opts.rules === "free" ? "Graj bez zasad" : "Graj"}</button>` : `<p class="help">Czekam na hosta.</p>`}
      <button data-act="settings" class="ghost">Ustawienia</button>
      <button data-act="back" class="ghost">Wróć</button>
    </div>
    ${card("right", opts.right, opts.rightLabel, opts.allowRight, kits[1].shirt)}
  </div>`;
}

function seg<T extends string | number>(name: string, value: T, options: Array<[T, string]>): string {
  return `<div class="seg" role="group">${options
    .map(([v, label]) => `<button type="button" class="${v === value ? "on" : ""}" data-act="set" data-arg="${name}:${v}">${esc(label)}</button>`)
    .join("")}</div>`;
}

export function settingsHtml(s: Settings, inMatch: boolean): string {
  return `<section class="menu-card wide settings">
    <p class="eyebrow">Ustawienia</p>
    <h2>Mecz i grafika</h2>
    <div class="set-grid">
      <label>Długość połowy</label>${
        inMatch ? `<p class="help">${s.halfMinutes} min (zmiana od następnego meczu)</p>` : seg("half", s.halfMinutes, HALF_OPTIONS.map((m) => [m, `${m} min`] as [number, string]))
      }
      <label>Poziom trudności</label>${inMatch ? `<p class="help">${esc(DIFFICULTY[s.difficulty])}</p>` : seg("diff", s.difficulty, DIFFICULTY.map((d, i) => [i, d] as [number, string]))}
      <label>Kamera</label>${seg("cam", s.cam, CAMS)}
      <label>Grafika</label>${seg("quality", s.quality, QUALITY)}
      <label>Pora</label>${seg("night", s.night ? "1" : "0", [
        ["1", "Wieczór, jupitery"],
        ["0", "Dzień"],
      ])}
      <label>Głośność</label><input type="range" min="0" max="100" step="5" value="${Math.round(s.volume * 100)}" data-input="volume" />
      <label>Podpowiedzi</label>${seg("hints", s.hints ? "1" : "0", [
        ["1", "Pokazuj"],
        ["0", "Ukryj"],
      ])}
    </div>
    <div class="stack"><button data-act="close-settings">Gotowe</button></div>
  </section>`;
}

export function controlsHtml(): string {
  const rows: Array<[string, string, string, string]> = [
    ["Ruch", "W A S D", "strzałki", "Lewy drążek"],
    ["Sprint", "lewy Shift", "; / prawy Shift", "RT / RB"],
    ["Podanie (przytrzymaj = mocniej)", "X / lewy przycisk myszy", "K", "A"],
    ["Strzał (przytrzymaj = mocniej)", "C / prawy przycisk myszy", "L", "B"],
    ["Prostopadła", "Spacja", "I", "Y"],
    ["Górne podanie, dośrodkowanie", "F / środkowy przycisk", "J", "X"],
    ["Wślizg", "E", "O", "X (bez piłki)"],
    ["Odbiór stojąc", "C (bez piłki)", "L (bez piłki)", "B (bez piłki)"],
    ["Pressing przy rywalu", "przytrzymaj X (bez piłki)", "przytrzymaj K (bez piłki)", "przytrzymaj A (bez piłki)"],
    ["Krycie bokiem (jockey)", "lewy Ctrl", "M / prawy Ctrl", "LT"],
    ["Zmiana zawodnika", "Q", "U", "LB"],
    ["Piłka w rękach (co 40 s, na 5 s)", "R", "P", "R3"],
    ["Obrona karnego", "ruch w górę i w dół, potem strzał albo wślizg", "to samo", "ruch + B albo X"],
    ["Celowanie", "mysz na boisku albo kierunek ruchu", "kierunek ruchu", "lewy lub prawy drążek"],
    ["Pomiń powtórkę", "Enter", "Enter", "A"],
    ["Pauza", "Esc", "Esc", "Start"],
  ];
  return `<section class="menu-card wide controls">
    <p class="eyebrow">Sterowanie</p>
    <h2>Jak grać</h2>
    <table><thead><tr><th></th><th>Klawiatura WASD + mysz</th><th>Klawiatura: strzałki</th><th>Pad</th></tr></thead><tbody>
    ${rows.map(([a, b, c, d]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td><td>${esc(d)}</td></tr>`).join("")}
    </tbody></table>
    <p class="help">Kto gra sam na klawiaturze, może używać obu zestawów klawiszy naraz. Gdy grają dwie osoby na jednej klawiaturze, każda ma swoją połowę.</p>
    <p class="help">Siłę podania i strzału ładujesz przytrzymaniem i puszczasz przycisk. Wciśnięcie zanim dobiegniesz do piłki daje zagranie z pierwszej. Strzał z bliska w róg ma mniejszy pasek, z daleka większy. Zawodnik w biegu nie skręci w miejscu: przy szybkim biegu musi przyhamować.</p>
    <div class="stack"><button data-act="close-controls">Zamknij</button></div>
  </section>`;
}

export function pauseHtml(guest: boolean): string {
  return `<section class="menu-card"><p class="eyebrow">${guest ? "Online" : "Pauza"}</p><h2>${guest ? "Menu" : "Mecz zatrzymany"}</h2>
    ${guest ? `<p class="lead">Mecz dalej liczy komputer hosta.</p>` : ""}
    <div class="stack">
      <button data-act="resume">${guest ? "Zamknij" : "Wznów"}</button>
      <button data-act="settings" class="ghost">Ustawienia</button>
      <button data-act="controls" class="ghost">Sterowanie</button>
      <button data-act="quit" class="ghost">Wyjdź do menu</button>
    </div></section>`;
}

export function statsHtml(v: MatchView, clubs: [Club, Club], final: boolean, canRematch: boolean): string {
  const s = v.stats;
  const pos = s.possession[0] + s.possession[1] || 1;
  const p0 = Math.round((s.possession[0] / pos) * 100);
  const acc = (t: number) => (s.passes[t] ? Math.round((s.passesOk[t] / s.passes[t]) * 100) : 0);
  const row = (label: string, a: number | string, b: number | string, na: number, nb: number) => {
    const sum = na + nb || 1;
    return `<div class="srow"><b>${a}</b><span>${label}<i><em class="l" style="width:${(na / sum) * 100}%"></em><em class="r" style="width:${(nb / sum) * 100}%"></em></i></span><b>${b}</b></div>`;
  };
  const scorers = (team: 0 | 1) =>
    v.goals
      .filter((g) => g.team === team)
      .map((g) => {
        const who = g.id >= 0 ? esc(shortName(ROSTERS[clubs[g.id < 11 ? 0 : 1].id][g.id % 11])) : "";
        return `<li>${who}${g.own ? " (sam.)" : ""} ${g.minute}'${g.pen ? " (k)" : ""}</li>`;
      })
      .join("");
  return `<section class="menu-card wide stats">
    <p class="eyebrow">${final ? "Koniec meczu" : "Przerwa"}</p>
    <div class="final">
      <div><img src="${crest(clubs[0], 72)}" alt="" /><span>${esc(clubs[0].name)}</span><ul>${scorers(0)}</ul></div>
      <p class="big-score">${v.score[0]} : ${v.score[1]}</p>
      <div><img src="${crest(clubs[1], 72)}" alt="" /><span>${esc(clubs[1].name)}</span><ul>${scorers(1)}</ul></div>
    </div>
    <div class="slist">
      ${row("Posiadanie", `${p0}%`, `${100 - p0}%`, p0, 100 - p0)}
      ${row("Strzały", s.shots[0], s.shots[1], s.shots[0], s.shots[1])}
      ${row("Celne", s.onTarget[0], s.onTarget[1], s.onTarget[0], s.onTarget[1])}
      ${row("Podania", s.passes[0], s.passes[1], s.passes[0], s.passes[1])}
      ${row("Celność podań", `${acc(0)}%`, `${acc(1)}%`, acc(0), acc(1))}
      ${row("Odbiory", s.tackles[0], s.tackles[1], s.tackles[0], s.tackles[1])}
      ${row("Faule", s.fouls[0], s.fouls[1], s.fouls[0], s.fouls[1])}
      ${row("Żółte kartki", s.yellows[0], s.yellows[1], s.yellows[0], s.yellows[1])}
      ${row("Czerwone kartki", s.reds[0], s.reds[1], s.reds[0], s.reds[1])}
      ${row("Rzuty rożne", s.corners[0], s.corners[1], s.corners[0], s.corners[1])}
      ${row("Spalone", s.offsides[0], s.offsides[1], s.offsides[0], s.offsides[1])}
      ${row("Obrony bramkarza", s.saves[0], s.saves[1], s.saves[0], s.saves[1])}
    </div>
    ${final ? `<div class="stack row">${canRematch ? `<button data-act="rematch">Rewanż</button>` : ""}<button data-act="quit" class="${canRematch ? "ghost" : ""}">Menu</button></div>` : `<p class="help">Druga połowa za chwilę…</p>`}
  </section>`;
}

export function hudHtml(left: Club, right: Club): string {
  const kits = pickKits(left, right);
  return `<div class="hud">
    <div class="scorebug">
      <div class="sb-clock"><span id="sb-time">00:00</span><span id="sb-extra" class="hidden"></span></div>
      <div class="sb-team l" style="--kit:${kits[0].shirt};--kit2:${kits[0].pattern === "solid" ? kits[0].trim : kits[0].alt}"><img src="${crest(left, 48)}" alt="" /><span>${esc(left.short)}</span><div id="cards-l" class="cardrow"></div></div>
      <div class="sb-score"><span id="sb-l">0</span><span id="sb-r">0</span></div>
      <div class="sb-team r" style="--kit:${kits[1].shirt};--kit2:${kits[1].pattern === "solid" ? kits[1].trim : kits[1].alt}"><span>${esc(right.short)}</span><img src="${crest(right, 48)}" alt="" /><div id="cards-r" class="cardrow"></div></div>
    </div>
    <div id="ev" class="ev"></div>
    <div id="goalfx" class="goalfx"><b>GOL!</b><span id="goal-who"></span></div>
    <div id="replay" class="replay hidden"><b>POWTÓRKA</b><span>Enter / A – pomiń</span></div>
    <canvas id="radar" class="radar" width="236" height="152"></canvas>
    <div id="tag0" class="ptag hidden"><span class="nm"></span><i class="pw"><em></em></i></div>
    <div id="tag1" class="ptag p2 hidden"><span class="nm"></span><i class="pw"><em></em></i></div>
    <div id="hint" class="hint"></div>
    <div id="hands" class="hands"></div>
    <div id="rules-tag" class="rules-tag hidden">Bez zasad</div>
  </div><div id="overlay"></div>`;
}

const EVENT_TONES: Record<string, string> = { info: "", yellow: "yellow", red: "red", goal: "goal", offside: "offside" };

export class Hud {
  private evTimer = 0;
  private goalTimer = 0;
  private hintTimer = 0;
  private sig = "";
  private radarCtx: CanvasRenderingContext2D | null = null;
  private colors: [string, string] = ["#2f8cff", "#ff3b3b"];
  private clubs: [Club, Club];

  constructor(clubs: [Club, Club], hint: string) {
    this.clubs = clubs;
    const kits = pickKits(clubs[0], clubs[1]);
    this.colors = [kits[0].shirt, kits[1].shirt];
    const canvas = document.getElementById("radar") as HTMLCanvasElement | null;
    this.radarCtx = canvas?.getContext("2d") ?? null;
    const h = document.getElementById("hint");
    if (h && hint) {
      h.textContent = hint;
      this.hintTimer = 14;
    }
  }

  event(e: MatchEvent, v: MatchView | null): void {
    if (e.k === "banner") {
      if (e.tone === "goal") return;
      const el = document.getElementById("ev");
      if (!el) return;
      el.className = `ev show ${EVENT_TONES[e.tone] ?? ""}`;
      el.innerHTML = `<b>${esc(e.text)}</b>${e.sub ? `<span>${esc(e.sub)}</span>` : ""}`;
      this.evTimer = 2.8;
    }
    if (e.k === "goal" && v) {
      const team = e.team;
      const g = v.goals[v.goals.length - 1];
      const name = e.id >= 0 ? shortName(ROSTERS[this.clubs[e.id < 11 ? 0 : 1].id][e.id % 11]) : "";
      const el = document.getElementById("goalfx");
      const who = document.getElementById("goal-who");
      if (who) who.textContent = `${name}${g ? ` ${g.minute}'` : ""}${g?.own ? " (samobójczy)" : ""}${g?.pen ? " (karny)" : ""}`;
      if (el) {
        el.style.setProperty("--goal", this.colors[team]);
        el.classList.add("show");
      }
      this.goalTimer = 3.2;
    }
  }

  update(v: MatchView, dt: number, replay: boolean, tags: Array<{ x: number; y: number; on: boolean; name: string; charge: number; kind: number; show: boolean }>): void {
    const clock = matchClock(v);
    const sig = `${v.score[0]}:${v.score[1]}:${clock.main}:${clock.extra}:${v.cards.join("")}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const set = (id: string, text: string) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      set("sb-time", clock.main);
      set("sb-l", String(v.score[0]));
      set("sb-r", String(v.score[1]));
      const ex = document.getElementById("sb-extra");
      if (ex) {
        ex.textContent = clock.extra;
        ex.classList.toggle("hidden", !clock.extra);
      }
      for (const t of [0, 1]) {
        const el = document.getElementById(t === 0 ? "cards-l" : "cards-r");
        if (!el) continue;
        const cards = v.cards.slice(t * 11, t * 11 + 11);
        el.innerHTML = cards.map((c) => (c === 1 ? '<i class="yc"></i>' : c === 2 ? '<i class="rc"></i>' : "")).join("");
      }
    }
    if (this.evTimer > 0) {
      this.evTimer -= dt;
      if (this.evTimer <= 0) document.getElementById("ev")?.classList.remove("show");
    }
    if (this.goalTimer > 0) {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) document.getElementById("goalfx")?.classList.remove("show");
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) document.getElementById("hint")?.classList.add("gone");
    }
    document.getElementById("replay")?.classList.toggle("hidden", !replay);
    document.getElementById("rules-tag")?.classList.toggle("hidden", v.rules);
    const hands = document.getElementById("hands");
    if (hands) {
      hands.innerHTML = v.seats
        .map((s) => {
          const n = s.hold > 0 ? Math.ceil(s.hold) : s.cd > 0 ? Math.ceil(s.cd) : 0;
          return `<i class="${s.hold > 0 ? "hold" : ""}" style="background:${esc(s.color)}" title="${esc(s.name)}">${n}</i>`;
        })
        .join("");
    }
    const hud = document.querySelector(".hud");
    tags.forEach((tag, i) => {
      let el = document.getElementById(`tag${i}`);
      if (!el && hud) {
        el = document.createElement("div");
        el.id = `tag${i}`;
        el.className = "ptag hidden";
        el.innerHTML = `<span class="nm"></span><i class="pw"><em></em></i>`;
        hud.append(el);
      }
      if (!el) return;
      const show = tag.show && tag.on && !replay;
      el.classList.toggle("hidden", !show);
      if (!show) return;
      el.style.transform = `translate(${Math.round(tag.x)}px, ${Math.round(tag.y)}px)`;
      const nm = el.querySelector(".nm");
      if (nm && nm.textContent !== tag.name) nm.textContent = tag.name;
      const bar = el.querySelector(".pw") as HTMLElement | null;
      const fill = el.querySelector(".pw em") as HTMLElement | null;
      if (bar && fill) {
        bar.classList.toggle("on", tag.charge >= 0);
        fill.style.width = `${Math.max(0, tag.charge) * 100}%`;
        fill.dataset.kind = String(tag.kind);
      }
    });
    for (let i = tags.length; i < 8; i += 1) document.getElementById(`tag${i}`)?.classList.add("hidden");
    this.radar(v, replay);
  }

  private radar(v: MatchView, replay: boolean): void {
    const g = this.radarCtx;
    if (!g) return;
    const W = 236;
    const H = 152;
    g.clearRect(0, 0, W, H);
    if (replay || v.mode === "halftime" || v.mode === "fulltime") return;
    const m = 8;
    const sx = (W - m * 2) / (HALF_L * 2);
    const sz = (H - m * 2) / (HALF_W * 2);
    const X = (x: number) => m + (x + HALF_L) * sx;
    const Z = (z: number) => m + (z + HALF_W) * sz;
    g.fillStyle = "rgba(10,30,18,0.62)";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 1;
    g.strokeRect(X(-HALF_L), Z(-HALF_W), HALF_L * 2 * sx, HALF_W * 2 * sz);
    g.beginPath();
    g.moveTo(X(0), Z(-HALF_W));
    g.lineTo(X(0), Z(HALF_W));
    g.stroke();
    g.beginPath();
    g.arc(X(0), Z(0), 9.15 * sx, 0, Math.PI * 2);
    g.stroke();
    for (const s of [-1, 1]) g.strokeRect(Math.min(X(s * HALF_L), X(s * (HALF_L - 16.5))), Z(-20.16), 16.5 * sx, 40.32 * sz);
    v.players.forEach((p, i) => {
      if (!p.on) return;
      const t = i < 11 ? 0 : 1;
      const seat = v.seats.find((s) => s.player === i);
      const ctrl = Boolean(seat);
      g.fillStyle = seat?.color ?? this.colors[t];
      g.strokeStyle = ctrl ? "#ffffff" : "rgba(0,0,0,0.6)";
      g.lineWidth = ctrl ? 2 : 1;
      g.beginPath();
      g.arc(X(p.x), Z(p.z), ctrl ? 4.4 : 3.4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(X(v.ball[0]), Z(v.ball[2]), 2.6, 0, Math.PI * 2);
    g.fill();
  }
}
