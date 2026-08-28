import type { LearningOverviewResponse } from "../../types.ts";

export async function runLearningOverviewPolling(input: {
  contextId: string;
  signal: AbortSignal;
  fetchOverview: (
    contextId: string,
    signal: AbortSignal,
  ) => Promise<LearningOverviewResponse>;
  wait: (signal: AbortSignal) => Promise<void>;
  onUpdate: (overview: LearningOverviewResponse) => void;
  maxPolls?: number;
}) {
  const maxPolls = Math.max(1, Math.trunc(input.maxPolls ?? 40));
  for (let poll = 0; poll < maxPolls && !input.signal.aborted; poll += 1) {
    const overview = await input.fetchOverview(input.contextId, input.signal);
    if (input.signal.aborted) return;
    input.onUpdate(overview);
    if (overview.status !== "pending") return;
    if (poll + 1 >= maxPolls) {
      input.onUpdate({
        contextId: input.contextId,
        status: "failed",
        coverage: overview.coverage,
        errorCode: "OVERVIEW_TIMEOUT",
      });
      return;
    }
    await input.wait(input.signal);
  }
}

export function waitForOverviewPoll(signal: AbortSignal, delayMs = 3000) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
