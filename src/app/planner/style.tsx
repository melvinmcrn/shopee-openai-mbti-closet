import { privateFetch } from "../private-fetch.mjs";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeProfilePhoto, profilePhotoAccept, profilePhotoRequirements } from "../wardrobe/add/normalize-upload.mjs";
import { styleOptions } from "../profile/style-options";
import { api, type Brief } from "./shared";

type PreparedTryOn = { status: "ready"; brief: Brief } | { status: "photo_required"; brief: Brief };

type StyleProps = {
  brief: Brief;
  needsPhoto: boolean;
  onPhoto: (saved: Brief) => void;
  onStyle: () => void;
  onChange: (updated: Brief) => void;
  onNext: (saved: Brief) => void;
  onBack: () => void;
};

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl border border-divider bg-surface px-3 py-2 text-base text-text placeholder:text-supporting focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

const actionClass =
  "min-h-11 rounded-lg px-3 text-sm font-semibold text-secondary hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60";

export function Style({ brief, needsPhoto, onPhoto, onStyle, onChange, onNext, onBack }: StyleProps) {
  const { formality, comfort, styles = [] } = brief;
  const options = [...new Set([...styleOptions, ...(brief.profileStyles ?? []), ...styles])];
  const setFormality = (formality: string) => onChange({ ...brief, formality });
  const setComfort = (comfort: string) => onChange({ ...brief, comfort });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const canReusePhoto = brief.hasSavedPhoto || uploaded;
  const savePending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [needsPhoto]);

  function deferPhoto() {
    onStyle();
    setPhoto(null);
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending.current) return;

    savePending.current = true;
    setSaving(true);
    setError("");

    try {
      if (photo) {
        const file = await normalizeProfilePhoto(photo);
        const body = new FormData();
        body.set("image", file, "profile-photo.jpg");
        const response = await privateFetch("/api/profile/photo", { method: "PUT", body });
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          throw new Error(problem.error || "Your photo could not be saved. Try again.");
        }
        setUploaded(true);
        setPhoto(null);
      }
      const result = await api<PreparedTryOn>("prepareTryOn", {
        ...brief,
        trackDraft: true,
        formality: formality.trim(),
        comfort: comfort.trim(),
        styles,
      });
      if (result.status === "photo_required") {
        onPhoto(result.brief);
        return;
      }
      onNext(result.brief);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your style preferences. Try again.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="style-heading" className="mx-auto max-w-2xl text-text">
      {!needsPhoto && <button type="button" onClick={onBack} disabled={saving} className={`${actionClass} -ml-3 mb-3`}>
        <span aria-hidden="true">← </span>Back to occasion
      </button>}
      <header>
        <h1 ref={heading} tabIndex={-1} id="style-heading" className="outline-none text-3xl font-semibold tracking-tight sm:text-4xl">
          {needsPhoto ? "Add your try-on photo" : "Today’s style"}
        </h1>
        <p className="mt-2 text-sm text-supporting">
          {needsPhoto ? `See yourself in looks for ${brief.occasion}.` : `What would you like to wear for ${brief.occasion}?`}
        </p>
      </header>

      <form onSubmit={save} className="mt-6 rounded-2xl border border-divider bg-surface p-5 sm:p-7">
        <fieldset disabled={saving} hidden={needsPhoto} aria-describedby="outfit-styles-help" className="mb-6 border-b border-divider pb-5">
          <legend className="font-semibold">Styles for this outfit</legend>
          <p id="outfit-styles-help" className="mt-1 text-sm text-supporting">
            New outfits start with your profile styles. Choose any that fit this occasion.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map(style => (
              <label key={style} className="flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border border-divider px-3 text-sm has-checked:border-secondary has-checked:bg-selected">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={styles.includes(style)}
                  onChange={event => {
                    const checked = event.currentTarget.checked;
                    onChange({ ...brief, styles: checked ? [...styles, style] : styles.filter(name => name !== style) });
                  }}
                />
                <span className="wrap-anywhere">{style}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={saving} hidden={needsPhoto} className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">
              Formality <span className="font-normal text-supporting">(optional)</span>
              <input
                name="formality"
                value={formality}
                maxLength={500}
                placeholder="Choose a suggestion or type your own"
                onChange={(event) => setFormality(event.target.value)}
                className={inputClass}
              />
            </label>
            <div role="group" aria-label="Formality suggestions" className="mt-2 flex flex-wrap gap-2">
              {["Casual", "Smart casual", "Business casual", "Formal"].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={formality === option}
                  onClick={() => setFormality(formality === option ? "" : option)}
                  className="min-h-9 rounded-full border border-divider px-3 text-sm aria-pressed:bg-selected aria-pressed:text-secondary"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold">
              Comfort <span className="font-normal text-supporting">(optional)</span>
              <input
                name="comfort"
                value={comfort}
                maxLength={500}
                placeholder="Choose a suggestion or type your own"
                onChange={(event) => setComfort(event.target.value)}
                className={inputClass}
              />
            </label>
            <div role="group" aria-label="Comfort suggestions" className="mt-2 flex flex-wrap gap-2">
              {["Comfortable for walking", "Loose fit", "Light and breathable", "Warm layers"].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={comfort === option}
                  onClick={() => setComfort(comfort === option ? "" : option)}
                  className="min-h-9 rounded-full border border-divider px-3 text-sm aria-pressed:bg-selected aria-pressed:text-secondary"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        {needsPhoto ? (
          <div>
            <label className="block text-base font-semibold" htmlFor="try-on-photo">Choose a photo</label>
            <p id="look-photo-use" className="mt-2 text-sm text-supporting">
              Choose a clear photo of yourself. We save it privately to your profile. OpenAI uses it to show these outfits on you.
              You can remove it in Profile.
            </p>
            <input id="try-on-photo" type="file" accept={profilePhotoAccept} required={!canReusePhoto} disabled={saving}
              aria-describedby="look-photo-use try-on-formats"
              className="mt-4 w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:rounded-full file:border file:border-divider file:bg-surface file:px-4 file:font-semibold"
              onChange={event => { setPhoto(event.currentTarget.files?.[0] ?? null); setError(""); }} />
            <p id="try-on-formats" className="mt-2 text-sm text-supporting">{profilePhotoRequirements}</p>
          </div>
        ) : (
          <p id="look-photo-use" className="mt-4 text-sm text-supporting">
            When you create looks, we send your saved profile photo to OpenAI to show the outfits on you.
            If you haven’t saved a photo, we’ll ask for one first.
          </p>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <button
          aria-describedby="look-photo-use"
          type="submit"
          disabled={saving}
          className="mt-4 min-h-12 rounded-full bg-primary px-6 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-60"
        >
          {saving ? "Saving…" : needsPhoto ? canReusePhoto && !photo ? "Use saved profile photo and create looks" : "Save photo and create looks" : "Create looks with my profile photo"}
        </button>
        {needsPhoto && (
          <button type="button" onClick={deferPhoto} disabled={saving} className={`${actionClass} mt-2 sm:ml-2`}>
            Not now, back to style
          </button>
        )}
      </form>
    </section>
  );
}
