"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { api, imageUrl, type Garment, type Look } from "./shared";

type PreviewProps = {
  look: Look;
  slots: Record<string, string>;
  garments: Garment[];
  onBack: () => void;
};

const slotOrder = ["other", "top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const buttonClass =
  "min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";

export function Preview({ look, slots, garments, onBack }: PreviewProps) {
  const [useProfilePhoto, setUseProfilePhoto] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const selectedSlots = slotOrder.filter((slot) => slots[slot]);

  async function generate() {
    if (pending.current) return;
    pending.current = true;
    setGenerating(true);
    setError("");

    try {
      const result = await api<{ imageRef: string }>("preview", {
        optionId: look.id,
        slots,
        useProfilePhoto,
      });
      if (!result.imageRef) throw new Error("No illustration was returned. You can try again.");
      setPreview(result.imageRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the preview. Try again.");
    } finally {
      pending.current = false;
      setGenerating(false);
    }
  }

  return (
    <section className="space-y-6 text-text">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Illustrated preview</h1>
        <p className="mt-2 text-sm text-supporting">
          Generate an optional illustration of your outfit. Details and fit may vary.
        </p>
      </header>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-divider bg-surface p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Your final pieces</h2>
          <ul className="mt-3 divide-y divide-divider">
            {selectedSlots.map((slot) => {
              const garment = garmentsById.get(slots[slot]);
              return (
                <li key={slot} className="flex items-center gap-3 py-3">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-selected">
                    {garment?.imageRef && (
                      <Image
                        src={imageUrl(garment.imageRef)}
                        alt=""
                        fill
                        unoptimized
                        sizes="56px"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold capitalize text-supporting">{slot}</p>
                    <p className="break-words text-sm font-medium">{garment?.name ?? "Unavailable item"}</p>
                    {garment?.color && <p className="text-xs text-supporting">{garment.color}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-4 rounded-2xl border border-divider bg-selected p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Outfit illustration</h2>
          {preview ? (
            <div className="relative aspect-3/4 max-h-[36rem] overflow-hidden rounded-xl bg-selected">
              <Image
                src={imageUrl(preview)}
                alt="Generated illustration of the selected outfit"
                fill
                unoptimized
                sizes="(min-width: 768px) 45vw, 90vw"
                className="object-contain"
                onError={() => {
                  setPreview("");
                  setError("The illustration could not be loaded. Try generating it again.");
                }}
              />
            </div>
          ) : (
            <>
              <label className="flex min-h-11 items-start gap-3 rounded-xl border border-divider bg-surface p-3 text-sm">
                <input
                  type="checkbox"
                  checked={useProfilePhoto}
                  disabled={generating}
                  onChange={(event) => setUseProfilePhoto(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                />
                <span>
                  <span className="block font-semibold">Use my profile photo for this preview</span>
                  <span className="mt-1 block text-supporting">
                    With your permission, your profile photo will be sent to OpenAI to generate this illustration.
                  </span>
                </span>
              </label>
              <button
                type="button"
                className={`${buttonClass} bg-primary text-on-primary hover:bg-primary-hover`}
                disabled={generating || !selectedSlots.length}
                onClick={generate}
              >
                {generating ? "Generating…" : error ? "Try again" : "Generate illustration"}
              </button>
              {generating && (
                <p role="status" className="text-sm text-supporting">Generating your outfit illustration…</p>
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
        {preview ? "Back to refine and save" : "Skip preview and return to save"}
      </button>
    </section>
  );
}
