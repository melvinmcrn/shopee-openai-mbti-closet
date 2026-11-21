import { useRef, useState, type FormEvent } from "react";
import { api, type Brief } from "./shared";

type StyleProps = {
  brief: Brief;
  onNext: (saved: Brief) => void;
  onBack: () => void;
};

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl border border-divider bg-surface px-3 py-2 text-base text-text placeholder:text-supporting focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

const actionClass =
  "min-h-11 rounded-lg px-3 text-sm font-semibold text-secondary hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60";

export function Style({ brief, onNext, onBack }: StyleProps) {
  const [formality, setFormality] = useState(brief.formality);
  const [comfort, setComfort] = useState(brief.comfort);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savePending = useRef(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending.current) return;

    savePending.current = true;
    setSaving(true);
    setError("");

    try {
      const saved = await api<Brief>("saveBrief", {
        ...brief,
        formality: formality.trim(),
        comfort: comfort.trim(),
        preferences: [],
      });
      onNext(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your style preferences. Try again.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="style-heading" className="mx-auto max-w-2xl text-text">
      <button type="button" onClick={onBack} disabled={saving} className={`${actionClass} -ml-3 mb-3`}>
        <span aria-hidden="true">← </span>Back to occasion
      </button>
      <header>
        <h1 id="style-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Today’s style
        </h1>
        <p className="mt-2 text-sm text-supporting">What would you like to wear for {brief.occasion}?</p>
      </header>

      <form onSubmit={save} className="mt-6 rounded-2xl border border-divider bg-surface p-5 sm:p-7">
        <fieldset disabled={saving} className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">
              Formality <span className="font-normal text-supporting">(optional)</span>
              <input
                name="formality"
                value={formality}
                maxLength={500}
                placeholder="Choose a suggestion or type your own"
                onChange={(event) => setFormality(event.target.value)}
                className={inputClass}
              />
            </label>
            <div role="group" aria-label="Formality suggestions" className="mt-2 flex flex-wrap gap-2">
              {["Casual", "Smart casual", "Business casual", "Formal"].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={formality === option}
                  onClick={() => setFormality(formality === option ? "" : option)}
                  className="min-h-9 rounded-full border border-divider px-3 text-sm aria-pressed:bg-selected aria-pressed:text-secondary"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold">
              Comfort <span className="font-normal text-supporting">(optional)</span>
              <input
                name="comfort"
                value={comfort}
                maxLength={500}
                placeholder="Choose a suggestion or type your own"
                onChange={(event) => setComfort(event.target.value)}
                className={inputClass}
              />
            </label>
            <div role="group" aria-label="Comfort suggestions" className="mt-2 flex flex-wrap gap-2">
              {["Comfortable for walking", "Loose fit", "Light and breathable", "Warm layers"].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={comfort === option}
                  onClick={() => setComfort(comfort === option ? "" : option)}
                  className="min-h-9 rounded-full border border-divider px-3 text-sm aria-pressed:bg-selected aria-pressed:text-secondary"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="mt-4 min-h-12 rounded-full bg-primary px-6 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </form>
    </section>
  );
}
