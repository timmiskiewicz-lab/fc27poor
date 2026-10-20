import type { ClubId } from "./clubs";
import type { InputFrame, MatchEvent, MatchView } from "./state";

export type SideName = "left" | "right";

export interface LobbyPlayer {
  name: string;
  side: SideName | null;
  club: ClubId | null;
}

export interface LobbyState {
  code: string;
  phase: "sides" | "clubs" | "match";
  host: LobbyPlayer;
  guest: LobbyPlayer | null;
  leftClub: ClubId;
  rightClub: ClubId;
}

export interface InputMsg {
  t: "input";
  seq: number;
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
  role: "host" | "guest";
  halfMinutes: number;
  difficulty: number;
}

export type ClientMsg =
  | { t: "join"; code: string }
  | { t: "side"; side: SideName | null }
  | { t: "club"; club: ClubId }
  | { t: "advance" }
  | { t: "start"; halfMinutes?: number; difficulty?: number }
  | InputMsg
  | Snapshot
  | { t: "pause"; paused: boolean }
  | { t: "leave" };

export type ServerMsg =
  | { t: "err"; message: string }
  | { t: "lobby"; lobby: LobbyState }
  | BeginMsg
  | { t: "peerInput"; input: InputMsg }
  | Snapshot
  | { t: "peerLeft" }
  | { t: "paused"; paused: boolean };
