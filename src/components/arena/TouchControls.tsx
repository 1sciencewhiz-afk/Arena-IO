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
      onChange({ dx: dx / RADIUS, dy: dy / RADIUS });
    };

    const onStart = (e: TouchEvent) => {
      if (activeId.current != null) return;
      const t = e.changedTouches[0];
      activeId.current = t.identifier;
      update(t.clientX, t.clientY);
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === activeId.current) {
          update(t.clientX, t.clientY);
          e.preventDefault();
          break;
        }
      }
    };
    const onEndTouch = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === activeId.current) {
          activeId.current = null;
          setKnob(null);
          onChange({ dx: 0, dy: 0 });
          onEnd?.();
          e.preventDefault();
          break;
        }
      }
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEndTouch, { passive: false });
    window.addEventListener("touchcancel", onEndTouch, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEndTouch);
      window.removeEventListener("touchcancel", onEndTouch);
    };
  }, [onChange, onEnd]);

  return (
    <div
      ref={baseRef}
      className={`pointer-events-auto fixed bottom-24 ${side === "left" ? "left-4" : "right-4"} h-32 w-32 touch-none select-none rounded-full border border-foreground/20 bg-foreground/10 backdrop-blur`}
    >
      <div
        className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-primary/80 shadow-lg transition-transform"
        style={{
          transform: `translate(-50%, -50%) translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)`,
        }}
      />
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
      <Joystick side="right" onChange={(v) => onAim(v.dx === 0 && v.dy === 0 ? null : v)} onEnd={() => onAim(null)} />

      {/* Fire + Melee */}
      <div className="pointer-events-auto fixed bottom-60 right-4 flex flex-col gap-2">
        <button
          onTouchStart={(e) => { e.preventDefault(); onFireDown(); }}
          onTouchEnd={(e) => { e.preventDefault(); onFireUp(); }}
          onTouchCancel={(e) => { e.preventDefault(); onFireUp(); }}
          className="h-20 w-20 touch-none select-none rounded-full border-2 border-primary bg-primary/80 text-sm font-black text-primary-foreground shadow-xl active:scale-95"
        >
          FIRE
        </button>
        <button
          onTouchStart={(e) => { e.preventDefault(); onMelee(); }}
          className="h-14 w-20 touch-none select-none rounded-full border border-foreground/30 bg-foreground/10 text-xs font-bold text-foreground shadow-lg active:scale-95"
        >
          MELEE
        </button>
      </div>

      {/* Weapon strip */}
      <div className="pointer-events-auto fixed bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full border border-foreground/15 bg-background/80 px-2 py-1.5 backdrop-blur">
        {WEAPON_ORDER.map((id) => {
          const w = WEAPONS[id];
          const active = weapon === id;
          return (
            <button
              key={id}
              onTouchStart={(e) => { e.preventDefault(); onSelectWeapon(id); }}
              className={`h-10 min-w-10 select-none rounded-full px-2 text-[10px] font-bold transition ${
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