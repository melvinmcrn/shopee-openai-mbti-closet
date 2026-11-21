"use client";

import { useEffect, useState } from "react";

export function GoogleAccount() {
  const [account, setAccount] = useState<{ name?: string; email?: string } | null>(null);
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
        setAccount(session?.user ?? null);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      }
    }
    void loadAccount();
    return () => controller.abort();
  }, []);

  if (status === "loading") return <p role="status">Checking sign-in…</p>;
  if (status === "unavailable") return <p role="status">Sign-in is unavailable right now.</p>;

  return account ? (
    <div className="flex flex-col gap-2">
      <p>Signed in as {account.email ?? account.name}</p>
      <a className="underline" href="/api/auth/signout" target="_top">Sign out of MBTI Closet</a>
    </div>
  ) : (
    <a className="rounded-lg border border-current px-5 py-3" href="/api/auth/signin" target="_top">
      Sign in with Google
    </a>
  );
}
