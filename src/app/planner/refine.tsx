"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { api, imageUrl, type Garment, type Look } from "./shared";

type RefineProps = {
  look: Look;
  garments: Garment[];
  slots: Record<string, string>;
  onChange: (slots: Record<string, string>) => void;
  onSaved: (id: string) => void;
  onPreview: () => void;
  onBack: () => void;
};

const slotOrder = ["top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const optionalSlots = ["outerwear", "accessory"];
const controlClass =
  "min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#713f65] disabled:cursor-not-allowed disabled:opacity-60";

function slotLabel(slot: string) {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function GarmentPhoto({ garment }: { garment?: Garment }) {
  const src = garment?.imageRef ? imageUrl(garment.imageRef) : undefined;

  return (
    <div className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#f1e9ee]">
      {src ? (
        <Image src={src} alt="" fill unoptimized sizes="56px" className="object-cover" />
      ) : (
        <span aria-hidden="true" className="text-lg text-[#806577]">—</span>
      )}
    </div>
  );
}

export function Refine({ look, garments, slots, onChange, onSaved, onPreview, onBack }: RefineProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savePending = useRef(false);
  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const visibleSlots = slotOrder.filter(
    (slot) =>
      look.slots[slot] ||
      slots[slot] ||
      (optionalSlots.includes(slot) && garments.some((garment) => garment.category === slot)),
  );
  const changed = visibleSlots.some((slot) => (look.slots[slot] || "") !== (slots[slot] || ""));

  function swap(slot: string, id: string) {
    const nextSlots = { ...slots };
    if (id) {
      nextSlots[slot] = id;
    } else {
      delete nextSlots[slot];
    }
    setError("");
    onChange(nextSlots);
  }

  async function save() {
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setError("");

    try {
      const saved = await api<{ id: string }>("save", { optionId: look.id, slots });
      onSaved(saved.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this outfit. Try again.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6 text-[#302331]">
      <header>
        <button
          type="button"
          className={`${controlClass} -ml-4 mb-2 text-[#713f65] hover:bg-[#f1e9ee]`}
          disabled={saving}
          onClick={onBack}
        >
          <span aria-hidden="true">← </span>Back to outfits
        </button>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Refine your outfit</h1>
        <p className="mt-2 text-sm text-[#655467]">Swap pieces with items from your wardrobe before saving.</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-[#e6dae2] bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Original outfit</h2>
          <ul className="mt-4 divide-y divide-[#eee6eb]">
            {visibleSlots.map((slot) => {
              const id = look.slots[slot];
              const garment = garmentsById.get(id);
              return (
                <li key={slot} className="flex min-h-22 items-center gap-3 py-3">
                  <GarmentPhoto garment={garment} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#655467]">{slotLabel(slot)}</p>
                    <p className="break-words text-sm font-medium">
                      {garment?.name ?? (id ? "Unavailable item" : "None")}
                    </p>
                    {garment?.color && <p className="text-xs text-[#655467]">{garment.color}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-[#dbbdcf] bg-[#fcf7fa] p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Your draft</h2>
          <ul className="mt-4 divide-y divide-[#eadde5]">
            {visibleSlots.map((slot) => {
              const id = slots[slot] || "";
              const garment = garmentsById.get(id);
              const isOptional = optionalSlots.includes(slot);
              const inOtherSlots = Object.entries(slots)
                .filter(([otherSlot]) => otherSlot !== slot)
                .map(([, itemId]) => itemId);
              const eligible = garments.filter(
                (item) => item.category === slot && !inOtherSlots.includes(item.id),
              );
              return (
                <li key={slot} className="flex min-h-22 items-center gap-3 py-3">
                  <GarmentPhoto garment={garment} />
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs font-semibold">
                      {slotLabel(slot)}
                      {id !== (look.slots[slot] || "") && (
                        <span className="text-[#713f65]">Changed</span>
                      )}
                    </span>
                    <select
                      value={id}
                      onChange={(event) => swap(slot, event.target.value)}
                      disabled={saving}
                      className="min-h-10 w-full rounded-lg border border-[#d4bdce] bg-white px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#713f65] disabled:opacity-60"
                    >
                      {isOptional && <option value="">None</option>}
                      {id && !eligible.some((item) => item.id === id) && (
                        <option value={id} disabled>{garment?.name ?? "Unavailable item"}</option>
                      )}
                      {eligible.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.color ? `${item.name} · ${item.color}` : item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${controlClass} bg-[#613853] text-white hover:bg-[#4e2943]`}
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save outfit"}
        </button>
        <button
          type="button"
          className={`${controlClass} border border-[#cdb5c5] bg-white text-[#613853] hover:bg-[#f1e9ee]`}
          disabled={saving}
          onClick={onPreview}
        >
          Preview outfit
        </button>
        {changed && (
          <button
            type="button"
            className={`${controlClass} text-[#713f65] hover:bg-[#f1e9ee]`}
            disabled={saving}
            onClick={() => {
              setError("");
              onChange({ ...look.slots });
            }}
          >
            Reset swaps
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm font-medium text-[#a42d40]">{error}</p>}
    </section>
  );
}
