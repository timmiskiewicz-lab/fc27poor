import { EMPTY_INPUT, type InputFrame } from "./types";

export interface DeviceInfo {
  id: string;
  kind: "keyboard" | "pad";
  label: string;
  index?: number;
}

interface PadMemory {
  x: number;
  y: number;
  buttons: boolean[];
}

const padMemory = new Map<number, PadMemory>();
const padGameMemory = new Map<number, boolean[]>();
const keyState = new Set<string>();
const keyLatch = new Set<string>();
const keyEdges: string[] = [];
const mouse = { x: 0, y: 0, movedAt: -1e9, left: false, right: false, middle: false, leftLatch: false, rightLatch: false, middleLatch: false };

/** "solo" accepts both key sets; with two people on one keyboard each gets one half. */
export type KeyLayout = "solo" | "wasd" | "arrows";

interface KeySet {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  sprint: string[];
  pass: string[];
  shoot: string[];
  through: string[];
  lob: string[];
  slide: string[];
  switchP: string[];
  jockey: string[];
}

const KEYSETS: Record<"wasd" | "arrows", KeySet> = {
  wasd: {
    up: ["KeyW"],
    down: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    sprint: ["ShiftLeft"],
    pass: ["KeyX"],
    shoot: ["KeyC"],
    through: ["Space"],
    lob: ["KeyF"],
    slide: ["KeyE"],
    switchP: ["KeyQ"],
    jockey: ["ControlLeft"],
  },
  arrows: {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    sprint: ["Semicolon", "ShiftRight"],
    pass: ["KeyK"],
    shoot: ["KeyL"],
    through: ["KeyI"],
    lob: ["KeyJ"],
    slide: ["KeyO"],
    switchP: ["KeyU"],
    jockey: ["KeyM", "ControlRight"],
  },
};

function keySet(layout: KeyLayout): KeySet {
  if (layout !== "solo") return KEYSETS[layout];
  const a = KEYSETS.wasd;
  const b = KEYSETS.arrows;
  const out = {} as KeySet;
  for (const k of Object.keys(a) as (keyof KeySet)[]) out[k] = [...a[k], ...b[k]];
  return out;
}

const SOLO = keySet("solo");
const GAME_KEYS = ["Enter", ...SOLO.pass, ...SOLO.shoot, ...SOLO.through, ...SOLO.lob, ...SOLO.slide, ...SOLO.switchP];

function typingNow(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export function attachInput(canvas: HTMLCanvasElement): void {
  window.addEventListener("keydown", (event) => {
    if (typingNow()) return;
    if (!event.repeat && !keyState.has(event.code)) {
      keyEdges.push(event.code);
      if (keyEdges.length > 24) keyEdges.shift();
      keyLatch.add(event.code);
    }
    keyState.add(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "ControlLeft", "ControlRight"].includes(event.code)) event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    keyState.delete(event.code);
  });
  window.addEventListener("blur", () => {
    keyState.clear();
    keyLatch.clear();
    mouse.left = mouse.right = mouse.middle = false;
  });
  window.addEventListener("mousemove", (event) => {
    if (Math.abs(event.clientX - mouse.x) + Math.abs(event.clientY - mouse.y) > 2) mouse.movedAt = performance.now();
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  });
  canvas.addEventListener("mousedown", (event) => {
    if (typingNow()) return;
    mouse.movedAt = performance.now();
    if (event.button === 0) {
      mouse.left = true;
      mouse.leftLatch = true;
    }
    if (event.button === 1) {
      mouse.middle = true;
      mouse.middleLatch = true;
      event.preventDefault();
    }
    if (event.button === 2) {
      mouse.right = true;
      mouse.rightLatch = true;
    }
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) mouse.left = false;
    if (event.button === 1) mouse.middle = false;
    if (event.button === 2) mouse.right = false;
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}

export function keyDown(code: string): boolean {
  return !typingNow() && keyState.has(code);
}

function held(code: string): boolean {
  if (typingNow()) return false;
  const v = keyState.has(code) || keyLatch.has(code);
  keyLatch.delete(code);
  return v;
}

function edgeKey(code: string): boolean {
  const index = keyEdges.indexOf(code);
  if (index < 0) return false;
  keyEdges.splice(index, 1);
  return true;
}

export function mousePosition(): { x: number; y: number } {
  return { x: mouse.x, y: mouse.y };
}

export function mouseAiming(): boolean {
  return mouse.left || mouse.right || mouse.middle || performance.now() - mouse.movedAt < 2200;
}

export function listPads(): DeviceInfo[] {
  const pads = navigator.getGamepads?.() ?? [];
  const found: DeviceInfo[] = [];
  let seen = 0;
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    seen += 1;
    found.push({ id: `pad:${pad.index}`, kind: "pad", label: `Pad ${seen}`, index: pad.index });
  }
  return found;
}

export function keyboardDevice(): DeviceInfo {
  return { id: "keyboard", kind: "keyboard", label: "Klawiatura WASD + mysz" };
}

export function arrowsDevice(): DeviceInfo {
  return { id: "keys2", kind: "keyboard", label: "Klawiatura: strzałki" };
}

export interface MenuPadState {
  index: number;
  flick: "left" | "right" | "down" | "up" | null;
  confirm: boolean;
  back: boolean;
  focus: boolean;
  start: boolean;
}

export function pollMenuPads(): MenuPadState[] {
  const pads = navigator.getGamepads?.() ?? [];
  const result: MenuPadState[] = [];
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const prev = padMemory.get(pad.index) ?? { x: 0, y: 0, buttons: [] };
    const x = (pad.axes[0] ?? 0) + (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
    const y = (pad.axes[1] ?? 0) + (pad.buttons[13]?.pressed ? 1 : 0) - (pad.buttons[12]?.pressed ? 1 : 0);
    const buttons = pad.buttons.map((button) => button.pressed || button.value > 0.55);
    let flick: MenuPadState["flick"] = null;
    if (x < -0.62 && prev.x >= -0.4) flick = "left";
    else if (x > 0.62 && prev.x <= 0.4) flick = "right";
    else if (y > 0.62 && prev.y <= 0.4) flick = "down";
    else if (y < -0.62 && prev.y >= -0.4) flick = "up";
    const edge = (i: number) => Boolean(buttons[i] && !prev.buttons[i]);
    padMemory.set(pad.index, { x, y, buttons });
    result.push({ index: pad.index, flick, confirm: edge(0), back: edge(1), focus: edge(4), start: edge(9) });
  }
  return result;
}

export function padBusy(index: number): boolean {
  const pad = (navigator.getGamepads?.() ?? [])[index];
  if (!pad || !pad.connected) return false;
  return pad.axes.some((axis) => Math.abs(axis) > 0.3) || pad.buttons.some((button) => button.pressed || button.value > 0.55);
}

export function padPausePressed(index: number): boolean {
  const pad = (navigator.getGamepads?.() ?? [])[index];
  if (!pad || !pad.connected) return false;
  const prev = padMemory.get(index) ?? { x: 0, y: 0, buttons: [] };
  const now = Boolean(pad.buttons[9]?.pressed);
  const was = Boolean(prev.buttons[9]);
  prev.buttons = pad.buttons.map((button) => button.pressed || button.value > 0.55);
  padMemory.set(index, prev);
  return now && !was;
}

export function keyboardFlick(layout: KeyLayout = "solo"): "left" | "right" | "down" | "up" | null {
  const keys = keySet(layout);
  const edge = (codes: string[]) => codes.some((code) => edgeKey(code));
  if (edge(keys.left)) return "left";
  if (edge(keys.right)) return "right";
  if (edge(keys.down)) return "down";
  if (edge(keys.up)) return "up";
  return null;
}

export function consumeMenuConfirm(): boolean {
  return edgeKey("Enter");
}

export function consumeEscape(): boolean {
  return edgeKey("Escape");
}

export function consumeFocusToggle(): boolean {
  return edgeKey("KeyQ") || edgeKey("Tab");
}

export function consumeKey(code: string): boolean {
  return edgeKey(code);
}

export function keyboardBusy(): boolean {
  return [...SOLO.up, ...SOLO.down, ...SOLO.left, ...SOLO.right, ...SOLO.sprint, ...GAME_KEYS].some(keyDown) || mouse.left || mouse.right;
}

export function swallowEdges(): void {
  keyEdges.length = 0;
  keyLatch.clear();
  mouse.leftLatch = mouse.rightLatch = mouse.middleLatch = false;
  for (const [index, mem] of padMemory) padGameMemory.set(index, mem.buttons.slice());
}

export function clearGameLatches(): void {
  for (const code of GAME_KEYS) keyLatch.delete(code);
}

/**
 * Camera basis on the ground: screen-right and screen-up expressed as world XZ vectors.
 */
export interface GroundBasis {
  rx: number;
  rz: number;
  ux: number;
  uz: number;
}

function toWorld(basis: GroundBasis, sx: number, sy: number): [number, number] {
  return [basis.rx * sx + basis.ux * sy, basis.rz * sx + basis.uz * sy];
}

export function readKeyboardInput(basis: GroundBasis, aim: [number, number] | null, layout: KeyLayout = "solo"): InputFrame {
  const keys = keySet(layout);
  const down = (codes: string[]) => codes.some(keyDown);
  const press = (codes: string[]) => codes.map(held).some(Boolean);
  let sx = 0;
  let sy = 0;
  if (down(keys.left)) sx -= 1;
  if (down(keys.right)) sx += 1;
  if (down(keys.up)) sy += 1;
  if (down(keys.down)) sy -= 1;
  const l = Math.hypot(sx, sy) || 1;
  const [mx, mz] = toWorld(basis, sx / l, sy / l);
  const withMouse = layout !== "arrows";
  const left = withMouse && (mouse.left || mouse.leftLatch);
  const right = withMouse && (mouse.right || mouse.rightLatch);
  const middle = withMouse && (mouse.middle || mouse.middleLatch);
  if (withMouse) mouse.leftLatch = mouse.rightLatch = mouse.middleLatch = false;
  return {
    mx,
    mz,
    ax: aim ? aim[0] : 0,
    az: aim ? aim[1] : 0,
    sprint: down(keys.sprint),
    pass: press(keys.pass) || left,
    shoot: press(keys.shoot) || right,
    through: press(keys.through),
    lob: press(keys.lob) || middle,
    slide: press(keys.slide),
    switchP: press(keys.switchP),
    jockey: down(keys.jockey),
    skip: held("Enter"),
  };
}

function stick(x: number, y: number, dead: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dead) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return [x * k, y * k];
}

export function readPadInput(index: number, basis: GroundBasis): InputFrame {
  const pad = (navigator.getGamepads?.() ?? [])[index];
  if (!pad || !pad.connected) return { ...EMPTY_INPUT };
  const b = pad.buttons.map((button) => button.pressed || button.value > 0.5);
  const swallowed = padGameMemory.get(index);
  if (swallowed) {
    for (let i = 0; i < b.length; i += 1) {
      if (swallowed[i] && b[i]) b[i] = false;
      else swallowed[i] = false;
    }
    if (!swallowed.some(Boolean)) padGameMemory.delete(index);
  }
  let [sx, sy] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0.17);
  if (b[12] || b[13] || b[14] || b[15]) {
    sx = (b[15] ? 1 : 0) - (b[14] ? 1 : 0);
    sy = (b[13] ? 1 : 0) - (b[12] ? 1 : 0);
  }
  const [mx, mz] = toWorld(basis, sx, -sy);
  const [rx, ry] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.3);
  const [ax, az] = Math.hypot(rx, ry) > 0 ? toWorld(basis, rx, -ry) : [0, 0];
  return {
    mx,
    mz,
    ax,
    az,
    sprint: Boolean(b[7] || b[5]),
    pass: Boolean(b[0]),
    shoot: Boolean(b[1]),
    through: Boolean(b[3]),
    lob: Boolean(b[2]),
    slide: Boolean(b[2]),
    switchP: Boolean(b[4]),
    jockey: Boolean(b[6]),
    skip: Boolean(b[0] || b[8]),
  };
}

function clampAxis(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

export function sanitizeInput(raw: Partial<InputFrame> | undefined): InputFrame {
  const r = raw ?? {};
  return {
    mx: clampAxis(r.mx),
    mz: clampAxis(r.mz),
    ax: clampAxis(r.ax),
    az: clampAxis(r.az),
    sprint: Boolean(r.sprint),
    pass: Boolean(r.pass),
    shoot: Boolean(r.shoot),
    through: Boolean(r.through),
    lob: Boolean(r.lob),
    slide: Boolean(r.slide),
    switchP: Boolean(r.switchP),
    jockey: Boolean(r.jockey),
    skip: Boolean(r.skip),
  };
}
