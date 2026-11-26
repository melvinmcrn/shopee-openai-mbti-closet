import Link from "next/link";
import { RecentLook } from "./recent-look";
import type { SavedLookNavigation } from "./saved-look-actions";
import type { Garment } from "./shared";

const outfitCategories = [
  { category: "top", label: "Tops" },
  { category: "bottom", label: "Bottoms" },
  { category: "dress", label: "Dresses" },
  { category: "shoes", label: "Shoes" },
  { category: "outerwear", label: "Outerwear" },
  { category: "accessory", label: "Accessories" },
] as const;

type PlannerHomeProps = {
  garments: readonly Garment[];
  savedNavigation: SavedLookNavigation;
  occasion?: string;
  onResume: () => void;
  onDiscard: () => void;
  onNew: () => void;
};

export function PlannerHome({ garments, savedNavigation, occasion, onResume, onDiscard, onNew }: PlannerHomeProps) {
  const categoryCounts = outfitCategories.map(({ category, label }) => ({
    label,
    count: garments.filter((garment) => garment.category === category).length,
  }));

  return (
    <>
      <section
        aria-labelledby="planner-title"
        className="rounded-3xl bg-secondary px-6 py-9 text-canvas sm:px-10 sm:py-14"
      >
        <h1 id="planner-title" className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Outfit planner
        </h1>
        <p className="mt-4 max-w-md leading-relaxed text-selected">
          Tell us what you’re dressing for. Compare looks with pieces from your closet and Shopee, then save your favorites.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onNew}
            className="min-h-12 rounded-full bg-primary px-6 font-semibold text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-canvas"
          >
            Plan a new outfit
          </button>
          <Link
            href="/wardrobe/add?from=planner"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-canvas/60 px-6 text-center font-semibold text-canvas transition-colors hover:bg-canvas/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-canvas"
          >
            Add new clothes to wardrobe
          </Link>
        </div>
      </section>
      {occasion && <section aria-label="Unfinished outfit" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-divider bg-surface px-5 py-3">
        <button className="min-h-11 min-w-0 break-words text-left font-semibold text-secondary underline underline-offset-4" onClick={onResume}>
          Continue “{occasion}”
        </button>
        <button className="min-h-11 text-sm text-supporting underline" onClick={onDiscard}>Discard plan</button>
      </section>}
      <RecentLook {...savedNavigation} />
      <section aria-labelledby="planner-closet-title" className="mt-8">
        <h2 id="planner-closet-title" className="text-xl font-semibold tracking-tight">
          Available in your closet
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {categoryCounts.map(({ label, count }) => (
            <div
              key={label}
              className="rounded-2xl border border-divider bg-surface px-4 py-3"
            >
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
