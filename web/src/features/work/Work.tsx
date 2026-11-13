import type { Work as W } from "../../shared/types";
import { Empty } from "../../shared/ui";
import "./work.css";

const NAME: Record<string, string> = { manual: "Manual", autopilot: "Autopilot", unchecked: "Model unchecked" };

/** Where the analysts' hours went, and what was left undone at the end. */
export function Work({ work }: { work: W[] }) {
  if (!work.length) return <Empty>No run yet.</Empty>;
  const max = Math.max(...work.map((w) => w.hours));
  return (
    <div className="work">
      {work.map((w) => (
        <div key={w.design} className={`card panel${w.design === "autopilot" ? " ours" : ""}`}>
          <h3>{NAME[w.design] ?? w.design}</h3>
          <div className="hours"><b>{w.hours.toLocaleString("en-US")}</b> analyst hours</div>
          <span className="track" aria-hidden="true"><i style={{ width: `${(100 * w.hours) / max}%` }} /></span>
          <dl>
            <dt>Handled with no person</dt><dd>{w.automatic.toLocaleString("en-US")}</dd>
            <dt>Left in the queue</dt><dd>{w.backlog.toLocaleString("en-US")}</dd>
            <dt>Median first reply</dt><dd>{w.median_reply_h === null ? "none sent" : `${w.median_reply_h} h`}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}
