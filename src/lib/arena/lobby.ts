import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type LobbyPresence = {
  roomCode: string;
  roomName: string;
  playerName: string;
};

export type LobbyRoom = {
  code: string;
  name: string;
  players: string[];
};

export const LOBBY_CHANNEL = "arena:lobby:v1";

/**
 * Subscribe to the lobby channel as a read-only observer.
 * Returns a teardown function.
 */
export function subscribeLobby(onRooms: (rooms: LobbyRoom[]) => void): () => void {
  const id = `obs-${Math.random().toString(36).slice(2)}`;
  const channel = supabase.channel(LOBBY_CHANNEL, {
    config: { presence: { key: id } },
  });

  const emit = () => {
    const state = channel.presenceState<LobbyPresence>();
    const byRoom = new Map<string, LobbyRoom>();
    for (const arr of Object.values(state)) {
      for (const meta of arr) {
        if (!meta || !("roomCode" in meta)) continue;
        const existing = byRoom.get(meta.roomCode);
        if (existing) {
          existing.players.push(meta.playerName);
          if (meta.roomName && !existing.name) existing.name = meta.roomName;
        } else {
          byRoom.set(meta.roomCode, {
            code: meta.roomCode,
            name: meta.roomName || meta.roomCode,
            players: [meta.playerName],
          });
        }
      }
    }
    onRooms(Array.from(byRoom.values()).sort((a, b) => b.players.length - a.players.length));
  };

  channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit)
    .subscribe();

  return () => {
    channel.unsubscribe();
    supabase.removeChannel(channel);
  };
}

/**
 * Announce a room to the lobby. Returns a teardown function.
 */
export function announceRoom(presence: LobbyPresence): () => void {
  const channel: RealtimeChannel = supabase.channel(LOBBY_CHANNEL, {
    config: { presence: { key: `${presence.roomCode}:${Math.random().toString(36).slice(2)}` } },
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      channel.track(presence);
    }
  });
  return () => {
    channel.unsubscribe();
    supabase.removeChannel(channel);
  };
}