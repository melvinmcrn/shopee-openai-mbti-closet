"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LoadTryOn } from "./try-on";
import { imageUrl, type Garment, type Look } from "./shared";

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
  const [attempt, setAttempt] = useState(0);
  const [generating, setGenerating] = useState(true);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const garmentsById = new Map(garments.map((garment) => [garment.id, garment]));
  const selectedSlots = slotOrder.filter((slot) => slots[slot]);

  useEffect(() => {
    let active = true;
    loadTryOn(look).then(({ imageRef }) => {
      if (active) setPreview(imageRef);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Couldn’t generate the try-on.");
    }).finally(() => {
      if (active) setGenerating(false);
    });
    return () => { active = false; };
  }, [look, attempt, loadTryOn]);

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
          <h2 className="text-lg font-semibold">Outfit try-on</h2>
          {preview ? (
            <div className="relative aspect-3/4 max-h-[36rem] overflow-hidden rounded-xl bg-selected">
              <Image
                src={imageUrl(preview)}
                alt="Generated try-on of the selected outfit"
                fill
                unoptimized
                sizes="(min-width: 768px) 45vw, 90vw"
                className="object-contain"
                onError={() => {
                  setPreview("");
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
              {generating && (
                <p role="status" className="text-sm text-supporting">Generating your outfit try-on…</p>
              )}
              {error && (
                <div className="space-y-1">
                  <p role="alert" className="text-sm font-medium text-danger">{error}</p>
                  <Link href="/profile/settings" className="text-sm font-semibold underline">Add or update your profile photo</Link>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <button
        type="button"
        className={`${buttonClass} border border-divider bg-surface text-secondary hover:bg-selected`}
        onClick={onBack}
      >
        {preview ? "Back to review and save" : "Skip preview and return to save"}
      </button>
    </section>
  );
}
