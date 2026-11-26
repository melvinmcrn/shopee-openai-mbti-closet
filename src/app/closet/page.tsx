"use client";

import { privateFetch } from "../private-fetch.mjs";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

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
type AffectedLook = { id: number; title: string };
type DeletePrompt = { item: Item; looks: AffectedLook[] | null };

function deleteImpactMessage(looks: AffectedLook[] | null) {
  if (looks === null) return "Checking saved looks…";
  if (looks.length === 0) return "This will remove the item from your wardrobe. No saved looks use it.";
  if (looks.length === 1) return "Deleting this item will also delete this saved look.";
  return `Deleting this item will also delete these ${looks.length} saved looks.`;
}

async function listCloset(signal?: AbortSignal): Promise<Closet> {
  const response = await privateFetch(itemsEndpoint, { cache: "no-store", signal });
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
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);
  const impactRequest = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
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

  useEffect(() => () => impactRequest.current?.abort(), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (deletePrompt) {
      if (!dialog.open) dialog.showModal();
      dialog.querySelector("button")?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [deletePrompt]);

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
      const response = await privateFetch(`${itemsEndpoint}/${item.id}`, {
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
      const response = await privateFetch(`${itemsEndpoint}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
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

  function cancelDeletion() {
    impactRequest.current?.abort();
    setDeletePrompt(null);
    setError("");
  }

  async function openDeletePrompt(item: Item) {
    impactRequest.current?.abort();
    const controller = new AbortController();
    impactRequest.current = controller;
    beginAction(null);
    setDeletePrompt({ item, looks: null });
    try {
      const response = await privateFetch(`${itemsEndpoint}/${item.id}/delete-impact`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Saved looks unavailable");
      const { savedLooks } = await response.json();
      if (!Array.isArray(savedLooks)) throw new Error("Invalid saved looks");
      if (!controller.signal.aborted) setDeletePrompt({ item, looks: savedLooks });
    } catch {
      if (!controller.signal.aborted) setError("Couldn’t check which saved looks use this item.");
    }
  }

  async function confirmDeletion() {
    if (!deletePrompt?.looks || busy) return;
    const { item, looks } = deletePrompt;
    setBusy(true);
    setError("");
    try {
      const response = await privateFetch(`${itemsEndpoint}/${item.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedLookIds: looks.map((look) => look.id) }),
      });
      if (response.status === 409) {
        const { code, savedLooks } = await response.json();
        if (code === "saved_looks_affected" && Array.isArray(savedLooks)) {
          setDeletePrompt({ item, looks: savedLooks });
          setError("The saved looks using this item changed. Review the updated list before confirming.");
          return;
        }
      }
      if (!response.ok) throw new Error("Deletion failed");
      setCloset((current) => current.status === "ready"
        ? { ...current, items: current.items.filter((existing) => existing.id !== item.id) }
        : current);
      setDeletePrompt(null);
      const count = looks.length;
      setNotice(count ? `Item and ${count} saved ${count === 1 ? "look" : "looks"} deleted.` : "Item deleted.");
    } catch {
      setError("Couldn’t delete this item. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const items = closet.status === "ready" ? closet.items : [];
  const visibleItems = category === "all" ? items : items.filter((item) => item.category === category);
  const affectedCount = deletePrompt?.looks?.length ?? 0;
  const deleteLabel = affectedCount === 0 ? "Delete item" : `Delete item and ${affectedCount === 1 ? "look" : "looks"}`;

  return (
    <main className="flex-1 bg-canvas text-text">
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
        {error && !action && !deletePrompt && <p className="mt-5 text-sm text-danger" role="alert">{error}</p>}

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
                      <button
                        aria-label={`Delete ${item.name}`}
                        className="min-h-11 px-2 text-sm font-semibold text-danger hover:underline disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void openDeletePrompt(item)}
                        type="button"
                      >
                        Delete
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
      <dialog
        ref={dialogRef}
        aria-labelledby="delete-item-title"
        aria-describedby={affectedCount > 0 ? "delete-item-impact delete-item-looks" : "delete-item-impact"}
        className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-divider bg-surface p-6 text-text shadow-xl backdrop:bg-text/40"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) cancelDeletion();
        }}
      >
        {deletePrompt && (
          <>
            <h2 id="delete-item-title" className="break-words font-heading text-2xl">Delete {deletePrompt.item.name}?</h2>
            <p id="delete-item-impact" aria-live="polite" className="mt-3 text-sm text-supporting">
              {deletePrompt.looks === null && error ? error : deleteImpactMessage(deletePrompt.looks)}
            </p>
            {affectedCount > 0 && (
              <ul id="delete-item-looks" className="mt-3 list-disc space-y-1 pl-5 text-sm font-semibold">
                {deletePrompt.looks?.map((look) => <li className="break-words" key={look.id}>{look.title}</li>)}
              </ul>
            )}
            {deletePrompt.looks !== null && error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} disabled={busy} onClick={cancelDeletion}>Cancel</button>
              {deletePrompt.looks === null && error ? (
                <button type="button" className={secondaryButton} onClick={() => void openDeletePrompt(deletePrompt.item)}>
                  Try again
                </button>
              ) : (
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-danger px-4 text-sm font-semibold text-on-primary disabled:opacity-50"
                  disabled={busy || deletePrompt.looks === null}
                  onClick={() => void confirmDeletion()}
                >
                  {busy ? "Deleting…" : deleteLabel}
                </button>
              )}
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
