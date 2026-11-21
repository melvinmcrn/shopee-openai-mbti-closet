"use client";

import Image from "next/image";
import { WardrobePhotos } from "./wardrobe-photos";
import { EnhancementProduct } from "./enhancement";
import { useEffect, useRef, useState } from "react";
import { api, imageUrl, occasionLookLabel, PlannerApiError, type CompletedLook, type Garment } from "./shared";

type RefineProps = {
  look: CompletedLook;
  garments: Garment[];
  onSaved: (id: string) => void;
  onStale: () => void;
  onBack: () => void;
};

const slotOrder = ["other", "top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const controlClass =
  "min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";

export function Refine({ look, garments, onSaved, onStale, onBack }: RefineProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savePending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const visibleSlots = slotOrder.filter(slot => look.slots[slot]);

  async function save() {
    if (savePending.current) return;
    const reviewHash = window.location.hash;
    savePending.current = true;
    setSaving(true);
    setError("");

    try {
      const saved = await api<{ id: string }>("save", {
        optionId: look.id, slots: look.slots, previewRef: look.imageRef,
        catalogItemIds: look.products.map(product => product.id),
      });
      if (mounted.current && window.location.hash === reviewHash) onSaved(saved.id);
    } catch (cause) {
      if (!mounted.current || window.location.hash !== reviewHash) return;
      if (cause instanceof PlannerApiError && (cause.status === 409 || cause.status === 404)) {
        onStale();
        return;
      }
      setError(cause instanceof Error ? cause.message : "Could not save this outfit. Try again.");
    } finally {
      savePending.current = false;
      if (mounted.current) setSaving(false);
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
          <span aria-hidden="true">← </span>Back to compare looks
        </button>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Review your outfit</h1>
        {look.kind === "occasion" && <p className="mt-2 text-sm text-supporting">{occasionLookLabel}</p>}
      </header>

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <figure className="mx-auto w-full max-w-sm">
          <Image src={imageUrl(look.imageRef)} alt="Full-body try-on of your selected look"
            width={512} height={768} unoptimized loading="eager"
            className="aspect-[2/3] w-full rounded-2xl bg-selected object-contain" />
          {look.useProfilePhoto === false && <figcaption className="mt-2 text-xs text-supporting">Studio model</figcaption>}
        </figure>
        <div className="min-w-0 space-y-5">
          <WardrobePhotos garments={visibleSlots.flatMap(slot => garmentsById.get(look.slots[slot]) ?? [])} />
          {look.products.length > 0 && (
            <ul aria-label="Suggested items" className="space-y-3">
              {look.products.map(product => <li key={product.id}><EnhancementProduct product={product} /></li>)}
            </ul>
          )}
          {look.explanation && <p className="text-sm leading-relaxed text-supporting">{look.explanation}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${controlClass} bg-primary text-on-primary hover:bg-primary-hover`}
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save outfit"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
    </section>
  );
}
