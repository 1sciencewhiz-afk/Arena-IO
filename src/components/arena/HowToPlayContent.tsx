import { WEAPONS, WEAPON_ORDER, UPGRADE_DEFS, UPGRADE_MAX } from "@/lib/arena/weapons";

export function HowToPlayContent() {
  return (
    <div className="space-y-6 text-sm text-foreground/80">
      <section>
        <h2 className="mb-2 text-base font-bold text-foreground">Goal</h2>
        <p>
          Eliminate other players to earn <span className="text-primary font-semibold">kill points</span>.
          Spend them on upgrades to grow stronger. Rooms are public in the lobby once at least one player is in them.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-base font-bold text-foreground">Controls</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-foreground/10 bg-foreground/5 p-3">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-foreground/60">Desktop</div>
            <ul className="space-y-1 text-xs">
              <li><b>WASD / Arrows</b> — move</li>
              <li><b>Mouse</b> — aim</li>
              <li><b>Left click</b> — attack (hold to auto-fire)</li>
              <li><b>1–4</b> — switch hotbar weapon</li>
              <li><b>Sniper</b> — hold to charge, release to fire</li>
            </ul>
          </div>
          <div className="rounded-lg border border-foreground/10 bg-foreground/5 p-3">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-foreground/60">Mobile</div>
            <ul className="space-y-1 text-xs">
              <li><b>Left stick</b> — move</li>
              <li><b>Right stick</b> — aim</li>
              <li><b>Fire</b> button — shoot / hold for sniper charge</li>
              <li><b>Melee</b> button — instant sword swing</li>
              <li><b>Weapon strip</b> — tap to switch</li>
            </ul>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-bold text-foreground">Weapons</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {WEAPON_ORDER.map((id) => {
            const w = WEAPONS[id];
            const meta: string[] = [`${Math.round(w.dmg)} dmg`, `${w.cooldown.toFixed(2)}s cd`];
            if (w.pellets) meta.push(`${w.pellets} pellets`);
            if (w.splash) meta.push(`splash ${w.splash}`);
            if (w.charge) meta.push(`charge ${w.charge}s`);
            if (w.melee) meta.push(`melee range ${w.melee.range}`);
            if (w.placeable) meta.push(`mine`);
            if (w.homing) meta.push(`homing`);
            if (w.bouncing) meta.push(`bouncing`);
            if (w.pierce) meta.push(`pierces`);
            if (w.immobilize) meta.push(`freeze ${w.immobilize}ms`);
            if (w.summon) meta.push(`x${w.summon} summons`);
            if (w.twin) meta.push(`twin barrel`);
            return (
              <li key={id} className="rounded-lg border border-foreground/10 bg-foreground/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground">{w.name}</span>
                </div>
                <div className="mt-1 text-xs text-foreground/60">{meta.join(" · ")}</div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-base font-bold text-foreground">Upgrades</h2>
        <p className="mb-2 text-xs text-foreground/60">
          1 kill = 1 point. Each level costs <i>level + 1</i> points. Damage, Fire Rate and Armour go up to level 20; Move Speed and Max HP cap at 5. Resets when you leave the room.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {UPGRADE_DEFS.map((u) => (
            <li key={u.id} className="rounded-lg border border-foreground/10 bg-foreground/5 p-3">
              <div className="font-semibold text-foreground">{u.name}</div>
              <div className="text-xs text-foreground/60">{u.desc} · max Lv {UPGRADE_MAX[u.id]}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-base font-bold text-foreground">Lobby</h2>
        <p>
          Name your room when you create it so friends can spot it in the live list.
          Share the 5-character code or the room link to invite others. Rooms vanish from the lobby when the last player leaves.
        </p>
      </section>
    </div>
  );
}