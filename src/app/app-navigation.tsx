"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ComponentPropsWithoutRef } from "react";
import { ClosetWordmark } from "./closet-wordmark";
import { usePlannerScreen } from "./planner/use-planner-screen";

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

function NavigationLink({ href, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) {
  const segment = useSelectedLayoutSegment();
  if (href.startsWith("#")) {
    // The planner uses native hash changes to switch between its screens.
    if (segment === "planner") return <a href={href} {...props} />;
    return <Link href={`/planner${href}`} {...props} />;
  }
  return <Link href={href} {...props} />;
}

export function AppHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-divider bg-canvas pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-14 max-w-4xl items-center px-5 sm:px-8">
        <NavigationLink href={signedIn ? "#home" : "/"} aria-label="Closet home" className="inline-flex min-h-11 items-center">
          <ClosetWordmark />
        </NavigationLink>
      </div>
    </header>
  );
}

export function FooterNavigation() {
  const segment = useSelectedLayoutSegment();
  const screen = usePlannerScreen(segment === "planner");
  let active: (typeof destinations)[number]["label"] | undefined;
  if (segment === "closet" || segment === "wardrobe") active = "Wardrobe";
  else if (segment === "account" || segment === "profile") active = "Profile";
  else if (segment === "planner") active = screen.split("/")[0] === "saved" ? "Saved" : "Home";
  else if (segment === null) active = "Home";
  return (
    <footer className="h-[var(--footer-navigation-height)] shrink-0">
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-20 h-[var(--footer-navigation-height)] border-t border-divider bg-surface pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="mx-auto grid h-full max-w-4xl grid-cols-4">
          {destinations.map(({ label, href, icon }) => (
            <NavigationLink
              key={label}
              href={href}
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
            </NavigationLink>
          ))}
        </div>
      </nav>
    </footer>
  );
}
