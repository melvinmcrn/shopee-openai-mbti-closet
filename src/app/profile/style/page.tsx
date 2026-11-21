"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { styleOptions } from "../style-options";

const primaryButton = "inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-50";
const secondaryButton = "inline-flex min-h-11 items-center justify-center rounded-full border border-divider bg-surface px-5 py-2.5 text-sm font-semibold text-text hover:border-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

export default function ConfirmStylePage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
  const [loadCount, setLoadCount] = useState(0);
  const [savedStyles, setSavedStyles] = useState<string[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);
  const options = [...new Set([...styleOptions, ...savedStyles])];

  useEffect(() => {
    const controller = new AbortController();

    async function loadStyles() {
      try {
        const response = await fetch("/api/profile", { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setStatus("signed-out");
          return;
        }
        if (!response.ok) throw new Error("Style preferences unavailable");

        const data = (await response.json()) as { styles?: unknown };
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.styles) || !data.styles.every((style) => typeof style === "string")) {
          throw new Error("Invalid style preferences");
        }
        setSavedStyles(data.styles);
        setSelectedStyles(data.styles);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }

    void loadStyles();
    return () => controller.abort();
  }, [loadCount]);

  function selectStyle(style: string, checked: boolean) {
    setSelectedStyles((current) => checked
      ? [...current, style]
      : current.filter((selected) => selected !== style));
    setSaveError("");
  }

  async function saveStyles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styles: selectedStyles }),
      });

      if (response.ok) {
        router.push("/profile/ready");
        return;
      }
      setSaveError(response.status === 401
        ? "Your session expired. Sign in again to save your style preferences."
        : "Could not save your style preferences. Try again.");
    } catch {
      setSaveError("Could not save your style preferences. Try again.");
    }

    savingRef.current = false;
    setSaving(false);
  }

  return (
    <main className="flex-1 bg-selected px-5 py-10 text-text sm:px-8 sm:py-14">
      <div className="mx-auto max-w-2xl">
        <header className="border-b border-divider pb-7">
          <Link className="text-sm font-semibold text-secondary hover:underline" href="/wardrobe/confirm">
            <span aria-hidden="true">← </span>Confirm items
          </Link>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Confirm style</h1>
          <p className="mt-3 max-w-lg leading-relaxed text-supporting">
            Choose the styles you like to wear regularly. You can update your choices in Settings.
          </p>
        </header>

        {status === "loading" && <p className="py-8" role="status">Loading style preferences…</p>}
        {status === "error" && (
          <div className="space-y-4 py-8">
            <p className="text-danger" role="alert">Could not load your style preferences.</p>
            <button
              className={secondaryButton}
              type="button"
              onClick={() => {
                setStatus("loading");
                setLoadCount((count) => count + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {status === "signed-out" && (
          <div className="space-y-4 py-8">
            <p>Sign in to confirm your style preferences.</p>
            <Link className={primaryButton} href="/">Go to sign in</Link>
          </div>
        )}
        {status === "ready" && (
          <form className="mt-6 space-y-6" onSubmit={saveStyles}>
            <fieldset disabled={saving} className="rounded-2xl border border-divider bg-surface p-5 sm:p-6">
              <legend className="sr-only">Style preferences</legend>
              <p className="mb-4 text-sm text-supporting">Select any that fit.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {options.map((style) => (
                  <label
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-divider px-4 py-3 text-sm font-semibold hover:border-secondary has-checked:border-secondary has-checked:bg-selected has-disabled:cursor-default"
                    key={style}
                  >
                    <input
                      className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                      type="checkbox"
                      checked={selectedStyles.includes(style)}
                      onChange={(event) => selectStyle(style, event.currentTarget.checked)}
                    />
                    <span className="wrap-anywhere">{style}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {saveError && <p className="text-sm text-danger" role="alert">{saveError}</p>}
            <div className="flex border-t border-divider pt-6">
              <button className={primaryButton} disabled={saving} type="submit">
                {saving ? "Saving…" : "Save and continue"}
                {!saving && <span aria-hidden="true" className="ml-2">→</span>}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
