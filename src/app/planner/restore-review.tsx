import { useEffect, useState } from "react";
import { api, type Brief, type CompletedLook, type Look } from "./shared";

export function RestoreReview({ look, brief, onReady, onBack }: {
  look: Look;
  brief: Brief;
  onReady: (look: CompletedLook) => void;
  onBack: () => void;
}) {
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    api<CompletedLook>("restoreReview", { briefId: brief.id, optionId: look.id, version: brief.version }).then(photo => {
      if (active && photo) onReady(photo);
      else if (active) setError(true);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [look, brief.id, brief.version, onReady]);
  return error ? <section>
    <p role="alert">This try-on is unavailable. Choose a current look to continue.</p>
    <button className="min-h-11 font-semibold text-secondary underline" onClick={onBack}>Back to compare looks</button>
  </section> : <p role="status">Opening your selected outfit…</p>;
}
