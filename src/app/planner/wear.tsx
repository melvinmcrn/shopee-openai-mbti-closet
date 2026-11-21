"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api } from "./shared";

type Wear = {
  id: string;
  lookId: string;
  date: string;
  rating: number | null;
  note: string | null;
};

type WearEntryProps = {
  id: string;
  onBack: () => void;
};

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });
const ratingOptions = [1, 2, 3, 4, 5, null];
const button =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#672f61] disabled:opacity-60";
const secondaryButton =
  `${button} border border-[#d9ccd8] text-[#542f51] enabled:hover:bg-[#f6edf6]`;

function WearForm({ id, onBack }: WearEntryProps) {
  const formId = useId();
  const [wear, setWear] = useState<Wear>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const active = useRef(false);
  const savePending = useRef(false);

  useEffect(() => {
    let current = true;
    active.current = true;

    void api<Wear>("wearGet", { id }).then(
      (entry) => {
        if (current) setWear(entry);
      },
      (cause: unknown) => {
        if (current) {
          setError(cause instanceof Error ? cause.message : "Could not open this wear entry.");
        }
      },
    );

    return () => {
      current = false;
      active.current = false;
    };
  }, [id, loadAttempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wear || savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setError("");

    try {
      await api<Wear>("wearUpdate", { id, rating: wear.rating, note: wear.note ?? "" });
      if (active.current) onBack();
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : "Could not save this wear entry.");
      }
    } finally {
      savePending.current = false;
      if (active.current) setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`${formId}-heading`} className="space-y-6 text-[#2a2229]">
      <header>
        <button type="button" className={secondaryButton} disabled={saving} onClick={onBack}>
          <span aria-hidden="true" className="mr-2">←</span>Back to saved look
        </button>
        <h1 id={`${formId}-heading`} className="mt-4 font-serif text-4xl tracking-tight sm:text-5xl">
          Wear entry
        </h1>
        {wear && (
          <p className="mt-2 text-sm text-[#6c5a67]">
            Worn on <time dateTime={wear.date}>{dateFormat.format(new Date(wear.date))}</time>
          </p>
        )}
      </header>

      {!wear && !error && <p role="status" className="text-sm text-[#6c5a67]">Opening your wear entry…</p>}

      {!wear && error && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-[#a42d40]">{error}</p>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setError("");
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {wear && (
        <form onSubmit={save} className="max-w-2xl rounded-2xl border border-[#e7dce4] bg-white p-5 sm:p-6">
          <fieldset disabled={saving} className="min-w-0 space-y-5">
            <fieldset>
              <legend className="text-sm font-semibold">
                Rating <span className="ml-1 font-normal text-[#6c5a67]">(optional)</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {ratingOptions.map((rating) => (
                  <label key={rating ?? "none"} className="relative">
                    <input
                      type="radio"
                      name={`${formId}-rating`}
                      value={rating ?? ""}
                      checked={wear.rating === rating}
                      onChange={() => setWear({ ...wear, rating })}
                      className="peer sr-only"
                    />
                    <span className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-[#d9ccd8] px-3 text-sm font-medium text-[#542f51] hover:bg-[#f6edf6] peer-checked:border-[#672f61] peer-checked:bg-[#672f61] peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#672f61] peer-disabled:cursor-default peer-disabled:opacity-60">
                      {rating ?? "No rating"}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor={`${formId}-note`} className="text-sm font-semibold">
                Note <span className="ml-1 font-normal text-[#6c5a67]">(optional)</span>
              </label>
              <textarea
                id={`${formId}-note`}
                rows={4}
                maxLength={1000}
                value={wear.note ?? ""}
                onChange={(event) => setWear({ ...wear, note: event.target.value })}
                className="mt-2 block w-full rounded-xl border border-[#d9ccd8] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#672f61] disabled:opacity-60"
              />
            </div>

            {error && <p role="alert" className="text-sm text-[#a42d40]">{error}</p>}
            <button
              type="submit"
              className={`${button} bg-[#672f61] text-white enabled:hover:bg-[#54254f]`}
            >
              {saving ? "Saving…" : "Save wear entry"}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

export function WearEntry(props: WearEntryProps) {
  return <WearForm key={props.id} {...props} />;
}
