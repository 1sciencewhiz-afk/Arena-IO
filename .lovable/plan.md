## 1. Fix the one-way hit / invisible-bullet bug

Current model: each client owns its own bullets locally, broadcasts `shoot` with `self:false`, and the *victim* validates collisions against itself. This is fragile — if presence/state hasn't synced the shooter's player object on the victim's side, the bullet renders without color and can be filtered out; and any dropped `shoot` event makes that side's attacks completely invisible to others.

New model — **shooter-authoritative**:

- Drop `broadcast: { self: false }`. Every client (including the shooter) processes `shoot`, `hit`, and `state` events the same way → no branchy code paths.
- The **shooter** owns collision detection for its own bullets vs. every other player it knows about, and emits an authoritative `hit { target, by, dmg, weapon }` event.
- All clients apply damage purely from `hit` events. Local HP is no longer mutated in two places.
- Bullets carry `{ id, owner, ownerColor, x, y, vx, vy, born, weapon, dmg }` so they always render correctly even if the owner's presence hasn't synced yet.
- Send bullets via broadcast immediately on spawn AND include them in the periodic state tick as a small "recent bullets" list for the first 200ms, so a dropped `shoot` packet self-heals.
- Respawn is triggered locally only when `hit.target === me.id && newHp === 0`.

## 2. Weapons (6 slots, keys 1–6)

| Key | Weapon | Behavior |
|---|---|---|
| 1 | Pistol | Single bullet, fast cooldown, low dmg |
| 2 | Shotgun | 5-pellet spread, medium cooldown |
| 3 | Sniper | Hold to charge, high dmg, slow cooldown, long range |
| 4 | Rocket | Slow projectile, splash radius, high cooldown |
| 5 | Mine | Place at feet, arms after 0.5s, triggers on proximity |
| 6 | Sword (melee) | Short-range arc swing in aim direction, very fast, no projectile |

Sword is implemented as an instantaneous arc check (range ~55px, ~90° arc) broadcast as a `swing` event; victims show a slash animation. All other weapons reuse the bullet pipeline with per-weapon `speed/dmg/lifetime/radius`.

Active weapon is shown in a HUD strip at the bottom of the canvas with cooldown bars.

## 3. Kill-point upgrade system

Each kill grants **1 point**. Points spend in a side panel:

- **Damage +10%** (max 5 levels, cost 1/2/3/4/5)
- **Cooldown −10%** (max 5 levels)
- **Move speed +8%** (max 5 levels)
- **Max HP +15** (max 5 levels)

Upgrades are local-only state on the player (no DB), included in the broadcast `state` payload so opponents see your stats reflected in your effective damage/speed. Points reset on leaving the room. A small "Upgrades" card sits under the Scoreboard with `+` buttons that disable when unaffordable or maxed.

## 4. Named rooms + live lobby list

No database — uses a dedicated `arena:lobby` realtime channel.

- When a player enters a room, they also subscribe to `arena:lobby` and `track()` presence with `{ roomCode, roomName, playerName }`.
- The home page subscribes to `arena:lobby` (read-only, anonymous presence) and aggregates presence state by `roomCode` to render: **room name · code · player list · Join button**.
- The "Create new room" flow adds a **Room name** input (defaults to `"<Nickname>'s Arena"`). The name is stored in `sessionStorage` keyed by code and tracked into both the room channel and the lobby channel so other players see it.
- Joining by code still works as today. Rooms disappear from the lobby automatically when the last player leaves (presence handles it).

## 5. Files touched

- `src/routes/index.tsx` — add room-name input, render live "Open rooms" list from the lobby channel.
- `src/routes/room/$code.tsx` — refactor net model, add weapons, melee, mines/rockets, upgrade panel, HUD, lobby presence tracking.
- `src/lib/arena/weapons.ts` *(new)* — weapon definitions & stat math (kept out of the route file for clarity).
- `src/lib/arena/lobby.ts` *(new)* — small helper that wraps the `arena:lobby` channel subscription so both the home and room routes share one implementation.
- `src/styles.css` — minor additions for weapon HUD and upgrade buttons (semantic tokens only).

No database, no auth, no new packages.

## Out of scope

- Persisting upgrades or stats across sessions (would need Cloud + accounts).
- Anti-cheat beyond shooter-authoritative trust (acceptable for a friendly PvP toy).
- Mobile touch controls.
