import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const readScreen = () => window.location.hash.slice(1) || "home";
const initialScreen = () => "home";

export function usePlannerScreen(inPlanner = true) {
  // Switching readers on planner entry also checks the hash after Next commits the URL.
  return useSyncExternalStore(subscribe, inPlanner ? readScreen : initialScreen, initialScreen);
}
