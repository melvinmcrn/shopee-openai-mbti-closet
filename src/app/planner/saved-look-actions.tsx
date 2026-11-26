import { useRef, useState } from "react";
import { addWear, type SavedLookSummary, type WearSummary } from "./shared";
import { formatWearDate, localDate } from "./wear-date";

export type SavedLookNavigation = {
  onOpen: (lookId: string) => void;
  onWear: (lookId: string, entryId: string) => void;
};

type Props = SavedLookNavigation & { look: SavedLookSummary; today: string };

const button =
  "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

export function SavedLookActions({ look, today, onOpen, onWear }: Props) {
  const [logged, setLogged] = useState<WearSummary>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const entry = logged?.date === today ? logged : look.wear?.date === today ? look.wear : null;

  async function logToday() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      setLogged(await addWear(look.id, localDate()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not log this wear. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-label={`Open saved look for ${look.occasion}`} onClick={() => onOpen(look.id)}
        className={`${button} border border-divider text-secondary hover:bg-selected`}>Open look</button>
      {entry ? (
        <button type="button" className={`${button} bg-selected text-secondary hover:underline`}
          onClick={() => onWear(look.id, entry.id)}>Add note or rating</button>
      ) : (
        <button type="button" disabled={saving} onClick={logToday}
          className={`${button} bg-secondary text-canvas enabled:hover:opacity-90 disabled:opacity-60`}>
          {saving ? "Logging…" : "Wore today"}
        </button>
      )}
    </div>
    <div role="status" className="text-sm font-medium text-secondary">
      {entry && <p className="mt-2">Logged for <time dateTime={entry.date}>{formatWearDate(entry.date)}</time>.</p>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </div>;
}
