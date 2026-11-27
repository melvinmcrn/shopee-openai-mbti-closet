type Activity = "open" | "setup" | "planner" | "reopen" | "wear";

export function observeJourney(accountId: string | number, activity: Activity) {
  void fetch("/api/journey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: String(accountId), activity }),
    keepalive: true,
  }).catch(() => {});
}

export function listenForJourneyOutcomes(accountId: string | number) {
  function resume(event: Event) {
    const journey = (event as CustomEvent).detail?.journey;
    if (journey === "setup" || journey === "planner") observeJourney(accountId, journey);
  }
  const reopen = () => observeJourney(accountId, "reopen");
  const wear = () => observeJourney(accountId, "wear");
  const navigate = () => { if (document.visibilityState === "visible") observeJourney(accountId, "open"); };
  window.addEventListener("closet:journey-resumed", resume);
  window.addEventListener("closet:saved-look-reopened", reopen);
  window.addEventListener("closet:wear-logged", wear);
  window.addEventListener("hashchange", navigate);
  return () => {
    window.removeEventListener("closet:journey-resumed", resume);
    window.removeEventListener("closet:saved-look-reopened", reopen);
    window.removeEventListener("closet:wear-logged", wear);
    window.removeEventListener("hashchange", navigate);
  };
}
