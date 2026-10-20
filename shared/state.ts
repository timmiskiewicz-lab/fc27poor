export type MatchMode = "kickoff" | "play" | "stoppage" | "setpiece" | "goal" | "replay" | "halftime" | "fulltime" | "paused";

export type RestartKind = "kickoff" | "throwin" | "corner" | "goalkick" | "freekick" | "indirect" | "penalty";

export const ACT = {
  run: 0,
  kick: 1,
  slide: 2,
  fallen: 3,
  dive: 4,
  celebrate: 5,
  throwin: 6,
  header: 7,
  tackle: 8,
  hold: 9,
  stumble: 10,
  jockey: 11,
  gkset: 12,
  off: 13,
  card: 14,
  flag: 15,
  point: 16,
  gkthrow: 17,
  wait: 18,
  volley: 19,
} as const;

/** `aa` of the celebrate act: 0 = teammate joining in, the rest are the scorer's styles. */
export const CELEBRATION = {
  teammate: 0,
  kneeSlide: 1,
  airplane: 2,
  jumpSpin: 3,
  badgeKiss: 4,
  crossedArms: 5,
  roar: 6,
  backflip: 7,
  pointSky: 8,
  cupEar: 9,
  dance: 10,
  zen: 11,
  armsWide: 12,
} as const;

export const SIGNATURE_CELEBRATION: Record<string, number> = {
  "Kylian Mbappé": CELEBRATION.crossedArms,
  "Vinícius Júnior": CELEBRATION.dance,
  Rodrygo: CELEBRATION.dance,
  "Erling Haaland": CELEBRATION.zen,
  "Jude Bellingham": CELEBRATION.armsWide,
  "Harry Kane": CELEBRATION.roar,
  "Lamine Yamal": CELEBRATION.cupEar,
  Raphinha: CELEBRATION.pointSky,
  "Ousmane Dembélé": CELEBRATION.kneeSlide,
  "Phil Foden": CELEBRATION.badgeKiss,
  "Jamal Musiala": CELEBRATION.airplane,
  "Khvicha Kvaratskhelia": CELEBRATION.armsWide,
};

export interface InputFrame {
  mx: number;
  mz: number;
  ax: number;
  az: number;
  sprint: boolean;
  pass: boolean;
  shoot: boolean;
  through: boolean;
  lob: boolean;
  slide: boolean;
  switchP: boolean;
  jockey: boolean;
  skip: boolean;
}

export interface PlayerView {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  act: number;
  at: number;
  aa: number;
  on: boolean;
}

export interface GoalInfo {
  team: 0 | 1;
  id: number;
  minute: number;
  own: boolean;
  pen: boolean;
}

export interface MatchStats {
  possession: [number, number];
  shots: [number, number];
  onTarget: [number, number];
  passes: [number, number];
  passesOk: [number, number];
  fouls: [number, number];
  yellows: [number, number];
  reds: [number, number];
  corners: [number, number];
  offsides: [number, number];
  tackles: [number, number];
  saves: [number, number];
}

export interface MatchView {
  ball: [number, number, number];
  ballV: [number, number, number];
  owner: number;
  held: boolean;
  players: PlayerView[];
  refs: PlayerView[];
  control: [number, number];
  charge: [number, number];
  chargeKind: [number, number];
  score: [number, number];
  clock: number;
  halfLen: number;
  half: 1 | 2;
  mode: MatchMode;
  attack: [number, number];
  restart: RestartKind | null;
  restartTeam: number;
  cut: number;
  cards: number[];
  goals: GoalInfo[];
  stats: MatchStats;
  aim: [number, number, number, number];
}

export type MatchEvent =
  | { k: "kick"; power: number }
  | { k: "touch" }
  | { k: "whistle"; n: number }
  | { k: "goal"; team: 0 | 1; id: number }
  | { k: "post" }
  | { k: "net" }
  | { k: "save"; team: 0 | 1 }
  | { k: "ooh" }
  | { k: "tackle" }
  | { k: "banner"; text: string; sub: string; tone: "info" | "yellow" | "red" | "goal" | "offside" }
  | { k: "card"; id: number; red: boolean }
  | { k: "replay" };

export function emptyStats(): MatchStats {
  return {
    possession: [0, 0],
    shots: [0, 0],
    onTarget: [0, 0],
    passes: [0, 0],
    passesOk: [0, 0],
    fouls: [0, 0],
    yellows: [0, 0],
    reds: [0, 0],
    corners: [0, 0],
    offsides: [0, 0],
    tackles: [0, 0],
    saves: [0, 0],
  };
}
