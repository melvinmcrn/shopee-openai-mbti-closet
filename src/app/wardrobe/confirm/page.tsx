"use client";

import { privateFetch } from "../../private-fetch.mjs";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { wardrobeHref } from "../flow.mjs";
import { useWardrobeFlow } from "../use-wardrobe-flow";

const categories = [
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["dress", "Dress"],
  ["shoes", "Shoes"],
  ["outerwear", "Outerwear"],
  ["accessory", "Accessory"],
  ["other", "Other"],
] as const;

type Category = (typeof categories)[number][0];

type DraftItem = {
  id: number;
  name: string;
  category: Category;
  color: string | null;
  garmentType: string | null;
  imageUrl: string | null;
  extractionSource?: "fixture" | "luna";
};

type ItemEdits = Pick<DraftItem, "name" | "category" | "garmentType" | "color">;

const primaryButton = "inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-50";
const secondaryButton = "inline-flex min-h-11 items-center justify-center rounded-full border border-divider bg-surface px-5 py-2.5 text-sm font-semibold text-text hover:border-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";
const fieldClass = "mt-1 block min-h-11 w-full rounded-lg border border-divider bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60";

export default function ConfirmWardrobeItemsPage() {
  const router = useRouter();
  const { origin, destination, error: flowError, retry: retryFlow } = useWardrobeFlow();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(() => new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
  const [manualItemIds, setManualItemIds] = useState<Set<string>>(() => new Set());
  const [reloads, setReloads] = useState(0);
  const [saving, setSaving] = useState(false);
  const [discardingId, setDiscardingId] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const activeMutation = useRef<AbortController | null>(null);
  const selectedItems = items.filter((item) => !excludedIds.has(item.id));
  useEffect(() => () => activeMutation.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDrafts() {
      try {
        const response = await privateFetch("/api/wardrobe/items?status=draft", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setStatus("signed-out");
          return;
        }
        if (!response.ok) throw new Error("Drafts unavailable");

        const data: { items: DraftItem[] } = await response.json();
        if (controller.signal.aborted) return;
        const params = new URLSearchParams(window.location.search);
        const requestedId = params.get("item");
        const batchIds = params.get("batch");
        const manualIds = new Set(params.get("manual")?.split(","));
        if (requestedId && params.get("review") === "manual") manualIds.add(requestedId);
        setManualItemIds(manualIds);

        if (batchIds !== null) {
          const draftsById = new Map(data.items.map((item) => [String(item.id), item]));
          const batch = [...new Set(batchIds.split(","))].flatMap((id) => {
            const draft = draftsById.get(id);
            return draft ? [draft] : [];
          });
          setItems(batch);
        } else {
          const requestedItem = data.items.find((item) => String(item.id) === requestedId);
          setItems(requestedItem
            ? [requestedItem, ...data.items.filter((item) => item.id !== requestedItem.id)]
            : data.items);
        }
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }

    void loadDrafts();
    return () => controller.abort();
  }, [reloads]);

  function editItem(id: number, edits: Partial<ItemEdits>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...edits } : item));
    setErrors((current) => ({ ...current, [id]: "" }));
  }

  function selectItem(id: number, checked: boolean) {
    setExcludedIds((current) => {
      const next = new Set(current);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function discardItem(item: DraftItem) {
    if (activeMutation.current) return;
    const controller = new AbortController();
    activeMutation.current = controller;
    setSaving(true);
    setDiscardingId(item.id);
    setErrors((current) => ({ ...current, [item.id]: "" }));
    try {
      const response = await privateFetch(`/api/wardrobe/items/${item.id}`, {
        method: "PATCH",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discard: true }),
      });
      if (controller.signal.aborted) return;
      if (response.status === 204) {
        setItems((current) => current.filter(({ id }) => id !== item.id));
      } else {
        const message = response.status === 401 ? "Sign in again to discard this draft."
          : response.status === 409 ? "This item has already been confirmed. Refresh to see your remaining drafts."
          : "Couldn’t discard this draft. Try again.";
        setErrors((current) => ({ ...current, [item.id]: message }));
      }
    } catch {
      if (!controller.signal.aborted) {
        setErrors((current) => ({ ...current, [item.id]: "Couldn’t confirm removal. Try discarding this draft again." }));
      }
    } finally {
      activeMutation.current = null;
      setSaving(false);
      setDiscardingId(null);
    }
  }

  async function saveAndContinue() {
    if (activeMutation.current || !destination || !selectedItems.length) return;
    const controller = new AbortController();
    activeMutation.current = controller;
    setSaving(true);
    setErrors({});

    let failed = false;
    for (const item of selectedItems) {
      const name = item.name.trim();
      const color = item.color?.trim() || null;
      const garmentType = item.garmentType?.trim() || null;
      if (!name) {
        failed = true;
        setErrors((current) => ({ ...current, [item.id]: "Enter a name for this item." }));
        continue;
      }

      try {
        const response = await privateFetch(`/api/wardrobe/items/${item.id}`, {
          method: "PATCH",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, category: item.category, garmentType, color, confirm: true }),
        });

        if (controller.signal.aborted) return;
        if (response.status === 401) {
          failed = true;
          setErrors((current) => ({
            ...current,
            [item.id]: "Your session expired. Sign in again to confirm your remaining items.",
          }));
          break;
        }

        if (!response.ok) throw new Error("Confirmation failed");

        setItems((current) => current.filter(({ id }) => id !== item.id));
        setSavedCount((count) => count + 1);
      } catch {
        if (controller.signal.aborted) return;
        failed = true;
        setErrors((current) => ({ ...current, [item.id]: "Could not save this item. Try again." }));
      }
    }

    if (!failed) {
      router.push(destination.href);
      return;
    }
    activeMutation.current = null;
    setSaving(false);
  }

  return (
    <main className="flex-1 bg-selected px-5 py-6 text-text sm:px-8 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-divider pb-4 sm:pb-7">
          <Link className="text-sm font-semibold text-secondary hover:underline" href={wardrobeHref("/wardrobe/add", origin)}>
            <span aria-hidden="true">← </span>Add items
          </Link>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Confirm items</h1>
          <p className="mt-3 max-w-lg leading-relaxed text-supporting">
            Choose what to save to your closet. Unselected items stay in drafts for later.
          </p>
        </header>

        {status === "loading" && <p className="py-8" role="status">Loading draft items…</p>}
        {status === "error" && (
          <div className="space-y-4 py-8">
            <p className="text-danger" role="alert">Could not load your draft items.</p>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setStatus("loading");
                setReloads((count) => count + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {status === "signed-out" && (
          <div className="space-y-4 py-8">
            <p>Sign in to review your draft items.</p>
            <Link className={primaryButton} href="/">Go to sign in</Link>
          </div>
        )}
        {status === "ready" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 py-3">
              <p className="text-sm font-semibold" role="status">
                {items.length > 0
                  ? `${items.length} ${items.length === 1 ? "item" : "items"} to review`
                  : "No items to review"}
                {savedCount > 0 && ` · ${savedCount} confirmed`}
              </p>
              {items.length > 0 && destination && !saving && (
                <Link className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href={destination.href}>
                  Review later
                </Link>
              )}
            </div>

            {items.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <article key={item.id} className="overflow-hidden rounded-2xl border border-divider bg-surface">
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 font-semibold">
                      <input
                        aria-label={`Select ${item.name || "wardrobe item"}`}
                        checked={!excludedIds.has(item.id)}
                        className="size-5 shrink-0 accent-primary"
                        disabled={saving}
                        onChange={(event) => selectItem(item.id, event.currentTarget.checked)}
                        type="checkbox"
                      />
                      <span className="break-words">{item.name || "Wardrobe item"}</span>
                    </label>
                    <div className="relative aspect-[4/3] bg-selected">
                      {item.imageUrl ? (
                        <Image
                          unoptimized
                          fill
                          src={item.imageUrl}
                          alt={item.extractionSource ? `Garment cutout: ${item.name}` : item.name || "Wardrobe item"}
                          className="object-contain p-4"
                        />
                      ) : (
                        <p className="grid h-full place-items-center text-sm text-supporting">No photo available</p>
                      )}
                    </div>
                    <fieldset className="space-y-4 p-4" disabled={saving || excludedIds.has(item.id)}>
                      <legend className="sr-only">{item.name || "Wardrobe item"} details</legend>
                      {!item.extractionSource && manualItemIds.has(String(item.id)) && (
                        <p className="text-sm text-supporting">Original photo · Automatic extraction did not complete.</p>
                      )}
                      {item.extractionSource === "luna" && (
                        <p className="text-sm text-supporting">Garment cutout and AI-suggested details. You can edit them before saving.</p>
                      )}
                      {item.extractionSource === "fixture" && <p className="text-sm">Demo fixture cutout</p>}
                      <label className="block text-sm font-semibold">
                        Name
                        <input
                          className={fieldClass}
                          value={item.name}
                          required
                          onChange={(event) => editItem(item.id, { name: event.target.value })}
                        />
                      </label>
                      <label className="block text-sm font-semibold">
                        Category
                        <select
                          className={fieldClass}
                          value={item.category}
                          onChange={(event) => editItem(item.id, { category: event.target.value as Category })}
                        >
                          {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm font-semibold">
                        Garment type
                        <input
                          className={fieldClass}
                          value={item.garmentType ?? ""}
                          maxLength={80}
                          onChange={(event) => editItem(item.id, { garmentType: event.target.value })}
                        />
                      </label>
                      <label className="block text-sm font-semibold">
                        Color
                        <input
                          className={fieldClass}
                          value={item.color ?? ""}
                          onChange={(event) => editItem(item.id, { color: event.target.value })}
                        />
                      </label>
                    </fieldset>
                    <div className="space-y-3 px-4 pb-4">
                      {errors[item.id] && <p className="text-sm text-danger" role="alert">{errors[item.id]}</p>}
                      <button type="button" className={secondaryButton} disabled={saving} onClick={() => void discardItem(item)}>
                        {discardingId === item.id ? "Discarding…" : "Discard item"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <nav aria-label="Review actions" className="sticky bottom-[var(--footer-navigation-height)] mt-5 flex flex-wrap items-center gap-3 border-t border-divider bg-selected py-3">
              {items.length > 0 ? (
                <button
                  className={`${primaryButton} w-full sm:w-auto`}
                  disabled={saving || !selectedItems.length || !destination}
                  onClick={() => void saveAndContinue()}
                  type="button"
                >
                  {saving && discardingId === null ? "Saving…" : `Save ${selectedItems.length} selected ${selectedItems.length === 1 ? "item" : "items"} and continue`}
                </button>
              ) : destination && !saving && (
                <Link className={primaryButton} href={destination.href}>{destination.label}<span aria-hidden="true" className="ml-2">→</span></Link>
              )}
              {flowError && <p role="alert">Couldn’t load your setup. <button className="underline" type="button" onClick={retryFlow}>Try again</button></p>}
            </nav>
          </>
        )}
      </div>
    </main>
  );
}
