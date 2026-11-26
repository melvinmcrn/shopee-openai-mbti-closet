import { useEffect, useState } from "react";
import type { CompletedLook, Look } from "./shared";
import type { LoadTryOn } from "./try-on";

export function RestoreReview({ look, loadTryOn, onReady, onBack }: {
  look: Look;
  loadTryOn: LoadTryOn;
  onReady: (look: CompletedLook) => void;
  onBack: () => void;
}) {
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    loadTryOn(look).preview.then(photo => {
      if (active && photo) onReady(photo);
      else if (active) setError(true);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [look, loadTryOn, onReady]);
  return error ? <section>
    <p role="alert">This try-on is unavailable. Choose a current look to continue.</p>
    <button className="min-h-11 font-semibold text-secondary underline" onClick={onBack}>Back to compare looks</button>
  </section> : <p role="status">Opening your selected outfit…</p>;
}
