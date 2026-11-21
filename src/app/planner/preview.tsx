"use client";

import Image from "next/image";
import { EnhancementCard, useLookEnhancement } from "./enhancement";
import { useEffect, useState } from "react";
import type { LoadTryOn } from "./try-on";
import { WardrobePhotos } from "./wardrobe-photos";
import { imageUrl, type Garment, type Look } from "./shared";

type PreviewProps = {
  look: Look;
  loadTryOn: LoadTryOn;
  useProfilePhoto: boolean;
  setUseProfilePhoto: (value: boolean) => void;
  garments: Garment[];
  onBack: () => void;
};

const slotOrder = ["other", "top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const buttonClass =
  "min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";

export function Preview({ look, loadTryOn, useProfilePhoto, setUseProfilePhoto, garments, onBack }: PreviewProps) {
  const slots = look.slots;
  const enhancement = useLookEnhancement(look.id, slots);
  const catalogItemId = enhancement.product === undefined ? undefined : enhancement.product?.id ?? null;
  const [attempt, setAttempt] = useState(0);
  const [generating, setGenerating] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const selectedSlots = slotOrder.filter((slot) => slots[slot]);

  useEffect(() => {
    let active = true;
    if (catalogItemId === undefined) return;
    loadTryOn(look, useProfilePhoto, catalogItemId).then(({ imageRef }) => {
      if (active) setPreview(imageRef);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Couldn’t generate the try-on.");
    }).finally(() => {
      if (active) setGenerating(false);
    });
    return () => { active = false; };
  }, [look, useProfilePhoto, attempt, loadTryOn, catalogItemId]);

  return (
    <section className="space-y-6 text-text">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Virtual try-on</h1>
        <p className="mt-2 text-sm text-supporting">
          Generate a virtual try-on of your outfit. Details and fit may vary.
        </p>
      </header>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-divider bg-surface p-4 sm:p-6">
          <WardrobePhotos garments={selectedSlots.flatMap(slot => garmentsById.get(slots[slot]) ?? [])} />
          <EnhancementCard {...enhancement} />
        </section>

        <section className="space-y-4 rounded-2xl border border-divider bg-selected p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Outfit try-on</h2>
          <label className="flex min-h-11 items-start gap-3 rounded-xl border border-divider bg-surface p-3 text-sm">
            <input
              type="checkbox"
              checked={useProfilePhoto}
              onChange={(event) => setUseProfilePhoto(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            />
            <span>
              <span className="block font-semibold">Use my profile photo for this preview</span>
              <span className="mt-1 block text-supporting">
                With your permission, your profile photo will be sent to OpenAI to generate this try-on.
              </span>
            </span>
          </label>
          {preview && catalogItemId !== undefined ? (
            <div className="relative aspect-3/4 max-h-[36rem] overflow-hidden rounded-xl bg-selected">
              <Image
                src={imageUrl(preview)}
                alt="Generated try-on of the selected outfit"
                fill
                unoptimized
                sizes="(min-width: 768px) 45vw, 90vw"
                className="object-contain"
                onError={() => {
                  setPreview(null);
                  setError("The try-on could not be loaded. Try generating it again.");
                }}
              />
            </div>
          ) : (
            <>
              {error && <button
                type="button"
                className={`${buttonClass} bg-primary text-on-primary hover:bg-primary-hover`}
                disabled={generating || !selectedSlots.length}
                onClick={() => { setError(""); setGenerating(true); setAttempt(n => n + 1); }}
              >
                Try again
              </button>}
              {generating && catalogItemId !== undefined && (
                <p role="status" className="text-sm text-supporting">Generating your outfit try-on…</p>
              )}
              {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
            </>
          )}
        </section>
      </div>

      <button
        type="button"
        className={`${buttonClass} border border-divider bg-surface text-secondary hover:bg-selected`}
        onClick={onBack}
      >
        {generating ? "Skip preview and return to save" : "Back to review and save"}
      </button>
    </section>
  );
}
