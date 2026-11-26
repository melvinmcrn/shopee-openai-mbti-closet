import { useEffect, useState } from "react";
import { SavedLookActions, type SavedLookNavigation } from "./saved-look-actions";
import { api, type SavedLookSummary } from "./shared";
import { useLocalDate } from "./wear-date";

export function RecentLook(navigation: SavedLookNavigation) {
  const today = useLocalDate();
  const [look, setLook] = useState<SavedLookSummary | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<SavedLookSummary | null>("recentLook", { date: today }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setLook(result); })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your recent look.");
      });
    return () => controller.abort();
  }, [attempt, today]);

  if (!look && !error) return null;
  return <section aria-labelledby="recent-look-title" className="mt-5 rounded-2xl border border-divider bg-surface p-5">
    <h2 id="recent-look-title" className="text-sm font-semibold text-supporting">Most recent saved look</h2>
    {look && <>
      <h3 className="mt-1 break-words font-heading text-2xl">{look.occasion}</h3>
      <SavedLookActions key={look.id} look={look} today={today} {...navigation} />
    </>}
    {error && <div className="mt-2 text-sm">
      <p role="alert">{error}</p>
      <button type="button" className="min-h-11 font-semibold text-secondary underline"
        onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry recent look</button>
    </div>}
  </section>;
}
