import Link from "next/link";
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
  onNew: () => void;
};

export function PlannerHome({ garments, onNew }: PlannerHomeProps) {
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
          Tell us what you’re dressing for. Compare outfits from your closet and save the looks you want to wear again.
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
            href="/wardrobe/add"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-canvas/60 px-6 text-center font-semibold text-canvas transition-colors hover:bg-canvas/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-canvas"
          >
            Add new clothes to wardrobe
          </Link>
        </div>
      </section>
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
