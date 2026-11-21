"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
  const [items, setItems] = useState<DraftItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
  const [manualItemIds, setManualItemIds] = useState<Set<string>>(() => new Set());
  const [reloads, setReloads] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const savingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDrafts() {
      try {
        const response = await fetch("/api/wardrobe/items?status=draft", {
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

  async function confirmItems(drafts: DraftItem[]) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrors({});

    for (const item of drafts) {
      const name = item.name.trim();
      const color = item.color?.trim() || null;
      const garmentType = item.garmentType?.trim() || null;
      if (!name) {
        setErrors((current) => ({ ...current, [item.id]: "Enter a name for this item." }));
        continue;
      }

      try {
        const response = await fetch(`/api/wardrobe/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, category: item.category, garmentType, color, confirm: true }),
        });

        if (response.status === 401) {
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
        setErrors((current) => ({ ...current, [item.id]: "Could not confirm this item. Try again." }));
      }
    }

    savingRef.current = false;
    setSaving(false);
  }

  return (
    <main className="min-h-screen flex-1 bg-selected px-5 py-10 text-text sm:px-8 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-divider pb-7">
          <Link className="text-sm font-semibold text-secondary hover:underline" href="/wardrobe/add">
            <span aria-hidden="true">← </span>Add items
          </Link>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Confirm items</h1>
          <p className="mt-3 max-w-lg leading-relaxed text-supporting">
            Review the photos and details. Confirm items individually or save the whole batch with Confirm all.
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
            <div className="flex flex-wrap items-center justify-between gap-4 py-6">
              <p className="text-sm font-semibold" role="status">
                {items.length > 0
                  ? `${items.length} ${items.length === 1 ? "item" : "items"} to review`
                  : "No items to review"}
                {savedCount > 0 && ` · ${savedCount} confirmed`}
              </p>
              {items.length > 1 && (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={saving}
                  onClick={() => void confirmItems(items)}
                >
                  {saving ? "Confirming…" : "Confirm all"}
                </button>
              )}
            </div>

            {items.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <form
                    key={item.id}
                    className="overflow-hidden rounded-2xl border border-divider bg-surface"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void confirmItems([item]);
                    }}
                  >
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
                    <fieldset className="space-y-4 p-4" disabled={saving}>
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
                      {errors[item.id] && <p className="text-sm text-danger" role="alert">{errors[item.id]}</p>}
                      <button type="submit" className={`${primaryButton} w-full`}>
                        {saving ? "Confirming…" : "Confirm item"}
                      </button>
                    </fieldset>
                  </form>
                ))}
              </div>
            )}

            <nav aria-label="Wardrobe setup" className="mt-5 flex flex-wrap gap-3 border-t border-divider pt-6">
              <Link className={secondaryButton} href="/wardrobe/add">Add more items</Link>
              <Link className={primaryButton} href="/profile/style">
                Continue to style profile<span aria-hidden="true" className="ml-2">→</span>
              </Link>
            </nav>
          </>
        )}
      </div>
    </main>
  );
}
