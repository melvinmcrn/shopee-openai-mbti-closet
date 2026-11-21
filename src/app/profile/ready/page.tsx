"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Profile = {
  heightCm: number | null;
  weightKg: number | null;
  facePhotoUrl: string | null;
  styles: string[];
  setupCompletedAt: string | null;
};

type WardrobeItem = {
  id: number;
  name: string;
};

type Setup = {
  profile: Profile;
  items: WardrobeItem[];
};

type SetupState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; data: Setup };

const cardClass = "rounded-2xl border border-divider bg-surface p-5 sm:p-6";
const linkClass =
  "inline-flex min-h-11 items-center rounded text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4";

function SetupSummary({ profile, items }: Setup) {
  const preview = items.slice(0, 3);
  const remaining = items.length - preview.length;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className={cardClass} aria-labelledby="wardrobe-heading">
        <h2 id="wardrobe-heading" className="text-lg font-semibold">Wardrobe</h2>
        <p className="mt-2 text-sm text-supporting">
          {items.length === 1 ? "1 saved item" : `${items.length} saved items`}
        </p>
        {preview.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm break-words">
            {preview.map((item) => <li key={item.id}>{item.name}</li>)}
            {remaining > 0 && <li className="text-supporting">+{remaining} more</li>}
          </ul>
        )}
        <Link href="/closet" className={`mt-2 ${linkClass}`}>Open closet</Link>
      </section>

      <section className={cardClass} aria-labelledby="details-heading">
        <h2 id="details-heading" className="text-lg font-semibold">Personal details</h2>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          <dt className="text-supporting">Height</dt>
          <dd>{profile.heightCm == null ? "Not added" : `${profile.heightCm} cm`}</dd>
          <dt className="text-supporting">Weight</dt>
          <dd>{profile.weightKg == null ? "Not added" : `${profile.weightKg} kg`}</dd>
          <dt className="text-supporting">Face photo</dt>
          <dd>{profile.facePhotoUrl ? "Added" : "Not added"}</dd>
        </dl>
        <Link href="/profile/settings" className={`mt-2 ${linkClass}`}>
          Edit or remove details
        </Link>
      </section>

      <section className={`${cardClass} sm:col-span-2`} aria-labelledby="styles-heading">
        <h2 id="styles-heading" className="text-lg font-semibold">Style preferences</h2>
        {profile.styles.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Selected styles">
            {profile.styles.map((style) => (
              <li
                key={style}
                className="max-w-full rounded-full bg-selected px-3 py-1 text-sm break-words"
              >
                {style}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-supporting">No styles selected</p>
        )}
        <Link href="/profile/style" className={`mt-2 ${linkClass}`}>Edit style preferences</Link>
      </section>
    </div>
  );
}

export default function ProfileReadyPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSetup() {
      try {
        const options = { signal: controller.signal, cache: "no-store" as const };
        const [profileResponse, wardrobeResponse] = await Promise.all([
          fetch("/api/profile", options),
          fetch("/api/wardrobe/items", options),
        ]);
        if (!profileResponse.ok || !wardrobeResponse.ok) {
          throw new Error("Unable to load setup");
        }
        const [profile, { items }] = await Promise.all([
          profileResponse.json() as Promise<Profile>,
          wardrobeResponse.json() as Promise<{ items: WardrobeItem[] }>,
        ]);
        if (!controller.signal.aborted) {
          setSetup({ status: "loaded", data: { profile, items } });
        }
      } catch {
        if (!controller.signal.aborted) setSetup({ status: "error" });
      }
    }

    void loadSetup();
    return () => controller.abort();
  }, [attempt]);

  async function openPlanner() {
    setFinishing(true);
    setFinishError(false);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: true }),
      });
      if (!response.ok) throw new Error("Unable to complete setup");
      const profile: Profile = await response.json();
      if (!profile.setupCompletedAt) throw new Error("Setup completion was not saved");
      router.replace("/planner");
    } catch {
      setFinishing(false);
      setFinishError(true);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Review your setup</h1>

      {setup.status === "loading" && <p role="status">Loading your setup…</p>}
      {setup.status === "error" && (
        <div>
          <p className="text-danger" role="alert">Your setup could not be loaded.</p>
          <button
            type="button"
            className={linkClass}
            onClick={() => {
              setSetup({ status: "loading" });
              setAttempt((previous) => previous + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {setup.status === "loaded" && (
        <>
          <SetupSummary {...setup.data} />
          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={openPlanner}
              disabled={finishing}
              className="min-h-11 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary disabled:opacity-60"
            >
              {finishing ? "Opening planner…" : "Open planner"}
            </button>
            {finishError && <p role="alert" className="text-sm text-danger">Setup could not be completed. Please try again.</p>}
          </div>
        </>
      )}
    </main>
  );
}
