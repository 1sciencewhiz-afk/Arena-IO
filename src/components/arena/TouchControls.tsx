import { useEffect, useRef, useState } from "react";
import { WEAPONS, WEAPON_ORDER, type WeaponId } from "@/lib/arena/weapons";

type Vec = { dx: number; dy: number };

type Props = {
  weapon: WeaponId;
  ownedWeapons: WeaponId[];
  onMove: (v: Vec) => void;
  onAim: (v: Vec | null) => void;
  onFireDown: () => void;
  onFireUp: () => void;
  onMelee: () => void;
  onSelectWeapon: (w: WeaponId) => void;
};

function Joystick({
  side,
  onChange,
  onEnd,
}: {
  side: "left" | "right";
  onChange: (v: Vec) => void;
  onEnd?: () => void;
}) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const activeId = useRef<number | null>(null);
  // Keep latest callbacks in refs so we don't rebind listeners every render
  const onChangeRef = useRef(onChange);
  const onEndRef = useRef(onEnd);
  onChangeRef.current = onChange;
  onEndRef.current = onEnd;
  const RADIUS = 56;

  useEffect(() => {
    const el = baseRef.current;
    if (!el) return;

    const center = () => {
      const r = el.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };

    const update = (clientX: number, clientY: number) => {
      const { cx, cy } = center();
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      setKnob({ x: dx, y: dy });
      onChangeRef.current({ dx: dx / RADIUS, dy: dy / RADIUS });
    };

    // Use Pointer Events with setPointerCapture — most reliable cross-device.
    const onDown = (e: PointerEvent) => {
      if (activeId.current != null) return;
      activeId.current = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
      update(e.clientX, e.clientY);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activeId.current) return;
      update(e.clientX, e.clientY);
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== activeId.current) return;
      activeId.current = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      setKnob(null);
      onChangeRef.current({ dx: 0, dy: 0 });
      onEndRef.current?.();
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div
      ref={baseRef}
      className={`pointer-events-auto fixed bottom-20 ${side === "left" ? "left-4" : "right-4"} h-36 w-36 touch-none select-none rounded-full border border-foreground/25 bg-background/40 backdrop-blur`}
      style={{ touchAction: "none" }}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-primary/80 shadow-lg"
        style={{
          transform: `translate(-50%, -50%) translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)`,
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-foreground/40">
        {side === "left" ? "move" : "aim + fire"}
      </div>
    </div>
  );
}

export function TouchControls({
  weapon,
  ownedWeapons,
  onMove,
  onAim,
  onFireDown,
  onFireUp,
  onMelee,
  onSelectWeapon,
}: Props) {
  // Right joystick: while held in any direction, aim AND fire.
  // Releasing the stick stops firing but keeps the last aim vector,
  // so the player keeps facing the same way.
  const firingRef = useRef(false);
  const DEAD = 0.15;

  return (
    <>
      <Joystick side="left" onChange={onMove} />
      <Joystick
        side="right"
        onChange={(v) => {
          const mag = Math.hypot(v.dx, v.dy);
          if (mag > DEAD) {
            onAim(v);
            if (!firingRef.current) {
              firingRef.current = true;
              onFireDown();
            }
          } else if (firingRef.current) {
            // Inside deadzone — stop firing but keep last aim
            firingRef.current = false;
            onFireUp();
          }
        }}
        onEnd={() => {
          if (firingRef.current) {
            firingRef.current = false;
            onFireUp();
          }
        }}
      />

      {/* Small melee button only — fire is now driven by the right joystick. */}
      <button
        onTouchStart={(e) => { e.preventDefault(); onMelee(); }}
        className="pointer-events-auto fixed right-6 bottom-[200px] h-12 w-12 touch-none select-none rounded-full border border-foreground/30 bg-background/50 text-[10px] font-bold text-foreground shadow-lg backdrop-blur active:scale-95"
      >
        MELEE
      </button>

      {/* Weapon strip — only owned weapons are selectable */}
      <div className="pointer-events-auto fixed bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full border border-foreground/15 bg-background/70 px-1.5 py-1 backdrop-blur">
        {WEAPON_ORDER.map((id) => {
          const w = WEAPONS[id];
          const active = weapon === id;
          const owned = ownedWeapons.includes(id);
          if (!owned) return null;
          return (
            <button
              key={id}
              onTouchStart={(e) => { e.preventDefault(); onSelectWeapon(id); }}
              onClick={() => onSelectWeapon(id)}
              className={`h-9 min-w-9 select-none rounded-full px-2 text-[10px] font-bold transition ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/10 text-foreground/70"
              }`}
            >
              {w.name.slice(0, 4)}
            </button>
          );
        })}
      </div>
    </>
  );
}