"use client";

import Image from "next/image";
import { EnhancementCard, useLookEnhancement } from "./enhancement";
import type { LoadTryOn } from "./try-on";
import { WardrobePhotos } from "./wardrobe-photos";
import { ProfilePhotoChoice } from "./profile-photo-choice";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, imageUrl, type Garment, type Look } from "./shared";

type CompareProps = {
  loadTryOn: LoadTryOn;
  useProfilePhoto: boolean;
  setUseProfilePhoto: (value: boolean) => void;
  briefId: string;
  garments: Garment[];
  onChoose: (look: Look) => void;
  onEdit: () => void;
};

type Generation = {
  status: "ready" | "insufficient" | "failed";
  looks?: Look[];
  message?: string;
};

const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-divider px-5 py-2 text-sm font-semibold text-secondary transition hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-wait disabled:opacity-60";

function StyledImage({ look, catalogItemId, useProfilePhoto, loadTryOn }: {
  look: Look;
  catalogItemId: string | null;
  useProfilePhoto: boolean;
  loadTryOn: LoadTryOn;
}) {
  const [attempt, setAttempt] = useState(0);
  const [generated, setGenerated] = useState<string | null>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (look.profileRef && !useProfilePhoto) return;
    loadTryOn(look, useProfilePhoto, catalogItemId).then(({ imageRef }) => {
      if (active) setGenerated(imageRef);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Couldn’t generate the try-on.");
    });
    return () => { active = false; };
  }, [look, attempt, useProfilePhoto, catalogItemId, loadTryOn]);

  if (error) return <button type="button" className={secondaryButton} onClick={() => {
    setError("");
    setGenerated(undefined);
    setAttempt(count => count + 1);
  }}>Retry styled image</button>;
  if (generated === null) return null;
  return (
    <div className="relative grid aspect-[2/3] place-items-center overflow-hidden rounded-xl bg-selected">
      {generated ? (
        <Image src={imageUrl(generated)} alt="Full-body virtual try-on of this outfit" fill unoptimized className="object-contain"
          onError={() => { setGenerated(null); setError("Couldn’t load the try-on."); }} />
      ) : (
        <p role="status" className="px-5 text-center text-sm text-supporting">
          {look.profileRef && !useProfilePhoto ? "Select “Use my profile photo” above to see this try-on." : "Creating your full-body try-on…"}
        </p>
      )}
    </div>
  );
}

function LookCard({
  look,
  index,
  loadTryOn,
  useProfilePhoto,
  garments,
  onChoose,
}: {
  look: Look;
  index: number;
  loadTryOn: LoadTryOn;
  useProfilePhoto: boolean;
  garments: Map<string, Garment>;
  onChoose: (look: Look) => void;
}) {
  const enhancement = useLookEnhancement(look.id, look.slots);
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-divider bg-surface p-2 sm:p-3">
      {enhancement.product !== undefined && Object.keys(look.slots).length > 0 && (
        <StyledImage
          key={JSON.stringify([useProfilePhoto, enhancement.product?.id])}
          catalogItemId={enhancement.product?.id ?? null}
          look={look}
          loadTryOn={loadTryOn}
          useProfilePhoto={useProfilePhoto}
        />
      )}
      <div className="flex flex-1 flex-col px-1 pb-1 pt-3 sm:px-2">
        <h2 className="font-heading text-lg text-text sm:text-2xl">Look {index + 1}</h2>
        {Object.keys(look.slots).length > 0 && (
          <div className="mt-3">
            <WardrobePhotos garments={Object.values(look.slots).flatMap(id => garments.get(id) ?? [])} />
          </div>
        )}
        <EnhancementCard {...enhancement} />
        {look.explanation && <p className="mt-2 text-sm text-supporting">{look.explanation}</p>}
        <div className="flex-1" />
        {!look.profileRef && <button
          type="button"
          aria-label={`Choose look ${index + 1}`}
          onClick={() => onChoose(look)}
          className="mt-3 min-h-11 w-full rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
        >
          Choose this look
        </button>}
      </div>
    </article>
  );
}

async function generate(briefId: string, priorLooks: Look[]) {
  try {
    return await api<Generation>("generate", { briefId, priorLooks });
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : undefined,
    } satisfies Generation;
  }
}

function CompareBrief({ briefId, garments, onChoose, onEdit, loadTryOn, useProfilePhoto, setUseProfilePhoto }: CompareProps) {
  const [result, setResult] = useState<Generation>();
  const [looks, setLooks] = useState<Look[]>([]);
  const [busy, setBusy] = useState(true);
  const priorLooks = useRef<Look[]>([]);
  const initialRequest = useRef<Promise<Generation> | null>(null);

  useEffect(() => {
    let active = true;
    initialRequest.current ??= generate(briefId, []);
    void initialRequest.current.then((response) => {
      if (!active) return;
      const generated = response.status === "ready" ? response.looks || [] : [];
      priorLooks.current = generated;
      setLooks(generated);
      setResult(response);
      setBusy(false);
    });

    return () => {
      active = false;
    };
  }, [briefId]);

  async function requestOptions() {
    setBusy(true);
    const response = await generate(briefId, priorLooks.current);
    if (response.status === "ready" && response.looks?.length) {
      priorLooks.current = [...priorLooks.current, ...response.looks];
      setLooks(priorLooks.current);
    }
    setResult(response);
    setBusy(false);
  }

  const garmentById = new Map(garments.map((garment) => [garment.id, garment]));
  const insufficient = result?.status === "insufficient";
  const failed = result?.status === "failed";
  const empty = result?.status === "ready" && !result.looks?.length;
  const needsCloset = insufficient && !looks.length && !garments.length;
  const needsRetry = failed || empty || (insufficient && !looks.length);
  let message = "We couldn’t build any looks this time. Try again.";
  if (insufficient) {
    message = looks.length
      ? "There aren’t any more combinations for this brief."
      : "There aren’t enough matching pieces to build a look for this brief.";
  }

  return (
    <section aria-labelledby="compare-heading" className="text-text">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
        <div>
          <h1 id="compare-heading" className="font-heading text-4xl tracking-tight sm:text-5xl">
            Compare looks
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-supporting sm:text-base">
            See how the pieces work together and choose what you’d like to wear.
          </p>
        </div>
        <button type="button" onClick={onEdit} className={secondaryButton}>
          Edit brief
        </button>
      </header>

      {(busy || looks.length > 0) && (
        <div className="mb-5">
          <ProfilePhotoChoice checked={useProfilePhoto} onChange={setUseProfilePhoto} />
        </div>
      )}
      {looks.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          {looks.map((look, index) => (
            <LookCard
              key={look.id}
              look={look}
              index={index}
              loadTryOn={loadTryOn}
              useProfilePhoto={useProfilePhoto}
              garments={garmentById}
              onChoose={onChoose}
            />
          ))}
        </div>
      )}

      <div aria-live="polite" className={looks.length ? "mt-5" : ""}>
        {busy && (
          <p className="flex items-center gap-3 rounded-2xl border border-divider bg-canvas p-5 text-sm text-supporting">
            <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-divider border-t-primary motion-reduce:animate-none" />
            {looks.length ? "Finding more looks…" : "Putting together your looks…"}
          </p>
        )}
        {!busy && (insufficient || failed || empty) && (
          <p className="rounded-2xl border border-divider bg-canvas p-5 text-sm leading-relaxed text-supporting">
            {result?.message || message}
          </p>
        )}
      </div>

      {needsCloset && (
        <Link href="/closet" className={`mt-5 inline-flex items-center ${secondaryButton}`}>Open closet</Link>
      )}
      {!needsCloset && (needsRetry || (looks.length > 0 && !insufficient)) && (
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={requestOptions}
            className={secondaryButton}
          >
            {needsRetry ? "Try again" : "Show more looks"}
          </button>
        </div>
      )}
    </section>
  );
}

export function Compare(props: CompareProps) {
  return <CompareBrief key={props.briefId} {...props} />;
}
