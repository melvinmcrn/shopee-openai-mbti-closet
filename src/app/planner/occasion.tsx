import { useRef, useState, type FormEvent } from "react";
import { api, type Brief } from "./shared";

type OccasionProps = {
  brief: Brief;
  onChange: (updated: Brief) => void;
  onNext: (updated: Brief) => void;
  onBack: () => void;
};

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl border border-divider bg-surface px-3 py-2 text-base text-text placeholder:text-supporting focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

function Suggestions({ label, options, value, onPick }: {
  label: string;
  options: string[];
  value: string;
  onPick: (option: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="mt-2 flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onPick(option)}
          className="min-h-9 rounded-full border border-divider px-3 text-sm hover:bg-selected aria-pressed:bg-selected aria-pressed:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function Occasion({ brief, onChange, onNext, onBack }: OccasionProps) {
  const { occasion, timing, location } = brief;
  const setOccasion = (occasion: string) => onChange({ ...brief, occasion });
  const setTiming = (timing: string) => onChange({ ...brief, timing });
  const setLocation = (location: string) => onChange({ ...brief, location });
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
        trackDraft: true,
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
          <div className="sm:col-span-2">
            <label htmlFor="planner-occasion" className="text-sm font-semibold">
              Occasion
            </label>
            <input
              id="planner-occasion"
              placeholder="Choose a suggestion or type your own"
              name="occasion"
              value={occasion}
              onChange={(event) => {
                setOccasion(event.target.value);
                setError("");
              }}
              required
              maxLength={500}
              className={inputClass}
            />
            <Suggestions
              label="Occasion suggestions"
              options={["Birthday dinner with friends", "Work meeting", "Weekend brunch"]}
              value={occasion}
              onPick={(option) => { setOccasion(option); setError(""); }}
            />
          </div>
          <div>
            <label htmlFor="planner-timing" className="text-sm font-semibold">
              Timing <span className="font-normal text-supporting">(optional)</span>
            </label>
            <input
              id="planner-timing"
              placeholder="Choose a suggestion or type your own"
              name="timing"
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
              maxLength={500}
              className={inputClass}
            />
            <Suggestions
              label="Timing suggestions"
              options={["Saturday evening", "Weekday morning", "All day"]}
              value={timing}
              onPick={setTiming}
            />
          </div>
          <div>
            <label htmlFor="planner-location" className="text-sm font-semibold">
              Location or weather <span className="font-normal text-supporting">(optional)</span>
            </label>
            <input
              id="planner-location"
              placeholder="Choose a suggestion or type your own"
              name="location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={500}
              className={inputClass}
            />
            <Suggestions
              label="Location or weather suggestions"
              options={["Breezy rooftop", "Air-conditioned office", "Hot and humid"]}
              value={location}
              onPick={setLocation}
            />
          </div>
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
