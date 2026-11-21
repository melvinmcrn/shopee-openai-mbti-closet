import { useRef, useState, type FormEvent } from "react";
import { api, type Brief } from "./shared";

type StyleProps = {
  brief: Brief;
  onNext: (saved: Brief) => void;
  onBack: () => void;
};

const garmentCategories = [
  { value: "top", label: "Tops" },
  { value: "bottom", label: "Bottoms" },
  { value: "dress", label: "Dresses" },
  { value: "shoes", label: "Shoes" },
  { value: "outerwear", label: "Outerwear" },
  { value: "accessory", label: "Accessories" },
];

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl border border-divider bg-surface px-3 py-2 text-base text-text placeholder:text-supporting focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

const actionClass =
  "min-h-11 rounded-lg px-3 text-sm font-semibold text-secondary hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60";

export function Style({ brief, onNext, onBack }: StyleProps) {
  const [formality, setFormality] = useState(brief.formality);
  const [comfort, setComfort] = useState(brief.comfort);
  const [preferences, setPreferences] = useState(brief.preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savePending = useRef(false);

  function updatePreference(category: string, checked: boolean) {
    setPreferences((current) =>
      checked ? [...current, category] : current.filter((preference) => preference !== category),
    );
  }

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
        preferences,
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
          <label className="text-sm font-semibold">
            Formality <span className="font-normal text-supporting">(optional)</span>
            <input
              name="formality"
              value={formality}
              maxLength={500}
              placeholder="e.g. Smart casual"
              onChange={(event) => setFormality(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm font-semibold">
            Comfort <span className="font-normal text-supporting">(optional)</span>
            <input
              name="comfort"
              value={comfort}
              maxLength={500}
              placeholder="e.g. Comfortable for walking"
              onChange={(event) => setComfort(event.target.value)}
              className={inputClass}
            />
          </label>
        </fieldset>

        <fieldset disabled={saving} aria-describedby="garment-preference-hint" className="mt-6">
          <legend className="text-sm font-semibold">Garment preferences</legend>
          <p id="garment-preference-hint" className="mt-1 text-sm text-supporting">
            Choose any categories you’d like to prioritize.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {garmentCategories.map(({ value, label }) => (
              <label
                key={value}
                className="flex min-h-12 items-center gap-2 rounded-xl border border-divider px-3 py-2 text-sm font-medium has-checked:border-secondary has-checked:bg-selected has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-secondary"
              >
                <input
                  type="checkbox"
                  name="preferences"
                  value={value}
                  checked={preferences.includes(value)}
                  onChange={(event) => updatePreference(value, event.target.checked)}
                  className="size-4 shrink-0 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={preferences.length === 0}
            onClick={() => setPreferences([])}
            className={`${actionClass} -ml-3 mt-1`}
          >
            Clear preferences
          </button>
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
