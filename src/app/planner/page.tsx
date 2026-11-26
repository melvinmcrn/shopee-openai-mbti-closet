"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlannerScreen } from "./use-planner-screen";
import { api, type Brief, type CompletedLook, type Garment } from "./shared";
import { PlannerHome } from "./home";
import { Occasion } from "./occasion";
import { Style } from "./style";
import { createTryOnLoader } from "./try-on";
import { Compare, type Comparison } from "./compare";
import { Refine } from "./refine";
import { SavedList } from "./saved-list";
import { Detail } from "./detail";
import { WearEntry } from "./wear";

const emptyBrief: Brief = { occasion: "", timing: "", location: "", formality: "", comfort: "", preferences: [] };

export default function PlannerPage() {
  const screen = usePlannerScreen();
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [loadTryOn] = useState(createTryOnLoader);
  const [comparison, setComparison] = useState<Comparison>();
  const [comparisonNotice, setComparisonNotice] = useState("");
  const [reviewed, setReviewed] = useState<CompletedLook[]>([]);
  const [lastSavedId, setLastSavedId] = useState<string>();
  const [garments, setGarments] = useState<Garment[]>();
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const changeScreen = () => window.scrollTo(0, 0);
    window.addEventListener("hashchange", changeScreen);
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("hashchange", changeScreen);
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  useEffect(() => {
    let current = true;
    api<Garment[]>("wardrobe").then(items => { if (current) setGarments(items); })
      .catch(error => { if (current) setLoadError(error.message); });
    return () => { current = false; };
  }, [reload]);

  function go(page: string) {
    window.location.hash = page;
  }
  function start() {
    setBrief({ ...emptyBrief, preferences: [] });
    setComparison(undefined);
    setComparisonNotice("");
    setReviewed([]);
    setLastSavedId(undefined);
    go("occasion");
  }
  function choose(chosen: CompletedLook) {
    setReviewed(previous => [...previous.filter(item => item.id !== chosen.id), chosen]);
    setComparisonNotice("");
    go("refine/" + chosen.id);
  }
  function refreshStaleLook(chosen: CompletedLook) {
    loadTryOn.clear(chosen);
    setReviewed(previous => previous.filter(item => item.id !== chosen.id));
    setComparisonNotice("This outfit changed before it could be saved. Choose a current photo to continue.");
    setLoadError("");
    setGarments(undefined);
    setReload(count => count + 1);
    window.history.back();
  }
  const pendingOpen = useRef<string | null>(null);
  useEffect(() => {
    if (screen !== "saved/" + pendingOpen.current) pendingOpen.current = null;
  }, [screen]);
  const reportOpened = useCallback((id: string) => {
    if (pendingOpen.current !== id) return;
    pendingOpen.current = null;
    window.dispatchEvent(new Event("closet:saved-look-reopened"));
  }, []);

  function openSavedLook(id: string) {
    pendingOpen.current = id;
    go("saved/" + id);
  }
  const savedNavigation = {
    onOpen: openSavedLook,
    onWear: (lookId: string, entryId: string) => go("saved/" + lookId + "/" + entryId),
  };
  const [view, routeId, wearId] = screen.split("/");
  const look = view === "refine" && (routeId ? reviewed.find(item => item.id === routeId) : reviewed.at(-1));
  let content;
  if (screen === "saved") content = <SavedList {...savedNavigation} onNew={start} />;
  else if (view === "saved" && routeId) content = wearId
    ? <WearEntry id={wearId} onBack={() => go("saved/" + routeId)} />
    : <Detail id={routeId} onOpened={reportOpened} onWear={id => go("saved/" + routeId + "/" + id)} onBack={() => go("saved")}
        onCompare={lastSavedId === routeId && comparison ? () => go("compare") : undefined} />;
  else if (!garments) content = loadError
    ? <div className="text-danger" role="alert">{loadError} <Link className="underline" href="/account">Account</Link> · <button onClick={() => {setLoadError(""); setReload(n => n + 1);}}>Retry</button></div>
    : <p role="status">Opening your closet…</p>;
  else if (screen === "occasion") content = <Occasion key={brief.id || "new"} brief={brief} onBack={() => go("home")} onNext={saved => { setBrief(saved); go("style"); }} />;
  else if (screen === "style" && brief.id) content = <Style brief={brief} onBack={() => go("occasion")} onNext={saved => { setBrief(saved); setComparison(undefined); setComparisonNotice(""); go("compare"); }} />;
  else if (screen === "compare" && brief.id) content = <Compare comparison={comparison} notice={comparisonNotice} onComparison={setComparison} loadTryOn={loadTryOn} briefId={brief.id} garments={garments}
    onEdit={() => go("style")} onChoose={choose} />;
  else if (look) content = <Refine key={look.id} look={look} garments={garments}
    onBack={() => window.history.back()} onStale={() => refreshStaleLook(look)}
    onSaved={id => { setLastSavedId(id); go("saved/" + id); }} />;
  else content = <PlannerHome garments={garments} savedNavigation={savedNavigation} onNew={start} />;
  return <main className="flex-1 bg-canvas px-5 py-6 text-text sm:px-10">
    <div className={screen === "compare" ? "mx-auto max-w-7xl" : "mx-auto max-w-4xl"}>{content}</div>
  </main>;
}
