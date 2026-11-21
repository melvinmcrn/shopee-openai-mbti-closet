"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { api, imageUrl, type Garment, type Look } from "./shared";

type RefineProps = {
  look: Look;
  garments: Garment[];
  onSaved: (id: string) => void;
  onPreview: () => void;
  onBack: () => void;
};

const slotOrder = ["other", "top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const controlClass =
  "min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";

function slotLabel(slot: string) {
  if (slot === "other") return "Original photo";
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function GarmentPhoto({ garment }: { garment?: Garment }) {
  const src = garment?.imageRef ? imageUrl(garment.imageRef) : undefined;

  return (
    <div className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-selected">
      {src ? (
        <Image src={src} alt="" fill unoptimized sizes="56px" className="object-cover" />
      ) : (
        <span aria-hidden="true" className="text-lg text-supporting">—</span>
      )}
    </div>
  );
}

export function Refine({ look, garments, onSaved, onPreview, onBack }: RefineProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savePending = useRef(false);
  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const visibleSlots = slotOrder.filter(slot => look.slots[slot]);

  async function save() {
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setError("");

    try {
      const saved = await api<{ id: string }>("save", { optionId: look.id, slots: look.slots });
      onSaved(saved.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this outfit. Try again.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6 text-text">
      <header>
        <button
          type="button"
          className={`${controlClass} -ml-4 mb-2 text-secondary hover:bg-selected`}
          disabled={saving}
          onClick={onBack}
        >
          <span aria-hidden="true">← </span>Back to outfits
        </button>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Review your outfit</h1>
      </header>

      <section className="rounded-2xl border border-divider bg-surface p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Selected pieces</h2>
        <ul className="mt-4 divide-y divide-divider">
          {visibleSlots.map((slot) => {
            const id = look.slots[slot];
            const garment = garmentsById.get(id);
            return (
              <li key={slot} className="flex min-h-22 items-center gap-3 py-3">
                <GarmentPhoto garment={garment} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-supporting">{slotLabel(slot)}</p>
                  <p className="break-words text-sm font-medium">
                    {garment?.name ?? (id ? "Unavailable item" : "None")}
                  </p>
                  {garment?.color && <p className="text-xs text-supporting">{garment.color}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${controlClass} bg-primary text-on-primary hover:bg-primary-hover`}
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save outfit"}
        </button>
        <button
          type="button"
          className={`${controlClass} border border-divider bg-surface text-secondary hover:bg-selected`}
          disabled={saving}
          onClick={onPreview}
        >
          Preview outfit
        </button>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
    </section>
  );
}
