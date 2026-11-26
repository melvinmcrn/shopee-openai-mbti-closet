import { EnhancementProduct } from "./enhancement";
import { SavedLookActions, type SavedLookNavigation } from "./saved-look-actions";
import { useLocalDate } from "./wear-date";
import { SavedPhoto } from "./saved-photo";
import { WardrobePhotos } from "./wardrobe-photos";
import { useEffect, useState } from "react";
import { api, occasionLookLabel, type SavedLook } from "./shared";

type SavedListProps = SavedLookNavigation & {
  onNew: () => void;
};

type SavedListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; looks: SavedLook[] };

const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-divider px-5 py-2 text-sm font-semibold text-secondary transition hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export function SavedList({ onOpen, onWear, onNew }: SavedListProps) {
  const today = useLocalDate();
  const [state, setState] = useState<SavedListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    void api<SavedLook[]>("list", { date: today }).then(
      (looks) => {
        if (active) setState({ status: "ready", looks });
      },
      (error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Your saved looks couldn’t be loaded.",
          });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [attempt, today]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }

  return (
    <section aria-labelledby="saved-list-heading" className="text-text">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 sm:mb-8">
        <h1 id="saved-list-heading" className="font-heading text-4xl tracking-tight sm:text-5xl">
          Saved looks
        </h1>
        <button type="button" onClick={onNew} className={primaryButton}>
          Plan a new outfit
        </button>
      </header>

      {state.status === "loading" && (
        <p role="status" className="rounded-2xl border border-divider bg-canvas p-5 text-sm text-supporting">
          Loading saved looks…
        </p>
      )}

      {state.status === "error" && (
        <div className="rounded-2xl border border-divider bg-canvas p-5">
          <p role="alert" className="text-sm text-supporting">{state.message}</p>
          <button type="button" onClick={retry} className={`mt-4 ${secondaryButton}`}>
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && (state.looks.length ? (
        <ul className="grid gap-4 lg:grid-cols-2">
          {state.looks.map((look) => (
            <li key={look.id} className="min-w-0">
              <article className="flex h-full flex-col rounded-2xl border border-divider bg-surface p-5 shadow-sm">
                <h2 className="break-words font-heading text-2xl">{look.occasion}</h2>
                <time dateTime={look.createdAt} className="mt-1 text-sm text-supporting">
                  {dateFormat.format(new Date(look.createdAt))}
                </time>
                <SavedLookActions look={look} today={today} onOpen={onOpen} onWear={onWear} />
                <div className="mt-4">
                  <SavedPhoto look={look} catalogItemIds={look.enhancements.map(product => product.id)} />
                </div>
                <div className="mt-4">
                  <WardrobePhotos garments={Object.values(look.slots)} />
                  {look.enhancements.map(product => (
                    <div key={product.id} className="mt-3"><EnhancementProduct product={product} /></div>
                  ))}
                </div>
                <p className="mt-5 flex-1 text-sm leading-relaxed text-supporting">
                  <strong>{look.kind === "occasion" ? occasionLookLabel : "Original suggestion"}</strong> · {look.explanation}
                </p>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-divider bg-canvas p-6 sm:p-8">
          <h2 className="font-heading text-2xl">No saved looks yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-supporting">
            Save an outfit you want to wear again and it will appear here.
          </p>
        </div>
      ))}
    </section>
  );
}
