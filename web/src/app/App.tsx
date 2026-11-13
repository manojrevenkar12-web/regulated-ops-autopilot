import { Checks } from "../features/checks/Checks";
import { Ledger } from "../features/ledger/Ledger";
import { Work } from "../features/work/Work";
import { useConsole } from "../shared/api";
import { ErrorState, Section, Skeleton } from "../shared/ui";

export function App() {
  const { data, isPending, error, refetch } = useConsole();
  return (
    <main className="page">
      <header className="masthead">
        <h1><span>The model reads.</span><span>Code checks.</span><span>A person decides.</span></h1>
        <p>
          AML alerts, card disputes and customer enquiries at an embedded-finance bank, worked three ways on the same
          simulated weeks: by people alone, with the autopilot, and with the model's drafts acted on unchecked.
        </p>
      </header>
      {isPending ? <Skeleton rows={6} /> : error ? <ErrorState message={error.message} onRetry={() => refetch()} /> : (
        <>
          <Ledger designs={data.designs} rows={data.ledger} />
          <Section id="checks" title="What the checks stopped"
            lede="Drafts the code sent to a person instead of acting on them, by what was wrong with them. Unchecked, each of these would have gone out.">
            <Checks caught={data.caught} />
          </Section>
          <Section id="work" title="Where the hours went"
            lede="The same team in every design. The autopilot's hours go to the cases a person must decide.">
            <Work work={data.work} />
          </Section>
          <p className="muted">Generated from {data.generated_from}.</p>
        </>
      )}
    </main>
  );
}
