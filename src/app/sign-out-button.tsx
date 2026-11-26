"use client";

import { useState } from "react";
import { sessionEnded } from "./private-fetch.mjs";

export function SignOutButton({ className, disabled, label }: {
  className: string;
  disabled?: boolean;
  label: string;
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");

  async function signOut() {
    setStatus("pending");
    try {
      const tokenResponse = await fetch("/api/auth/csrf", { cache: "no-store" });
      if (!tokenResponse.ok) throw new Error("CSRF token unavailable");
      const { csrfToken } = await tokenResponse.json();
      if (typeof csrfToken !== "string" || !csrfToken) throw new Error("Invalid CSRF token");

      const response = await fetch("/api/auth/signout", {
        method: "POST",
        headers: { "X-Auth-Return-Redirect": "1" },
        body: new URLSearchParams({ csrfToken, callbackUrl: "/" }),
      });
      if (!response.ok) throw new Error("Sign-out failed");
      const { url } = await response.json();
      // Auth.js also returns a redirect URL for errors such as an expired CSRF token.
      if (new URL(url, window.location.origin).pathname !== "/") throw new Error("Sign-out failed");
      try {
        localStorage.setItem(sessionEnded, String(Date.now()));
      } catch {
        // Other tabs also check when they return to the foreground.
      }
      window.location.replace("/");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div>
      <button type="button" className={className} disabled={disabled || status === "pending"} onClick={signOut}>
        {status === "pending" ? "Signing out…" : label}
      </button>
      {status === "error" && <p role="alert" className="text-sm text-danger">Couldn’t sign out. Please try again.</p>}
    </div>
  );
}
