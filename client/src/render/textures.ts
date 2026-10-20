import * as THREE from "three";
import type { Club, ClubId, Crest, Kit } from "../../../shared/clubs";
import { BOX_DEPTH, BOX_HALF_W, CIRCLE_R, HALF_L, HALF_W, PEN_SPOT, SIX_DEPTH, SIX_HALF_W } from "../game/math";

export const FIELD_X = 64;
export const FIELD_Z = 44;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Brak kontekstu 2D");
  return [c, ctx];
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color(1, 1, 1), k);
  else c.multiplyScalar(1 + k);
  return `#${c.getHexString()}`;
}

function finish(c: HTMLCanvasElement, srgb = true, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Grass base colour, mowing pattern and white markings for the whole ground plane. */
export function pitchTexture(pattern: number, size = 4096): THREE.CanvasTexture {
  const W = size;
  const H = Math.round((size * FIELD_Z) / FIELD_X);
  const [c, g] = canvas(W, H);
  const ppm = W / (FIELD_X * 2);
  const X = (x: number) => (x + FIELD_X) * ppm;
  const Z = (z: number) => (z + FIELD_Z) * ppm;
  const base = new THREE.Color("#356a27");
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, W, H);
  const bands = 22;
  const bw = (HALF_L * 2) / bands;
  for (let i = -6; i < bands + 6; i += 1) {
    const x0 = -HALF_L + i * bw;
    const light = i % 2 === 0;
    for (let j = -6; j < 14; j += 1) {
      const z0 = -HALF_W + j * ((HALF_W * 2) / 8);
      const checker = pattern === 1 && j % 2 === 0;
      const lit = checker ? !light : light;
      const col = base.clone().multiplyScalar(lit ? 1.08 : checker ? 0.95 : 0.9);
      if (pattern === 2) col.multiplyScalar(1 + 0.05 * Math.sin((i + j) * 0.9));
      g.fillStyle = `#${col.getHexString()}`;
      g.fillRect(X(x0), Z(z0), bw * ppm + 1, ((HALF_W * 2) / 8) * ppm + 1);
    }
  }
  const outside = base.clone().multiplyScalar(0.82);
  g.fillStyle = `rgba(${Math.round(outside.r * 255)},${Math.round(outside.g * 255)},${Math.round(outside.b * 255)},0.55)`;
  g.fillRect(0, 0, W, Z(-HALF_W - 1.5));
  g.fillRect(0, Z(HALF_W + 1.5), W, H);
  g.fillRect(0, 0, X(-HALF_L - 2), H);
  g.fillRect(X(HALF_L + 2), 0, W, H);
  for (let i = 0; i < 2600; i += 1) {
    const x = hash(i) * W;
    const y = hash(i + 9000) * H;
    const r = (2 + hash(i + 400) * 16) * (ppm / 30);
    g.fillStyle = `rgba(${hash(i + 7) > 0.5 ? "30,55,20" : "120,150,70"},${0.035 + hash(i + 3) * 0.04})`;
    g.beginPath();
    g.ellipse(x, y, r * 2.2, r, hash(i + 11) * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (const side of [-1, 1]) {
    const gx = X(side * (HALF_L - 6));
    const grad = g.createRadialGradient(gx, Z(0), 0, gx, Z(0), 8 * ppm);
    grad.addColorStop(0, "rgba(110,95,55,0.22)");
    grad.addColorStop(1, "rgba(110,95,55,0)");
    g.fillStyle = grad;
    g.fillRect(gx - 9 * ppm, Z(-9), 18 * ppm, 18 * ppm);
    const spot = X(side * (HALF_L - PEN_SPOT));
    const g2 = g.createRadialGradient(spot, Z(0), 0, spot, Z(0), 1.6 * ppm);
    g2.addColorStop(0, "rgba(110,95,55,0.3)");
    g2.addColorStop(1, "rgba(110,95,55,0)");
    g.fillStyle = g2;
    g.fillRect(spot - 2 * ppm, Z(-2), 4 * ppm, 4 * ppm);
  }
  g.strokeStyle = "rgba(226,230,222,0.86)";
  g.fillStyle = "rgba(226,230,222,0.86)";
  g.lineWidth = 0.12 * ppm;
  g.lineJoin = "miter";
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    g.beginPath();
    g.moveTo(X(x0), Z(z0));
    g.lineTo(X(x1), Z(z1));
    g.stroke();
  };
  g.strokeRect(X(-HALF_L), Z(-HALF_W), HALF_L * 2 * ppm, HALF_W * 2 * ppm);
  line(0, -HALF_W, 0, HALF_W);
  g.beginPath();
  g.arc(X(0), Z(0), CIRCLE_R * ppm, 0, Math.PI * 2);
  g.stroke();
  const dot = (x: number, z: number, r: number) => {
    g.beginPath();
    g.arc(X(x), Z(z), r * ppm, 0, Math.PI * 2);
    g.fill();
  };
  dot(0, 0, 0.16);
  for (const s of [-1, 1]) {
    const gx = s * HALF_L;
    g.strokeRect(Math.min(X(gx), X(gx - s * BOX_DEPTH)), Z(-BOX_HALF_W), BOX_DEPTH * ppm, BOX_HALF_W * 2 * ppm);
    g.strokeRect(Math.min(X(gx), X(gx - s * SIX_DEPTH)), Z(-SIX_HALF_W), SIX_DEPTH * ppm, SIX_HALF_W * 2 * ppm);
    dot(gx - s * PEN_SPOT, 0, 0.13);
    const a = Math.acos((BOX_DEPTH - PEN_SPOT) / CIRCLE_R);
    g.beginPath();
    if (s > 0) g.arc(X(gx - PEN_SPOT), Z(0), CIRCLE_R * ppm, Math.PI - a, Math.PI + a);
    else g.arc(X(gx + PEN_SPOT), Z(0), CIRCLE_R * ppm, -a, a);
    g.stroke();
    for (const zs of [-1, 1]) {
      g.beginPath();
      const start = s > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : zs > 0 ? -Math.PI / 2 : 0;
      g.arc(X(gx), Z(zs * HALF_W), 1 * ppm, start, start + Math.PI / 2);
      g.stroke();
      line(gx + s * 0.3, zs * (HALF_W - 10.15), gx + s * 0.9, zs * (HALF_W - 10.15));
      line(gx - s * 10.15, zs * (HALF_W + 0.3), gx - s * 10.15, zs * (HALF_W + 0.9));
    }
  }
  return finish(c, true, 16);
}

/** Tiling grass detail (blades, small colour noise); used in a world-space multiply. */
export function grassDetail(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = "rgb(128,128,128)";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i += 1) {
    const x = hash(i * 1.3) * S;
    const y = hash(i * 2.7 + 5) * S;
    const l = 2 + hash(i + 77) * 7;
    const a = -Math.PI / 2 + (hash(i + 13) - 0.5) * 0.9;
    const v = Math.round(70 + hash(i + 21) * 120);
    g.strokeStyle = `rgba(${v},${v + 10},${v - 10},0.55)`;
    g.lineWidth = 0.8 + hash(i + 5) * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
    for (const ox of [-S, S]) {
      if (x + ox > -10 && x + ox < S + 10) {
        g.beginPath();
        g.moveTo(x + ox, y);
        g.lineTo(x + ox + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }
  }
  const t = finish(c, false, 16);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function ballTexture(accent = "#1f4fd8", accent2 = "#e8b923"): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#f7f7f4";
  g.fillRect(0, 0, W, H);
  const star = (cx: number, cy: number, r: number, rot: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rr = i % 2 === 0 ? r : r * 0.42;
      const a = rot + (i * Math.PI) / 5;
      const sx = Math.cos(a) * rr * 2;
      const sy = Math.sin(a) * rr;
      if (i === 0) g.moveTo(cx + sx, cy + sy);
      else g.lineTo(cx + sx, cy + sy);
    }
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 6; i += 1) {
    const cx = (i / 6) * W + 40;
    star(cx, H * 0.5 + Math.sin(i * 2.1) * 40, 62, i * 0.7, i % 2 ? accent : "#151515");
    star(cx + W / 12, H * 0.2, 34, i, accent2);
    star(cx + W / 12, H * 0.8, 34, i + 1, accent2);
  }
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 3;
  for (let i = 0; i < 12; i += 1) {
    g.beginPath();
    const x = (i / 12) * W;
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 60, H * 0.33, x - 60, H * 0.66, x, H);
    g.stroke();
  }
  return finish(c);
}

export function netTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(0, S / 2);
  g.lineTo(S / 2, 0);
  g.lineTo(S, S / 2);
  g.lineTo(S / 2, S);
  g.closePath();
  g.stroke();
  const t = finish(c, true, 4);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function crestPath(g: CanvasRenderingContext2D, shape: Crest["shape"], S: number): void {
  const m = S * 0.06;
  g.beginPath();
  if (shape === "round") g.arc(S / 2, S / 2, S / 2 - m, 0, Math.PI * 2);
  else if (shape === "oval") g.ellipse(S / 2, S / 2, S * 0.32, S / 2 - m, 0, 0, Math.PI * 2);
  else if (shape === "diamond") {
    g.moveTo(S / 2, m);
    g.lineTo(S - m, S / 2);
    g.lineTo(S / 2, S - m);
    g.lineTo(m, S / 2);
    g.closePath();
  } else {
    g.moveTo(m, m);
    g.lineTo(S - m, m);
    g.lineTo(S - m, S * 0.52);
    g.quadraticCurveTo(S - m, S * 0.86, S / 2, S - m);
    g.quadraticCurveTo(m, S * 0.86, m, S * 0.52);
    g.closePath();
  }
}

export function drawCrest(g: CanvasRenderingContext2D, crest: Crest, S: number, x = 0, y = 0): void {
  g.save();
  g.translate(x, y);
  crestPath(g, crest.shape, S);
  g.fillStyle = crest.c;
  g.fill();
  g.save();
  g.translate(S * 0.5, S * 0.5);
  g.scale(0.84, 0.84);
  g.translate(-S * 0.5, -S * 0.5);
  crestPath(g, crest.shape, S);
  g.clip();
  g.fillStyle = crest.a;
  g.fillRect(0, 0, S, S);
  g.fillStyle = crest.b;
  if (crest.shape === "shield") {
    for (let i = 0; i < 4; i += 1) g.fillRect(S * (0.18 + i * 0.18), S * 0.36, S * 0.09, S * 0.7);
    g.fillStyle = crest.c;
    g.fillRect(0, S * 0.08, S, S * 0.26);
  } else if (crest.shape === "round") {
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillRect(S * 0.42, 0, S * 0.16, S);
  }
  g.restore();
  g.fillStyle = crest.shape === "shield" ? crest.a : crest.c;
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = S * 0.02;
  g.font = `900 ${Math.round(S * (crest.letters.length > 2 ? 0.2 : 0.3))}px "Arial Black", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const ty = crest.shape === "shield" ? S * 0.22 : S * 0.52;
  g.strokeText(crest.letters, S / 2, ty);
  g.fillStyle = crest.shape === "shield" ? crest.a : "#ffffff";
  if (crest.shape === "round") g.fillStyle = crest.c === "#ffffff" ? crest.a : crest.c;
  g.fillText(crest.letters, S / 2, ty);
  g.restore();
}

export function crestTexture(crest: Crest): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  drawCrest(g, crest, S);
  return finish(c);
}

export function crestDataUrl(crest: Crest, S = 96): string {
  const [c, g] = canvas(S, S);
  drawCrest(g, crest, S);
  return c.toDataURL();
}

/**
 * Back print: name across the top quarter, big number below; plus a small front number in the
 * lower-left corner (sampled by the shader for chest and shorts).
 */
export const SPONSORS: Record<ClubId, { text: string; font: string; italic?: boolean }> = {
  barca: { text: "Spotify", font: "700" },
  real: { text: "Emirates", font: "700", italic: true },
  atleti: { text: "Riyadh Air", font: "700" },
  city: { text: "etihad", font: "800" },
  liverpool: { text: "Standard Chartered", font: "700" },
  bayern: { text: "T", font: "900" },
  juve: { text: "Jeep", font: "900" },
  psg: { text: "QATAR AIRWAYS", font: "800" },
};

/**
 * Canvas layout read by the kit shader: top half = back name + number (also used on the shorts),
 * 0.5–0.75 = chest sponsor.
 */
export function printTexture(kit: Kit, shirtName: string, num: number, club?: ClubId): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  const fill = kit.number;
  const outline = new THREE.Color(fill).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6 ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.25)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = fill;
  g.strokeStyle = outline;
  const name = shirtName.toUpperCase();
  let fs = 46;
  const narrow = (size: number, w = 800) => `${w} ${size}px "Barlow Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
  g.font = narrow(fs);
  while (g.measureText(name).width > S * 0.8 && fs > 22) {
    fs -= 2;
    g.font = narrow(fs);
  }
  g.lineWidth = 3;
  g.strokeText(name, S / 2, S * 0.085);
  g.fillText(name, S / 2, S * 0.085);
  g.font = narrow(Math.round(S * 0.36), 800);
  g.lineWidth = 7;
  g.strokeText(String(num), S / 2, S * 0.315);
  g.fillText(String(num), S / 2, S * 0.315);
  const sp = club ? SPONSORS[club] : null;
  if (sp) {
    let size = 70;
    const font = (px: number) => `${sp.italic ? "italic " : ""}${sp.font} ${px}px "Outfit Variable", Outfit, "Segoe UI", Arial, sans-serif`;
    g.font = font(size);
    while (g.measureText(sp.text).width > S * 0.86 && size > 20) {
      size -= 2;
      g.font = font(size);
    }
    g.lineWidth = 2;
    g.strokeText(sp.text, S / 2, S * 0.625);
    g.fillText(sp.text, S / 2, S * 0.625);
  }
  return finish(c, true, 4);
}

export function adTexture(clubs: [Club, Club], stadium: string): THREE.CanvasTexture {
  const W = 4096;
  const H = 128;
  const [c, g] = canvas(W, H);
  const items: Array<{ text: string; bg: string; fg: string; crest?: Crest }> = [
    { text: "FC 27 POOR EDITION", bg: "#0a1d3a", fg: "#ffffff" },
    { text: clubs[0].name.toUpperCase(), bg: clubs[0].home.shirt, fg: clubs[0].home.number, crest: clubs[0].crest },
    { text: "NOVA ENERGY", bg: "#101010", fg: "#38f2b5" },
    { text: stadium.toUpperCase(), bg: "#f2f2f2", fg: "#141414" },
    { text: "KICKR", bg: "#e5262b", fg: "#ffffff" },
    { text: clubs[1].name.toUpperCase(), bg: clubs[1].home.shirt, fg: clubs[1].home.number, crest: clubs[1].crest },
    { text: "AURORA AIR", bg: "#151f6b", fg: "#ffd34d" },
    { text: "PLAY FAIR", bg: "#1a1a1a", fg: "#ffffff" },
  ];
  const w = W / items.length;
  items.forEach((it, i) => {
    g.fillStyle = it.bg;
    g.fillRect(i * w, 0, w, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(255,255,255,0.14)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.2)");
    g.fillStyle = grad;
    g.fillRect(i * w, 0, w, H);
    g.fillStyle = it.fg;
    g.font = `900 ${H * 0.52}px "Arial Black", Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let fs = H * 0.52;
    while (g.measureText(it.text).width > w * (it.crest ? 0.68 : 0.88) && fs > 20) {
      fs -= 2;
      g.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
    }
    const tx = i * w + w / 2 + (it.crest ? H * 0.45 : 0);
    g.fillText(it.text, tx, H * 0.53);
    if (it.crest) drawCrest(g, it.crest, H * 0.84, tx - g.measureText(it.text).width / 2 - H * 0.98, H * 0.08);
  });
  const t = finish(c, true, 8);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Seat colours for the bowl: base seat colour with darker row lines and a few accent blocks. */
export function seatTexture(club: Club): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const [c, g] = canvas(W, H);
  const main = club.home.shirt;
  const alt = club.home.pattern === "stripes" || club.home.pattern === "band" ? club.home.alt : club.home.trim;
  g.fillStyle = shade(main, -0.25);
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 64) {
    if ((x / 64) % 5 === 2) {
      g.fillStyle = shade(alt, -0.2);
      g.fillRect(x, 0, 64, H);
    }
  }
  for (let y = 0; y < H; y += 8) {
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, y + 6, W, 2);
  }
  for (let x = 0; x < W; x += 4) {
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(x, 0, 1, H);
  }
  const t = finish(c, true, 8);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function screenCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D, THREE.CanvasTexture] {
  const [c, g] = canvas(512, 256);
  const t = finish(c, true, 4);
  return [c, g, t];
}
