"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useAccountSession } from "./account-session";
import { privateFetch } from "./private-fetch.mjs";
import { returnDestination } from "./return-destination.mjs";
import { SignOutButton } from "./sign-out-button";

export function GoogleAccount() {
  const { user: account, status: sessionStatus } = useAccountSession();
  const [callbackUrl, setCallbackUrl] = useState("/");
  const [csrfToken, setCsrfToken] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    if (sessionStatus === "checking" || sessionStatus === "unavailable") return;
    const controller = new AbortController();
    async function loadAccount() {
      try {
        const url = new URL(window.location.href);
        const destination = returnDestination(url.searchParams.get("returnTo"), url.origin);
        if (account) {
          if (destination) {
            window.location.replace(destination);
            return;
          }
          const profileResponse = await privateFetch("/api/profile?resume=1", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!profileResponse.ok) throw new Error("Profile endpoint unavailable");
          const profile = await profileResponse.json();
          if (!controller.signal.aborted) {
            const destinations: Record<string, string> = {
              confirm: "/wardrobe/confirm?from=onboarding", style: "/profile/style", ready: "/profile/ready",
            };
            const stage = profile.setupStage;
            if (!profile.setupCompletedAt && Object.hasOwn(destinations, stage)) {
              window.dispatchEvent(new CustomEvent("closet:journey-resumed", { detail: { journey: "setup", stage } }));
            }
            window.location.replace(profile.setupCompletedAt ? "/planner" : destinations[stage] ?? "/wardrobe/add?from=onboarding");
          }
          return;
        }

        const csrfResponse = await fetch("/api/auth/csrf", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!csrfResponse.ok) throw new Error("Sign-in token unavailable");
        const { csrfToken } = await csrfResponse.json();
        if (typeof csrfToken !== "string" || !csrfToken) {
          throw new Error("Sign-in token unavailable");
        }
        if (controller.signal.aborted) return;
        setCallbackUrl(destination ?? "/");
        setCsrfToken(csrfToken);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      }
    }
    void loadAccount();
    return () => controller.abort();
  }, [account, sessionStatus]);

  if (sessionStatus !== "unavailable" && status === "loading") {
    return (
      <p className="pt-4 text-center text-sm text-supporting" role="status">
        {account ? "Opening Closet…" : "Checking sign-in…"}
      </p>
    );
  }

  if (sessionStatus === "unavailable" || status === "unavailable") {
    return account ? (
      <div className="flex flex-col gap-2 rounded-2xl bg-selected p-4">
        <p className="text-sm text-text" role="status">Your profile is unavailable right now.</p>
        <p className="text-sm text-text">Signed in as {account.email ?? account.name}</p>
        <SignOutButton label="Sign out of Closet" className="w-fit text-sm font-semibold text-secondary underline underline-offset-4" />
      </div>
    ) : (
      <p className="rounded-xl bg-selected px-4 py-3 text-sm text-text" role="status">
        Sign-in is unavailable right now. Please try again in a moment.
      </p>
    );
  }

  return (
    <form className="w-full" action="/api/auth/signin/google" method="post" target="_top">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <button
        aria-describedby="google-sign-in-note"
        className="flex min-h-[54px] w-full items-center justify-center gap-3 rounded-[9px] bg-primary px-5 py-3 text-xl font-bold text-on-primary shadow-sm transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.99]"
        type="submit"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface">
          <Image src="/google-sign-in.png" alt="" width={20} height={20} unoptimized />
        </span>
        Sign in to get started
      </button>
      <p className="mt-3 text-center text-sm text-supporting" id="google-sign-in-note">
        Sign in with Google to save your wardrobe.
      </p>
    </form>
  );
}
