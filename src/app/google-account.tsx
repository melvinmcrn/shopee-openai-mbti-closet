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
    return <p role="status">{account ? "Opening MBTI Closet…" : "Checking sign-in…"}</p>;
  }

  if (status === "unavailable") {
    return account ? (
      <div className="flex flex-col gap-2">
        <p role="status">Your profile is unavailable right now.</p>
        <p>Signed in as {account.email ?? account.name}</p>
        <a className="underline" href="/api/auth/signout" target="_top">Sign out of MBTI Closet</a>
      </div>
    ) : (
      <p role="status">Sign-in is unavailable right now.</p>
    );
  }

  return (
    <form action="/api/auth/signin/google" method="post" target="_top">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <button className="rounded-lg border border-current px-5 py-3" type="submit">
        Sign in with Google
      </button>
    </form>
  );
}
