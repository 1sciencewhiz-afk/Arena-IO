## Goal

Make the arena fully playable on a phone, and add a dedicated instructions page reachable from the lobby and the in-room HUD.

## 1. Instructions page (`/how-to-play`)

New route `src/routes/how-to-play.tsx` with its own `head()` metadata (title, description, og tags). Sections:

- **Goal** — eliminate other players, earn kill points.
- **Controls** — desktop (WASD/arrows to move, mouse aim, left-click to fire, 1–6 to switch weapons, hold for sniper charge) and mobile (left joystick to move, right joystick to aim, Fire button, weapon wheel/strip, melee button).
- **Weapons** — short card per weapon (Pistol, Shotgun, Sniper, Rocket, Mine, Sword) pulled from `src/lib/arena/weapons.ts` so descriptions stay in sync (damage, cooldown, special behavior).
- **Upgrades** — Damage, Fire Rate, Speed, Max HP (1 kill = 1 point, max level 5).
- **Lobby tips** — name your room, share the 5-char code, live lobby list.

Add "How to play" links:
- Lobby page header (`src/routes/index.tsx`).
- In-room HUD top bar (`src/routes/room/$code.tsx`) — small `?` button opens an in-room overlay (same content, no navigation away, so the player doesn't lose their session).

## 2. Mobile controls in the arena

Detect touch via `useIsMobile()` + `'ontouchstart' in window`. When active, render a touch overlay on top of the canvas and disable mouse/keyboard listeners' redundant work.

Layout (portrait + landscape, fixed to viewport using `dvh`):

```text
+-------------------------------------+
|  HP  Wpn  Score          ? Leave    |
|                                     |
|            [ game canvas ]          |
|                                     |
|  ( move )                ( aim  )   |
|  joystick   [Fire][Melee] joystick  |
|             [1..6 wpn strip]        |
+-------------------------------------+
```

- **Left virtual joystick** — drag within a ~120px circle, normalized vector drives the same movement input the keyboard currently writes into (`input.move = {x, y}`), so the existing player-update loop is untouched.
- **Right virtual joystick** — sets aim direction; releasing it does NOT fire (prevents accidental shots). For sniper, holding the Fire button while the right stick is engaged charges the shot; release Fire to launch.
- **Fire button** — tap to shoot, hold for auto-fire / sniper charge (same code path as mouse hold).
- **Melee button** — dedicated button that swings the Sword regardless of currently selected weapon, so melee is always one tap away on touch. (Sword stays selectable via the weapon strip too for desktop parity.)
- **Weapon strip** — horizontally scrollable row of 6 weapon chips (icon + cooldown ring) at the bottom; tap to select. Reuses the existing cooldown values.
- Prevent page scroll/zoom while playing: `touch-action: none` on the canvas + overlay, and `user-select: none`.

Resize handling: canvas already auto-sizes; on mobile we make the playfield fill the viewport (minus HUD bars) and scale world coordinates the same way as on desktop. No gameplay/balance changes.

## 3. Lobby on mobile

Tweak `src/routes/index.tsx` so the create/join form and the live room list stack cleanly on narrow viewports (single column, larger touch targets, sticky "Create" button). Add the "How to play" link in the header.

## 4. Files

- New: `src/routes/how-to-play.tsx`, `src/components/arena/TouchControls.tsx`, `src/components/arena/HowToPlayContent.tsx` (shared between the route and the in-room overlay).
- Edited: `src/routes/room/$code.tsx` (wire touch input into the existing input state, add `?` overlay, add weapon strip/fire/melee buttons on mobile), `src/routes/index.tsx` (mobile-friendly layout + link), `src/styles.css` (joystick + button styles using design tokens).

## Out of scope

- No new weapons, balance changes, or persistence.
- No haptics / gamepad API.
- No landscape lock — we just adapt to whatever orientation the player uses.
