import type { Garment } from "./shared";

const outfitCategories = [
  { category: "top", label: "Tops" },
  { category: "bottom", label: "Bottoms" },
  { category: "dress", label: "Dresses" },
  { category: "shoes", label: "Shoes" },
] as const;

type PlannerHomeProps = {
  garments: readonly Garment[];
  onNew: () => void;
  onSaved: () => void;
};

export function PlannerHome({ garments, onNew, onSaved }: PlannerHomeProps) {
  const categoryCounts = outfitCategories.map(({ category, label }) => ({
    label,
    count: garments.filter((garment) => garment.category === category).length,
  }));

  return (
    <>
      <section
        aria-labelledby="planner-title"
        className="rounded-3xl bg-[#2a1f29] px-6 py-9 text-[#fff9f4] sm:px-10 sm:py-14"
      >
        <h1 id="planner-title" className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Outfit planner
        </h1>
        <p className="mt-4 max-w-md leading-relaxed text-[#e9dce4]">
          Tell us what you’re dressing for. Compare outfits from your closet and save the looks you want to wear again.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onNew}
            className="min-h-12 rounded-full bg-[#f7e8ef] px-6 font-semibold text-[#2a1f29] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Plan a new outfit
          </button>
          <button
            type="button"
            onClick={onSaved}
            className="min-h-12 rounded-full border border-[#a594a2] px-6 font-semibold text-[#fff9f4] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Saved looks
          </button>
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
              className="rounded-2xl border border-current/15 bg-current/5 px-4 py-3"
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
