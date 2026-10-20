import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@fontsource/barlow-condensed/700-italic.css";
import "@fontsource/barlow-condensed/800-italic.css";
import "@fontsource-variable/outfit";
import * as THREE from "three";
import { CLUBS, clubById, type Club, type ClubId } from "../../shared/clubs";
import type { InputMsg, LobbyState, ServerMsg, SideName } from "../../shared/protocol";
import { ROSTERS, shortName } from "../../shared/rosters";
import type { MatchEvent, MatchView } from "../../shared/state";
import * as audio from "./audio";
import {
  arrowsDevice,
  attachInput,
  consumeEscape,
  consumeFocusToggle,
  consumeMenuConfirm,
  keyboardBusy,
  keyboardDevice,
  keyboardFlick,
  listPads,
  mouseAiming,
  mousePosition,
  padBusy,
  pollMenuPads,
  readKeyboardInput,
  readPadInput,
  sanitizeInput,
  swallowEdges,
  type DeviceInfo,
  type MenuPadState,
} from "./game/input";
import { HALF_L } from "./game/math";
import { Match } from "./game/sim/Match";
import { EMPTY_INPUT, type InputFrame } from "./game/types";
import { GuestView } from "./net/GuestView";
import { P2PNet, netErrorText } from "./net/p2p";
import { World } from "./render/world";
import { HALF_OPTIONS, loadSettings, saveSettings, type Settings } from "./settings";
import {
  Hud,
  clubsHtml,
  controlsHtml,
  gateHtml,
  hudHtml,
  menuHtml,
  pauseHtml,
  settingsHtml,
  sidesHtml,
  statsHtml,
  toast,
  type Chip,
} from "./ui";

type Screen = "loading" | "menu" | "gate" | "sides" | "clubs" | "match";
type Overlay = "none" | "pause" | "half" | "full";
type Modal = "none" | "settings" | "controls";
type ButtonKey = "pass" | "shoot" | "through" | "lob" | "slide" | "switchP" | "skip";

const BUTTONS: ButtonKey[] = ["pass", "shoot", "through", "lob", "slide", "switchP", "skip"];
const MARK_P1 = "#36a3ff";
const MARK_P2 = "#ff4d5e";

const ui = document.getElementById("ui") as HTMLElement;
const modalEl = document.getElementById("modal") as HTMLElement;
const canvas = document.getElementById("view") as HTMLCanvasElement;

class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world: World;
  private settings: Settings = loadSettings();
  private screen: Screen = "loading";
  private modal: Modal = "none";
  private overlay: Overlay = "none";
  private net: P2PNet | null = null;
  private connecting: P2PNet | null = null;
  private role: "host" | "guest" | null = null;
  private lobby: LobbyState | null = null;
  private online = false;
  private note = "";
  private readonly sides = new Map<string, SideName | null>();
  private clubIndex: [number, number] = [0, 1];
  private focus: SideName = "left";
  private match: Match | null = null;
  private guest: GuestView | null = null;
  private hud: Hud | null = null;
  private clubs: [Club, Club] = [CLUBS[0], CLUBS[1]];
  private humans: [boolean, boolean] = [false, false];
  private devices: [string | null, string | null] = [null, null];
  private yourSide: SideName = "left";
  private remoteLatest: InputFrame = { ...EMPTY_INPUT };
  private remoteLatch = new Set<ButtonKey>();
  private remoteSeq = 0;
  private seq = 1;
  private sendAcc = 0;
  private snapAcc = 0;
  private outbox: MatchEvent[] = [];
  private lastView: MatchView | null = null;
  private uiSig = "";
  private activePad: number | null = null;
  private knownPads = new Set<string>();
  private padsReady = false;
  private navIdx = -1;
  private crowd = 0.3;
  private last = performance.now();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.world = new World(this.renderer);
    this.applyWorldSettings();
    const fit = () => this.world.resize(window.innerWidth, window.innerHeight);
    fit();
    window.addEventListener("resize", fit);
    audio.setVolume(this.settings.volume);
    attachInput(canvas);
    window.addEventListener(
      "keydown",
      (event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLButtonElement) event.preventDefault();
      },
      true,
    );
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!target) return;
      if (target instanceof HTMLButtonElement) target.blur();
      this.act(target.dataset.act ?? "", target.dataset.arg ?? "");
    };
    ui.addEventListener("click", onClick);
    modalEl.addEventListener("click", onClick);
    modalEl.addEventListener("input", (event) => {
      const el = event.target as HTMLInputElement;
      if (el.dataset.input === "volume") {
        this.settings.volume = Number(el.value) / 100;
        audio.setVolume(this.settings.volume);
        saveSettings(this.settings);
      }
    });
    ui.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      const data = new FormData(form);
      if (form.dataset.form === "join") void this.joinRoom(String(data.get("code") ?? ""));
    });
    ui.innerHTML = `<div class="loading"><div class="spinner"></div><p>Ładowanie stadionu i zawodników…</p></div>`;
    this.world.ready
      .then(() => {
        this.screen = "menu";
        this.syncUi(true);
      })
      .catch((error: unknown) => {
        console.error(error);
        ui.innerHTML = `<div class="loading"><p>Nie udało się wczytać modelu zawodnika (models/player.glb).</p></div>`;
      });
    requestAnimationFrame((now) => this.frame(now));
    if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = { app: this, world: this.world };
  }

  private applyWorldSettings(): void {
    this.world.applySettings({ quality: this.settings.quality, night: this.settings.night, camera: this.settings.cam });
  }

  // ---------------------------------------------------------------- loop

  private frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      this.update(dt);
    } catch (error) {
      console.error(error);
    }
    requestAnimationFrame((next) => this.frame(next));
  }

  private update(dt: number): void {
    if (this.screen === "loading") return;
    this.watchPads();
    const pads = pollMenuPads();
    const esc = consumeEscape() || pads.some((p) => p.back && this.modal !== "none");
    if (this.modal !== "none") {
      if (esc) this.closeModal();
      else this.navigate(pads);
    } else if (this.screen === "match") {
      if (esc && this.overlay !== "full" && this.overlay !== "half") this.togglePause();
      else if (pads.some((p) => p.start) && this.overlay !== "full" && this.overlay !== "half") this.togglePause();
      else if (this.overlay === "pause" && pads.some((p) => p.back)) this.togglePause(false);
      else if (this.overlay === "pause" || this.overlay === "full") this.navigate(pads);
    } else if (esc || pads.some((p) => p.back)) {
      this.back();
    } else if (this.screen === "sides") this.pollSides(pads);
    else if (this.screen === "clubs") this.pollClubs(pads);
    else this.navigate(pads);

    if (this.screen === "match") this.tickMatch(dt);
    else {
      if (this.screen === "clubs") this.world.setClubs(this.currentClub("left"), this.currentClub("right"), false);
      this.world.update(dt, this.screen === "clubs" ? "clubs" : "menu", null, [false, false]);
      this.world.render();
    }
  }

  // ---------------------------------------------------------------- menu navigation

  private navRoot(): HTMLElement | null {
    if (this.modal !== "none") return modalEl;
    if (this.screen === "match") return this.overlay === "pause" || this.overlay === "full" ? document.getElementById("overlay") : null;
    if (this.screen === "menu" || this.screen === "gate") return ui;
    return null;
  }

  private navigate(pads: MenuPadState[]): void {
    const root = this.navRoot();
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), input"));
    if (!items.length) return;
    let dir = 0;
    let confirm = false;
    let side = 0;
    const flick = keyboardFlick();
    if (flick === "up") dir = -1;
    if (flick === "down") dir = 1;
    if (flick === "left") side = -1;
    if (flick === "right") side = 1;
    if (consumeMenuConfirm()) confirm = true;
    for (const p of pads) {
      if (p.flick === "up") dir = -1;
      if (p.flick === "down") dir = 1;
      if (p.flick === "left") side = -1;
      if (p.flick === "right") side = 1;
      if (p.confirm) confirm = true;
    }
    const current = this.navIdx >= 0 && this.navIdx < items.length ? items[this.navIdx] : null;
    if (side !== 0 && current instanceof HTMLInputElement && current.type === "range") {
      current.value = String(Math.max(0, Math.min(100, Number(current.value) + side * 5)));
      current.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (side !== 0) dir = side;
    if (dir !== 0) {
      this.navIdx = this.navIdx < 0 ? 0 : (this.navIdx + dir + items.length) % items.length;
      audio.playUi();
    }
    items.forEach((el, i) => el.classList.toggle("nav", i === this.navIdx));
    if (confirm) {
      const el = items[Math.max(0, this.navIdx)];
      if (el instanceof HTMLInputElement) el.focus();
      else el.click();
    }
  }

  private resetNav(): void {
    this.navIdx = -1;
  }

  // ---------------------------------------------------------------- actions

  private act(action: string, arg: string): void {
    audio.playUi();
    this.resetNav();
    switch (action) {
      case "local":
        this.online = false;
        this.role = null;
        this.lobby = null;
        this.note = "";
        this.sides.clear();
        this.screen = "sides";
        this.syncUi(true);
        return;
      case "online":
        this.note = "";
        this.screen = "gate";
        this.syncUi(true);
        return;
      case "settings":
        this.modal = "settings";
        this.paintModal();
        return;
      case "controls":
        this.modal = "controls";
        this.paintModal();
        return;
      case "close-settings":
      case "close-controls":
        this.closeModal();
        return;
      case "set":
        this.changeSetting(arg);
        return;
      case "back":
        this.back();
        return;
      case "host":
        void this.hostRoom();
        return;
      case "assign": {
        const side = arg === "left" || arg === "right" ? arg : null;
        if (!side) return;
        if (this.online) this.net?.send({ t: "side", side });
        else this.assignDevice("keyboard", side);
        return;
      }
      case "advance":
        this.advance();
        return;
      case "focus":
        if (arg === "left" || arg === "right") this.focus = arg;
        this.syncUi(true);
        return;
      case "cycle": {
        const [side, dir] = arg.split(":");
        if ((side === "left" || side === "right") && dir) this.cycle(side, Number(dir));
        return;
      }
      case "start":
        this.startMatch();
        return;
      case "resume":
        this.togglePause(false);
        return;
      case "rematch":
        if (!this.online) this.beginMatch(this.clubs[0].id, this.clubs[1].id);
        return;
      case "quit":
        this.quitMatch();
        return;
    }
  }

  private changeSetting(arg: string): void {
    const [name, raw] = arg.split(":");
    const s = this.settings;
    if (name === "half" && HALF_OPTIONS.includes(Number(raw))) s.halfMinutes = Number(raw);
    if (name === "diff") s.difficulty = Math.max(0, Math.min(3, Number(raw)));
    if (name === "cam" && (raw === "tv" || raw === "wide" || raw === "pro")) s.cam = raw;
    if (name === "quality" && (raw === "low" || raw === "high" || raw === "ultra")) s.quality = raw;
    if (name === "night") s.night = raw === "1";
    if (name === "hints") s.hints = raw === "1";
    if (name === "cam" || name === "quality" || name === "night") this.applyWorldSettings();
    saveSettings(s);
    this.paintModal();
    if (this.screen === "clubs") this.syncUi(true);
  }

  private paintModal(): void {
    if (this.modal === "none") {
      modalEl.innerHTML = "";
      modalEl.classList.remove("on");
      return;
    }
    modalEl.classList.add("on");
    modalEl.innerHTML = this.modal === "settings" ? settingsHtml(this.settings, this.screen === "match") : controlsHtml();
  }

  private closeModal(): void {
    this.modal = "none";
    this.resetNav();
    this.paintModal();
    swallowEdges();
  }

  // ---------------------------------------------------------------- online

  private openNet(role: "host" | "guest"): P2PNet {
    this.dropNet();
    const net = new P2PNet(
      (msg) => {
        if (this.net === net) this.onNet(msg);
      },
      () => {
        if (this.net === net) this.net = null;
      },
    );
    this.net = net;
    this.role = role;
    return net;
  }

  private dropNet(): void {
    this.net?.close();
    this.net = null;
    this.connecting = null;
    this.lobby = null;
    this.role = null;
    this.online = false;
  }

  private async withNet(role: "host" | "guest", note: string, open: (net: P2PNet) => Promise<unknown>): Promise<void> {
    if (this.connecting) return;
    const net = this.openNet(role);
    this.connecting = net;
    this.note = note;
    this.syncUi(true);
    try {
      await open(net);
    } catch (error) {
      if (this.net === net) {
        this.dropNet();
        toast(netErrorText(error));
      }
    } finally {
      if (this.connecting === net) this.connecting = null;
      if (this.note === note) this.note = "";
      this.syncUi(true);
    }
  }

  private hostRoom(): Promise<void> {
    return this.withNet("host", "Tworzę pokój…", (net) => net.host());
  }

  private joinRoom(raw: string): Promise<void> {
    const code = raw.replace(/\D/g, "");
    if (code.length !== 6) {
      toast("Kod pokoju ma 6 cyfr.");
      return Promise.resolve();
    }
    return this.withNet("guest", `Łączę z pokojem ${code}…`, (net) => net.join(code));
  }

  private leaveRoom(): void {
    this.net?.send({ t: "leave" });
    this.dropNet();
  }

  private onNet(msg: ServerMsg): void {
    switch (msg.t) {
      case "err":
        toast(msg.message);
        return;
      case "lobby": {
        this.lobby = msg.lobby;
        this.online = true;
        const me = this.role === "host" ? msg.lobby.host : msg.lobby.guest;
        if (me?.side) this.yourSide = me.side;
        if (msg.lobby.phase === "sides" && this.screen !== "match") this.screen = "sides";
        if (msg.lobby.phase === "clubs" && this.screen !== "match") this.screen = "clubs";
        if (this.screen !== "match") this.syncUi(true);
        return;
      }
      case "begin":
        this.yourSide = msg.you;
        this.role = msg.role;
        this.online = true;
        this.humans = [true, true];
        this.beginMatch(msg.leftClub, msg.rightClub, msg.halfMinutes, msg.difficulty);
        return;
      case "peerInput":
        this.takeRemote(msg.input);
        return;
      case "snap":
        if (!this.guest || this.screen !== "match") return;
        this.guest.push(msg.at, msg.v);
        for (const e of msg.ev ?? []) this.onEvent(e, msg.v);
        return;
      case "paused":
        toast(msg.paused ? "Host zatrzymał mecz." : "Host wznowił mecz.");
        return;
      case "peerLeft":
        if (this.role === "host" && this.match && this.screen === "match") {
          const team = this.yourSide === "left" ? 1 : 0;
          this.match.humans[team] = false;
          this.humans[team] = false;
          this.remoteLatest = { ...EMPTY_INPUT };
          toast("Gość wyszedł. Jego drużyna gra teraz jako bot.");
          return;
        }
        if (this.lobby || this.screen === "match") toast(this.role === "guest" ? "Host zamknął pokój." : "Gość wyszedł.");
        this.dropNet();
        this.endMatchState();
        this.screen = "gate";
        this.syncUi(true);
    }
  }

  private takeRemote(msg: InputMsg): void {
    if (typeof msg.seq !== "number" || msg.seq <= this.remoteSeq) return;
    this.remoteSeq = msg.seq;
    const f = sanitizeInput(msg.f);
    for (const k of BUTTONS) if (f[k]) this.remoteLatch.add(k);
    this.remoteLatest = f;
  }

  private remoteFrame(): InputFrame {
    const f = { ...this.remoteLatest };
    for (const k of this.remoteLatch) f[k] = true;
    this.remoteLatch.clear();
    return f;
  }

  // ---------------------------------------------------------------- navigation between screens

  private back(): void {
    this.resetNav();
    if (this.screen === "clubs" && !this.online) {
      this.screen = "sides";
      this.syncUi(true);
      return;
    }
    if ((this.screen === "sides" || this.screen === "clubs") && this.online) {
      this.leaveRoom();
      this.screen = "gate";
      this.syncUi(true);
      return;
    }
    if (this.screen === "gate") {
      this.toMenu();
      return;
    }
    this.screen = "menu";
    this.syncUi(true);
  }

  private endMatchState(): void {
    this.match = null;
    this.guest = null;
    this.hud = null;
    this.overlay = "none";
    this.modal = "none";
    this.paintModal();
    audio.stopCrowd();
  }

  private toMenu(): void {
    this.dropNet();
    this.endMatchState();
    this.screen = "menu";
    this.syncUi(true);
  }

  private quitMatch(): void {
    if (this.online) {
      this.leaveRoom();
      this.endMatchState();
      this.screen = "gate";
      this.syncUi(true);
      return;
    }
    this.toMenu();
  }

  // ---------------------------------------------------------------- devices

  private watchPads(): void {
    const pads = listPads();
    if (!this.padsReady) {
      pads.forEach((pad) => this.knownPads.add(pad.id));
      this.padsReady = true;
      return;
    }
    let changed = false;
    const live = new Set(pads.map((pad) => pad.id));
    for (const pad of pads) {
      if (!this.knownPads.has(pad.id)) {
        this.knownPads.add(pad.id);
        changed = true;
        toast(`Podłączono ${pad.label}.`);
      }
    }
    for (const id of [...this.knownPads]) {
      if (!live.has(id)) {
        this.knownPads.delete(id);
        changed = true;
        if (this.screen === "match") toast("Pad odłączony.");
      }
    }
    if (changed && (this.screen === "sides" || this.screen === "clubs")) this.syncUi(true);
  }

  private localDevices(): DeviceInfo[] {
    return [keyboardDevice(), arrowsDevice(), ...listPads()];
  }

  /** Each keyboard half only gets its own keys when both halves are in play. */
  private splitKeyboard(): boolean {
    return Boolean(this.sides.get("keyboard") && this.sides.get("keys2"));
  }

  /** Keyboard flicks per device: WASD drives "keyboard", arrows drive "keys2"; a lone keyboard half hears both. */
  private keyboardFlicks(split: boolean): Array<[string, ReturnType<typeof keyboardFlick>]> {
    if (split || this.splitKeyboard()) return [["keyboard", keyboardFlick("wasd")], ["keys2", keyboardFlick("arrows")]];
    return [[this.sides.get("keys2") ? "keys2" : "keyboard", keyboardFlick()]];
  }

  private refreshDevices(): void {
    const devices = this.localDevices();
    for (const id of [...this.sides.keys()]) if (!devices.some((d) => d.id === id)) this.sides.delete(id);
    for (const d of devices) if (!this.sides.has(d.id)) this.sides.set(d.id, null);
  }

  private assignDevice(id: string, side: SideName | null): void {
    if (side) {
      for (const [other, taken] of this.sides) {
        if (other !== id && taken === side) {
          this.note = "Ta strona jest już zajęta.";
          this.syncUi(true);
          return;
        }
      }
    }
    this.sides.set(id, side);
    this.note = "";
    audio.playUi();
    this.syncUi(true);
  }

  private pollSides(pads: MenuPadState[]): void {
    const confirm = consumeMenuConfirm();
    if (this.online) {
      const flick = keyboardFlick();
      if (flick === "left" || flick === "right") this.net?.send({ t: "side", side: flick });
      if (flick === "down") this.net?.send({ t: "side", side: null });
      for (const pad of pads) {
        if (pad.flick === "left" || pad.flick === "right") this.net?.send({ t: "side", side: pad.flick });
        if (pad.flick === "down") this.net?.send({ t: "side", side: null });
        if (pad.confirm && this.role === "host") this.advance();
      }
      if (confirm && this.role === "host") this.advance();
      return;
    }
    this.refreshDevices();
    for (const [id, f] of this.keyboardFlicks(true)) if (f === "left" || f === "right" || f === "down") this.assignDevice(id, f === "down" ? null : f);
    for (const pad of pads) {
      if (pad.flick === "left" || pad.flick === "right" || pad.flick === "down") this.assignDevice(`pad:${pad.index}`, pad.flick === "down" ? null : pad.flick);
      if (pad.confirm) this.advance();
    }
    if (confirm) this.advance();
  }

  private advance(): void {
    if (this.online) {
      this.net?.send({ t: "advance" });
      return;
    }
    let left: string | null = null;
    let right: string | null = null;
    for (const [id, side] of this.sides) {
      if (side === "left") left = id;
      if (side === "right") right = id;
    }
    if (!left && !right) {
      this.note = "Przesuń klawiaturę albo pad na lewą lub prawą stronę.";
      this.syncUi(true);
      return;
    }
    this.devices = [left, right];
    this.humans = [Boolean(left), Boolean(right)];
    this.focus = left ? "left" : "right";
    this.screen = "clubs";
    this.note = "";
    swallowEdges();
    this.syncUi(true);
  }

  private botSide(): SideName | null {
    if (!this.humans[0]) return "left";
    if (!this.humans[1]) return "right";
    return null;
  }

  private pollClubs(pads: MenuPadState[]): void {
    const confirm = consumeMenuConfirm();
    if (this.online) {
      const flick = keyboardFlick();
      if ((flick === "left" || flick === "right") && this.yourSide) this.cycle(this.yourSide, flick === "left" ? -1 : 1);
      for (const pad of pads) {
        if ((pad.flick === "left" || pad.flick === "right") && this.yourSide) this.cycle(this.yourSide, pad.flick === "left" ? -1 : 1);
        if (pad.confirm && this.role === "host") this.startMatch();
      }
      if (confirm && this.role === "host") this.startMatch();
      return;
    }
    if (consumeFocusToggle()) {
      const bot = this.botSide();
      if (bot) this.focus = this.focus === bot ? (bot === "left" ? "right" : "left") : bot;
      this.syncUi(true);
    }
    for (const [id, flick] of this.keyboardFlicks(false)) {
      if (flick !== "left" && flick !== "right") continue;
      const own = this.sides.get(id) ?? null;
      const target = this.focus !== own && this.botSide() === this.focus ? this.focus : own;
      if (target) this.cycle(target, flick === "left" ? -1 : 1);
    }
    for (const pad of pads) {
      const own = this.sides.get(`pad:${pad.index}`) ?? null;
      if (!own) continue;
      const bot = this.botSide();
      if (pad.focus && bot) {
        this.focus = this.focus === bot ? own : bot;
        this.syncUi(true);
      }
      if (pad.flick === "left" || pad.flick === "right") {
        const target = this.focus !== own && bot === this.focus ? this.focus : own;
        this.cycle(target, pad.flick === "left" ? -1 : 1);
      }
      if (pad.confirm) this.startMatch();
    }
    if (confirm) this.startMatch();
  }

  private cycle(side: SideName, dir: number): void {
    audio.playUi();
    if (this.online) {
      if (!this.lobby || side !== this.yourSide) return;
      const current = side === "left" ? this.lobby.leftClub : this.lobby.rightClub;
      const other = side === "left" ? this.lobby.rightClub : this.lobby.leftClub;
      this.net?.send({ t: "club", club: this.nextClub(current, other, dir) });
      return;
    }
    const index = side === "left" ? 0 : 1;
    const other = 1 - index;
    this.clubIndex[index] = CLUBS.findIndex((club) => club.id === this.nextClub(CLUBS[this.clubIndex[index]].id, CLUBS[this.clubIndex[other]].id, dir));
    this.focus = side;
    this.syncUi(true);
  }

  private nextClub(current: ClubId, other: ClubId, dir: number): ClubId {
    let index = CLUBS.findIndex((club) => club.id === current);
    for (let i = 0; i < CLUBS.length; i += 1) {
      index = (index + dir + CLUBS.length) % CLUBS.length;
      if (CLUBS[index].id !== other) return CLUBS[index].id;
    }
    return current;
  }

  private currentClub(side: SideName): ClubId {
    if (this.online && this.lobby) return side === "left" ? this.lobby.leftClub : this.lobby.rightClub;
    return CLUBS[this.clubIndex[side === "left" ? 0 : 1]].id;
  }

  // ---------------------------------------------------------------- match

  private startMatch(): void {
    if (this.online) {
      this.net?.send({ t: "start", halfMinutes: this.settings.halfMinutes, difficulty: this.settings.difficulty });
      return;
    }
    const left = this.currentClub("left");
    const right = this.currentClub("right");
    if (left === right) {
      toast("Wybierz dwa różne kluby.");
      return;
    }
    this.yourSide = this.humans[0] ? "left" : "right";
    this.beginMatch(left, right);
  }

  private beginMatch(left: ClubId, right: ClubId, halfMinutes = this.settings.halfMinutes, difficulty = this.settings.difficulty): void {
    swallowEdges();
    this.resetNav();
    this.screen = "match";
    this.overlay = "none";
    this.modal = "none";
    this.paintModal();
    this.clubs = [clubById(left), clubById(right)];
    this.snapAcc = 0;
    this.sendAcc = 0;
    this.outbox = [];
    this.remoteLatest = { ...EMPTY_INPUT };
    this.remoteLatch.clear();
    this.remoteSeq = 0;
    this.lastView = null;
    this.world.setClubs(left, right, true);
    const blueTeam = this.online ? this.myTeam() : this.humans[0] ? 0 : 1;
    this.world.setMarkerColors(blueTeam === 0 ? MARK_P1 : MARK_P2, blueTeam === 1 ? MARK_P1 : MARK_P2);
    if (this.role === "guest") {
      this.match = null;
      this.guest = new GuestView();
    } else {
      this.guest = null;
      this.match = new Match({
        leftClub: left,
        rightClub: right,
        humans: [this.humans[0], this.humans[1]],
        halfMinutes,
        difficulty,
      });
    }
    ui.innerHTML = hudHtml(this.clubs[0], this.clubs[1]);
    this.uiSig = "match";
    this.hud = new Hud(this.clubs, this.settings.hints ? this.hintText() : "");
    audio.startCrowd();
  }

  private hintText(): string {
    const usesPad = this.online ? listPads().length > 0 && this.activePad !== null : this.devices.some((d) => d?.startsWith("pad:"));
    const usesKeys = this.online ? true : this.devices.includes("keyboard") || this.devices.includes("keys2");
    const split = !this.online && this.devices.includes("keyboard") && this.devices.includes("keys2");
    const keys = "WASD ruch · Shift sprint · X podanie · C strzał · Spacja prostopadła · F górą · E wślizg · Q zmiana · Ctrl krycie · Esc pauza";
    const arrows = "Strzałki ruch · ; sprint · K podanie · L strzał · I prostopadła · J górą · O wślizg · U zmiana · M krycie";
    const pad = "Pad: A podanie · B strzał · Y prostopadła · X górą / wślizg · LB zmiana · RT sprint · LT krycie · Start pauza";
    return [usesKeys ? keys : "", split ? arrows : "", usesPad ? pad : ""].filter(Boolean).join("\n");
  }

  private myTeam(): 0 | 1 {
    return this.yourSide === "right" ? 1 : 0;
  }

  private mouseAim(team: 0 | 1): [number, number] | null {
    const v = this.lastView;
    if (!v || !mouseAiming() || this.world.replaying()) return null;
    const m = mousePosition();
    const g = this.world.pickGround(m.x, m.y, canvas.getBoundingClientRect());
    const p = v.players[v.control[team]];
    if (!g || !p) return null;
    const dx = g[0] - p.x;
    const dz = g[1] - p.z;
    const l = Math.hypot(dx, dz);
    if (l < 1) return null;
    return [dx / l, dz / l];
  }

  private readDevice(id: string | null, team: 0 | 1): InputFrame | null {
    if (!id) return null;
    const basis = this.world.groundBasis();
    if (id === "keyboard" || id === "keys2") {
      const split = this.devices.includes("keyboard") && this.devices.includes("keys2");
      if (!split) return readKeyboardInput(basis, this.mouseAim(team), "solo");
      return id === "keyboard" ? readKeyboardInput(basis, this.mouseAim(team), "wasd") : readKeyboardInput(basis, null, "arrows");
    }
    return readPadInput(Number(id.slice(4)), basis);
  }

  private readMine(): InputFrame {
    const team = this.myTeam();
    if (keyboardBusy()) this.activePad = null;
    else for (const pad of listPads()) if (pad.index !== undefined && padBusy(pad.index)) this.activePad = pad.index;
    const basis = this.world.groundBasis();
    if (this.activePad === null) return readKeyboardInput(basis, this.mouseAim(team));
    return readPadInput(this.activePad, basis);
  }

  private tickMatch(dt: number): void {
    let v: MatchView | null = null;
    if (this.role === "guest") {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / 60) {
        this.sendAcc = 0;
        this.seq += 1;
        this.net?.send({ t: "input", seq: this.seq, f: this.overlay === "pause" ? { ...EMPTY_INPUT } : this.readMine() });
      }
      v = this.guest?.sample() ?? null;
    } else if (this.match) {
      const inputs: [InputFrame | null, InputFrame | null] = [null, null];
      const blocked = this.overlay === "pause" || this.modal !== "none";
      if (this.online) {
        const team = this.myTeam();
        inputs[team] = blocked ? { ...EMPTY_INPUT } : this.readMine();
        inputs[1 - team] = this.match.humans[1 - team] ? this.remoteFrame() : null;
      } else {
        inputs[0] = blocked && this.devices[0] ? { ...EMPTY_INPUT } : this.readDevice(this.devices[0], 0);
        inputs[1] = blocked && this.devices[1] ? { ...EMPTY_INPUT } : this.readDevice(this.devices[1], 1);
      }
      this.match.step(dt, inputs);
      v = this.match.toView();
      const events = this.match.pullEvents();
      for (const e of events) this.onEvent(e, v);
      if (this.online && this.role === "host") {
        this.outbox.push(...events);
        this.snapAcc += dt;
        if (this.snapAcc >= 1 / 30) {
          this.snapAcc = 0;
          this.net?.send({ t: "snap", at: performance.now() / 1000, v, ev: this.outbox });
          this.outbox = [];
        }
      }
    }
    if (!v) {
      this.world.update(dt, "menu", null, [false, false]);
      this.world.render();
      return;
    }
    this.lastView = v;
    this.syncMatchOverlay(v);
    const humans: [boolean, boolean] = [this.humans[0], this.humans[1]];
    this.world.record(v, dt);
    const shown = this.world.update(dt, "match", v, humans) ?? v;
    this.world.render();
    const tags = ([0, 1] as const).map((t) => {
      const id = shown.control[t];
      const p = shown.players[id];
      const info = ROSTERS[this.clubs[t].id][id % 11];
      const pr = p ? this.world.project(p.x, 2.95, p.z) : { x: 0, y: 0, ok: false };
      return { x: pr.x, y: pr.y, on: pr.ok, name: info ? `${info.num} ${shortName(info)}` : "", charge: v!.charge[t], kind: v!.chargeKind[t], show: humans[t] };
    });
    this.hud?.update(v, dt, this.world.replaying(), tags);
    this.updateCrowdAudio(v, dt);
  }

  private updateCrowdAudio(v: MatchView, dt: number): void {
    let target = 0.28;
    const danger = Math.max(0, Math.min(1, (Math.abs(v.ball[0]) - 30) / (HALF_L - 30)));
    target += danger * 0.4;
    if (v.mode === "goal") target = 1;
    else if (v.mode === "replay") target = 0.55;
    else if (v.mode === "halftime" || v.mode === "fulltime") target = 0.35;
    else if (v.mode === "paused") target = 0.12;
    this.crowd += (target - this.crowd) * Math.min(1, dt * 2.5);
    audio.crowdLevel(this.crowd);
  }

  private onEvent(e: MatchEvent, v: MatchView): void {
    switch (e.k) {
      case "kick":
        audio.playKick(e.power);
        break;
      case "touch":
        audio.playTouch();
        break;
      case "whistle":
        audio.playWhistle(e.n);
        break;
      case "goal":
        audio.playGoal();
        break;
      case "post":
        audio.playPost();
        break;
      case "net":
        audio.playNet();
        break;
      case "save":
      case "ooh":
        audio.playOoh();
        break;
      case "tackle":
        audio.playTackle();
        break;
    }
    this.world.onEvents([e], v);
    this.hud?.event(e, v);
  }

  private syncMatchOverlay(v: MatchView): void {
    const host = document.getElementById("overlay");
    if (!host) return;
    if (v.mode === "halftime" && this.overlay === "none") {
      this.overlay = "half";
      host.innerHTML = statsHtml(v, this.clubs, false, false);
    } else if (v.mode !== "halftime" && this.overlay === "half") {
      this.overlay = "none";
      host.innerHTML = "";
      swallowEdges();
    }
    if (v.mode === "fulltime" && this.overlay !== "full") {
      this.overlay = "full";
      this.resetNav();
      host.innerHTML = statsHtml(v, this.clubs, true, !this.online);
    }
    if (this.overlay === "pause" && this.match && this.match.mode !== "paused") {
      this.overlay = "none";
      host.innerHTML = "";
    }
  }

  private togglePause(force?: boolean): void {
    const host = document.getElementById("overlay");
    if (!host) return;
    this.resetNav();
    if (this.role === "guest" || !this.match) {
      this.overlay = force === false || this.overlay === "pause" ? "none" : "pause";
    } else {
      const want = force === undefined ? this.match.mode !== "paused" : force;
      if (want !== (this.match.mode === "paused")) this.match.togglePause();
      this.overlay = this.match.mode === "paused" ? "pause" : "none";
      if (this.online && this.role === "host") this.net?.send({ t: "pause", paused: this.overlay === "pause" });
    }
    host.innerHTML = this.overlay === "pause" ? pauseHtml(this.role === "guest") : "";
    if (this.overlay === "none") swallowEdges();
  }

  // ---------------------------------------------------------------- menus markup

  private syncUi(force = false): void {
    if (this.screen === "match" || this.screen === "loading") return;
    const sig = JSON.stringify({
      screen: this.screen,
      note: this.note,
      busy: this.connecting !== null,
      lobby: this.lobby,
      sides: [...this.sides.entries()],
      clubs: this.clubIndex,
      focus: this.focus,
      s: [this.settings.halfMinutes, this.settings.difficulty],
    });
    if (!force && sig === this.uiSig) return;
    this.uiSig = sig;
    if (this.screen === "menu") ui.innerHTML = menuHtml();
    else if (this.screen === "gate") ui.innerHTML = gateHtml(this.note, this.connecting !== null);
    else if (this.screen === "sides") ui.innerHTML = this.sidesMarkup();
    else if (this.screen === "clubs") ui.innerHTML = this.clubsMarkup();
  }

  private sidesMarkup(): string {
    this.refreshDevices();
    const chips: Chip[] = this.localDevices().map((d) => ({ id: d.id, label: d.label, side: this.sides.get(d.id) ?? null }));
    const assigned = chips.some((c) => c.side);
    const onlineReady = Boolean(this.lobby?.host.side && this.lobby.guest?.side && this.lobby.host.side !== this.lobby.guest.side);
    return sidesHtml({
      online: this.online,
      lobby: this.lobby,
      chips,
      note: this.note,
      canAdvance: this.online ? onlineReady && this.role === "host" : assigned,
      host: this.role === "host",
    });
  }

  private clubsMarkup(): string {
    const left = clubById(this.currentClub("left"));
    const right = clubById(this.currentClub("right"));
    const bot = this.botSide();
    const leftHuman = this.online ? Boolean(this.lobby?.host.side === "left" || this.lobby?.guest?.side === "left") : this.humans[0];
    const rightHuman = this.online ? Boolean(this.lobby?.host.side === "right" || this.lobby?.guest?.side === "right") : this.humans[1];
    return clubsHtml({
      left,
      right,
      focus: this.focus,
      leftLabel: leftHuman ? "Gospodarze · gracz" : "Gospodarze · bot",
      rightLabel: rightHuman ? "Goście · gracz" : "Goście · bot",
      canStart: !this.online || this.role === "host",
      help: this.online
        ? "A / D albo drążek zmienia twój klub."
        : bot
          ? "A / D zmienia zaznaczony klub. Q albo LB przełącza na drużynę bota. Enter albo A zaczyna mecz."
          : "Każde urządzenie zmienia klub swojej strony. Enter albo A zaczyna mecz.",
      allowLeft: this.online ? this.yourSide === "left" : true,
      allowRight: this.online ? this.yourSide === "right" : true,
      settings: this.settings,
    });
  }
}

new App();
