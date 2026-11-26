"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { normalizeUpload, photoAccept, photoRequirements } from "./normalize-upload.mjs";
import { maxBatchSize, prepareWardrobeBatch } from "./prepare-batch.mjs";
import { requestWardrobeUploadBatch, type BatchProgress } from "./request-wardrobe-upload.mjs";
import { wardrobeHref } from "../flow.mjs";
import { useWardrobeFlow } from "../use-wardrobe-flow";

const uploadError = "This photo could not be uploaded. Try again.";
const extractionError = "The garment details could not be read. Your photo is saved and ready for manual review.";
const manualCutoutError = "Your photo is saved. The automatic cutout failed. You can review it manually.";
const extractionMessages = new Map([
  ["extraction_unavailable", "Automatic garment extraction is unavailable right now."],
  ["unsupported_photo", "Automatic extraction couldn’t read this image. You can still review the saved photo."],
  ["garment_not_found", "No wardrobe items were found. Try a clearer photo or review it manually."],
  ["invalid_extraction", "Your photo is saved. Try extracting the main item, or review it manually."],
]);

const photoStatuses = {
  queued: "Ready to upload",
  uploading: "In progress",
  "upload-failed": "Upload failed",
  "extraction-failed": "Ready for manual review",
  primary: "Extracting the main item…",
  manual: "Ready for manual review",
  ready: "Ready to review",
};

type Photo = {
  file: File;
  name: string;
  preview: string;
  draftKey: string;
  id: number | null;
  garments?: ExtractedItem[];
  retryMainItem?: boolean;
  mayHaveDraft?: boolean;
  status: keyof typeof photoStatuses;
  error?: string;
};

type ExtractedItem = { id: number; name: string };
type Progress = BatchProgress | { phase: "preparing" };

type UploadItem = {
  draftKey: string;
  id?: unknown;
  extraction?: { status?: unknown; code?: string; nextAction?: "extract_primary" | "manual_review"; item?: ExtractedItem; items?: ExtractedItem[] } | null;
  status?: number;
  error?: string;
};

async function retryMainItem(photo: Photo, signal: AbortSignal): Promise<Photo> {
  try {
    const response = await fetch(`/api/wardrobe/items/${photo.id}/extract?mode=primary`, { method: "POST", signal });
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) return { ...photo, status: "manual", error: manualCutoutError };
    if (response.ok && "items" in result && Array.isArray(result.items) && result.items.length
      && result.items.every((item): item is ExtractedItem => item && Number.isSafeInteger(item.id) && typeof item.name === "string")) {
      return { ...photo, status: "ready", garments: result.items, retryMainItem: false, error: undefined };
    }
    const code = "code" in result && typeof result.code === "string" ? result.code : "";
    const message = "error" in result && typeof result.error === "string" ? result.error : extractionError;
    return { ...photo, status: "manual", error: code === "draft_changed" || code === "item_not_found" ? message : manualCutoutError };
  } catch {
    return { ...photo, status: "extraction-failed", retryMainItem: true, error: "The retry could not be confirmed. Try again or check your saved drafts." };
  }
}

const fileButton = "relative inline-flex cursor-pointer items-center rounded-full border border-divider px-4 py-2 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-secondary has-disabled:cursor-not-allowed has-disabled:opacity-60";
const actionButton = "rounded-full bg-primary px-5 py-2.5 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";

export default function AddWardrobePhotoPage() {
  const { origin, destination, error: flowError, retry: retryFlow } = useWardrobeFlow();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [preparingSelection, setPreparingSelection] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [preparationError, setPreparationError] = useState("");
  const [failedBatch, setFailedBatch] = useState<{ keys: Set<string>; message: string } | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<{ key: string; message: string; missing?: boolean } | null>(null);
  const previews = useRef(new Set<string>());
  const activeTask = useRef<AbortController | null>(null);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      activeTask.current?.abort();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const hasActiveUpload = progress !== null || removingKey !== null;
  useEffect(() => {
    if (!hasActiveUpload) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasActiveUpload]);

  const busy = preparingSelection || hasActiveUpload;
  const percent = progress?.phase === "uploading" ? progress.percent : undefined;
  const progressLabel = progress?.phase === "preparing"
    ? "Preparing photos…"
    : progress?.phase === "uploading"
      ? "Uploading photos…"
      : "Reading garment details…";
  const hasQueued = photos.some((photo) => photo.status === "queued");
  const hasFailures = photos.some((photo) => photo.status.endsWith("-failed"));
  const batchError = preparationError || (failedBatch && photos.some(({ draftKey }) => failedBatch.keys.has(draftKey))
    ? failedBatch.message : "");
  const uploaded = photos.filter((photo) => photo.id !== null);
  const reviewIds = uploaded.flatMap((photo) => photo.garments?.map((garment) => garment.id) ?? [photo.id]);
  const params = new URLSearchParams();
  params.set("batch", reviewIds.join(","));
  const manual = uploaded.filter((photo) => photo.status === "extraction-failed" || photo.status === "manual");
  if (manual.length) params.set("manual", manual.map((photo) => photo.id).join(","));

  async function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (activeTask.current || !files.length) return;

    if (photos.length + files.length > maxBatchSize) {
      setSelectionError(`Choose up to ${maxBatchSize} photos at a time. No new photos were added.`);
      return;
    }

    const controller = new AbortController();
    activeTask.current = controller;
    setPreparingSelection(true);
    setSelectionError("");
    setPreparationError("");
    let currentName = "";
    try {
      const prepared = [];
      // Decode sequentially to limit peak memory and add the selection atomically.
      for (const original of files) {
        currentName = original.name;
        const file = await normalizeUpload(original);
        if (controller.signal.aborted) return;
        prepared.push({ file, name: original.name });
      }
      const nextPhotos = prepared.map(({ file, name }): Photo => {
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        return { file, name, preview, draftKey: crypto.randomUUID(), id: null, status: "queued" };
      });
      setPhotos((current) => [...current, ...nextPhotos]);
    } catch {
      if (!controller.signal.aborted) {
        setSelectionError(`Couldn’t prepare “${currentName}”. ${photoRequirements}. No new photos were added.`);
      }
    } finally {
      activeTask.current = null;
      if (!controller.signal.aborted) setPreparingSelection(false);
    }
  }

  function forgetPhoto(photo: Photo) {
    URL.revokeObjectURL(photo.preview);
    previews.current.delete(photo.preview);
    setPhotos((current) => current.filter(({ draftKey }) => draftKey !== photo.draftKey));
    setSelectionError("");
    setPreparationError("");
    setRemovalError(null);
  }

  async function removePhoto(photo: Photo) {
    if (activeTask.current) return;
    if (photo.id === null && !photo.mayHaveDraft) {
      forgetPhoto(photo);
      return;
    }
    const controller = new AbortController();
    activeTask.current = controller;
    setRemovingKey(photo.draftKey);
    setRemovalError(null);
    try {
      const response = await fetch(`/api/wardrobe/upload?draftKey=${encodeURIComponent(photo.draftKey)}`, {
        method: "DELETE", signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 204) {
        forgetPhoto(photo);
      } else if (response.status === 404 && photo.id === null) {
        setRemovalError({
          key: photo.draftKey, missing: true,
          message: "No saved draft was found yet. Try removing again, or dismiss this photo here and check saved drafts later.",
        });
      } else {
        setRemovalError({ key: photo.draftKey, message: response.status === 401
          ? "Sign in again to remove this photo from your saved drafts."
          : "Couldn’t confirm removal. Try removing this photo again." });
      }
    } catch {
      if (!controller.signal.aborted) {
        setRemovalError({ key: photo.draftKey, message: "Couldn’t confirm removal. Try removing this photo again." });
      }
    } finally {
      activeTask.current = null;
      if (!controller.signal.aborted) setRemovingKey(null);
    }
  }

  async function processPhotos(selection: Photo[]) {
    if (activeTask.current || !selection.length) return;
    const controller = new AbortController();
    activeTask.current = controller;
    setPreparationError("");
    setFailedBatch(null);
    setRemovalError(null);
    setSelectionError("");
    setProgress({ phase: "preparing" });
    try {
      for (const photo of selection.filter((entry) => entry.retryMainItem)) {
        if (photo.id === null) continue;
        setProgress({ phase: "processing" });
        const updated = await retryMainItem(photo, controller.signal);
        if (controller.signal.aborted) return;
        setPhotos((current) => current.map((entry) => entry.draftKey === photo.draftKey ? updated : entry));
      }
      const batch = selection.filter((photo) => !photo.retryMainItem);
      if (!batch.length) return;
      let prepared;
      try {
        prepared = await prepareWardrobeBatch(batch);
      } catch (error) {
        if (!controller.signal.aborted) {
          setPreparationError(error instanceof Error ? error.message : "Photos could not be prepared. No photos were sent.");
        }
        return;
      }
      if (controller.signal.aborted) return;

      const keys = new Set(batch.map(({ draftKey }) => draftKey));
      setPhotos((current) => current.map((photo) =>
        keys.has(photo.draftKey) ? { ...photo, status: "uploading", error: undefined } : photo,
      ));
      let items: UploadItem[] | undefined;
      let responseStatus: number | undefined;
      try {
        const result = await requestWardrobeUploadBatch(prepared, setProgress, controller.signal);
        if (controller.signal.aborted) return;
        responseStatus = result.status;
        if (result.status === 200 && result.body && typeof result.body === "object" && "items" in result.body && Array.isArray(result.body.items)) {
          items = result.body.items;
        } else {
          const message = result.status === 401
            ? "Sign in again to upload or review wardrobe photos."
            : result.status === 413
              ? "The batch is too large to send. Remove some photos or choose smaller versions and retry."
              : "The upload could not be confirmed. Retry or check your saved drafts.";
          setFailedBatch({ keys, message });
        }
      } catch {
        if (controller.signal.aborted) return;
        setFailedBatch({ keys, message: "The upload could not be confirmed. Retry or check your saved drafts." });
      }

      const byKey = new Map(items?.filter((item) => item && typeof item.draftKey === "string")
        .map((item) => [item.draftKey, item]));
      const updated = batch.map((photo): Photo => {
        const item = byKey.get(photo.draftKey);
        if (typeof item?.id === "number" && Number.isSafeInteger(item.id) && item.id > 0) {
          if (item.extraction?.status === "ready") {
            const garments = item.extraction.items ?? (item.extraction.item && [item.extraction.item]);
            return { ...photo, id: item.id, garments, status: "ready", error: undefined };
          }
          if (item.extraction?.nextAction === "manual_review") {
            return { ...photo, id: item.id, status: "manual", error: manualCutoutError };
          }
          if (item.extraction?.nextAction === "extract_primary") {
            return { ...photo, id: item.id, status: "primary", error: undefined };
          }
          const code = item.extraction?.code;
          return {
            ...photo, id: item.id, status: "extraction-failed", retryMainItem: code === "invalid_extraction",
            error: (code && extractionMessages.get(code)) || extractionError,
          };
        }
        return {
          ...photo,
          status: photo.id === null ? "upload-failed" : "extraction-failed",
          // A lost response can leave a saved draft even when its ID never arrived.
          mayHaveDraft: photo.mayHaveDraft || ![400, 401, 403, 413, 415].includes(item?.status ?? responseStatus ?? 0),
          error: items
            ? item?.status === 409
              ? "This draft changed. Check the wardrobe review page for its latest details."
              : item?.error || (photo.id === null ? uploadError : extractionError)
            : undefined,
        };
      });
      const updatedByKey = new Map(updated.map((photo) => [photo.draftKey, photo]));
      setPhotos((current) => current.map((photo) => updatedByKey.get(photo.draftKey) ?? photo));
      for (const photo of updated) {
        if (photo.status !== "primary") continue;
        setProgress({ phase: "processing" });
        const result = await retryMainItem(photo, controller.signal);
        if (controller.signal.aborted) return;
        setPhotos((current) => current.map((entry) => entry.draftKey === photo.draftKey ? result : entry));
      }
    } finally {
      activeTask.current = null;
      if (!controller.signal.aborted) setProgress(null);
    }
  }

  function submitPhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void processPhotos(photos.filter((photo) => photo.status === "queued" || photo.status.endsWith("-failed")));
  }

  return (
    <main className="wardrobe-page mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-7 space-y-3">
        {!busy && (
          <nav aria-label="Wardrobe" className="flex flex-wrap gap-4 text-sm font-medium underline underline-offset-4">
            {destination && destination.href !== "/profile/style" && <Link href={destination.href}>{destination.label}</Link>}
            <Link href={wardrobeHref("/wardrobe/confirm", origin)}>Review saved drafts</Link>
          </nav>
        )}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Add wardrobe photos</h1>
        <p>Upload individual pieces or a full outfit. You can review and save each item we find.</p>
        {flowError && <p role="alert">Couldn’t load your setup. <button className="underline" type="button" onClick={retryFlow}>Try again</button></p>}
      </header>

      <form onSubmit={submitPhotos} className="space-y-5">
        <div className="rounded-3xl border border-divider bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap gap-3">
            <label className={fileButton}>
              {photos.length ? "Choose more photos" : "Choose photos"}
              <input
                type="file"
                accept={photoAccept}
                className="sr-only"
                multiple
                disabled={busy || photos.length >= maxBatchSize}
                onChange={choosePhotos}
              />
            </label>
            <label className={fileButton}>
              Take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={busy || photos.length >= maxBatchSize}
                onChange={choosePhotos}
              />
            </label>
          </div>
          <p className="mt-3 text-sm text-supporting">Up to {maxBatchSize} photos · {photoRequirements}</p>
          {preparingSelection && <p className="mt-3 text-sm" role="status">Preparing photos…</p>}
          {selectionError && <p className="mt-3 text-sm text-danger" role="alert">{selectionError}</p>}
          {photos.length > 0 && (
            <ul aria-label="Selected photos" className="mt-5 grid gap-3 sm:grid-cols-2">
              {photos.map((photo) => (
                <li key={photo.draftKey} className="min-w-0 rounded-2xl border border-divider p-3">
                  <Image
                    alt=""
                    className="h-32 w-full rounded-lg bg-selected object-contain"
                    height={128}
                    src={photo.preview}
                    unoptimized
                    width={240}
                  />
                  <p className="mt-2 break-all text-sm font-medium">{photo.name}</p>
                  {photo.status === "ready" && photo.garments?.length ? (
                    <div className="mt-1 text-sm">
                      <p>{photo.garments.length === 1 ? "1 item found" : `${photo.garments.length} items found`}</p>
                      <ul className="mt-1 list-disc pl-5 text-supporting">
                        {photo.garments.map((garment) => <li key={garment.id}>{garment.name}</li>)}
                      </ul>
                    </div>
                  ) : <p className="mt-1 text-sm">{photoStatuses[photo.status]}</p>}
                  {photo.error && <p className="mt-1 text-sm text-danger" role="alert">{photo.error}</p>}
                  {(photo.status === "queued" || photo.status === "manual" || photo.status.endsWith("-failed")) && (
                    <button
                      type="button"
                      className="mt-2 text-sm underline underline-offset-4 disabled:opacity-60"
                      aria-label={`Remove ${photo.name}`}
                      disabled={busy}
                      onClick={() => void removePhoto(photo)}
                    >
                      {removingKey === photo.draftKey ? "Removing…" : "Remove"}
                    </button>
                  )}
                  {removalError?.key === photo.draftKey && (
                    <div className="mt-2 text-sm">
                      <p role="alert" className="text-danger">{removalError.message}</p>
                      {removalError.missing && (
                        <button type="button" disabled={busy} className="mt-2 underline underline-offset-4" onClick={() => forgetPhoto(photo)}>
                          Dismiss from this batch
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {photos.length > 0 && (
          <>
            {progress && (
              <div className="space-y-2">
                <p className="flex justify-between gap-2 text-sm font-medium" role="status">
                  <span>{progressLabel}</span>
                  {percent !== undefined && <span aria-hidden="true">{percent}%</span>}
                </p>
                <div
                  aria-label={progressLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  role="progressbar"
                  className="h-2 overflow-hidden rounded-full bg-selected"
                >
                  {percent === undefined
                    ? <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse" />
                    : <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />}
                </div>
              </div>
            )}
            {!progress && (
              <p className="text-sm" role="status">{uploaded.length} of {photos.length} uploaded</p>
            )}
            {batchError && <p className="text-sm text-danger" role="alert">{batchError}</p>}
            <div className="flex flex-wrap items-center gap-3">
              {hasQueued && (
                <button className={actionButton} disabled={busy} type="submit">
                  Upload photos
                </button>
              )}
              {hasFailures && !hasQueued && (
                <button
                  className={actionButton}
                  disabled={busy}
                  type="submit"
                >
                  Retry failed photos
                </button>
              )}
              {!busy && !hasQueued && reviewIds.length > 0 && (
                <Link className={actionButton} href={wardrobeHref("/wardrobe/confirm", origin, params)}>
                  {reviewIds.length === 1 ? "Review item" : `Review ${reviewIds.length} items`}
                </Link>
              )}
            </div>
          </>
        )}
      </form>
    </main>
  );
}
