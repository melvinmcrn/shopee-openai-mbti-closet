import { useRef, useState, type FormEvent } from "react";
import { api, type Brief } from "./shared";

type OccasionProps = {
  brief: Brief;
  onNext: (updated: Brief) => void;
  onBack: () => void;
};

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl border border-divider bg-surface px-3 py-2 text-base text-text placeholder:text-supporting focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

export function Occasion({ brief, onNext, onBack }: OccasionProps) {
  const [occasion, setOccasion] = useState(brief.occasion);
  const [timing, setTiming] = useState(brief.timing);
  const [location, setLocation] = useState(brief.location);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savePending = useRef(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending.current) return;

    const occasionText = occasion.trim();
    if (!occasionText) {
      setError("Enter an occasion to continue.");
      return;
    }

    savePending.current = true;
    setSaving(true);
    setError("");

    try {
      const updated = await api<Brief>("saveBrief", {
        ...brief,
        occasion: occasionText,
        timing: timing.trim(),
        location: location.trim(),
      });
      onNext(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your occasion. Try again.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl text-text" aria-labelledby="occasion-heading">
      <button
        type="button"
        onClick={onBack}
        disabled={saving}
        className="-ml-3 mb-3 min-h-11 rounded-lg px-3 text-sm font-semibold text-secondary hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60"
      >
        <span aria-hidden="true">← </span>Back to planner
      </button>
      <header>
        <h1 id="occasion-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          What are you dressing for?
        </h1>
        <p className="mt-2 text-sm text-supporting">
          Start with the occasion and add any details that will affect what you wear.
        </p>
      </header>

      <form onSubmit={save} className="mt-6 rounded-2xl border border-divider bg-surface p-5 sm:p-7">
        <fieldset disabled={saving} className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-semibold sm:col-span-2">
            Occasion
            <input
              name="occasion"
              value={occasion}
              onChange={(event) => {
                setOccasion(event.target.value);
                setError("");
              }}
              required
              maxLength={500}
              placeholder="e.g. A birthday dinner"
              className={inputClass}
            />
          </label>
          <label className="text-sm font-semibold">
            Timing <span className="font-normal text-supporting">(optional)</span>
            <input
              name="timing"
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
              maxLength={500}
              placeholder="e.g. Saturday evening"
              className={inputClass}
            />
          </label>
          <label className="text-sm font-semibold">
            Location or weather <span className="font-normal text-supporting">(optional)</span>
            <input
              name="location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={500}
              placeholder="e.g. Outdoors and chilly"
              className={inputClass}
            />
          </label>
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="mt-6 min-h-12 rounded-full bg-primary px-6 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </form>
    </section>
  );
}
