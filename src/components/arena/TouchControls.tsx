import { useEffect, useRef, useState } from "react";
import { WEAPONS, WEAPON_ORDER, type WeaponId } from "@/lib/arena/weapons";

type Vec = { dx: number; dy: number };

type Props = {
  weapon: WeaponId;
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
      className={`pointer-events-auto fixed bottom-24 ${side === "left" ? "left-4" : "right-4"} h-32 w-32 touch-none select-none rounded-full border border-foreground/25 bg-background/40 backdrop-blur`}
      style={{ touchAction: "none" }}
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-primary/80 shadow-lg"
        style={{
          transform: `translate(-50%, -50%) translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)`,
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-foreground/40">
        {side === "left" ? "move" : "aim"}
      </div>
    </div>
  );
}

export function TouchControls({
  weapon,
  onMove,
  onAim,
  onFireDown,
  onFireUp,
  onMelee,
  onSelectWeapon,
}: Props) {
  return (
    <>
      <Joystick side="left" onChange={onMove} />
      {/* Sticky aim: keep last direction after release so the player keeps facing where they aimed. */}
      <Joystick
        side="right"
        onChange={(v) => {
          if (v.dx !== 0 || v.dy !== 0) onAim(v);
        }}
      />

      {/* Fire + Melee */}
      <div className="pointer-events-auto fixed right-4 bottom-[260px] flex flex-col gap-2">
        <button
          onTouchStart={(e) => { e.preventDefault(); onFireDown(); }}
          onTouchEnd={(e) => { e.preventDefault(); onFireUp(); }}
          onTouchCancel={(e) => { e.preventDefault(); onFireUp(); }}
          className="h-20 w-20 touch-none select-none rounded-full border-2 border-primary bg-primary/85 text-sm font-black text-primary-foreground shadow-xl active:scale-95"
        >
          FIRE
        </button>
        <button
          onTouchStart={(e) => { e.preventDefault(); onMelee(); }}
          className="h-14 w-20 touch-none select-none rounded-full border border-foreground/30 bg-background/40 text-xs font-bold text-foreground shadow-lg backdrop-blur active:scale-95"
        >
          MELEE
        </button>
      </div>

      {/* Weapon strip */}
      <div className="pointer-events-auto fixed bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full border border-foreground/15 bg-background/70 px-1.5 py-1 backdrop-blur">
        {WEAPON_ORDER.map((id) => {
          const w = WEAPONS[id];
          const active = weapon === id;
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