import type { CamMode, Quality } from "./render/world";

export interface Settings {
  halfMinutes: number;
  difficulty: number;
  cam: CamMode;
  quality: Quality;
  night: boolean;
  volume: number;
  hints: boolean;
}

const KEY = "fc27pe-settings-v1";
const OLD_KEY = "szybka-gra-settings-v2";

export const DEFAULTS: Settings = {
  halfMinutes: 4,
  difficulty: 1,
  cam: "tv",
  quality: "high",
  night: true,
  volume: 0.8,
  hints: true,
};

export const HALF_OPTIONS = [2, 3, 4, 5, 6, 8, 10];
export const DIFFICULTY = ["Amator", "Profesjonalista", "Klasa światowa", "Legenda"];
export const CAMS: Array<[CamMode, string]> = [
  ["tv", "Telewizyjna"],
  ["wide", "Szeroka"],
  ["pro", "Bliska"],
];
export const QUALITY: Array<[Quality, string]> = [
  ["low", "Niska"],
  ["high", "Wysoka"],
  ["ultra", "Ultra"],
];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      halfMinutes: HALF_OPTIONS.includes(Number(s.halfMinutes)) ? Number(s.halfMinutes) : DEFAULTS.halfMinutes,
      difficulty: [0, 1, 2, 3].includes(Number(s.difficulty)) ? Number(s.difficulty) : DEFAULTS.difficulty,
      cam: CAMS.some(([c]) => c === s.cam) ? (s.cam as CamMode) : DEFAULTS.cam,
      quality: QUALITY.some(([q]) => q === s.quality) ? (s.quality as Quality) : DEFAULTS.quality,
      night: typeof s.night === "boolean" ? s.night : DEFAULTS.night,
      volume: typeof s.volume === "number" ? Math.max(0, Math.min(1, s.volume)) : DEFAULTS.volume,
      hints: typeof s.hints === "boolean" ? s.hints : DEFAULTS.hints,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable */
  }
}
