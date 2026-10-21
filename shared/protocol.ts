import type { ClubId } from "./clubs";
import type { InputFrame, MatchEvent, MatchView } from "./state";

export type SideName = "left" | "right";

export type RulesMode = "full" | "free";

export const MAX_PLAYERS = 8;

/** Stable, distinct colours handed out in slot order. */
export const PLAYER_COLORS = ["#36a3ff", "#ff4d5e", "#3ddc84", "#f6c945", "#c084fc", "#ff8a3d", "#22d3ee", "#fb7185"];

export interface LobbyPlayer {
  slot: number;
  name: string;
  color: string;
  side: SideName | null;
}

export interface LobbyState {
  code: string;
  phase: "sides" | "clubs" | "match";
  players: LobbyPlayer[];
  leftClub: ClubId;
  rightClub: ClubId;
  rules: RulesMode;
}

export interface InputMsg {
  t: "input";
  seq: number;
  slot: number;
  f: InputFrame;
}

export interface Snapshot {
  t: "snap";
  at: number;
  v: MatchView;
  ev: MatchEvent[];
}

export interface BeginMsg {
  t: "begin";
  leftClub: ClubId;
  rightClub: ClubId;
  you: SideName;
  slot: number;
  role: "host" | "guest";
  halfMinutes: number;
  difficulty: number;
  rules: RulesMode;
}

export type ClientMsg =
  | { t: "join"; code: string; name: string }
  | { t: "side"; side: SideName | null }
  | { t: "club"; club: ClubId }
  | { t: "rules"; rules: RulesMode }
  | { t: "advance" }
  | { t: "start"; halfMinutes?: number; difficulty?: number }
  | InputMsg
  | Snapshot
  | { t: "pause"; paused: boolean }
  | { t: "leave" };

export type ServerMsg =
  | { t: "err"; message: string }
  | { t: "you"; slot: number }
  | { t: "lobby"; lobby: LobbyState }
  | BeginMsg
  | { t: "peerInput"; slot: number; input: InputMsg }
  | Snapshot
  | { t: "peerLeft"; slot?: number }
  | { t: "paused"; paused: boolean };
