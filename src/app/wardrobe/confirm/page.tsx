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
  imageUrl: string | null;
};

type ItemEdits = Pick<DraftItem, "name" | "category" | "color">;

const primaryButton = "inline-flex min-h-11 items-center justify-center rounded-full bg-[#25201c] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#463a32] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9c3c24] disabled:opacity-50";
const secondaryButton = "inline-flex min-h-11 items-center justify-center rounded-full border border-[#c9bcb0] bg-white px-5 py-2.5 text-sm font-semibold text-[#25201c] hover:border-[#25201c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9c3c24]";
const fieldClass = "mt-1 block min-h-11 w-full rounded-lg border border-[#c9bcb0] bg-white px-3 py-2 text-base text-[#25201c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9c3c24] disabled:opacity-60";

export default function ConfirmWardrobeItemsPage() {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
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
        const requestedId = new URLSearchParams(window.location.search).get("item");
        const requestedItem = data.items.find((item) => String(item.id) === requestedId);
        setItems(requestedItem
          ? [requestedItem, ...data.items.filter((item) => item.id !== requestedItem.id)]
          : data.items);
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
      if (!name) {
        setErrors((current) => ({ ...current, [item.id]: "Enter a name for this item." }));
        continue;
      }

      try {
        const response = await fetch(`/api/wardrobe/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, category: item.category, color, confirm: true }),
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
    <main className="min-h-screen flex-1 bg-[#f8f4ef] px-5 py-10 text-[#25201c] sm:px-8 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-[#dcd0c5] pb-7">
          <Link className="text-sm font-semibold text-[#863420] hover:underline" href="/wardrobe/add">
            <span aria-hidden="true">← </span>Add items
          </Link>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Confirm items</h1>
          <p className="mt-3 max-w-lg leading-relaxed text-[#65574d]">
            Review the photos and details. Confirm each item you want to add to your wardrobe.
          </p>
        </header>

        {status === "loading" && <p className="py-8" role="status">Loading draft items…</p>}
        {status === "error" && (
          <div className="space-y-4 py-8">
            <p role="alert">Could not load your draft items.</p>
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
                    className="overflow-hidden rounded-2xl border border-[#dcd0c5] bg-white"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void confirmItems([item]);
                    }}
                  >
                    <div className="relative aspect-[4/3] bg-[#eee5db]">
                      {item.imageUrl ? (
                        <Image
                          unoptimized
                          fill
                          src={item.imageUrl}
                          alt={item.name || "Wardrobe item"}
                          className="object-contain p-4"
                        />
                      ) : (
                        <p className="grid h-full place-items-center text-sm text-[#65574d]">No photo available</p>
                      )}
                    </div>
                    <fieldset className="space-y-4 p-4" disabled={saving}>
                      <legend className="sr-only">{item.name || "Wardrobe item"} details</legend>
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
                        Color
                        <input
                          className={fieldClass}
                          value={item.color ?? ""}
                          onChange={(event) => editItem(item.id, { color: event.target.value })}
                        />
                      </label>
                      {errors[item.id] && <p className="text-sm text-[#a02f20]" role="alert">{errors[item.id]}</p>}
                      <button type="submit" className={`${primaryButton} w-full`}>
                        {saving ? "Confirming…" : "Confirm item"}
                      </button>
                    </fieldset>
                  </form>
                ))}
              </div>
            )}

            <nav aria-label="Wardrobe setup" className="mt-5 flex flex-wrap gap-3 border-t border-[#dcd0c5] pt-6">
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
