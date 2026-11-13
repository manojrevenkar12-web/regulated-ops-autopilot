import type { Caught } from "../../shared/types";
import { Empty } from "../../shared/ui";
import "./checks.css";

/** Drafts the code checks sent to a person instead of acting on them, by what was wrong. */
export function Checks({ caught }: { caught: Caught[] }) {
  if (!caught.length) return <Empty>The checks found nothing wrong in this run.</Empty>;
  const max = Math.max(...caught.map((c) => c.count));
  return (
    <ul className="checks panel">
      {caught.map((c) => (
        <li key={c.check}>
          <span className="what">{c.check}</span>
          <span className="track" aria-hidden="true"><i style={{ width: `${(100 * c.count) / max}%` }} /></span>
          <span className="count">{c.count}</span>
        </li>
      ))}
    </ul>
  );
}
