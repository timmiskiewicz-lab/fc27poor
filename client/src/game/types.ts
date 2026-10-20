import type { ClubId } from "../../../shared/clubs";
import type { SideName } from "../../../shared/protocol";
import type { InputFrame } from "../../../shared/state";

export type { InputFrame };

export const EMPTY_INPUT: InputFrame = {
  mx: 0,
  mz: 0,
  ax: 0,
  az: 0,
  sprint: false,
  pass: false,
  shoot: false,
  through: false,
  lob: false,
  slide: false,
  switchP: false,
  jockey: false,
  skip: false,
};

export interface MatchConfig {
  leftClub: ClubId;
  rightClub: ClubId;
  humans: [boolean, boolean];
  halfMinutes: number;
  difficulty: number;
  seed?: number;
}

export interface LocalSideSetup {
  left: string | null;
  right: string | null;
  leftClub: ClubId;
  rightClub: ClubId;
}

export function teamIndex(side: SideName): 0 | 1 {
  return side === "left" ? 0 : 1;
}
