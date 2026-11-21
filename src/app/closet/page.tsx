"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ClosetWordmark } from "../closet-wordmark";

const categoryLabels = {
  top: "Top",
  bottom: "Bottom",
  dress: "Dress",
  shoes: "Shoes",
  outerwear: "Outerwear",
  accessory: "Accessory",
  other: "Other",
};
type Category = keyof typeof categoryLabels;

const categories = Object.keys(categoryLabels) as Category[];
const itemsEndpoint = "/api/wardrobe/items";

type Item = {
  id: number;
  name: string;
  category: Category;
  color: string | null;
  imageUrl: string | null;
};

type Closet =
  | { status: "loading" | "signed-out" | "failed" }
  | { status: "ready"; items: Item[] };

type ItemAction = { id: number; type: "edit" | "archive" };

async function listCloset(signal?: AbortSignal): Promise<Closet> {
  const response = await fetch(itemsEndpoint, { cache: "no-store", signal });
  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) throw new Error("Couldn’t load your closet.");
  const { items } = (await response.json()) as { items: Item[] };
  return { status: "ready", items };
}

const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-divider px-4 text-sm font-semibold text-text hover:bg-selected disabled:opacity-50";
const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50";
const fieldClass =
  "mt-1 block min-h-11 w-full rounded-lg border border-divider bg-surface px-3 text-sm font-normal text-text";

export default function ClosetPage() {
  const [closet, setCloset] = useState<Closet>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [category, setCategory] = useState<Category | "all">("all");
  const [action, setAction] = useState<ItemAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void listCloset(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) setCloset(state);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCloset({ status: "failed" });
      });
    return () => controller.abort();
  }, [loadAttempt]);

  function beginAction(nextAction: ItemAction | null) {
    setError("");
    setNotice("");
    setAction(nextAction);
  }

  async function saveItem(event: FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    if (!name) {
      setError("Enter an item name.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${itemsEndpoint}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: fields.get("category"),
          color: String(fields.get("color") ?? "").trim() || null,
        }),
      });
      if (!response.ok) throw new Error("Update failed");
      const { item: updated } = (await response.json()) as { item: Item };
      setCloset((current) =>
        current.status === "ready"
          ? { status: "ready", items: current.items.map((existing) => existing.id === item.id ? updated : existing) }
          : current,
      );
      setAction(null);
      setNotice("Item updated.");
    } catch {
      setError("Couldn’t save this item. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveItem(item: Item) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${itemsEndpoint}/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Archive failed");
    } catch {
      setError("Couldn’t archive this item. Try again.");
      setBusy(false);
      return;
    }

    setCloset((current) =>
      current.status === "ready"
        ? { status: "ready", items: current.items.filter((existing) => existing.id !== item.id) }
        : current,
    );
    setAction(null);
    setNotice("Item archived.");
    try {
      setCloset(await listCloset());
    } catch {
      setError("Couldn’t refresh your closet. Reload the page to see the latest items.");
    } finally {
      setBusy(false);
    }
  }

  const items = closet.status === "ready" ? closet.items : [];
  const visibleItems = category === "all" ? items : items.filter((item) => item.category === category);

  return (
    <main className="min-h-screen flex-1 bg-canvas text-text">
      <header className="border-b border-divider">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4 sm:px-8">
          <Link className="flex h-[30px] items-center" href="/" aria-label="Closet home">
            <ClosetWordmark />
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold">
            <Link aria-current="page" className="underline underline-offset-4" href="/closet">Closet</Link>
            <Link className="hover:underline" href="/planner">Outfit planner</Link>
            <Link className="hover:underline" href="/profile/settings">Profile settings</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 pb-16 pt-9 sm:px-8 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-5xl leading-none tracking-tight sm:text-6xl">Closet</h1>
            {closet.status === "ready" && (
              <p className="mt-3 text-sm text-supporting">
                {items.length} {items.length === 1 ? "item" : "items"}
              </p>
            )}
          </div>
          <Link className={primaryButton} href="/wardrobe/add">Add items</Link>
        </div>

        {notice && <p className="mt-5 text-sm text-secondary" role="status">{notice}</p>}
        {error && !action && <p className="mt-5 text-sm text-danger" role="alert">{error}</p>}

        {closet.status === "loading" && <p className="mt-8" role="status">Loading your closet…</p>}
        {closet.status === "signed-out" && (
          <p className="mt-8">
            <Link className="font-semibold underline" href="/">Sign in with Google</Link> to view your closet.
          </p>
        )}
        {closet.status === "failed" && (
          <div className="mt-8 space-y-3">
            <p className="text-danger" role="alert">Couldn’t load your closet.</p>
            <button
              className={secondaryButton}
              onClick={() => {
                setCloset({ status: "loading" });
                setLoadAttempt((attempt) => attempt + 1);
              }}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {closet.status === "ready" && items.length === 0 && (
          <p className="mt-8 rounded-2xl border border-divider bg-surface px-5 py-8">
            Your closet is empty. Add and confirm your first item to see it here.
          </p>
        )}

        {items.length > 0 && (
          <div aria-label="Filter by category" className="mb-6 mt-8 flex flex-wrap gap-2" role="group">
            {(["all", ...categories] as const).map((filter) => (
              <button
                aria-pressed={category === filter}
                className={`${secondaryButton} aria-pressed:border-secondary aria-pressed:bg-selected`}
                disabled={busy}
                key={filter}
                onClick={() => {
                  setCategory(filter);
                  beginAction(null);
                }}
                type="button"
              >
                {filter === "all" ? "All items" : categoryLabels[filter]}
              </button>
            ))}
          </div>
        )}

        {items.length > 0 && visibleItems.length === 0 && (
          <p className="rounded-2xl border border-divider bg-surface px-5 py-8">No items in this category.</p>
        )}
        {visibleItems.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] items-start gap-4 sm:gap-5">
            {visibleItems.map((item) => (
              <li className="overflow-hidden rounded-2xl border border-divider bg-surface" key={item.id}>
                <div className="relative aspect-[4/3] bg-selected">
                  {item.imageUrl && (
                    <Image
                      alt=""
                      className="object-contain"
                      fill
                      sizes="(min-width: 1024px) 270px, (min-width: 640px) 33vw, 90vw"
                      src={item.imageUrl}
                      unoptimized
                    />
                  )}
                </div>
                <div className="p-4">
                  <h2 className="break-words text-lg font-semibold">{item.name}</h2>
                  <p className="mt-1 break-words text-sm text-supporting">
                    {categoryLabels[item.category]}{item.color && ` · ${item.color}`}
                  </p>

                  {action?.id !== item.id && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        aria-label={`Edit ${item.name}`}
                        className={secondaryButton}
                        disabled={busy}
                        onClick={() => beginAction({ id: item.id, type: "edit" })}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        aria-label={`Archive ${item.name}`}
                        className={secondaryButton}
                        disabled={busy}
                        onClick={() => beginAction({ id: item.id, type: "archive" })}
                        type="button"
                      >
                        Archive
                      </button>
                    </div>
                  )}

                  {action?.id === item.id && action.type === "edit" && (
                    <form className="mt-4" onSubmit={(event) => void saveItem(event, item)}>
                      <fieldset className="space-y-3" disabled={busy}>
                        <label className="block text-sm font-semibold">
                          Name
                          <input className={fieldClass} defaultValue={item.name} name="name" required />
                        </label>
                        <label className="block text-sm font-semibold">
                          Category
                          <select className={fieldClass} defaultValue={item.category} name="category">
                            {categories.map((option) => (
                              <option key={option} value={option}>{categoryLabels[option]}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm font-semibold">
                          Color
                          <input className={fieldClass} defaultValue={item.color ?? ""} name="color" />
                        </label>
                        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                        <div className="flex flex-wrap gap-2">
                          <button className={primaryButton} type="submit">{busy ? "Saving…" : "Save"}</button>
                          <button className={secondaryButton} onClick={() => beginAction(null)} type="button">Cancel</button>
                        </div>
                      </fieldset>
                    </form>
                  )}

                  {action?.id === item.id && action.type === "archive" && (
                    <div className="mt-4 space-y-3">
                      <p className="text-sm">Archive this item from your closet?</p>
                      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={primaryButton}
                          disabled={busy}
                          onClick={() => void archiveItem(item)}
                          type="button"
                        >
                          {busy ? "Archiving…" : "Confirm archive"}
                        </button>
                        <button
                          className={secondaryButton}
                          disabled={busy}
                          onClick={() => beginAction(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
