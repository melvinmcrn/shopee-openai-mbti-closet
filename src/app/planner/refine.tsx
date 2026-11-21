"use client";

import { WardrobePhotos } from "./wardrobe-photos";
import { LookEnhancement } from "./enhancement";
import { useRef, useState } from "react";
import { api, type Garment, type Look } from "./shared";

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
        <WardrobePhotos garments={visibleSlots.flatMap(slot => garmentsById.get(look.slots[slot]) ?? [])} />
        <LookEnhancement optionId={look.id} slots={look.slots} />
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
