"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

const photoTypes = ["image/jpeg", "image/png", "image/webp"];
const maxPhotoBytes = 8 * 1024 * 1024;
const nextStep = "/wardrobe/add";

const secondaryButton = "rounded-full border border-divider px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";
const measurementInput = "w-full rounded-xl border border-divider bg-surface px-3 py-2.5 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

type Profile = {
  heightCm: number | null;
  weightKg: number | null;
  facePhotoUrl: string | null;
};

type SelectedPhoto = {
  file: File;
  url: string;
};

export default function ProfileDetailsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [photoChange, setPhotoChange] = useState<SelectedPhoto | "remove" | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const localPhotoUrl = typeof photoChange === "object" ? photoChange?.url : undefined;
  const visiblePhotoUrl = photoChange === "remove" ? null : localPhotoUrl ?? profile?.facePhotoUrl;

  useEffect(() => {
    const controller = new AbortController();

    async function loadProfile() {
      try {
        const response = await fetch("/api/profile", { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          setLoadError(response.status === 401 ? "Sign in to edit your profile." : "Your profile could not be loaded.");
          return;
        }
        const data = (await response.json()) as Profile;
        if (controller.signal.aborted) return;
        setProfile(data);
        setHeight(data.heightCm?.toString() ?? "");
        setWeight(data.weightKg?.toString() ?? "");
      } catch {
        if (!controller.signal.aborted) setLoadError("Your profile could not be loaded.");
      }
    }

    void loadProfile();
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => {
    if (localPhotoUrl) return () => URL.revokeObjectURL(localPhotoUrl);
  }, [localPhotoUrl]);

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!photoTypes.includes(file.type) || file.size === 0 || file.size > maxPhotoBytes) {
      setFormError("Choose a JPEG, PNG, or WebP photo up to 8 MB.");
      return;
    }

    setPhotoChange({ file, url: URL.createObjectURL(file) });
    setFormError("");
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || saving) return;

    const heightCm = height === "" ? null : Number(height);
    const weightKg = weight === "" ? null : Number(weight);
    if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm <= 0)) {
      setFormError("Enter a height greater than zero or leave the field blank.");
      return;
    }
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg <= 0)) {
      setFormError("Enter a weight greater than zero or leave the field blank.");
      return;
    }

    setSaving(true);
    setFormError("");
    let failureMessage = "Your measurements could not be saved. Try again.";
    try {
      const measurements: Partial<Pick<Profile, "heightCm" | "weightKg">> = {};
      if (heightCm !== profile.heightCm) measurements.heightCm = heightCm;
      if (weightKg !== profile.weightKg) measurements.weightKg = weightKg;

      if (Object.keys(measurements).length) {
        const response = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(measurements),
        });
        if (!response.ok) {
          setFormError(response.status === 401 ? "Sign in again to save your profile." : failureMessage);
          return;
        }
        setProfile({ ...profile, ...measurements });
      }

      if (photoChange) {
        const removing = photoChange === "remove";
        failureMessage = removing ? "Your photo could not be removed. Try again." : "Your photo could not be saved. Try again.";
        let body: FormData | undefined;
        if (!removing) {
          body = new FormData();
          body.set("image", photoChange.file);
        }
        const response = await fetch("/api/profile/photo", { method: removing ? "DELETE" : "PUT", body });
        if (!response.ok) {
          setFormError(response.status === 401 ? "Sign in again to update your profile photo." : failureMessage);
          return;
        }
      }

      router.push(nextStep);
    } catch {
      setFormError(failureMessage);
    } finally {
      setSaving(false);
    }
  }

  function resetPhotoChange(change: "remove" | null) {
    setPhotoChange(change);
    setFormError("");
  }

  return (
    <main className="wardrobe-page mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-7 space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Profile details</h1>
        <p>Add any details you’d like to save with your profile. You can skip this step.</p>
      </header>

      {!profile && (
        <div className="mb-4">
          {loadError ? (
            <>
              <p className="text-danger" role="alert">{loadError}</p>
              <button
                className="mt-2 text-sm font-medium underline underline-offset-4"
                onClick={() => {
                  setLoadError("");
                  setLoadAttempt(loadAttempt + 1);
                }}
                type="button"
              >
                Try again
              </button>
            </>
          ) : <p role="status">Loading your profile…</p>}
        </div>
      )}

      <form aria-busy={saving} className="space-y-5" onSubmit={saveDetails}>
        <fieldset className="space-y-5 disabled:opacity-60" disabled={!profile || saving}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="block text-sm font-medium">Height (cm)</span>
              <input className={measurementInput} type="number" step="any" value={height} onChange={(event) => setHeight(event.currentTarget.value)} />
            </label>
            <label className="block space-y-2">
              <span className="block text-sm font-medium">Weight (kg)</span>
              <input className={measurementInput} type="number" step="any" value={weight} onChange={(event) => setWeight(event.currentTarget.value)} />
            </label>
          </div>

          <section aria-labelledby="photo-title" className="space-y-3 rounded-3xl border border-divider bg-surface p-5 sm:p-6">
            <h2 className="text-lg font-semibold" id="photo-title">Face photo</h2>
            <p id="photo-info" className="text-sm text-supporting">When you create a try-on, OpenAI uses this photo to show the outfit on you. Choose a JPEG, PNG, or WebP up to 8 MB.</p>

            {visiblePhotoUrl && (
              <Image
                alt={localPhotoUrl ? "Selected face photo" : "Saved face photo"}
                className="size-28 rounded-2xl bg-selected object-cover"
                height={112}
                src={visiblePhotoUrl}
                unoptimized
                width={112}
              />
            )}
            {photoChange === "remove" && <p className="text-sm" role="status">Your photo will be removed when you save.</p>}

            <div className="flex flex-wrap items-center gap-3">
              <label className="relative inline-flex cursor-pointer rounded-full border border-divider px-4 py-2 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-secondary has-disabled:cursor-not-allowed">
                {visiblePhotoUrl ? "Choose another photo" : "Choose photo"}
                <input type="file" accept={photoTypes.join(",")} aria-describedby="photo-info" className="sr-only" onChange={choosePhoto} />
              </label>
              {photoChange && (
                <button className={secondaryButton} onClick={() => resetPhotoChange(null)} type="button">
                  {photoChange === "remove" ? "Undo removal" : "Clear selection"}
                </button>
              )}
              {!photoChange && profile?.facePhotoUrl && (
                <button className={secondaryButton} onClick={() => resetPhotoChange("remove")} type="button">
                  Remove photo
                </button>
              )}
            </div>
          </section>
        </fieldset>

        {formError && <p className="text-danger" role="alert">{formError}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button className={primaryButton} disabled={!profile || saving} type="submit">
            {saving ? "Saving…" : "Save and continue"}
          </button>
          <button
            className="rounded-full px-4 py-2 text-sm font-medium underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
            onClick={() => router.push(nextStep)}
            type="button"
          >
            Skip for now
          </button>
        </div>
        <p className="sr-only" role="status">{saving ? "Saving your profile details…" : ""}</p>
      </form>
    </main>
  );
}
