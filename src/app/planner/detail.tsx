"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { api, imageUrl, type Garment, type SavedLook } from "./shared";

type DetailProps = {
  id: string;
  onWear: (id: string) => void;
  onBack: () => void;
};

type DetailResult = { look: SavedLook } | { error: string };

const slotOrder = ["top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#d9ccd8] px-5 py-2 text-sm font-semibold text-[#542f51] transition hover:bg-[#f6edf6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#672f61]";

function SavedGarment({ slot, garment }: { slot: string; garment: Garment }) {
  const [imageFailed, setImageFailed] = useState(false);
  const slotLabel = slot.replace(/[-_]/g, " ");

  return (
    <li className="min-w-0 overflow-hidden rounded-2xl border border-[#e7dce4] bg-white">
      <div className="relative grid aspect-[7/6] place-items-center bg-[#f4efeb]">
        {garment.imageRef && !imageFailed ? (
          <Image
            src={imageUrl(garment.imageRef)}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 640px) 25vw, 50vw"
            className="object-contain"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span aria-hidden="true" className="px-2 text-center text-xs capitalize text-[#64565d]">
            {garment.color || slotLabel}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-xs font-medium capitalize text-[#6c5a67]">{slotLabel}</p>
        <p className="mt-1 wrap-break-word text-sm font-semibold">{garment.name}</p>
        {garment.color && <p className="mt-1 text-xs capitalize text-[#6c5a67]">{garment.color}</p>}
      </div>
    </li>
  );
}

function SavedDetail({ id, onBack }: DetailProps) {
  const [result, setResult] = useState<DetailResult>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api<SavedLook | null>("detail", { id })
      .then((look) => {
        if (active) setResult(look ? { look } : { error: "This saved look is unavailable." });
      })
      .catch((error: unknown) => {
        if (active) {
          setResult({ error: error instanceof Error ? error.message : "Could not open this saved look." });
        }
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const look = result && "look" in result ? result.look : undefined;
  const error = result && "error" in result ? result.error : undefined;
  const slots = look
    ? Object.entries(look.slots).sort(([a], [b]) => slotOrder.indexOf(a) - slotOrder.indexOf(b))
    : [];

  return (
    <section aria-labelledby="saved-detail-title" className="space-y-6 text-[#2a2229]">
      <header>
        <button type="button" className={secondaryButton} onClick={onBack}>
          <span aria-hidden="true" className="mr-2">←</span>Saved looks
        </button>
        <h1 id="saved-detail-title" className="mt-4 font-serif text-4xl tracking-tight sm:text-5xl">
          {look?.occasion || "Saved look"}
        </h1>
      </header>

      {!result && <p role="status" className="text-sm text-[#6c5a67]">Opening your saved look…</p>}
      {error && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-[#a42d40]">{error}</p>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setResult(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {look && (
        <>
          <section aria-labelledby="saved-pieces-title">
            <h2 id="saved-pieces-title" className="mb-3 text-lg font-semibold">Outfit pieces</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {slots.map(([slot, garment]) => (
                <SavedGarment key={slot} slot={slot} garment={garment} />
              ))}
            </ul>
          </section>
          {look.explanation && (
            <p className="max-w-2xl text-sm leading-relaxed text-[#51434d]">{look.explanation}</p>
          )}
        </>
      )}
    </section>
  );
}

export function Detail(props: DetailProps) {
  return <SavedDetail key={props.id} {...props} />;
}
