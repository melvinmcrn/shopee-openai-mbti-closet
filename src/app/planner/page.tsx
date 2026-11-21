"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClosetWordmark } from "../closet-wordmark";
import { FooterNavigation } from "../footer-navigation";
import { api, type Brief, type Garment, type Look } from "./shared";
import { PlannerHome } from "./home";
import { Occasion } from "./occasion";
import { Style } from "./style";
import { createTryOnLoader } from "./try-on";
import { Compare } from "./compare";
import { Refine } from "./refine";
import { Preview } from "./preview";
import { SavedList } from "./saved-list";
import { Detail } from "./detail";
import { WearEntry } from "./wear";

const emptyBrief: Brief = { occasion: "", timing: "", location: "", formality: "", comfort: "", preferences: [] };

export default function PlannerPage() {
  const [screen, setScreen] = useState("home");
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [loadTryOn] = useState(createTryOnLoader);
  const [useProfilePhoto, setUseProfilePhoto] = useState(false);
  const [look, setLook] = useState<Look>();
  const [garments, setGarments] = useState<Garment[]>();
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const readRoute = () => setScreen(window.location.hash.slice(1) || "home");
    const changeScreen = () => {
      readRoute();
      window.scrollTo(0, 0);
    };
    readRoute();
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
    setLook(undefined);
    setUseProfilePhoto(false);
    go("occasion");
  }
  const [, savedId, wearId] = screen.split("/");
  let content;
  if (screen === "saved") content = <SavedList onOpen={id => go("saved/" + id)} onNew={start} />;
  else if (screen.startsWith("saved/") && savedId) content = wearId
    ? <WearEntry id={wearId} onBack={() => go("saved/" + savedId)} />
    : <Detail id={savedId} onWear={id => go("saved/" + savedId + "/" + id)} onBack={() => go("saved")} />;
  else if (!garments) content = loadError
    ? <div className="text-danger" role="alert">{loadError} <Link className="underline" href="/account">Account</Link> · <button onClick={() => {setLoadError(""); setReload(n => n + 1);}}>Retry</button></div>
    : <p role="status">Opening your closet…</p>;
  else if (screen === "occasion") content = <Occasion key={brief.id || "new"} brief={brief} onBack={() => go("home")} onNext={saved => { setBrief(saved); go("style"); }} />;
  else if (screen === "style" && brief.id) content = <Style brief={brief} onBack={() => go("occasion")} onNext={saved => { setBrief(saved); go("compare"); }} />;
  else if (screen === "compare" && brief.id) content = <Compare loadTryOn={loadTryOn} useProfilePhoto={useProfilePhoto} setUseProfilePhoto={setUseProfilePhoto} briefId={brief.id} garments={garments} onEdit={() => go("style")} onChoose={chosen => { setLook(chosen); go("refine"); }} />;
  else if (screen === "refine" && look) content = <Refine look={look} garments={garments} onBack={() => go("compare")} onPreview={() => go("preview")} onSaved={id => go("saved/" + id)} />;
  else if (screen === "preview" && look) content = <Preview key={String(useProfilePhoto)} loadTryOn={loadTryOn} useProfilePhoto={useProfilePhoto} setUseProfilePhoto={setUseProfilePhoto} look={look} garments={garments} onBack={() => go("refine")} />;
  else content = <PlannerHome garments={garments} onNew={start} />;
  const activeTab = screen === "home" ? "Home" : screen === "saved" ? "Saved" : null;
  return <main className="min-h-screen bg-canvas px-5 py-6 text-text sm:px-10">
    <div className="mx-auto max-w-4xl">
      <header className="mb-7 flex items-center gap-5 border-b border-divider pb-4 text-sm font-medium">
        <a href="#home" className="mr-auto flex h-[30px] items-center" aria-label="Outfit planner home">
          <ClosetWordmark />
        </a>
        {!activeTab && (
          <nav aria-label="Planner navigation" className="flex gap-5">
            <a href="#saved">Saved</a><Link href="/account">Account</Link>
          </nav>
        )}
      </header>
      {content}
    </div>
    {activeTab && <FooterNavigation active={activeTab} />}
  </main>;
}
