export type ClubId = "barca" | "real" | "atleti" | "city" | "liverpool" | "bayern" | "juve" | "psg";

export type KitPattern = "solid" | "stripes" | "band" | "hoops";

export interface Kit {
  pattern: KitPattern;
  shirt: string;
  alt: string;
  edge: string;
  sleeves: string;
  shorts: string;
  socks: string;
  trim: string;
  number: string;
  stripes: number;
}

export interface Crest {
  shape: "shield" | "round" | "diamond" | "oval";
  a: string;
  b: string;
  c: string;
  letters: string;
}

export interface Club {
  id: ClubId;
  name: string;
  short: string;
  stadium: string;
  home: Kit;
  away: Kit;
  crest: Crest;
  shirt: string;
  shorts: string;
  trim: string;
}

function kit(partial: Partial<Kit> & Pick<Kit, "shirt">): Kit {
  return {
    pattern: "solid",
    alt: partial.shirt,
    edge: partial.alt ?? partial.shirt,
    sleeves: partial.shirt,
    shorts: partial.shirt,
    socks: partial.shirt,
    trim: "#ffffff",
    number: "#ffffff",
    stripes: 5,
    ...partial,
  };
}

function club(id: ClubId, name: string, short: string, stadium: string, home: Kit, away: Kit, crest: Crest): Club {
  return { id, name, short, stadium, home, away, crest, shirt: home.shirt, shorts: home.shorts, trim: home.trim };
}

export const CLUBS: Club[] = [
  club(
    "barca",
    "FC Barcelona",
    "BAR",
    "Camp Nou",
    kit({ pattern: "stripes", shirt: "#a50044", alt: "#0b4ea2", sleeves: "#a50044", shorts: "#0c2c6b", socks: "#0c2c6b", trim: "#edbb00", number: "#edbb00", stripes: 5 }),
    kit({ shirt: "#f1c232", shorts: "#f1c232", socks: "#f1c232", trim: "#a50044", number: "#a50044" }),
    { shape: "shield", a: "#a50044", b: "#0b4ea2", c: "#edbb00", letters: "FCB" },
  ),
  club(
    "real",
    "Real Madrid",
    "RMA",
    "Santiago Bernabéu",
    kit({ shirt: "#f6f5f0", shorts: "#f6f5f0", socks: "#f6f5f0", trim: "#c9a227", number: "#1b1b1b" }),
    kit({ shirt: "#1d2a4f", shorts: "#1d2a4f", socks: "#1d2a4f", trim: "#c9a227", number: "#f6f5f0" }),
    { shape: "round", a: "#f6f5f0", b: "#1d2a4f", c: "#c9a227", letters: "RM" },
  ),
  club(
    "atleti",
    "Atlético Madryt",
    "ATM",
    "Metropolitano",
    kit({ pattern: "stripes", shirt: "#d81e2a", alt: "#ffffff", sleeves: "#d81e2a", shorts: "#1c3f94", socks: "#d81e2a", trim: "#1c3f94", number: "#1c3f94", stripes: 7 }),
    kit({ shirt: "#1c3f94", shorts: "#1c3f94", socks: "#1c3f94", trim: "#d81e2a", number: "#ffffff" }),
    { shape: "shield", a: "#d81e2a", b: "#ffffff", c: "#1c3f94", letters: "ATM" },
  ),
  club(
    "city",
    "Manchester City",
    "MCI",
    "Etihad",
    kit({ shirt: "#7ab7e8", shorts: "#ffffff", socks: "#7ab7e8", trim: "#1c2c5b", number: "#1c2c5b" }),
    kit({ shirt: "#1a2235", shorts: "#1a2235", socks: "#1a2235", trim: "#7ab7e8", number: "#ffffff" }),
    { shape: "round", a: "#7ab7e8", b: "#1c2c5b", c: "#f6c344", letters: "MC" },
  ),
  club(
    "liverpool",
    "Liverpool",
    "LIV",
    "Anfield",
    kit({ shirt: "#c8102e", shorts: "#c8102e", socks: "#c8102e", trim: "#ffffff", number: "#ffffff" }),
    kit({ shirt: "#f2f2ee", shorts: "#f2f2ee", socks: "#f2f2ee", trim: "#c8102e", number: "#c8102e" }),
    { shape: "shield", a: "#c8102e", b: "#00a398", c: "#f6eb61", letters: "LFC" },
  ),
  club(
    "bayern",
    "Bayern Monachium",
    "BAY",
    "Allianz Arena",
    kit({ shirt: "#dc052d", shorts: "#dc052d", socks: "#dc052d", trim: "#ffffff", number: "#ffffff" }),
    kit({ shirt: "#f4f4f4", shorts: "#f4f4f4", socks: "#f4f4f4", trim: "#dc052d", number: "#dc052d" }),
    { shape: "round", a: "#dc052d", b: "#0066b2", c: "#ffffff", letters: "FCB" },
  ),
  club(
    "juve",
    "Juventus",
    "JUV",
    "Allianz Stadium",
    kit({ pattern: "stripes", shirt: "#111111", alt: "#f4f4f4", sleeves: "#111111", shorts: "#f4f4f4", socks: "#111111", trim: "#111111", number: "#f4f4f4", stripes: 6 }),
    kit({ shirt: "#f3a0c3", shorts: "#111111", socks: "#f3a0c3", trim: "#111111", number: "#111111" }),
    { shape: "oval", a: "#111111", b: "#f4f4f4", c: "#c9a227", letters: "J" },
  ),
  club(
    "psg",
    "Paris Saint-Germain",
    "PSG",
    "Parc des Princes",
    kit({ pattern: "band", shirt: "#0b1f4b", alt: "#d3132a", edge: "#ffffff", sleeves: "#0b1f4b", shorts: "#0b1f4b", socks: "#0b1f4b", trim: "#d3132a", number: "#ffffff" }),
    kit({ pattern: "band", shirt: "#f4f4f4", alt: "#0b1f4b", edge: "#d3132a", sleeves: "#f4f4f4", shorts: "#f4f4f4", socks: "#f4f4f4", trim: "#0b1f4b", number: "#0b1f4b" }),
    { shape: "round", a: "#0b1f4b", b: "#d3132a", c: "#ffffff", letters: "PSG" },
  ),
];

export function clubById(id: ClubId): Club {
  const found = CLUBS.find((item) => item.id === id);
  if (!found) throw new Error(`Nieznany klub: ${id}`);
  return found;
}

export function isClubId(value: unknown): value is ClubId {
  return typeof value === "string" && CLUBS.some((item) => item.id === value);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot((r1 - r2) * 0.9, (g1 - g2) * 1.2, (b1 - b2) * 0.8);
}

function dominant(item: Kit): string[] {
  return item.pattern === "stripes" ? [item.shirt, item.alt] : [item.shirt];
}

export function kitsClash(a: Kit, b: Kit): boolean {
  for (const ca of dominant(a)) {
    for (const cb of dominant(b)) {
      if (colorDistance(ca, cb) < 0.24) return true;
    }
  }
  return false;
}

export function pickKits(left: Club, right: Club): [Kit, Kit] {
  if (!kitsClash(left.home, right.home)) return [left.home, right.home];
  if (!kitsClash(left.home, right.away)) return [left.home, right.away];
  return [left.away, right.home];
}

const GK_COLORS = ["#f28c28", "#3ccf6e", "#8e44ad", "#1fb5d6", "#1d1d1d", "#f5e11b", "#e84393"];

export function keeperKit(outfield: Kit[], used: string[]): Kit {
  const pick =
    GK_COLORS.find((color) => outfield.every((item) => dominant(item).every((c) => colorDistance(c, color) > 0.32)) && used.every((c) => colorDistance(c, color) > 0.32)) ??
    GK_COLORS[0];
  return kit({ shirt: pick, shorts: "#1b1b1b", socks: pick, trim: "#1b1b1b", number: "#1b1b1b" });
}

export function refereeKit(outfield: Kit[]): Kit {
  const options = ["#f5e11b", "#151515", "#e84393"];
  const pick = options.find((color) => outfield.every((item) => dominant(item).every((c) => colorDistance(c, color) > 0.3))) ?? options[1];
  return kit({ shirt: pick, shorts: "#111111", socks: "#111111", trim: "#111111", number: pick });
}
