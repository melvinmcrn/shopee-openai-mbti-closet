"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { normalizeUpload } from "./normalize-upload.mjs";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxBatchSize = 20;
const maxImageBytes = 8 * 1024 * 1024;
const uploadError = "The photo could not be uploaded. Try again.";
const extractionError = "The garment details could not be read. Your photo is saved and ready for manual review.";
const extractionMessages = new Map([
  ["extraction_unavailable", "Automatic garment extraction is unavailable right now."],
  ["unsupported_photo", "This photo format could not be processed. Try a clearer JPEG or PNG."],
  ["garment_not_found", "No garment could be isolated. Try a clearer photo of one item."],
  ["invalid_extraction", "The garment outline could not be used. Try a clearer photo."],
]);
const sampleError = "The sample wardrobe could not be loaded. Try again.";

const photoStatuses = {
  queued: "Ready to upload",
  uploading: "Uploading photo…",
  extracting: "Reading garment details…",
  "upload-failed": "Upload failed",
  "extraction-failed": "Ready for manual review",
  ready: "Ready to review",
};

type Photo = {
  file: File;
  preview: string;
  draftKey: string;
  id: number | null;
  status: keyof typeof photoStatuses;
  error?: string;
};

const fileButton = "relative inline-flex cursor-pointer items-center rounded-full border border-divider px-4 py-2 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-secondary has-disabled:cursor-not-allowed has-disabled:opacity-60";
const actionButton = "rounded-full bg-primary px-5 py-2.5 font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";

export default function AddWardrobePhotoPage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [processing, setProcessing] = useState(false);
  const [addingSample, setAddingSample] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [sampleMessage, setSampleMessage] = useState("");
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const busy = processing || addingSample;
  const hasQueued = photos.some((photo) => photo.status === "queued");
  const hasFailures = photos.some((photo) => photo.status.endsWith("-failed"));
  const uploaded = photos.filter((photo) => photo.id !== null);
  const params = new URLSearchParams();
  params.set("batch", uploaded.map((photo) => photo.id).join(","));
  const manual = uploaded.filter((photo) => photo.status === "extraction-failed");
  if (manual.length) params.set("manual", manual.map((photo) => photo.id).join(","));

  function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;

    const valid = files.filter((file) =>
      imageTypes.includes(file.type) && file.size > 0 && file.size <= maxImageBytes,
    );
    const available = maxBatchSize - photos.length;
    const nextPhotos = valid.slice(0, available).map((file): Photo => {
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      return { file, preview, draftKey: crypto.randomUUID(), id: null, status: "queued" };
    });

    const messages = [];
    if (valid.length < files.length) messages.push("Some photos were skipped. Choose JPEG, PNG, or WebP images up to 8 MB each.");
    if (valid.length > available) messages.push(`You can add up to ${maxBatchSize} photos at a time.`);
    setSelectionError(messages.join(" "));
    setPhotos((current) => [...current, ...nextPhotos]);
  }

  function removePhoto(photo: Photo) {
    URL.revokeObjectURL(photo.preview);
    previews.current.delete(photo.preview);
    setPhotos((current) => current.filter(({ draftKey }) => draftKey !== photo.draftKey));
    setSelectionError("");
  }

  function updatePhoto(draftKey: string, changes: Partial<Pick<Photo, "id" | "status" | "error">>) {
    setPhotos((current) => current.map((photo) =>
      photo.draftKey === draftKey ? { ...photo, ...changes } : photo,
    ));
  }

  async function processPhoto(photo: Photo) {
    const { draftKey } = photo;
    let itemId = photo.id;
    if (itemId === null) {
      updatePhoto(draftKey, { status: "uploading", error: undefined });
      let image: File;
      try {
        image = await normalizeUpload(photo.file);
      } catch {
        updatePhoto(draftKey, {
          status: "upload-failed",
          error: "This WebP could not be prepared. Choose a JPEG or PNG photo instead.",
        });
        return;
      }

      try {
        const form = new FormData();
        form.set("image", image);
        form.set("draftKey", draftKey);
        const response = await fetch("/api/wardrobe/upload", { method: "POST", body: form });
        if (!response.ok) {
          updatePhoto(draftKey, {
            status: "upload-failed",
            error: response.status === 401 ? "Sign in to upload wardrobe photos." : uploadError,
          });
          return;
        }
        const { id } = (await response.json()) as { id?: unknown };
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
          throw new Error("Invalid upload response");
        }
        itemId = id;
      } catch {
        updatePhoto(draftKey, { status: "upload-failed", error: uploadError });
        return;
      }
    }

    updatePhoto(draftKey, { id: itemId, status: "extracting", error: undefined });
    try {
      const response = await fetch(`/api/wardrobe/items/${itemId}/extract`, { method: "POST" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { code?: string } | null;
        const message = result?.code ? extractionMessages.get(result.code) : undefined;
        const error = response.status === 401
          ? "Your session expired. Sign in again to read or review the draft."
          : message ?? extractionError;
        updatePhoto(draftKey, { status: "extraction-failed", error });
        return;
      }
      updatePhoto(draftKey, { status: "ready" });
    } catch {
      updatePhoto(draftKey, { status: "extraction-failed", error: extractionError });
    }
  }

  async function processPhotos(batch: Photo[]) {
    if (busy || !batch.length) return;
    setProcessing(true);
    try {
      for (const photo of batch) await processPhoto(photo);
    } finally {
      setProcessing(false);
    }
  }

  function submitPhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void processPhotos(photos.filter((photo) => photo.status === "queued"));
  }

  async function addSampleWardrobe() {
    if (busy) return;
    setAddingSample(true);
    setSampleMessage("");
    try {
      const response = await fetch("/api/wardrobe/sample", { method: "POST" });
      if (response.ok) {
        router.push("/wardrobe/confirm");
        return;
      }
      setSampleMessage(response.status === 401 ? "Sign in to add a sample wardrobe." : sampleError);
    } catch {
      setSampleMessage(sampleError);
    } finally {
      setAddingSample(false);
    }
  }


  return (
    <main className="wardrobe-page mx-auto w-full max-w-xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-7 space-y-3">
        <Link className="text-sm font-medium underline underline-offset-4" href="/">
          Closet
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Add wardrobe photos</h1>
        <p>Choose several photos at once, with one garment per photo. You can review and save the items together.</p>
      </header>

      <form onSubmit={submitPhotos} className="space-y-5">
        <div className="rounded-3xl border border-divider bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap gap-3">
            <label className={fileButton}>
              {photos.length ? "Choose more photos" : "Choose photos"}
              <input
                type="file"
                accept={imageTypes.join(",")}
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
          <p className="mt-3 text-sm text-supporting">Up to {maxBatchSize} photos · JPEG, PNG, or WebP · Up to 8 MB each</p>
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
                  <p className="mt-2 break-all text-sm font-medium">{photo.file.name}</p>
                  <p className="mt-1 text-sm">{photoStatuses[photo.status]}</p>
                  {photo.error && <p className="mt-1 text-sm text-danger" role="alert">{photo.error}</p>}
                  {photo.id === null && (
                    <button
                      type="button"
                      className="mt-2 text-sm underline underline-offset-4 disabled:opacity-60"
                      aria-label={`Remove ${photo.file.name}`}
                      disabled={busy}
                      onClick={() => removePhoto(photo)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {photos.length > 0 && (
          <>
            <p className="text-sm" role="status">
              {`${uploaded.length} of ${photos.length} uploaded${processing ? " · Processing photos…" : ""}`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {hasQueued && (
                <button className={actionButton} disabled={busy} type="submit">
                  Upload photos
                </button>
              )}
              {hasFailures && (
                <button
                  className={actionButton}
                  disabled={busy}
                  type="button"
                  onClick={() => void processPhotos(photos.filter((photo) => photo.status.endsWith("-failed")))}
                >
                  Retry failed photos
                </button>
              )}
              {!busy && uploaded.length > 0 && uploaded.length === photos.length && (
                <Link className={actionButton} href={`/wardrobe/confirm?${params}`}>
                  {uploaded.length === 1 ? "Review item" : `Review ${uploaded.length} items`}
                </Link>
              )}
            </div>
            {!busy && uploaded.length > 0 && uploaded.length < photos.length && (
              <p className="text-sm">Upload or remove the remaining photos to review this batch.</p>
            )}
          </>
        )}
      </form>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-6">
        <p>Want to try a ready-made wardrobe?</p>
        <button
          className="font-medium underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          onClick={addSampleWardrobe}
          type="button"
        >
          {addingSample ? "Loading sample wardrobe…" : "Use sample wardrobe"}
        </button>
      </div>
      {sampleMessage && <p className="mt-3 text-danger" role="alert">{sampleMessage}</p>}
    </main>
  );
}
