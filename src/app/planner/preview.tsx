"use client";

import { TryOnPhoto } from "./try-on-photo";
import { EnhancementCard, useLookEnhancement } from "./enhancement";
import type { LoadTryOn } from "./try-on";
import { WardrobePhotos } from "./wardrobe-photos";
import { occasionLookLabel, type Garment, type Look } from "./shared";

type PreviewProps = {
  look: Look;
  loadTryOn: LoadTryOn;
  garments: Garment[];
  onBack: () => void;
};

const slotOrder = ["other", "top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const buttonClass =
  "min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";

export function Preview({ look, loadTryOn, garments, onBack }: PreviewProps) {
  const slots = look.slots;
  const enhancement = useLookEnhancement(look.id, slots);
  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const selectedSlots = slotOrder.filter((slot) => slots[slot]);

  return (
    <section className="space-y-6 text-text">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Virtual try-on</h1>
        <p className="mt-2 text-sm text-supporting">
          {look.kind === "occasion" ? occasionLookLabel + "." : "Generate a virtual try-on of your outfit."} Details and fit may vary.
        </p>
      </header>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-divider bg-surface p-4 sm:p-6">
          <WardrobePhotos garments={selectedSlots.flatMap(slot => garmentsById.get(slots[slot]) ?? [])} />
          <EnhancementCard {...enhancement} />
        </section>

        {enhancement.products && (
          <div>
            <TryOnPhoto look={look} products={enhancement.products} loadTryOn={loadTryOn}
              alt="Generated try-on of the selected outfit" />
          </div>
        )}
      </div>

      <button
        type="button"
        className={`${buttonClass} bg-primary text-on-primary hover:bg-primary-hover`}
        onClick={onBack}
      >
        Back to review and save
      </button>
    </section>
  );
}
