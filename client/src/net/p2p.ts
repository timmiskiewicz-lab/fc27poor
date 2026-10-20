import Peer, { type DataConnection, type PeerError } from "peerjs";
import { isClubId } from "../../../shared/clubs";
import type { ClientMsg, LobbyState, ServerMsg, SideName } from "../../../shared/protocol";

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

function freshLobby(code: string): LobbyState {
  return {
    code,
    phase: "sides",
    host: { name: "Host", side: null, club: "barca" },
    guest: null,
    leftClub: "barca",
    rightClub: "real",
  };
}

/**
 * Room transport without a server. The host's machine runs the room (lobby rules and relaying) and the
 * match itself; the guest talks to it over a WebRTC data channel found through the room code.
 */
export class P2PNet {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
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

  async host(): Promise<string> {
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
          if (!this.closed && !this.conn) this.toHost({ t: "err", message: netErrorText(error) });
        });
        this.lobby = freshLobby(code);
        this.broadcast();
        return code;
      } catch (error) {
        lastError = error;
        if ((error as Partial<PeerError<string>>).type !== "unavailable-id") break;
      }
    }
    throw lastError ?? new Error("timeout");
  }

  async join(code: string): Promise<void> {
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
    conn.send({ t: "join", code } satisfies ClientMsg);
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
    this.conn = null;
    conn?.close();
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
      const busy = this.conn !== null ? "Pokój jest pełny." : this.lobby?.phase === "match" ? "Mecz już trwa." : "";
      if (busy || !this.lobby) {
        void c.send({ t: "err", message: busy || "Pokój jest zamknięty." } satisfies ServerMsg);
        window.setTimeout(() => c.close(), 400);
        return;
      }
      this.conn = c;
      c.on("data", (data) => {
        if (this.conn === c) this.fromGuest(data as ClientMsg);
      });
      const gone = () => {
        if (this.conn === c) this.guestLeft();
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

  private toGuest(msg: ServerMsg): void {
    if (this.conn?.open) void this.conn.send(msg);
  }

  private broadcast(): void {
    if (!this.lobby) return;
    this.toHost({ t: "lobby", lobby: this.lobby });
    this.toGuest({ t: "lobby", lobby: this.lobby });
  }

  private fail(who: Role, message: string): void {
    if (who === "host") this.toHost({ t: "err", message });
    else this.toGuest({ t: "err", message });
  }

  private guestLeft(): void {
    this.conn = null;
    const lobby = this.lobby;
    if (!lobby) return;
    lobby.guest = null;
    if (lobby.phase === "match") this.toHost({ t: "peerLeft" });
    else {
      lobby.phase = "sides";
      this.broadcast();
    }
  }

  private fromGuest(msg: ClientMsg): void {
    const lobby = this.lobby;
    if (!lobby || !msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "join":
        if (lobby.guest) return;
        if (String(msg.code) !== lobby.code) {
          this.fail("guest", "Nie ma pokoju z tym kodem.");
          return;
        }
        lobby.guest = { name: "Gość", side: null, club: null };
        this.broadcast();
        return;
      case "leave":
        this.conn?.close();
        this.guestLeft();
        return;
      case "input":
        if (lobby.phase === "match") this.toHost({ t: "peerInput", input: msg });
        return;
      case "side":
      case "club":
        this.lobbyMove("guest", msg);
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
        this.lobbyMove("host", msg);
        return;
      case "advance":
        this.advance();
        return;
      case "start":
        this.start(msg.halfMinutes, msg.difficulty);
        return;
      case "snap":
        if (lobby.phase === "match") this.toGuest(msg);
        return;
      case "pause":
        this.toGuest({ t: "paused", paused: Boolean(msg.paused) });
        return;
      case "leave": {
        this.toGuest({ t: "peerLeft" });
        const conn = this.conn;
        const peer = this.peer;
        this.closed = true;
        this.conn = null;
        this.peer = null;
        window.setTimeout(() => {
          conn?.close();
          peer?.destroy();
        }, 300);
        return;
      }
      default:
        return;
    }
  }

  private lobbyMove(who: Role, msg: Extract<ClientMsg, { t: "side" } | { t: "club" }>): void {
    const lobby = this.lobby;
    if (!lobby) return;
    const me = who === "host" ? lobby.host : lobby.guest;
    const other = who === "host" ? lobby.guest : lobby.host;
    if (!me) return;
    if (msg.t === "side") {
      if (lobby.phase !== "sides") return;
      const side = msg.side;
      if (side !== null && side !== "left" && side !== "right") return;
      if (side && other?.side === side) {
        this.fail(who, "Ta strona jest zajęta.");
        return;
      }
      me.side = side;
      this.broadcast();
      return;
    }
    if (lobby.phase !== "clubs" || !isClubId(msg.club) || !me.side) return;
    const otherClub = me.side === "left" ? lobby.rightClub : lobby.leftClub;
    if (msg.club === otherClub) {
      this.fail(who, "Druga strona ma już ten klub.");
      return;
    }
    me.club = msg.club;
    if (me.side === "left") lobby.leftClub = msg.club;
    else lobby.rightClub = msg.club;
    this.broadcast();
  }

  private advance(): void {
    const lobby = this.lobby;
    if (!lobby) return;
    const hostSide = lobby.host.side;
    const guestSide = lobby.guest?.side ?? null;
    if (!this.conn || !lobby.guest || !hostSide || !guestSide || hostSide === guestSide) {
      this.fail("host", "Obie osoby muszą stanąć na przeciwnych stronach.");
      return;
    }
    lobby.phase = "clubs";
    lobby.host.club = hostSide === "left" ? lobby.leftClub : lobby.rightClub;
    lobby.guest.club = guestSide === "left" ? lobby.leftClub : lobby.rightClub;
    this.broadcast();
  }

  private start(halfMinutesRaw: number | undefined, difficultyRaw: number | undefined): void {
    const lobby = this.lobby;
    if (!lobby) return;
    if (lobby.phase !== "clubs" || !this.conn || !lobby.guest) {
      this.fail("host", "Do startu potrzebny jest drugi gracz.");
      return;
    }
    const hostSide = lobby.host.side;
    const guestSide = lobby.guest.side;
    if (!hostSide || !guestSide || hostSide === guestSide) {
      this.fail("host", "Wybierzcie przeciwne strony.");
      return;
    }
    if (lobby.leftClub === lobby.rightClub) {
      this.fail("host", "Wybierzcie różne kluby.");
      return;
    }
    lobby.phase = "match";
    const halfMinutes = Math.max(2, Math.min(10, Math.round(Number(halfMinutesRaw) || 4)));
    const difficulty = Math.max(0, Math.min(3, Math.round(Number(difficultyRaw) || 0)));
    const begin = (you: SideName, role: Role): ServerMsg => ({ t: "begin", leftClub: lobby.leftClub, rightClub: lobby.rightClub, you, role, halfMinutes, difficulty });
    this.toHost(begin(hostSide, "host"));
    this.toGuest(begin(guestSide, "guest"));
  }
}
