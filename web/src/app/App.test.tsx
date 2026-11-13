import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Console } from "../shared/types";

const sample: Console = {
  generated_from: "reports/dev.json", designs: ["Manual", "Autopilot", "Model unchecked"],
  ledger: [{ label: "Fraud refunds later than the law allows", note: "of 248", values: ["34", "2", "12"] }],
  caught: [{ check: "action raise_limit is not something an assistant may do", count: 50 }],
  work: [{ design: "autopilot", hours: 1014, automatic: 5770, backlog: 76, median_reply_h: 0.6 }],
};
const renderApp = () => render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
afterEach(() => vi.restoreAllMocks());

describe("console", () => {
  it("shows a skeleton, then the ledger, the checks and the hours", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(sample)));
    renderApp();
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(await screen.findByText("Fraud refunds later than the law allows")).toBeTruthy();
    expect(screen.getByText("1,014")).toBeTruthy();
  });
  it("offers a retry when the data does not load", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));
    renderApp();
    expect(await screen.findByRole("alert")).toBeTruthy();
    f.mockResolvedValueOnce(new Response(JSON.stringify(sample)));
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Fraud refunds later than the law allows")).toBeTruthy());
  });
  it("says what to do when there is no run", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ...sample, ledger: [], caught: [], work: [] })));
    renderApp();
    expect(await screen.findByText(/No run yet. npm run evaluate/)).toBeTruthy();
    expect(screen.getByText(/found nothing wrong/)).toBeTruthy();
  });
});
