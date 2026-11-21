"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Brief, type Garment, type Look } from "./shared";
import { PlannerHome } from "./home";
import { Occasion } from "./occasion";
import { Style } from "./style";
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
  const [look, setLook] = useState<Look>();
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [garments, setGarments] = useState<Garment[]>();
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const readRoute = () => setScreen(window.location.hash.slice(1) || "home");
    readRoute();
    window.addEventListener("hashchange", readRoute);
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("hashchange", readRoute);
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
    window.scrollTo(0, 0);
  }
  function start() {
    setBrief({ ...emptyBrief, preferences: [] });
    setLook(undefined);
    go("occasion");
  }
  const [, savedId, wearId] = screen.split("/");
  let content;
  if (screen === "saved") content = <SavedList onOpen={id => go("saved/" + id)} onNew={start} />;
  else if (screen.startsWith("saved/") && savedId) content = wearId
    ? <WearEntry id={wearId} onBack={() => go("saved/" + savedId)} />
    : <Detail id={savedId} onWear={id => go("saved/" + savedId + "/" + id)} onBack={() => go("saved")} />;
  else if (!garments) content = loadError
    ? <div role="alert">{loadError} <Link className="underline" href="/">Account</Link> · <button onClick={() => {setLoadError(""); setReload(n => n + 1);}}>Retry</button></div>
    : <p role="status">Opening your closet…</p>;
  else if (screen === "occasion") content = <Occasion key={brief.id || "new"} brief={brief} onBack={() => go("home")} onNext={saved => { setBrief(saved); go("style"); }} />;
  else if (screen === "style" && brief.id) content = <Style brief={brief} onBack={() => go("occasion")} onNext={saved => { setBrief(saved); go("compare"); }} />;
  else if (screen === "compare" && brief.id) content = <Compare briefId={brief.id} garments={garments} onEdit={() => go("style")} onChoose={chosen => { setLook(chosen); setSlots({...chosen.slots}); go("refine"); }} />;
  else if (screen === "refine" && look) content = <Refine look={look} slots={slots} garments={garments} onChange={setSlots} onBack={() => go("compare")} onPreview={() => go("preview")} onSaved={id => go("saved/" + id)} />;
  else if (screen === "preview" && look) content = <Preview look={look} slots={slots} garments={garments} onBack={() => go("refine")} />;
  else content = <PlannerHome garments={garments} onNew={start} onSaved={() => go("saved")} />;
  return <main className="min-h-screen bg-[#fcf9f7] px-5 py-6 text-[#302331] sm:px-10">
    <div className="mx-auto max-w-4xl">
      <nav aria-label="Planner navigation" className="mb-7 flex items-center gap-5 border-b border-[#ded2d8] pb-4 text-sm font-medium">
        <a href="#home" className="mr-auto text-lg font-semibold">MBTI Closet</a>
        <a href="#saved">Saved</a><Link href="/">Account</Link>
      </nav>
      {content}
    </div>
  </main>;
}
