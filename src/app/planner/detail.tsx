"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, imageUrl, type Garment, type SavedLook } from "./shared";

type DetailProps = {
  id: string;
  onWear: (id: string) => void;
  onBack: () => void;
};

type DetailResult = { look: SavedLook } | { error: string };
type Wear = { id: string; date: string; rating: number | null; note: string | null };
type Suggestion = { id: string; title: string; url: string; sponsored: boolean };
type ItemsResult<T> = { items: T[] } | { error: string };

const slotOrder = ["top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#d9ccd8] px-5 py-2 text-sm font-semibold text-[#542f51] transition hover:bg-[#f6edf6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#672f61] disabled:opacity-60";

function SavedGarment({ slot, garment }: { slot: string; garment: Garment }) {
  const [imageFailed, setImageFailed] = useState(false);
  const slotLabel = slot.replace(/[-_]/g, " ");

  return (
    <li className="min-w-0 overflow-hidden rounded-2xl border border-[#e7dce4] bg-white">
      <div className="relative grid aspect-[7/6] place-items-center bg-[#f4efeb]">
        {garment.imageRef && !imageFailed ? (
          <Image
            src={imageUrl(garment.imageRef)}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 640px) 25vw, 50vw"
            className="object-contain"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span aria-hidden="true" className="px-2 text-center text-xs capitalize text-[#64565d]">
            {garment.color || slotLabel}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-xs font-medium capitalize text-[#6c5a67]">{slotLabel}</p>
        <p className="mt-1 wrap-break-word text-sm font-semibold">{garment.name}</p>
        {garment.color && <p className="mt-1 text-xs capitalize text-[#6c5a67]">{garment.color}</p>}
      </div>
    </li>
  );
}

function useLookItems<T>(action: "wearList" | "shopping", lookId: string) {
  const [result, setResult] = useState<ItemsResult<T>>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api<T[]>(action, { lookId })
      .then((items) => {
        if (active) setResult({ items });
      })
      .catch((error: unknown) => {
        if (active) {
          setResult({ error: error instanceof Error ? error.message : "Could not load this section." });
        }
      });
    return () => {
      active = false;
    };
  }, [action, lookId, attempt]);

  function retry() {
    setResult(undefined);
    setAttempt((value) => value + 1);
  }

  return { result, retry };
}

function SectionError({ error, retry, label }: { error: string; retry: () => void; label: string }) {
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-[#a42d40]">{error}</p>
      <button type="button" className={secondaryButton} onClick={retry}>{label}</button>
    </div>
  );
}

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatWearDate(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(day);
}

function WearHistory({ lookId, onWear }: { lookId: string; onWear: DetailProps["onWear"] }) {
  const { result, retry } = useLookItems<Wear>("wearList", lookId);
  const [date, setDate] = useState(localDate);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const active = useRef(false);
  const savePending = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function logWear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending.current || !date) return;
    savePending.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const entry = await api<Wear>("wearAdd", { lookId, date });
      if (active.current) onWear(entry.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not log this wear.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="saved-wear-title" className="space-y-4 rounded-2xl border border-[#e7dce4] bg-white p-4 sm:p-6">
      <h2 id="saved-wear-title" className="text-lg font-semibold">Wear history</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={logWear}>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Date worn
          <input
            type="date"
            required
            value={date}
            disabled={saving}
            onChange={(event) => setDate(event.target.value)}
            className="min-h-11 rounded-xl border border-[#d9ccd8] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#672f61]"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#672f61] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#54254f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#672f61] disabled:opacity-60"
        >
          {saving ? "Logging…" : "Log wear"}
        </button>
      </form>
      {saveError && <p role="alert" className="text-sm text-[#a42d40]">{saveError}</p>}
      {!result && <p role="status" className="text-sm text-[#6c5a67]">Loading wear history…</p>}
      {result && "error" in result && (
        <SectionError error={result.error} retry={retry} label="Retry wear history" />
      )}
      {result && "items" in result && (result.items.length ? (
        <ul className="divide-y divide-[#e7dce4]">
          {result.items.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  <time dateTime={entry.date}>{formatWearDate(entry.date)}</time>
                </p>
                {entry.rating != null && <p className="text-sm text-[#6c5a67]">Rated {entry.rating}/5</p>}
                {entry.note && <p className="wrap-break-word text-sm text-[#6c5a67]">{entry.note}</p>}
              </div>
              <button
                type="button"
                className={secondaryButton}
                aria-label={`Edit wear from ${formatWearDate(entry.date)}`}
                disabled={saving}
                onClick={() => onWear(entry.id)}
              >
                Edit wear
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#6c5a67]">No wears logged yet.</p>
      ))}
    </section>
  );
}

function shoppingHref(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return undefined;
  }
}

function ShoppingSuggestion({
  item,
  lookId,
  onHidden,
}: {
  item: Suggestion;
  lookId: string;
  onHidden: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const href = shoppingHref(item.url);

  async function hide() {
    setPending(true);
    setError("");
    try {
      await api("hide", { lookId, id: item.id });
      onHidden(item.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not hide this suggestion.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {item.sponsored && <p className="text-xs font-semibold text-[#6c5a67]">Sponsored</p>}
          {href ? (
            <a
              className="wrap-break-word text-sm font-semibold text-[#542f51] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#672f61]"
              href={href}
              target="_blank"
              rel={item.sponsored ? "sponsored noopener noreferrer" : "noopener noreferrer"}
            >
              {item.title}<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <p className="wrap-break-word text-sm font-semibold">{item.title}</p>
          )}
        </div>
        <button
          type="button"
          className={secondaryButton}
          disabled={pending}
          aria-label={`Hide ${item.title}`}
          onClick={hide}
        >
          {pending ? "Hiding…" : "Hide"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-[#a42d40]">{error}</p>}
    </li>
  );
}

function ShoppingSuggestions({ lookId }: { lookId: string }) {
  const { result, retry } = useLookItems<Suggestion>("shopping", lookId);
  const [hidden, setHidden] = useState<string[]>([]);
  const suggestions = result && "items" in result
    ? result.items.filter((item) => !hidden.includes(item.id))
    : undefined;

  return (
    <section aria-labelledby="saved-shopping-title" className="space-y-4 rounded-2xl border border-[#e7dce4] bg-white p-4 sm:p-6">
      <h2 id="saved-shopping-title" className="text-lg font-semibold">Shopping suggestions</h2>
      {!result && <p role="status" className="text-sm text-[#6c5a67]">Loading shopping suggestions…</p>}
      {result && "error" in result && (
        <SectionError error={result.error} retry={retry} label="Retry shopping suggestions" />
      )}
      {suggestions && (suggestions.length ? (
        <ul className="divide-y divide-[#e7dce4]">
          {suggestions.map((item) => (
            <ShoppingSuggestion
              key={item.id}
              item={item}
              lookId={lookId}
              onHidden={(id) => setHidden((items) => [...items, id])}
            />
          ))}
        </ul>
      ) : (
        <p role="status" className="text-sm text-[#6c5a67]">No shopping suggestions for this look.</p>
      ))}
    </section>
  );
}

function SavedDetail({ id, onWear, onBack }: DetailProps) {
  const [result, setResult] = useState<DetailResult>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api<SavedLook | null>("detail", { id })
      .then((look) => {
        if (active) setResult(look ? { look } : { error: "This saved look is unavailable." });
      })
      .catch((error: unknown) => {
        if (active) {
          setResult({ error: error instanceof Error ? error.message : "Could not open this saved look." });
        }
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const look = result && "look" in result ? result.look : undefined;
  const error = result && "error" in result ? result.error : undefined;
  const slots = look
    ? Object.entries(look.slots).sort(([a], [b]) => slotOrder.indexOf(a) - slotOrder.indexOf(b))
    : [];

  return (
    <section aria-labelledby="saved-detail-title" className="space-y-6 text-[#2a2229]">
      <header>
        <button type="button" className={secondaryButton} onClick={onBack}>
          <span aria-hidden="true" className="mr-2">←</span>Saved looks
        </button>
        <h1 id="saved-detail-title" className="mt-4 font-serif text-4xl tracking-tight sm:text-5xl">
          {look?.occasion || "Saved look"}
        </h1>
      </header>

      {!result && <p role="status" className="text-sm text-[#6c5a67]">Opening your saved look…</p>}
      {error && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-[#a42d40]">{error}</p>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setResult(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {look && (
        <>
          <section aria-labelledby="saved-pieces-title">
            <h2 id="saved-pieces-title" className="mb-3 text-lg font-semibold">Outfit pieces</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {slots.map(([slot, garment]) => (
                <SavedGarment key={slot} slot={slot} garment={garment} />
              ))}
            </ul>
          </section>
          {look.explanation && (
            <p className="max-w-2xl text-sm leading-relaxed text-[#51434d]"><strong>Original suggestion</strong> · {look.explanation}</p>
          )}
          <WearHistory lookId={look.id} onWear={onWear} />
          <ShoppingSuggestions lookId={look.id} />
        </>
      )}
    </section>
  );
}

export function Detail(props: DetailProps) {
  return <SavedDetail key={props.id} {...props} />;
}
