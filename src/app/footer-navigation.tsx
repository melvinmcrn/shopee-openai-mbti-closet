const destinations = [
  {
    label: "Home",
    href: "#home",
    icon: <>
      <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 21v-7h6v7" />
    </>,
  },
  {
    label: "Wardrobe",
    href: "/closet",
    icon: <path d="M8 4 3 7l2 5 3-1v9h8v-9l3 1 2-5-5-3a4 4 0 0 1-8 0Z" />,
  },
  {
    label: "Saved",
    href: "#saved",
    icon: <path d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4z" />,
  },
  {
    label: "Profile",
    href: "/account",
    icon: <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
    </>,
  },
] as const;

type FooterDestination = (typeof destinations)[number]["label"];

export function FooterNavigation({ active }: { active: FooterDestination }) {
  const inPlanner = active === "Home" || active === "Saved";
  return (
    <footer className="h-[var(--footer-navigation-height)] shrink-0">
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-20 h-[var(--footer-navigation-height)] border-t border-divider bg-surface pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="mx-auto grid h-full max-w-4xl grid-cols-4">
          {destinations.map(({ label, href, icon }) => (
            <a
              key={label}
              href={!inPlanner && href.startsWith("#") ? `/planner${href}` : href}
              aria-label={label}
              aria-current={label === active ? "page" : undefined}
              title={label}
              className="grid place-items-center text-supporting aria-[current=page]:text-secondary focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-secondary"
            >
              <svg
                aria-hidden="true"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {icon}
              </svg>
            </a>
          ))}
        </div>
      </nav>
    </footer>
  );
}
