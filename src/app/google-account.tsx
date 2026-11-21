"use client";

import { useEffect, useState } from "react";

export function GoogleAccount() {
  const [account, setAccount] = useState<{ name?: string; email?: string } | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const controller = new AbortController();
    async function loadAccount() {
      try {
        const response = await fetch("/api/account", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Account endpoint unavailable");
        const session = await response.json();
        if (controller.signal.aborted) return;

        if (session?.user) {
          setAccount(session.user);
          const profileResponse = await fetch("/api/profile", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!profileResponse.ok) throw new Error("Profile endpoint unavailable");
          const profile = await profileResponse.json();
          if (!controller.signal.aborted) {
            window.location.replace(profile.setupCompletedAt ? "/planner" : "/profile/details");
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
        setCsrfToken(csrfToken);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      }
    }
    void loadAccount();
    return () => controller.abort();
  }, []);

  if (status === "loading") {
    return (
      <p className="pt-4 text-center text-sm text-supporting" role="status">
        {account ? "Opening MBTI Closet…" : "Checking sign-in…"}
      </p>
    );
  }

  if (status === "unavailable") {
    return account ? (
      <div className="flex flex-col gap-2 rounded-2xl bg-selected p-4">
        <p className="text-sm text-text" role="status">Your profile is unavailable right now.</p>
        <p className="text-sm text-text">Signed in as {account.email ?? account.name}</p>
        <a className="w-fit text-sm font-semibold text-secondary underline underline-offset-4" href="/api/auth/signout" target="_top">
          Sign out of MBTI Closet
        </a>
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
      <button className="min-h-[54px] w-full rounded-[9px] bg-primary px-5 py-3 text-xl font-bold text-white shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.99]" type="submit">
        Add clothes
      </button>
      <p className="mt-3 text-center text-sm text-supporting">Sign in with Google to save your wardrobe.</p>
    </form>
  );
}
