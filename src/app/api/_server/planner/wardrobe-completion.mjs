// An original outfit photo supplies the clothes; a profile can also show garments outside its crop.
export function combineBaseCoverage(profile, original) {
  if (!original) return profile ?? null;
  if (!profile) return original;
  const supplement = retainedBaseCategories(profile, original);
  return Object.fromEntries(Object.keys(original).map(slot => [slot, original[slot] || supplement[slot]]));
}

export function retainedBaseCategories(coverage, slots) {
  if (!coverage) return null;
  const visible = { ...coverage };
  for (const [slot, item] of Object.entries(slots)) {
    if (item) visible[slot] = false;
  }
  if (slots.top || slots.bottom) visible.dress = false;
  if (slots.dress) visible.top = visible.bottom = false;
  return visible;
}

export function effectiveWardrobeSlots(slots, wardrobe, coverage) {
  if (!coverage) return slots;
  const result = { ...slots };
  const visible = retainedBaseCategories(coverage, slots);
  const owned = category => wardrobe.find(item => item.category === category && item.imageRef);
  const addMissing = category => {
    if (result[category] || visible[category]) return;
    const item = owned(category);
    if (item) result[category] = item;
  };
  if (!slots.dress && !visible.dress) {
    const canUseDress = !slots.top && !visible.top && !slots.bottom && !visible.bottom;
    const dress = canUseDress && owned("dress");
    if (dress && !(owned("top") && owned("bottom"))) {
      result.dress = dress;
    } else {
      addMissing("top");
      addMissing("bottom");
    }
  }
  addMissing("shoes");
  return result;
}
