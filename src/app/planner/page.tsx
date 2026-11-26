"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccountSession } from "../account-session";
import { usePlannerScreen } from "./use-planner-screen";
import { api, type Brief, type CompletedLook, type Garment, type Look } from "./shared";
import { PlannerHome } from "./home";
import { Occasion } from "./occasion";
import { Style } from "./style";
import { createTryOnLoader } from "./try-on";
import { Compare, type Comparison } from "./compare";
import { Refine } from "./refine";
import { RestoreReview } from "./restore-review";
import { SavedList } from "./saved-list";
import { Detail } from "./detail";
import { WearEntry } from "./wear";
import { emptyBrief, readForm, writeForm, type FormStage } from "./form-draft";

type Stage = FormStage | "photo" | "compare" | "refine";
type Draft = { brief: Brief; version?: string; stage: Stage; optionId?: string; looks: Look[]; pending?: boolean };
const planningScreen = /^(occasion|style|photo|compare|refine)(\/|$)/;

function go(page: string, briefId?: string, replace = false) {
  const url = new URL(window.location.href);
  if (briefId) url.searchParams.set("brief", briefId);
  else url.searchParams.delete("brief");
  url.hash = page;
  if (url.href === window.location.href) return;
  if (replace) window.history.replaceState(window.history.state, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function recordResume(stage: string) {
  window.dispatchEvent(new CustomEvent("closet:journey-resumed", { detail: { journey: "planner", stage } }));
}

export default function PlannerPage() {
  const accountId = String(useAccountSession().user!.id);
  const screen = usePlannerScreen();
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [stage, setStage] = useState<Stage>("occasion");
  const [optionId, setOptionId] = useState<string>();
  const [loadTryOn] = useState(createTryOnLoader);
  const [comparison, setComparison] = useState<Comparison>();
  const [comparisonNotice, setComparisonNotice] = useState("");
  const [reviewed, setReviewed] = useState<CompletedLook[]>([]);
  const [lastSavedId, setLastSavedId] = useState<string>();
  const [garments, setGarments] = useState<Garment[]>();
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [reload, setReload] = useState(0);
  const changing = useRef(false);

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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const initial = new URL(window.location.href);
    const requested = initial.hash.slice(1);
    const inPlan = planningScreen.test(requested);
    const briefId = inPlan ? initial.searchParams.get("brief") : null;
    async function restore() {
      const params = briefId ? { briefId } : {};
      const [items, requestedDraft] = await Promise.all([
        api<Garment[]>("wardrobe", {}, controller.signal),
        api<Draft | null>("resumePlanner", params, controller.signal),
      ]);
      const unavailable = Boolean(briefId && !requestedDraft);
      const draft = unavailable ? await api<Draft | null>("resumePlanner", {}, controller.signal) : requestedDraft;
      if (controller.signal.aborted) return;
      if (!unavailable && draft?.pending && inPlan) {
        timer = setTimeout(load, 1500);
        return;
      }
      const saved = draft ? { ...draft.brief, version: draft.version ?? undefined } : undefined;
      const form = !briefId || draft ? readForm(accountId, saved) : null;
      const nextStage = form?.stage ?? draft?.stage ?? "occasion";
      setBrief(form?.brief ?? saved ?? emptyBrief);
      setStage(nextStage);
      setOptionId(draft?.optionId);
      draft?.looks.forEach(look => loadTryOn.clear(look));
      setComparison(draft?.looks.length ? { looks: draft.looks, result: { status: "ready", looks: draft.looks } } : undefined);
      setReviewed([]);
      setLastSavedId(undefined);
      setGarments(items);
      if (inPlan && window.location.href === initial.href) {
        if (unavailable || (!draft && !form && requested !== "occasion")) {
          setComparisonNotice("This plan is no longer available.");
          go("home", undefined, true);
        } else {
          const target = requested === "compare" && briefId && draft && ["compare", "refine"].includes(draft.stage)
            ? "compare" : nextStage === "refine" ? "refine/" + draft?.optionId : nextStage;
          go(target, saved?.id, true);
          if (draft || form) recordResume(target.split("/")[0]);
        }
      }
    }
    function load() {
      restore().catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    }
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [accountId, loadTryOn, reload]);

  function edit(formStage: FormStage, fields: Brief) {
    setBrief(fields);
    setStage(formStage);
    writeForm(accountId, { stage: formStage, brief: fields });
  }

  function commit(saved: Brief, next: Stage) {
    writeForm(accountId, null);
    setBrief(saved);
    setStage(next);
    setOptionId(undefined);
    setComparison(undefined);
    setComparisonNotice("");
    setReviewed([]);
    go(next, saved.id);
  }

  async function change(next: Stage | "closed", selected?: string) {
    if (changing.current) return false;
    changing.current = true;
    setActionError("");
    try {
      let updated = brief;
      if (brief.id && !lastSavedId) {
        const { version } = await api<{ version: string }>("setDraftStage", {
          briefId: brief.id, version: brief.version, stage: next, optionId: selected,
        });
        updated = { ...brief, version };
        setBrief(updated);
      }
      setOptionId(selected);
      if (next !== "closed") {
        setStage(next);
        writeForm(accountId, next === "occasion" || next === "style" ? { stage: next, brief: updated } : null);
      }
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update your plan.");
      return false;
    } finally {
      changing.current = false;
    }
  }

  async function reset(startNew: boolean) {
    if (!(await change("closed"))) return;
    writeForm(accountId, null);
    setBrief(emptyBrief);
    setStage("occasion");
    setComparison(undefined);
    setComparisonNotice("");
    setReviewed([]);
    setLastSavedId(undefined);
    go(startNew ? "occasion" : "home");
  }

  async function step(next: Stage) {
    if (await change(next)) go(next, brief.id);
  }

  const remember = useCallback((chosen: CompletedLook) => {
    setReviewed(previous => [...previous.filter(item => item.id !== chosen.id), chosen]);
  }, []);

  async function choose(chosen: CompletedLook) {
    if (!(await change("refine", chosen.id))) return;
    remember(chosen);
    setComparisonNotice("");
    go("refine/" + chosen.id, brief.id);
  }

  function continuePlan() {
    const target = stage === "refine" ? "refine/" + optionId : stage;
    go(target, brief.id);
    // Read the server's current version before showing any previously generated content.
    setGarments(undefined);
    setReload(count => count + 1);
  }

  async function refreshStaleLook(chosen: CompletedLook) {
    loadTryOn.clear(chosen);
    setReviewed(previous => previous.filter(item => item.id !== chosen.id));
    setComparisonNotice("This outfit changed before it could be saved. Choose a current photo to continue.");
    await step("compare");
    setGarments(undefined);
    setLoadError("");
    setReload(count => count + 1);
  }

  // A saved detail reached from Save or wear feedback is part of that action.
  // All other visits, including bookmarks and history, count after detail loads.
  const skipReopen = useRef<string | null>(null);
  useEffect(() => {
    const [view, lookId, wearId] = screen.split("/");
    if (view === "saved" && wearId) skipReopen.current = lookId;
    else if (screen !== "saved/" + skipReopen.current) skipReopen.current = null;
  }, [screen]);
  const reportOpened = useCallback((id: string) => {
    if (skipReopen.current === id || window.location.hash !== "#saved/" + id) return;
    skipReopen.current = id;
    window.dispatchEvent(new Event("closet:saved-look-reopened"));
  }, []);

  const savedNavigation = {
    onOpen: (id: string) => go("saved/" + id),
    onWear: (lookId: string, entryId: string) => go("saved/" + lookId + "/" + entryId),
  };
  const [view, routeId, wearId] = screen.split("/");
  const look = view === "refine" && reviewed.find(item => item.id === routeId);
  const option = view === "refine" && comparison?.looks.find(item => item.id === routeId);
  const backToCompare = () => void step("compare");
  let content;
  if (screen === "saved") content = <SavedList {...savedNavigation} onNew={() => void reset(true)} />;
  else if (view === "saved" && routeId) content = wearId
    ? <WearEntry id={wearId} onBack={() => go("saved/" + routeId)} />
    : <Detail id={routeId} onOpened={reportOpened} onWear={id => go("saved/" + routeId + "/" + id)} onBack={() => go("saved")}
        onCompare={lastSavedId === routeId && comparison ? () => go("compare", brief.id) : undefined} />;
  else if (!garments) content = loadError
    ? <div className="text-danger" role="alert">{loadError} <Link className="underline" href="/account">Account</Link> · <button onClick={() => {setLoadError(""); setReload(n => n + 1);}}>Retry</button></div>
    : <p role="status">Opening your closet…</p>;
  else if (screen === "occasion") content = <Occasion brief={brief} onChange={updated => edit("occasion", updated)}
    onBack={() => go("home")} onNext={saved => commit(saved, "style")} />;
  else if ((screen === "style" || screen === "photo") && brief.id) content = <Style brief={brief} needsPhoto={screen === "photo"}
    onChange={updated => edit("style", updated)} onStyle={() => void step("style")} onPhoto={saved => commit(saved, "photo")}
    onBack={() => void step("occasion")} onNext={saved => commit(saved, "compare")} />;
  else if (screen === "compare" && brief.id) content = <Compare comparison={comparison} notice={comparisonNotice} onComparison={setComparison} loadTryOn={loadTryOn} briefId={brief.id} garments={garments}
    onEdit={() => void step("style")} onChoose={choose} />;
  else if (look) content = <Refine key={look.id} look={look} garments={garments} draftVersion={brief.version}
    onBack={backToCompare} onStale={() => void refreshStaleLook(look)}
    onSaved={id => { writeForm(accountId, null); setLastSavedId(id); skipReopen.current = id; go("saved/" + id); }} />;
  else if (option) content = <RestoreReview key={option.id} look={option} loadTryOn={loadTryOn} onReady={remember} onBack={backToCompare} />;
  else content = <>{comparisonNotice && <p role="status">{comparisonNotice}</p>}
    <PlannerHome garments={garments} savedNavigation={savedNavigation} occasion={lastSavedId ? undefined : brief.occasion.trim()} onNew={() => void reset(true)}
      onResume={continuePlan} onDiscard={() => void reset(false)} /></>;
  return <main className="flex-1 bg-canvas px-5 py-6 text-text sm:px-10">
    <div className={screen === "compare" ? "mx-auto max-w-7xl" : "mx-auto max-w-4xl"}>
      {actionError && <p className="mb-4 text-danger" role="alert">{actionError} <button className="underline" onClick={() => window.location.reload()}>Reload</button></p>}
      {content}
    </div>
  </main>;
}
