// The harness: one world against one design, hour by hour.
import { Autopilot, type Design } from "../engine/autopilot.ts";
import { loadSettings } from "../settings.ts";
import { World, loadWorld } from "./sim.ts";

const HOUR = 3_600_000;

export async function run(worldPath: string, design: Design) {
  const world = new World(loadWorld(worldPath));
  const settings = loadSettings();
  const ap = new Autopilot(design, settings, design === "manual" ? null : world, { ledger: world, facts: world.facts });
  const end = world.start.getTime() + world.cfg.days * 24 * HOUR;
  let i = 0;
  for (let t = world.start.getTime(); t < end; t += HOUR) {
    const now = new Date(t);
    while (i < world.arrivals.length && world.arrivals[i].at.getTime() <= t) await ap.intake(world.arrivals[i++].c, now);
    ap.work(now, world.capacity(now), world);
    ap.outbox.flush(world, now);
  }
  return { world, ap, end: new Date(end) };
}
