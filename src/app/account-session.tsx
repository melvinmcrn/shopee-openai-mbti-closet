"use client";

import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AppHeader, FooterNavigation } from "./app-navigation";
import { sessionEnded } from "./private-fetch.mjs";
import { returnDestination } from "./return-destination.mjs";

type User = { id: number | string; name?: string; email?: string };
type Session =
  | { status: "checking" | "signed-out" | "unavailable"; user: null }
  | { status: "signed-in"; user: User };
const checking: Session = { status: "checking", user: null };
const AccountContext = createContext<Session>(checking);

export function useAccountSession() {
  return useContext(AccountContext);
}

export function AccountSession({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const segment = useSelectedLayoutSegment();
  const protectedPage = segment !== null && segment !== "_not-found";
  const [snapshot, setSnapshot] = useState<{ pathname: string; session: Session } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Layouts persist across Next navigations. Withhold each page until its check succeeds.
  const session = snapshot?.pathname === pathname ? snapshot.session : checking;

  useEffect(() => {
    let request: AbortController;
    let timer: number | undefined;

    function signedOut() {
      request?.abort();
      window.clearTimeout(timer);
      setSnapshot({ pathname, session: { status: "signed-out", user: null } });
      if (protectedPage) {
        const destination = returnDestination(window.location.href, window.location.origin);
        window.location.replace(destination ? "/?" + new URLSearchParams({ returnTo: destination }) : "/");
      }
    }

    async function verify() {
      request?.abort();
      window.clearTimeout(timer);
      request = new AbortController();
      const { signal } = request;
      try {
        const response = await fetch("/api/account", { method: "POST", cache: "no-store", signal });
        if (signal.aborted) return;
        if (response.status === 401) return signedOut();
        if (!response.ok) throw new Error("Account unavailable");
        const data = await response.json();
        if (signal.aborted) return;
        if (!data?.user) return signedOut();
        setSnapshot({ pathname, session: { status: "signed-in", user: data.user } });
        const expiresIn = Date.parse(data.expires) - Date.now();
        if (Number.isFinite(expiresIn)) timer = window.setTimeout(verify, Math.max(1000, expiresIn));
      } catch {
        if (!signal.aborted) setSnapshot({ pathname, session: { status: "unavailable", user: null } });
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void verify();
    }
    function onPageHide(event: PageTransitionEvent) {
      if (event.persisted) {
        request?.abort();
        window.clearTimeout(timer);
        flushSync(() => setSnapshot(null));
      }
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) void verify();
    }
    function onStorage(event: StorageEvent) {
      if (event.key === sessionEnded) void verify();
    }

    void verify();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("popstate", verify);
    window.addEventListener("storage", onStorage);
    window.addEventListener(sessionEnded, signedOut);
    return () => {
      request?.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("popstate", verify);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(sessionEnded, signedOut);
    };
  }, [pathname, protectedPage, attempt]);

  const checkedUser = snapshot?.session.user;
  return (
    <AccountContext.Provider value={session}>
      <AppHeader signedIn={Boolean(checkedUser)} />
      {!protectedPage || session.user ? <Fragment key={session.user?.id}>{children}</Fragment> : (
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-start gap-3 px-5 py-7">
          {session.status === "unavailable" ? <>
            <p role="status">We couldn’t check your sign-in.</p>
            <button className="font-semibold text-secondary underline" onClick={() => setAttempt(value => value + 1)}>Try again</button>
          </> : <p role="status" className="text-sm text-supporting">Checking sign-in…</p>}
        </main>
      )}
      {checkedUser && <FooterNavigation />}
    </AccountContext.Provider>
  );
}
