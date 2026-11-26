"use client";

import { privateFetch } from "../../private-fetch.mjs";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { normalizeProfilePhoto, profilePhotoAccept, profilePhotoRequirements } from "../../wardrobe/add/normalize-upload.mjs";

const nextStep = "/wardrobe/add?from=onboarding";

const secondaryButton = "rounded-full border border-divider px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60";
const photoButton = "relative inline-flex cursor-pointer rounded-full border border-divider px-4 py-2 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-secondary has-disabled:cursor-not-allowed";
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
  const [photoChange, setPhotoChange] = useState<SelectedPhoto | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const savingRef = useRef(false);
  const preparingRef = useRef<AbortController | null>(null);
  const localPhotoUrl = photoChange?.url;
  const visiblePhotoUrl = localPhotoUrl ?? profile?.facePhotoUrl;

  useEffect(() => {
    const controller = new AbortController();

    async function loadProfile() {
      try {
        const response = await privateFetch("/api/profile", { cache: "no-store", signal: controller.signal });
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

  useEffect(() => () => preparingRef.current?.abort(), []);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const original = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!original || savingRef.current || preparingRef.current) return;

    const controller = new AbortController();
    preparingRef.current = controller;
    setPreparing(true);
    setFormError("");
    try {
      const file = await normalizeProfilePhoto(original);
      if (!controller.signal.aborted) setPhotoChange({ file, url: URL.createObjectURL(file) });
    } catch (error) {
      if (!controller.signal.aborted) setFormError(error instanceof Error ? error.message : "Choose another photo.");
    } finally {
      preparingRef.current = null;
      if (!controller.signal.aborted) setPreparing(false);
    }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || savingRef.current || preparingRef.current) return;
    if (!visiblePhotoUrl) {
      setFormError("Upload or take a profile photo to continue.");
      return;
    }

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

    savingRef.current = true;
    setSaving(true);
    setFormError("");
    let failureMessage = "Your profile photo could not be verified. Try again.";
    try {
      let savedProfile: Profile;
      if (photoChange) {
        failureMessage = "Your profile photo could not be saved. Try again.";
        const body = new FormData();
        body.set("image", photoChange.file, "profile-photo.jpg");
        const response = await privateFetch("/api/profile/photo", { method: "PUT", body });
        if (response.status === 413) {
          setFormError("This photo is too large to upload. Choose a smaller version and try again.");
          return;
        }
        if (response.status === 415) {
          setFormError("This photo could not be read. Choose a JPEG, PNG, or WebP and try again.");
          return;
        }
        if (response.status === 401) {
          setFormError("Sign in again to save your profile photo.");
          return;
        }
        if (!response.ok) throw new Error(failureMessage);
        savedProfile = await response.json();
        if (!savedProfile.facePhotoUrl) throw new Error(failureMessage);
        setProfile(savedProfile);
        setPhotoChange(null);
      } else {
        const response = await privateFetch("/api/profile", { cache: "no-store" });
        if (response.status === 401) {
          setFormError("Sign in again to continue.");
          return;
        }
        if (!response.ok) throw new Error(failureMessage);
        savedProfile = await response.json();
        setProfile(savedProfile);
      }

      if (!savedProfile.facePhotoUrl) {
        setFormError("Upload or take a profile photo to continue.");
        return;
      }

      const measurements: Partial<Pick<Profile, "heightCm" | "weightKg">> = {};
      if (heightCm !== profile.heightCm) measurements.heightCm = heightCm;
      if (weightKg !== profile.weightKg) measurements.weightKg = weightKg;

      if (Object.keys(measurements).length) {
        failureMessage = "Your measurements could not be saved. Try again.";
        const response = await privateFetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(measurements),
        });
        if (!response.ok) {
          setFormError(response.status === 401 ? "Sign in again to save your profile." : failureMessage);
          return;
        }
        const updated: Profile = await response.json();
        setProfile(updated);
        if (!updated.facePhotoUrl) {
          setFormError("Upload or take a profile photo to continue.");
          return;
        }
      }

      router.push(nextStep);
    } catch {
      setFormError(failureMessage);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="wardrobe-page mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-7 space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Profile details</h1>
        <p>Add a profile photo to continue. Height and weight are optional.</p>
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

      <form aria-busy={saving || preparing} className="space-y-5" onSubmit={saveDetails}>
        <fieldset className="space-y-5 disabled:opacity-60" disabled={!profile || preparing || saving}>
          <section aria-labelledby="photo-title" className="space-y-3 rounded-3xl border border-divider bg-surface p-5 sm:p-6">
            <h2 className="text-lg font-semibold" id="photo-title">Profile photo (required)</h2>
            <p id="photo-info" className="text-sm text-supporting">
              Choose a clear photo of your face. It’s stored privately and sent to OpenAI only when you
              request an outfit preview. {profilePhotoRequirements}
            </p>

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
            <div className="flex flex-wrap items-center gap-3">
              <label className={photoButton}>
                Upload photo
                <input type="file" accept={profilePhotoAccept} aria-describedby="photo-info" className="sr-only" onChange={choosePhoto} />
              </label>
              <label className={photoButton}>
                Take photo
                <input type="file" accept="image/*" capture="user" aria-describedby="photo-info" className="sr-only" onChange={choosePhoto} />
              </label>
              {photoChange && (
                <button className={secondaryButton} onClick={() => {
                  setPhotoChange(null);
                  setFormError("");
                }} type="button">
                  Clear selection
                </button>
              )}
            </div>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="block text-sm font-medium">Height (cm), optional</span>
              <input className={measurementInput} type="number" step="any" value={height} onChange={(event) => setHeight(event.currentTarget.value)} />
            </label>
            <label className="block space-y-2">
              <span className="block text-sm font-medium">Weight (kg), optional</span>
              <input className={measurementInput} type="number" step="any" value={weight} onChange={(event) => setWeight(event.currentTarget.value)} />
            </label>
          </div>
        </fieldset>

        {formError && <p className="text-danger" role="alert">{formError}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button className={primaryButton} disabled={!profile || !visiblePhotoUrl || preparing || saving} type="submit">
            {preparing ? "Preparing photo…" : saving ? "Saving…" : "Save and continue"}
          </button>
        </div>
        <p className="sr-only" role="status">{preparing ? "Preparing your profile photo…" : saving ? "Saving your profile details…" : ""}</p>
      </form>
    </main>
  );
}
