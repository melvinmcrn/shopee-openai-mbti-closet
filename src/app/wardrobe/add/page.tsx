"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxImageBytes = 8 * 1024 * 1024;
const uploadError = "The photo could not be uploaded. Try again.";
const extractionError = "The garment details could not be read. Your photo is saved and ready for manual review.";
const sampleError = "The sample wardrobe could not be loaded. Try again.";

const actionLabels = {
  idle: "Upload photo",
  uploading: "Uploading photo…",
  extracting: "Reading garment details…",
  "upload-failed": "Retry upload",
  "extraction-failed": "Retry reading details",
  ready: "Photo ready to review",
};

type Photo = {
  file: File;
  preview: string;
  draftKey: string;
  id: number | null;
};

type Phase = keyof typeof actionLabels;

export default function AddWardrobePhotoPage() {
  const router = useRouter();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [addingSample, setAddingSample] = useState(false);
  const [error, setError] = useState("");
  const [sampleMessage, setSampleMessage] = useState("");
  const preview = photo?.preview;

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const busy = phase === "uploading" || phase === "extracting" || addingSample;
  const reviewHref = photo?.id ? `/wardrobe/confirm?item=${photo.id}` : "/wardrobe/confirm";

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!imageTypes.includes(file.type) || file.size === 0 || file.size > maxImageBytes) {
      setError("Choose a JPEG, PNG, or WebP image up to 8 MB.");
      return;
    }

    setPhoto({ file, preview: URL.createObjectURL(file), draftKey: crypto.randomUUID(), id: null });
    setPhase("idle");
    setError("");
  }

  async function submitPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || busy || phase === "ready") return;
    setError("");

    let itemId = photo.id;
    if (itemId === null) {
      setPhase("uploading");
      try {
        const form = new FormData();
        form.set("image", photo.file);
        form.set("draftKey", photo.draftKey);
        const response = await fetch("/api/wardrobe/upload", { method: "POST", body: form });
        if (!response.ok) {
          setPhase("upload-failed");
          setError(response.status === 401 ? "Sign in to upload a wardrobe photo." : uploadError);
          return;
        }
        const { id } = (await response.json()) as { id?: unknown };
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
          throw new Error("Invalid upload response");
        }
        itemId = id;
        setPhoto({ ...photo, id });
      } catch {
        setPhase("upload-failed");
        setError(uploadError);
        return;
      }
    }

    setPhase("extracting");
    try {
      const response = await fetch(`/api/wardrobe/items/${itemId}/extract`, { method: "POST" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { code?: string } | null;
        setError(result?.code === "extraction_unavailable"
          ? "Automatic garment details are unavailable. Your photo is saved and you can enter its details in review."
          : extractionError);
        setPhase("extraction-failed");
        return;
      }
      setPhase("ready");
    } catch {
      setError(extractionError);
      setPhase("extraction-failed");
    }
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
          MBTI Closet
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Add wardrobe photos</h1>
        <p>Use a clear photo of one garment. You’ll review its details before adding it to your closet.</p>
      </header>

      <form onSubmit={submitPhoto} className="space-y-5">
        <div className="rounded-3xl border border-current/15 p-5 sm:p-6">
          {photo && (
            <figure className="mb-5 space-y-2">
              <Image
                alt="Selected garment photo"
                className="mx-auto max-h-64 w-full rounded-2xl bg-current/5 object-contain"
                height={256}
                src={photo.preview}
                unoptimized
                width={512}
              />
              <figcaption className="break-all text-sm">{photo.file.name}</figcaption>
            </figure>
          )}
          <div className="flex flex-wrap gap-3">
            <label className="relative inline-flex cursor-pointer items-center rounded-full border border-current/25 px-4 py-2 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 has-disabled:cursor-not-allowed has-disabled:opacity-60">
              {photo ? "Choose another photo" : "Choose photo"}
              <input type="file" accept={imageTypes.join(",")} className="sr-only" disabled={busy} onChange={choosePhoto} />
            </label>
            <label className="relative inline-flex cursor-pointer items-center rounded-full border border-current/25 px-4 py-2 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 has-disabled:cursor-not-allowed has-disabled:opacity-60">
              Take photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={choosePhoto} />
            </label>
          </div>
          <p className="mt-3 text-sm">JPEG, PNG, or WebP · Up to 8 MB</p>
        </div>

        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {phase !== "ready" && (
            <button
              className="rounded-full border border-current/25 px-5 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!photo || busy}
              type="submit"
            >
              {actionLabels[phase]}
            </button>
          )}
          {photo?.id && (phase === "ready" || phase === "extraction-failed") && (
            <Link className="rounded-full border border-current/25 px-5 py-2.5 font-medium" href={reviewHref}>
              {phase === "ready" ? "Review item" : "Enter details manually"}
            </Link>
          )}
        </div>
        <p className="sr-only" role="status">
          {phase === "uploading" || phase === "extracting" || phase === "ready" ? actionLabels[phase] : ""}
        </p>
      </form>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-current/15 pt-6">
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
      {sampleMessage && <p className="mt-3" role="alert">{sampleMessage}</p>}
    </main>
  );
}
