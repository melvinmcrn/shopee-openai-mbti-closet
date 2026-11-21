"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, imageUrl, occasionLookLabel, type CompletedLook, type Garment, type Look } from "./shared";
import type { LoadTryOn } from "./try-on";

type CompareProps = {
  loadTryOn: LoadTryOn;
  briefId: string;
  comparison?: Comparison;
  notice?: string;
  onComparison: (comparison: Comparison) => void;
  garments: Garment[];
  onChoose: (look: CompletedLook) => void;
  onEdit: () => void;
};

type Generation = {
  status: "ready" | "insufficient" | "failed";
  looks?: Look[];
  message?: string;
};

export type Comparison = { looks: Look[]; result?: Generation; request?: Promise<Generation> };
type PhotoState = { attempt: number; status?: "ready" | "failed" };
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-divider px-5 py-2 text-sm font-semibold text-secondary transition hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-wait disabled:opacity-60";

function LookCard({ look, index, loadTryOn, attempt, onStatus, onChoose }: {
  look: Look;
  index: number;
  loadTryOn: LoadTryOn;
  attempt: number;
  onStatus: (id: string, state: PhotoState) => void;
  onChoose: (look: CompletedLook) => void;
}) {
  const [completed, setCompleted] = useState<CompletedLook | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    loadTryOn(look).then(result => {
      if (!active) return;
      if (result) setCompleted(result);
      else onStatus(look.id, { attempt, status: "failed" });
    }).catch(() => {
      if (active) onStatus(look.id, { attempt, status: "failed" });
    });
    return () => { active = false; };
  }, [look, loadTryOn, attempt, onStatus]);
  if (!completed) return null;
  const occasion = look.kind === "occasion";
  return (
    <article hidden={!visible} className="min-w-0 rounded-2xl border border-divider bg-surface p-2 sm:p-3">
      <h2 className="mb-2 px-1 font-heading text-lg text-text sm:text-2xl">
        {occasion ? occasionLookLabel : `Look ${index + 1}`}
      </h2>
      <button
        type="button" aria-label={occasion ? "Choose occasion look" : `Choose look ${index + 1}`}
        aria-describedby={completed.useProfilePhoto === false ? `model-${look.id}` : undefined}
        disabled={!visible} onClick={() => onChoose(completed)}
        className="group flex w-full flex-col items-stretch gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
      >
        <Image src={imageUrl(completed.imageRef)} alt="Full-body virtual try-on of this outfit"
          width={512} height={768} loading="eager" unoptimized className="aspect-[2/3] w-full rounded-xl bg-selected object-contain"
          onLoad={() => { setVisible(true); onStatus(look.id, { attempt, status: "ready" }); }}
          onError={() => { setVisible(false); onStatus(look.id, { attempt, status: "failed" }); }} />
        {completed.useProfilePhoto === false &&
          <span id={`model-${look.id}`} className="text-xs text-supporting">Studio model</span>}
        <span className="flex min-h-11 items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition group-hover:bg-primary-hover">
          Choose this look
        </span>
      </button>
    </article>
  );
}

async function generate(briefId: string, priorLooks: Look[]): Promise<Generation> {
  try {
    return await api<Generation>("generate", { briefId, priorLooks });
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : undefined };
  }
}

function CompareBrief({ briefId, comparison, notice, onComparison, garments, onChoose, onEdit, loadTryOn }: CompareProps) {
  const initialRequest = useRef<Promise<Generation> | null>(null);
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const onStatus = useCallback((id: string, photo: PhotoState) => {
    setPhotos(current => {
      const prior = current[id];
      if ((prior?.attempt ?? 0) !== photo.attempt || prior?.status === photo.status) return current;
      return { ...current, [id]: photo };
    });
  }, []);

  useEffect(() => {
    if (!comparison) {
      const request = initialRequest.current ??= generate(briefId, []);
      onComparison({ looks: [], request });
      return;
    }
    if (!comparison.request) return;
    let active = true;
    void comparison.request.then(result => {
      if (!active) return;
      const batch = result.status === "ready" ? result.looks ?? [] : [];
      const looks = [...new Map([...comparison.looks, ...batch].map(look => [look.id, look])).values()];
      onComparison({ result, looks });
    });
    return () => { active = false; };
  }, [briefId, comparison, onComparison]);

  const looks = comparison?.looks ?? [];
  const result = comparison?.result;
  const ordered = [...looks.filter(look => look.kind !== "occasion"), ...looks.filter(look => look.kind === "occasion")];
  const generating = !comparison || Boolean(comparison.request);
  const pending = looks.some(look => !photos[look.id]?.status);
  const ready = looks.some(look => photos[look.id]?.status === "ready");
  const failedPhotos = looks.filter(look => photos[look.id]?.status === "failed");
  const insufficient = result?.status === "insufficient";
  const needsCloset = insufficient && !looks.length && !garments.length;
  const generationFailed = result?.status === "failed" || (result?.status === "ready" && !result.looks?.length);
  const canGenerate = generationFailed || (!looks.length && insufficient && !needsCloset) ||
    (looks.length > 0 && garments.length > 0 && !insufficient);

  function retryPhotos() {
    const updates: Record<string, PhotoState> = {};
    for (const look of failedPhotos) {
      loadTryOn.clear(look);
      updates[look.id] = { attempt: photos[look.id].attempt + 1 };
    }
    setPhotos(current => ({ ...current, ...updates }));
  }

  return (
    <section aria-labelledby="compare-heading" className="text-text">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
        <h1 id="compare-heading" className="font-heading text-4xl tracking-tight sm:text-5xl">Compare looks</h1>
        <button type="button" onClick={onEdit} className={secondaryButton}>Edit brief</button>
      </header>
      {notice && <p role="status" className="mb-4 text-sm text-supporting">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((look, index) => {
          const attempt = photos[look.id]?.attempt ?? 0;
          return <LookCard key={look.id + "/" + attempt} look={look} index={index} attempt={attempt}
            loadTryOn={loadTryOn} onStatus={onStatus} onChoose={onChoose} />;
        })}
      </div>
      <div aria-live="polite" className="mt-4 space-y-2 text-sm text-supporting">
        {(generating || pending) && (
          <p role="status" className="flex items-center gap-3 rounded-2xl border border-divider bg-canvas p-5">
            <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-divider border-t-primary motion-reduce:animate-none" />
            {generating ? (looks.length ? "Finding more looks…" : "Putting together your looks…") : "Creating your full-body photos…"}
          </p>
        )}
        {!generating && (insufficient || generationFailed) && (
          <p>{insufficient && looks.length ? "There aren’t any more combinations for this brief." :
            result?.message || "We couldn’t build any looks for this brief. Try again."}</p>
        )}
        {!generating && !pending && failedPhotos.length > 0 && (
          <p>{ready ? "Some outfit photos couldn’t be completed." : "No completed outfit photos are available for this brief."}</p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {!pending && failedPhotos.length > 0 && (
          <button type="button" onClick={retryPhotos} className={secondaryButton}>Retry photos</button>
        )}
        {needsCloset && <Link href="/closet" className={secondaryButton}>Open closet</Link>}
        {canGenerate && comparison && (
          <button type="button" disabled={generating}
            onClick={() => onComparison({ ...comparison, request: generate(briefId, looks) })} className={secondaryButton}>
            {generationFailed || !looks.length ? "Try again" : "Show more looks"}
          </button>
        )}
      </div>
    </section>
  );
}

export function Compare(props: CompareProps) {
  return <CompareBrief key={props.briefId} {...props} />;
}
