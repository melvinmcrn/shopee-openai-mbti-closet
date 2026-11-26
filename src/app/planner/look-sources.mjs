export function sourceLabel(slots, clothes, shopee) {
  const ownedSlots = [...Object.keys(slots).filter(slot => slot !== "other"), ...(clothes?.original ?? [])];
  const count = ownedSlots.length;
  const owned = count ? `${count} owned piece${count === 1 ? "" : "s"}` : "";
  if (shopee === undefined) return owned;
  const fromProfile = Boolean(clothes?.profile.length);
  const hasOwnedBase = ownedSlots.includes("dress") || (ownedSlots.includes("top") && ownedSlots.includes("bottom"));
  if (hasOwnedBase && !fromProfile && !shopee) return "All from your closet";
  return [
    owned,
    fromProfile ? "Clothes from your profile photo" : "",
    shopee ? `${shopee} Shopee item${shopee === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ") || "Try-on basics";
}
