import Peer, { type DataConnection, type PeerError } from "peerjs";
import { isClubId } from "../../../shared/clubs";
import { MAX_PLAYERS, PLAYER_COLORS, type ClientMsg, type LobbyPlayer, type LobbyState, type RulesMode, type ServerMsg, type SideName } from "../../../shared/protocol";

/** Peer ids on the public PeerJS broker are global, so the room code is namespaced. */
const PREFIX = "fc27pe-";
const OPEN_TIMEOUT = 15000;

type Role = "host" | "guest";

const NET_ERRORS: Record<string, string> = {
  "peer-unavailable": "Nie ma pokoju z tym kodem (albo host wyszedł).",
  network: "Brak połączenia z serwerem parowania. Sprawdź internet.",
  "server-error": "Serwer parowania PeerJS nie odpowiada. Spróbuj za chwilę.",
  "socket-error": "Brak połączenia z serwerem parowania. Sprawdź internet.",
  "socket-closed": "Połączenie z serwerem parowania zostało zamknięte.",
  "browser-incompatible": "Ta wersja gry nie obsługuje WebRTC.",
  "webrtc": "Nie udało się zestawić połączenia między komputerami (zapora albo NAT).",
};

export function netErrorText(error: unknown): string {
  const type = (error as Partial<PeerError<string>> | null)?.type;
  if (type && NET_ERRORS[type]) return NET_ERRORS[type];
  if (error instanceof Error && error.message === "timeout") return "Upłynął limit czasu połączenia. Sprawdź kod i internet.";
  return "Nie udało się połączyć.";
}

function openPeer(id: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, { debug: 0 });
    const timer = window.setTimeout(() => {
      peer.destroy();
      reject(new Error("timeout"));
    }, OPEN_TIMEOUT);
    peer.once("open", () => {
      window.clearTimeout(timer);
      resolve(peer);
    });
    peer.once("error", (error) => {
      window.clearTimeout(timer);
      peer.destroy();
      reject(error);
    });
  });
}

function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 16);
  return name.length >= 2 ? name : "";
}

function freshLobby(code: string, name: string): LobbyState {
  return {
    code,
    phase: "sides",
    players: [{ slot: 0, name, color: PLAYER_COLORS[0], side: null }],
    leftClub: "barca",
    rightClub: "real",
    rules: "full",
  };
}

/**
 * Room transport without a server. The host's machine runs the room (lobby rules and relaying) and the
 * match itself; the guest talks to it over a WebRTC data channel found through the room code.
 */
interface Link {
  conn: DataConnection;
  slot: number;
}

export class P2PNet {
  private peer: Peer | null = null;
  /** The guest's single connection to the host. The host keeps `links` instead. */
  private conn: DataConnection | null = null;
  private links: Link[] = [];
  private lobby: LobbyState | null = null;
  private role: Role | null = null;
  private closed = false;

  constructor(
    private readonly onMsg: (msg: ServerMsg) => void,
    private readonly onClose: () => void,
  ) {}

  get open(): boolean {
    return !this.closed && this.peer !== null && !this.peer.destroyed;
  }

  async host(name: string): Promise<string> {
    this.role = "host";
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      try {
        const peer = await openPeer(PREFIX + code);
        if (this.closed) {
          peer.destroy();
          throw new Error("closed");
        }
        this.peer = peer;
        peer.on("connection", (c) => this.accept(c));
        peer.on("disconnected", () => {
          if (!this.closed && !peer.destroyed) peer.reconnect();
        });
        peer.on("error", (error) => {
          if (!this.closed && this.links.length === 0) this.toHost({ t: "err", message: netErrorText(error) });
        });
        this.lobby = freshLobby(code, cleanName(name) || "Host");
        this.broadcast();
        return code;
      } catch (error) {
        lastError = error;
        if ((error as Partial<PeerError<string>>).type !== "unavailable-id") break;
      }
    }
    throw lastError ?? new Error("timeout");
  }

  async join(code: string, name: string): Promise<void> {
    this.role = "guest";
    const peer = await openPeer(`${PREFIX}g${Math.random().toString(36).slice(2, 12)}`);
    if (this.closed) {
      peer.destroy();
      throw new Error("closed");
    }
    this.peer = peer;
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), OPEN_TIMEOUT);
      conn.once("open", () => {
        window.clearTimeout(timer);
        resolve();
      });
      peer.once("error", (error) => {
        window.clearTimeout(timer);
        reject(error);
      });
    }).catch((error: unknown) => {
      this.close();
      throw error;
    });
    this.conn = conn;
    conn.on("data", (data) => {
      if (!this.closed) this.onMsg(data as ServerMsg);
    });
    conn.on("close", () => this.hostGone());
    conn.on("error", () => this.hostGone());
    conn.send({ t: "join", code, name: cleanName(name) || "Gracz" } satisfies ClientMsg);
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    if (this.role === "guest") {
      if (this.conn?.open) void this.conn.send(msg);
      return;
    }
    if (this.role === "host") this.fromHost(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const conn = this.conn;
    const links = this.links;
    this.conn = null;
    this.links = [];
    conn?.close();
    for (const link of links) link.conn.close();
    this.peer?.destroy();
    this.peer = null;
  }

  // ---------------------------------------------------------------- guest side

  private hostGone(): void {
    if (this.closed) return;
    this.onMsg({ t: "peerLeft" });
    this.close();
    this.onClose();
  }

  // ---------------------------------------------------------------- host side: the room

  private accept(c: DataConnection): void {
    c.on("open", () => {
      const full = (this.lobby?.players.length ?? 1) >= MAX_PLAYERS;
      const busy = full ? "Pokój jest pełny (maks. 8)." : this.lobby?.phase === "match" ? "Mecz już trwa." : "";
      if (busy || !this.lobby) {
        void c.send({ t: "err", message: busy || "Pokój jest zamknięty." } satisfies ServerMsg);
        window.setTimeout(() => c.close(), 400);
        return;
      }
      const link: Link = { conn: c, slot: -1 };
      this.links.push(link);
      c.on("data", (data) => {
        if (this.links.includes(link)) this.fromGuest(link, data as ClientMsg);
      });
      const gone = () => {
        if (this.links.includes(link)) this.guestLeft(link);
      };
      c.on("close", gone);
      c.on("error", gone);
    });
  }

  private toHost(msg: ServerMsg): void {
    const copy = structuredClone(msg);
    queueMicrotask(() => {
      if (!this.closed) this.onMsg(copy);
    });
  }

  private toGuests(msg: ServerMsg): void {
    for (const link of this.links) if (link.conn.open) void link.conn.send(msg);
  }

  private toSlot(slot: number, msg: ServerMsg): void {
    const link = this.links.find((l) => l.slot === slot);
    if (link?.conn.open) void link.conn.send(msg);
  }

  private broadcast(): void {
    if (!this.lobby) return;
    this.toHost({ t: "lobby", lobby: this.lobby });
    this.toGuests({ t: "lobby", lobby: this.lobby });
  }

  private fail(slot: number, message: string): void {
    if (slot === 0) this.toHost({ t: "err", message });
    else this.toSlot(slot, { t: "err", message });
  }

  private guestLeft(link: Link): void {
    this.links = this.links.filter((l) => l !== link);
    const lobby = this.lobby;
    if (!lobby || link.slot < 0) return;
    lobby.players = lobby.players.filter((p) => p.slot !== link.slot);
    if (lobby.phase === "match") this.toHost({ t: "peerLeft", slot: link.slot });
    else this.broadcast();
  }

  private fromGuest(link: Link, msg: ClientMsg): void {
    const lobby = this.lobby;
    if (!lobby || !msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "join": {
        if (link.slot >= 0) return;
        if (String(msg.code) !== lobby.code) {
          void link.conn.send({ t: "err", message: "Nie ma pokoju z tym kodem." } satisfies ServerMsg);
          return;
        }
        if (lobby.players.length >= MAX_PLAYERS || lobby.phase === "match") {
          void link.conn.send({ t: "err", message: lobby.phase === "match" ? "Mecz już trwa." : "Pokój jest pełny (maks. 8)." } satisfies ServerMsg);
          window.setTimeout(() => link.conn.close(), 400);
          return;
        }
        const used = new Set(lobby.players.map((p) => p.slot));
        let slot = 1;
        while (used.has(slot)) slot += 1;
        link.slot = slot;
        lobby.players.push({ slot, name: cleanName(msg.name) || `Gracz ${slot + 1}`, color: PLAYER_COLORS[slot % PLAYER_COLORS.length], side: null });
        void link.conn.send({ t: "you", slot } satisfies ServerMsg);
        this.broadcast();
        return;
      }
      case "leave":
        link.conn.close();
        return;
      case "input":
        if (lobby.phase === "match" && link.slot >= 0) this.toHost({ t: "peerInput", slot: link.slot, input: { ...msg, slot: link.slot } });
        return;
      case "side":
      case "club":
        if (link.slot >= 0) this.lobbyMove(link.slot, msg);
        return;
      default:
        return;
    }
  }

  private fromHost(msg: ClientMsg): void {
    const lobby = this.lobby;
    if (!lobby) return;
    switch (msg.t) {
      case "side":
      case "club":
        this.lobbyMove(0, msg);
        return;
      case "rules":
        if (lobby.phase === "match") return;
        lobby.rules = msg.rules === "free" ? "free" : "full";
        this.broadcast();
        return;
      case "advance":
        this.advance();
        return;
      case "start":
        this.start(msg.halfMinutes, msg.difficulty);
        return;
      case "snap":
        if (lobby.phase === "match") this.toGuests(msg);
        return;
      case "pause":
        this.toGuests({ t: "paused", paused: Boolean(msg.paused) });
        return;
      case "leave": {
        this.toGuests({ t: "peerLeft" });
        const links = this.links;
        const peer = this.peer;
        this.closed = true;
        this.links = [];
        this.peer = null;
        window.setTimeout(() => {
          for (const link of links) link.conn.close();
          peer?.destroy();
        }, 300);
        return;
      }
      default:
        return;
    }
  }

  private player(slot: number): LobbyPlayer | undefined {
    return this.lobby?.players.find((p) => p.slot === slot);
  }

  private lobbyMove(slot: number, msg: Extract<ClientMsg, { t: "side" } | { t: "club" }>): void {
    const lobby = this.lobby;
    const me = this.player(slot);
    if (!lobby || !me) return;
    if (msg.t === "side") {
      if (lobby.phase !== "sides") return;
      const side = msg.side;
      if (side !== null && side !== "left" && side !== "right") return;
      me.side = side;
      this.broadcast();
      return;
    }
    if (lobby.phase !== "clubs" || !isClubId(msg.club) || !me.side) return;
    const otherClub = me.side === "left" ? lobby.rightClub : lobby.leftClub;
    if (msg.club === otherClub) {
      this.fail(slot, "Druga strona ma już ten klub.");
      return;
    }
    if (me.side === "left") lobby.leftClub = msg.club;
    else lobby.rightClub = msg.club;
    this.broadcast();
  }

  private readySides(): boolean {
    const lobby = this.lobby;
    if (!lobby) return false;
    const left = lobby.players.some((p) => p.side === "left");
    const right = lobby.players.some((p) => p.side === "right");
    return lobby.players.length >= 2 && lobby.players.every((p) => p.side) && left && right;
  }

  private advance(): void {
    const lobby = this.lobby;
    if (!lobby) return;
    if (!this.links.length || !this.readySides()) {
      this.fail(0, "Potrzeba co najmniej dwóch osób, po jednej na każdej stronie.");
      return;
    }
    lobby.phase = "clubs";
    this.broadcast();
  }

  private start(halfMinutesRaw: number | undefined, difficultyRaw: number | undefined): void {
    const lobby = this.lobby;
    if (!lobby) return;
    if (lobby.phase !== "clubs" || !this.links.length) {
      this.fail(0, "Do startu potrzebny jest drugi gracz.");
      return;
    }
    if (!this.readySides()) {
      this.fail(0, "Każdy musi wybrać stronę i obie strony muszą być zajęte.");
      return;
    }
    if (lobby.leftClub === lobby.rightClub) {
      this.fail(0, "Wybierzcie różne kluby.");
      return;
    }
    lobby.phase = "match";
    const halfMinutes = Math.max(2, Math.min(10, Math.round(Number(halfMinutesRaw) || 4)));
    const difficulty = Math.max(0, Math.min(3, Math.round(Number(difficultyRaw) || 0)));
    const rules: RulesMode = lobby.rules;
    for (const person of lobby.players) {
      if (!person.side) continue;
      const msg: ServerMsg = { t: "begin", leftClub: lobby.leftClub, rightClub: lobby.rightClub, you: person.side, slot: person.slot, role: person.slot === 0 ? "host" : "guest", halfMinutes, difficulty, rules };
      if (person.slot === 0) this.toHost(msg);
      else this.toSlot(person.slot, msg);
    }
  }
}
