// The game's data and the StarHermit platform, on the runtime's modules:
// - progress (journey stars, lessons, challenges, dailies, achievements,
//   mastery, stats: js/core/progress.js) is the game's save (starhermit:storage
//   `saves`): on the device and, signed in, in the account's cloud slot, two
//   devices' progress merged on a conflict (mergeProgress). The browser
//   build's cloud save (the JS SDK slot game:<slug>, a versioned document
//   whose payload is the progress) shows as foreign: it is merged in and
//   replaces the slot once (replaceForeign);
// - the game's own options (theme, cosmetics, camera, the accessibility
//   options the runtime has no equivalent for, telemetry consent, the M-key
//   mute) and the profile (name, avatar colour, ratings) are `settings`
//   (game.<key>, synced with the account); the browser build's per-player
//   settings keys are migrated where the game still has the option, then
//   removed. Sound, graphics, language, controls, text size, high contrast
//   and reduced motion are the runtime's Options;
// - the round in progress (Resume) stays on the device (`storage`);
// - a finished solo round's total goes to the high-score board through
//   server.js: a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did;
// - hosted tables are realtime rooms (rooms.*) for the lobby and the
//   session the platform binds to a started room for the round, refereed by
//   server.js over its game socket (connectGame): `roomsAdapter` gives
//   js/core/hosted.js that surface. The script records the result.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, friends, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, profile as fetchProfile,
  rooms, serverNow, sessions, type GameSocket, type Leaderboard, type Room, type RoomSocket,
} from "starhermit:platform";
import { saves, settings, storage } from "starhermit:storage";
import {
  DEFAULT_PROFILE, DEFAULT_SETTINGS, fromBrowserCloudSave, migrateLegacySetting, normalizeProfile, normalizeProgress, normalizeSettings,
} from "../js/core/storage.js";
import { mergeProgress } from "../js/core/progress.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Progress = any;
export type Settings = typeof DEFAULT_SETTINGS;
export type Profile = typeof DEFAULT_PROFILE;
const SCHEMA = 1;

// --- progress ------------------------------------------------------------------------
let progress: Progress = normalizeProgress(null);
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) came in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function adopted(): void { for (const fn of mergedListeners) fn(); }

export function getProgress(): Progress { return progress; }
/** Replaces the progress document and saves it (device at once, the account debounced). */
export function saveProgress(p: Progress = progress): void {
  progress = normalizeProgress(p);
  try { saves.save(progress as JsonValue, { schema: SCHEMA }); } catch (e) { console.warn(`save: ${String(e)}`); }
}

let lastSavedAt = 0;
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const fromBrowser = fromBrowserCloudSave(old.text);
  if (fromBrowser) progress = normalizeProgress(mergeProgress(fromBrowser, progress));
  try { saves.save(progress as JsonValue, { schema: SCHEMA, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
  if (fromBrowser) adopted();
}

/** Reads the device's save and options, starts listening for the account's (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  progress = normalizeProgress(cur?.data);
  lastSavedAt = cur?.savedAt ?? 0;
  saves.onConflict((local, remote) => ({ merged: mergeProgress(remote.data, local?.data) as JsonValue }));
  saves.onStatus((_status, state) => {
    if (state === "foreign") { migrateForeign(); return; }
    // The account's save replaced the device's (another device saved last): adopt it.
    const now = saves.load();
    if (now && now.savedAt !== lastSavedAt) {
      lastSavedAt = now.savedAt;
      const next = normalizeProgress(now.data);
      if (JSON.stringify(next) !== JSON.stringify(progress)) { progress = next; adopted(); }
    }
  });
  if (saves.state() === "foreign") migrateForeign();
  settings.onLegacy(importLegacySettings);
  importLegacySettings();
  refreshInvite();
}
export function flushSave(): void { void saves.flush().catch(() => undefined); }

// --- the game's options and the profile ----------------------------------------------------
export function loadSettings(): Settings {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const v = settings.get(key);
    if (v !== undefined) raw[key] = v;
  }
  return normalizeSettings(raw) as Settings;
}
export function saveSettings(s: Settings): void {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = s[key] as unknown as JsonValue;
    if (JSON.stringify(settings.get(key)) === JSON.stringify(v)) continue;
    try { settings.set(key, v); } catch (e) { console.warn(`setting ${key}: ${String(e)}`); }
  }
}
export function loadProfile(): Profile { return normalizeProfile(settings.get("profile")) as Profile; }
export function saveProfile(p: Profile): void {
  try { settings.set("profile", p as unknown as JsonValue); } catch (e) { console.warn(`profile: ${String(e)}`); }
}
const settingsListeners = new Set<() => void>();
/** fn() after the account's (or another device's) options came in. */
export function onSettingsChange(fn: () => void): void { settingsListeners.add(fn); }
settings.onChange(() => { for (const fn of settingsListeners) fn(); });

function importLegacySettings(): void {
  const keys = settings.legacyKeys();
  if (!keys) return;
  let changed = false;
  for (const key of keys) {
    let pairs: { key: string; value: unknown }[] = [];
    try { pairs = migrateLegacySetting(key, settings.legacy(key)); } catch { pairs = []; }
    for (const m of pairs) {
      if (settings.get(m.key) === undefined) { settings.set(m.key, m.value as JsonValue); changed = true; }
    }
    // Every legacy key is the browser build's (its settings, sound, frame-rate and language slots).
    try { settings.removeLegacy(key); } catch { /* not a removable key */ }
  }
  if (changed) for (const fn of settingsListeners) fn();
}

// --- the round in progress (this device only) -------------------------------------------------
export function loadSnapshot<T>(): T | null {
  try { return storage.getJson("snapshot") as unknown as T | null; } catch { return null; }
}
export function saveSnapshot(snap: unknown): void {
  try { storage.setJson("snapshot", snap as JsonValue); } catch (e) { console.warn(`snapshot: ${String(e)}`); }
}
export function clearSnapshot(): void { try { storage.remove("snapshot"); } catch { /* gone */ } }

// --- the player and the clock ---------------------------------------------------------------
export function signedIn(): boolean { return player() !== null; }
export function accountName(): string | null { return player()?.displayName?.slice(0, 40) ?? null; }
export function userId(): string | null { return player()?.userId ?? null; }
let invite: string | null = null;
function refreshInvite(): void {
  invite = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
const playerListeners = new Set<() => void>();
export function onAccountChange(fn: () => void): void { playerListeners.add(fn); }
onPlayerChange(() => { refreshInvite(); board = null; for (const fn of playerListeners) fn(); });

/** The platform's time (daily courts must not follow the device clock), else the device's. */
export function nowMs(): number {
  let t: number | null = null;
  try { t = serverNow(); } catch { t = null; }
  return t ?? Date.now();
}

const names = new Map<string, string>();
/** A player's display name (cached); "player" while unknown. */
export async function displayName(id: string): Promise<string> {
  const hit = names.get(id);
  if (hit) return hit;
  try {
    const p = await fetchProfile(id);
    names.set(id, p.displayName);
    return p.displayName;
  } catch { return "Player " + id.slice(0, 6); }
}

// --- leaderboard -------------------------------------------------------------------------------
let board: Leaderboard | null = null;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? null;
  return board;
}

/** Posts a finished round's total through server.js (its score posting); whether it was
 * taken and the player's rank (null past the first 100). Never rejects. */
export async function submitScore(points: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": points } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const page = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = page.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}

// --- hosted tables: realtime rooms -----------------------------------------------------------------
type Res = { ok: boolean; status: number; data?: unknown; error?: string };
const errRes = (e: unknown): Res => {
  const pe = e as { status?: number; kind?: string; message?: string };
  return { ok: false, status: pe?.status ?? (pe?.kind === "not-found" ? 404 : 0), error: pe?.kind || pe?.message || "network" };
};
async function call(fn: () => Promise<unknown>): Promise<Res> {
  if (!player()) return { ok: false, status: 0, error: "standalone" };
  try { const data = await fn(); return { ok: true, status: data == null ? 204 : 200, data }; }
  catch (e) { return errRes(e); }
}
/** The seat (slot) the signed-in player has at a room, else 1. */
function mySeat(room: Room): number {
  const me = player()?.userId;
  const p = room.participants.find((x) => x.userId === me);
  return p ? p.slot : 1;
}
const roomRes = (room: Room | null): Res => (room
  ? { ok: true, status: 200, data: { roomId: room.id, seat: mySeat(room), metadata: room.metadata, joinCode: room.joinCode, gameSessionId: room.gameSessionId } }
  : { ok: false, status: 404, error: "not-found" });

interface SocketHandlers {
  onOpen?: () => void;
  onClose?: () => void;
  onAuthLost?: () => void;
  onTermsRequired?: () => void;
  onUnavailable?: (code: string) => void;
}
interface RoomHandlers extends SocketHandlers {
  onMessage?: (m: { control?: unknown }) => void;
}
interface GameHandlers extends SocketHandlers {
  onMessage?: (data: unknown) => void;
  onError?: (message: string) => void;
}
function stopped(h: SocketHandlers, reason: string): void {
  if (reason === "terms-required") h.onTermsRequired?.();
  else if (reason === "signed-out") h.onAuthLost?.();
  else if (reason !== "closed") h.onUnavailable?.(reason);
}

/**
 * js/core/hosted.js's platform surface: realtime rooms for the lobby (create,
 * open, quick-join, invites, the roster), `startRoom` (the platform binds a
 * session to the room, refereed by server.js), and that session's game socket
 * for the round. No client posts a result: the script returns it.
 */
export const roomsAdapter = {
  get hosted(): boolean { return player() !== null; },
  get online(): boolean { return player() !== null; },
  get slug(): string { return "crown-draughts"; },
  get userId(): string | null { return player()?.userId ?? null; },
  createRoom(config: { teamCount: number; seatsPerTeam: number; metadata?: JsonValue; aiPlayers?: unknown }): Promise<Res> {
    return call(async () => {
      const room = await rooms.create({ teamCount: config.teamCount, seatsPerTeam: config.seatsPerTeam, metadata: config.metadata ?? null, backfillAiPlayers: false });
      return { roomId: room.id, joinCode: room.joinCode, seat: mySeat(room), metadata: room.metadata };
    });
  },
  openRoom(roomId: string): Promise<Res> { return call(() => rooms.open(roomId)); },
  /** Host: starts the room; `data.gameSessionId` is the script's session (null when it could not be made). */
  startRoom(roomId: string): Promise<Res> {
    return call(async () => {
      const room = await rooms.start(roomId);
      return { gameSessionId: room.gameSessionId };
    });
  },
  async quickJoin(): Promise<Res> {
    if (!player()) return { ok: false, status: 0, error: "standalone" };
    try { return roomRes(await rooms.quickJoin()); } catch (e) { return errRes(e); }
  },
  async acceptRoomInvite(inviteId: string): Promise<Res> {
    if (!player()) return { ok: false, status: 0, error: "standalone" };
    try { return roomRes(await rooms.acceptInvite(inviteId)); } catch (e) { return errRes(e); }
  },
  inviteToRoom(roomId: string, uid: string): Promise<Res> { return call(() => rooms.invite(roomId, uid)); },
  async listFriends(): Promise<Res> {
    const r = await call(() => friends.list());
    if (!r.ok) return { ...r, data: [] };
    const list = (r.data as { userId: string; username: string; online: boolean }[]) || [];
    const data = await Promise.all(list.map(async (f) => ({ ...f, name: await displayName(f.userId) })));
    return { ok: true, status: 200, data };
  },
  /** Incoming room invites: [{ id, fromUserId, fromName }]. */
  async pollInvites(): Promise<Res> {
    const r = await call(() => rooms.invites());
    if (!r.ok) return r;
    const list = (r.data as { id: string; fromUserId: string; fromUsername: string }[]) || [];
    return { ok: true, status: 200, data: list.map((i) => ({ id: i.id, fromUserId: i.fromUserId, fromName: i.fromUsername })) };
  },
  leaveRoom(roomId: string): Promise<Res> { return call(() => rooms.leave(roomId)); },
  profileFor(uid: string): Promise<string> { return displayName(uid); },
  /** The room's socket for the lobby: its roster (seats, status, the bound session) as control messages. */
  openRoomSocket(roomId: string, h: RoomHandlers): { close(): void } {
    let socket: RoomSocket | null = null;
    try { socket = rooms.connect(roomId); } catch { queueMicrotask(() => h.onUnavailable?.("connect")); }
    const roster = (room: Room): void => {
      const players = [...room.participants].sort((a, b) => a.slot - b.slot).map((p) => ({
        seat: p.slot, userId: p.userId, name: (p.userId && names.get(p.userId)) || p.username, connected: true,
      }));
      h.onMessage?.({ control: { type: "roster", players, status: room.status, gameSessionId: room.gameSessionId } });
      // Resolve display names, then tell again.
      const unknown = room.participants.filter((p) => p.userId && !names.has(p.userId));
      if (unknown.length) void Promise.all(unknown.map((p) => displayName(p.userId!))).then(() => roster(room));
    };
    if (socket) {
      socket.on("open", () => h.onOpen?.());
      socket.on("roster", roster);
      socket.on("disconnected", () => h.onClose?.());
      socket.on("stopped", (reason) => stopped(h, reason));
    }
    return { close(): void { try { socket?.close(); } catch { /* gone */ } socket = null; } };
  },
  /** The bound session's game socket: commands to server.js, its broadcasts back. */
  openGameSocket(sessionId: string, h: GameHandlers): { send(data: unknown): boolean; close(): void } {
    let socket: GameSocket | null = null;
    try { socket = connectGame(sessionId); } catch { queueMicrotask(() => h.onUnavailable?.("connect")); }
    if (socket) {
      socket.on("open", () => h.onOpen?.());
      socket.on("game", (data) => h.onMessage?.(data));
      socket.on("error", (message) => h.onError?.(message));
      socket.on("disconnected", () => h.onClose?.());
      socket.on("stopped", (reason) => stopped(h, reason));
      socket.on("abandoned", (reason) => h.onUnavailable?.(`abandoned:${reason}`));
    }
    return {
      send(data: unknown): boolean {
        try { return !!socket && socket.state === "open" && socket.sendCommand(data as JsonValue); } catch { return false; }
      },
      close(): void { try { socket?.close(); } catch { /* gone */ } socket = null; },
    };
  },
};
