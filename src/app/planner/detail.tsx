"use client";

import { SavedPhoto } from "./saved-photo";
import { WardrobePhotos } from "./wardrobe-photos";
import { EnhancementProduct, type CatalogProduct } from "./enhancement";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, occasionLookLabel, type SavedLook } from "./shared";

type DetailProps = {
  onCompare?: () => void;
  id: string;
  onWear: (id: string) => void;
  onBack: () => void;
};

type DetailResult = { look: SavedLook } | { error: string };
type Wear = { id: string; date: string; rating: number | null; note: string | null };
type Suggestion = CatalogProduct & { catalogItemId: string; sponsored: boolean };
type ItemsResult<T> = { items: T[] } | { error: string };

const slotOrder = ["other", "top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-divider px-5 py-2 text-sm font-semibold text-secondary transition hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60";

function useLookItems<T>(action: "wearList" | "shopping", lookId?: string) {
  const [result, setResult] = useState<ItemsResult<T>>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!lookId) return;
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
      <p role="alert" className="text-sm text-danger">{error}</p>
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
    <section aria-labelledby="saved-wear-title" className="space-y-4 rounded-2xl border border-divider bg-surface p-4 sm:p-6">
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
            className="min-h-11 rounded-xl border border-divider bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60"
        >
          {saving ? "Logging…" : "Log wear"}
        </button>
      </form>
      {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
      {!result && <p role="status" className="text-sm text-supporting">Loading wear history…</p>}
      {result && "error" in result && (
        <SectionError error={result.error} retry={retry} label="Retry wear history" />
      )}
      {result && "items" in result && (result.items.length ? (
        <ul className="divide-y divide-divider">
          {result.items.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  <time dateTime={entry.date}>{formatWearDate(entry.date)}</time>
                </p>
                {entry.rating != null && <p className="text-sm text-supporting">Rated {entry.rating}/5</p>}
                {entry.note && <p className="wrap-break-word text-sm text-supporting">{entry.note}</p>}
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
        <p className="text-sm text-supporting">No wears logged yet.</p>
      ))}
    </section>
  );
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
        <div className="min-w-0 flex-1 basis-40 space-y-1">
          <EnhancementProduct product={item} sponsored={item.sponsored} />
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
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </li>
  );
}

function ShoppingSuggestions({ lookId, result, retry, suggestions, onHidden }: {
  lookId: string;
  result?: ItemsResult<Suggestion>;
  retry: () => void;
  suggestions?: Suggestion[];
  onHidden: (id: string) => void;
}) {
  if (!result || suggestions?.length === 0) return null;
  return (
    <section aria-labelledby="saved-shopping-title" className="space-y-4 rounded-2xl border border-divider bg-surface p-4 sm:p-6">
      <h2 id="saved-shopping-title" className="text-lg font-semibold">Elevate your look</h2>
      {result && "error" in result && (
        <SectionError error={result.error} retry={retry} label="Retry shopping suggestions" />
      )}
      {suggestions && (
        <ul className="divide-y divide-divider">
          {suggestions.map((item) => (
            <ShoppingSuggestion
              key={item.id}
              item={item}
              lookId={lookId}
              onHidden={onHidden}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SavedDetail({ id, onWear, onBack, onCompare }: DetailProps) {
  const [result, setResult] = useState<DetailResult>();
  const [attempt, setAttempt] = useState(0);

  const look = result && "look" in result ? result.look : undefined;
  const shopping = useLookItems<Suggestion>("shopping", look && !look.hasPinnedPreview ? id : undefined);
  const [hidden, setHidden] = useState<string[]>([]);
  const shoppingResult = look?.hasPinnedPreview
    ? { items: look.enhancements.map(product => ({ ...product, catalogItemId: product.id, sponsored: false })) }
    : shopping.result;
  const suggestions = shoppingResult && "items" in shoppingResult
    ? shoppingResult.items.filter(item => !hidden.includes(item.id)) : undefined;

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

  const catalogItemIds = suggestions?.map(item => item.catalogItemId);
  const error = result && "error" in result ? result.error : undefined;
  const slots = look
    ? Object.entries(look.slots).sort(([a], [b]) => slotOrder.indexOf(a) - slotOrder.indexOf(b))
    : [];

  return (
    <section aria-labelledby="saved-detail-title" className="space-y-6 text-text">
      <header>
        <div className="flex flex-wrap gap-2">
          {onCompare && <button type="button" className={secondaryButton} onClick={onCompare}>Back to compare looks</button>}
          <button type="button" className={secondaryButton} onClick={onBack}>Saved looks</button>
        </div>
        <h1 id="saved-detail-title" className="mt-4 font-heading text-4xl tracking-tight sm:text-5xl">
          {look?.occasion || "Saved look"}
        </h1>
        {look?.kind === "occasion" && <p className="mt-2 text-sm text-supporting">{occasionLookLabel}</p>}
      </header>

      {!result && <p role="status" className="text-sm text-supporting">Opening your saved look…</p>}
      {error && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-danger">{error}</p>
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
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <div className="mx-auto w-full max-w-sm empty:hidden md:mx-0 md:w-2/5 md:shrink-0">
              {catalogItemIds !== undefined && (
                <SavedPhoto look={look} catalogItemIds={catalogItemIds} />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-4 empty:hidden">
              <WardrobePhotos garments={slots.map(([, garment]) => garment)} />
              <ShoppingSuggestions lookId={look.id} result={shoppingResult} retry={shopping.retry} suggestions={suggestions}
                onHidden={id => setHidden(items => [...items, id])} />
            </div>
          </div>
          {look.explanation && (
            <p className="max-w-2xl text-sm leading-relaxed text-supporting"><strong>Original suggestion</strong> · {look.explanation}</p>
          )}
          <WearHistory lookId={look.id} onWear={onWear} />

        </>
      )}
    </section>
  );
}

export function Detail(props: DetailProps) {
  return <SavedDetail key={props.id} {...props} />;
}
