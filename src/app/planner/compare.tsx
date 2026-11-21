"use client";

import Image from "next/image";
import { LookEnhancement } from "./enhancement";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, imageUrl, type Garment, type Look } from "./shared";

type CompareProps = {
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

function GarmentTile({ garment, slot }: { garment?: Garment; slot: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const src = garment?.imageRef ? imageUrl(garment.imageRef) : "";
  const slotLabel = slot === "other" ? "Original photo" : slot.replace(/[-_]/g, " ");

  return (
    <li className="min-w-0">
      <div className="relative flex aspect-[7/6] items-center justify-center overflow-hidden rounded-xl bg-selected">
        {src && !imageFailed ? (
          <Image
            src={src}
            alt=""
            fill
            unoptimized
            className="object-contain"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="px-2 text-center text-xs capitalize text-supporting">
            {garment?.color || slotLabel}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs font-medium capitalize text-supporting">
        {slotLabel}
      </p>
      <p className="mt-0.5 break-words text-sm font-semibold text-text">
        {garment?.name || "Item unavailable"}
      </p>
    </li>
  );
}

function StyledImage({ look, garments }: { look: Look; garments: Map<string, Garment> }) {
  const [useProfilePhoto, setUseProfilePhoto] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [generated, setGenerated] = useState("");
  const [error, setError] = useState(false);
  const request = useRef<Promise<{ imageRef: string }> | null>(null);
  const original = look.profileRef || garments.get(look.slots.other ?? Object.values(look.slots)[0])?.imageRef;
  useEffect(() => {
    let active = true;
    if (look.profileRef && !useProfilePhoto) return;
    request.current ??= api<{ imageRef: string }>("preview", {
      optionId: look.id, slots: look.slots, useProfilePhoto,
    });
    request.current.then(({ imageRef }) => {
      if (active) setGenerated(imageRef);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [look, attempt, useProfilePhoto]);
  const ref = generated || original;
  return (
    <div className="mt-4">
      {ref && <Image src={imageUrl(ref)} alt={generated ? "AI-styled outfit" : "Original wardrobe photo"} width={512} height={640} unoptimized className="max-h-[32rem] w-full rounded-xl bg-selected object-contain" />}
      <p role="status" className="mt-2 text-sm text-supporting">
        {generated ? "AI-styled outfit" : error ? "Couldn’t generate the styled image." : look.profileRef && !useProfilePhoto ? "Original profile photo" : "Styling your outfit…"}
      </p>
      <label className="mt-2 flex items-center gap-2 text-sm text-supporting">
        <input type="checkbox" checked={useProfilePhoto} onChange={event => {
          request.current = null;
          setGenerated("");
          setError(false);
          setUseProfilePhoto(event.target.checked);
        }} />
        Use my profile photo as the main image and send it to OpenAI for styling
      </label>
      {error && <button type="button" className={secondaryButton} onClick={() => {
        request.current = null;
        setError(false);
        setAttempt(count => count + 1);
      }}>Retry styled image</button>}
    </div>
  );
}

function LookCard({
  look,
  index,
  garments,
  onChoose,
}: {
  look: Look;
  index: number;
  garments: Map<string, Garment>;
  onChoose: (look: Look) => void;
}) {
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-divider bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="font-heading text-2xl text-text">Look {index + 1}</h2>
      {look.occasion && (
        <p className="mt-1 text-sm text-supporting">{look.occasion}</p>
      )}
      <StyledImage look={look} garments={garments} />
      <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">
        {Object.entries(look.slots).map(([slot, garmentId]) => (
          <GarmentTile
            key={`${slot}:${garmentId}`}
            garment={garments.get(garmentId)}
            slot={slot}
          />
        ))}
      </ul>
      <p className="mb-4 mt-5 flex-1 text-sm leading-relaxed text-supporting">
        {look.explanation}
      </p>
      <LookEnhancement optionId={look.id} slots={look.slots} />
      {!look.profileRef && <button
        type="button"
        aria-label={`Choose look ${index + 1}`}
        onClick={() => onChoose(look)}
        className="min-h-11 w-full rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
      >
        Choose this look
      </button>}
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

function CompareBrief({ briefId, garments, onChoose, onEdit }: CompareProps) {
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
      setLooks(response.looks);
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

      {looks.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {looks.map((look, index) => (
            <LookCard
              key={look.id}
              look={look}
              index={index}
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
            {needsRetry ? "Try again" : "More options"}
          </button>
        </div>
      )}
    </section>
  );
}

export function Compare(props: CompareProps) {
  return <CompareBrief key={props.briefId} {...props} />;
}
