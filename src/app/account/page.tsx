"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { SignOutButton } from "../sign-out-button";
import { styleOptions } from "../profile/style-options";

type EditableProfile = {
  heightCm: number | null;
  weightKg: number | null;
  styles: string[];
};

type Profile = EditableProfile & {
  facePhotoUrl: string | null;
  setupCompletedAt: string | null;
};

type PendingPhoto = { file: File; previewUrl: string };
type Notice = { text: string; error?: boolean };

const fieldClass = "mt-2 w-full rounded-lg border border-divider bg-surface px-3 py-2 text-text";
const buttonClass = "w-fit rounded-full border border-divider px-4 py-2 text-sm font-medium hover:bg-selected disabled:opacity-50";
const primaryButtonClass = "w-fit rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50";

function measurement(value: string) {
  return value.trim() ? Number(value) : null;
}

async function readProfile(response: Response): Promise<Profile> {
  if (response.status === 401) throw new Error("Sign in with Google to access your profile.");
  if (!response.ok) throw new Error("We couldn’t update your profile. Try again.");
  return response.json();
}

function NoticeMessage({ notice }: { notice: Notice | null }) {
  return (
    <p role={notice?.error ? "alert" : "status"} className={notice?.error ? "text-sm text-danger" : "text-sm text-supporting"}>
      {notice?.text}
    </p>
  );
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [styles, setStyles] = useState<string[]>([]);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState<"profile" | "photo" | null>(null);
  const [profileNotice, setProfileNotice] = useState<Notice | null>(null);
  const [photoNotice, setPhotoNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProfile() {
      try {
        const response = await fetch("/api/profile", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) {
          setLoadError(true);
          return;
        }
        if (!response.ok) throw new Error("Profile unavailable");
        const data: Profile = await response.json();
        setProfile(data);
        setHeight(data.heightCm?.toString() ?? "");
        setWeight(data.weightKg?.toString() ?? "");
        setStyles(data.styles);
      } catch {
        if (!controller.signal.aborted) {
          setProfileNotice({ text: "We couldn’t load your profile. Try again.", error: true });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadProfile();
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => {
    return () => {
      if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl);
    };
  }, [pendingPhoto]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || busy) return;
    const heightCm = measurement(height);
    const weightKg = measurement(weight);
    if ([heightCm, weightKg].some((value) => value !== null && (!Number.isFinite(value) || value <= 0))) {
      setProfileNotice({ text: "Enter a positive number or leave the measurement blank.", error: true });
      return;
    }

    const changes: Partial<EditableProfile> = {};
    if (heightCm !== profile.heightCm) changes.heightCm = heightCm;
    if (weightKg !== profile.weightKg) changes.weightKg = weightKg;
    if (styles.length !== profile.styles.length || styles.some((style) => !profile.styles.includes(style))) {
      changes.styles = styles;
    }
    if (!Object.keys(changes).length) {
      setProfileNotice({ text: "Your preferences are up to date." });
      return;
    }

    setBusy("profile");
    setProfileNotice(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const updated = await readProfile(response);
      setProfile(updated);
      setHeight(updated.heightCm?.toString() ?? "");
      setWeight(updated.weightKg?.toString() ?? "");
      setStyles(updated.styles);
      setProfileNotice({ text: "Preferences saved." });
    } catch (error) {
      setProfileNotice({ text: error instanceof Error ? error.message : "We couldn’t save your preferences.", error: true });
    } finally {
      setBusy(null);
    }
  }

  function changePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setPhotoNotice({ text: "Choose a JPEG, PNG, or WebP image up to 8 MB.", error: true });
      return;
    }
    setPhotoNotice(null);
    setPendingPhoto({ file, previewUrl: URL.createObjectURL(file) });
  }

  async function savePhoto(method: "PUT" | "DELETE") {
    if (busy) return;
    let body: FormData | undefined;
    if (method === "PUT") {
      if (!pendingPhoto) return;
      body = new FormData();
      body.set("image", pendingPhoto.file);
    }

    setBusy("photo");
    setPhotoNotice(null);
    try {
      const response = await fetch("/api/profile/photo", { method, body });
      const updated = await readProfile(response);
      setProfile((current) => current && {
        ...current,
        facePhotoUrl: updated.facePhotoUrl,
        setupCompletedAt: updated.setupCompletedAt,
      });
      setPendingPhoto(null);
      setPhotoNotice({ text: method === "PUT" ? "Face photo saved." : "Face photo removed." });
    } catch (error) {
      setPhotoNotice({ text: error instanceof Error ? error.message : "We couldn’t update your face photo.", error: true });
    } finally {
      setBusy(null);
    }
  }

  const photoUrl = pendingPhoto?.previewUrl ?? profile?.facePhotoUrl;
  const availableStyles = new Set([...styleOptions, ...(profile?.styles ?? [])]);

  return (
    <main className="flex-1 bg-selected px-5 py-8 text-text sm:px-8 sm:py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-7">
        {profile && !profile.setupCompletedAt && (
          <Link className="w-fit text-sm font-medium text-supporting underline underline-offset-4" href="/profile/ready">
            ← Back to planner setup
          </Link>
        )}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Account</h1>
          {!loading && !loadError && (
            <SignOutButton label="Log out" className={buttonClass} disabled={busy !== null} />
          )}
        </header>
        {loading && <p role="status">Loading your profile…</p>}
        {loadError && <p>Sign in with Google to access your profile. <Link className="underline" href="/">Go to sign in</Link></p>}
        {!loading && !loadError && !profile && (
          <div className="flex flex-col items-start gap-3">
            <NoticeMessage notice={profileNotice} />
            <button className={buttonClass} type="button" onClick={() => {
              setProfileNotice(null);
              setLoading(true);
              setLoadAttempt(loadAttempt + 1);
            }}>
              Try again
            </button>
          </div>
        )}
        {profile && (
          <>
            <section aria-labelledby="face-photo-heading" className="rounded-2xl border border-divider bg-surface p-5 sm:p-6">
              <h2 id="face-photo-heading" className="text-lg font-semibold">Private profile picture</h2>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                {photoUrl ? (
                  <Image
                    src={photoUrl}
                    alt={pendingPhoto ? "New face photo preview" : "Your saved face photo"}
                    width={104}
                    height={104}
                    unoptimized
                    className="size-26 rounded-xl bg-selected object-cover"
                  />
                ) : (
                  <span className="flex size-26 items-center justify-center rounded-xl bg-selected px-2 text-center text-sm text-supporting">No face photo</span>
                )}
                <div className="flex min-w-0 flex-1 basis-48 flex-col items-start gap-2">
                  <label className="text-sm font-medium" htmlFor="face-photo">{profile.facePhotoUrl ? "Change face photo" : "Choose a face photo"}</label>
                  <input
                    id="face-photo"
                    className="max-w-full text-sm file:mr-2 file:rounded-full file:border file:border-divider file:px-3 file:py-1.5 file:font-medium disabled:opacity-50"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={changePhoto}
                    disabled={busy !== null}
                  />
                  {pendingPhoto && <p className="max-w-full wrap-anywhere text-sm text-supporting">{pendingPhoto.file.name}</p>}
                  <div className="flex flex-wrap gap-2">
                    {pendingPhoto && (
                      <>
                        <button className={primaryButtonClass} type="button" disabled={busy !== null} onClick={() => void savePhoto("PUT")}>
                          {busy === "photo" ? "Saving photo…" : "Save photo"}
                        </button>
                        <button className={buttonClass} type="button" disabled={busy !== null} onClick={() => {
                          setPendingPhoto(null);
                          setPhotoNotice(null);
                        }}>
                          Cancel preview
                        </button>
                      </>
                    )}
                    {profile.facePhotoUrl && !pendingPhoto && (
                      <button className={buttonClass} type="button" disabled={busy !== null} onClick={() => void savePhoto("DELETE")}>
                        {busy === "photo" ? "Removing photo…" : "Remove photo"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <NoticeMessage notice={photoNotice} />
            </section>

            <form onSubmit={saveProfile} className="grid gap-5 rounded-2xl border border-divider bg-surface p-5 sm:p-6">
              <fieldset disabled={busy !== null} className="grid gap-3">
                <legend className="mb-2 text-lg font-semibold">Optional measurements</legend>
                <p className="text-sm text-supporting">Leave a field blank to clear it when you save.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium">
                    Height (cm)
                    <input className={fieldClass} type="number" step="any" inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} />
                  </label>
                  <label className="text-sm font-medium">
                    Weight (kg)
                    <input className={fieldClass} type="number" step="any" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} />
                  </label>
                </div>
              </fieldset>

              <div className="border-t border-divider pt-5">
                <fieldset disabled={busy !== null}>
                  <legend className="mb-3 text-lg font-semibold">Preferred styles</legend>
                  <div className="flex flex-wrap gap-2">
                    {[...availableStyles].map((style) => (
                      <label key={style} className="flex cursor-pointer items-center gap-2 rounded-full border border-divider px-3 py-2 text-sm has-checked:border-secondary has-checked:bg-selected">
                        <input
                          className="accent-primary"
                          type="checkbox"
                          checked={styles.includes(style)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setStyles((selected) => checked ? [...selected, style] : selected.filter((option) => option !== style));
                          }}
                        />
                        <span className="wrap-anywhere">{style}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <button className={primaryButtonClass} type="submit" disabled={busy !== null}>
                {busy === "profile" ? "Saving…" : "Save preferences"}
              </button>
              <NoticeMessage notice={profileNotice} />
            </form>
          </>
        )}
      </div>
    </main>
  );
}
