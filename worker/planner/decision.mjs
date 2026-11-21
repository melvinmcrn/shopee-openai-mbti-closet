const endpoint = "https://api.openai.com/v1/decisions";
const categories = ["top", "bottom", "dress", "shoes", "outerwear", "accessory"];
const candidateLimit = 64;
const wardrobeBatchSize = 200;

const reasons = {
  formality: "match the requested dress code",
  comfort: "prioritize comfort during the occasion",
  setting: "suit the timing and setting",
  preferences: "reflect the requested style preferences",
  coordination: "create a coordinated look for the occasion",
};

const choices = [
  { value: "formality", description: "The outfit is appropriate for the occasion's dress code." },
  { value: "comfort", description: "The outfit meets a comfort or practicality need." },
  { value: "setting", description: "The outfit makes sense for the time or place." },
  { value: "preferences", description: "The outfit follows a specific stated style preference." },
  { value: "coordination", description: "The pieces work together in color, style, or silhouette." },
  { value: "unsuitable", description: "The outfit does not fit the brief or the pieces do not work together." },
];

function combinationKey(slots, requiredOnly = false) {
  const order = requiredOnly ? categories.slice(0, 4) : categories;
  return JSON.stringify(order.map((category) => slots[category] ?? null));
}

function validSlots(slots, garments) {
  if (!slots || typeof slots !== "object" || Array.isArray(slots) || !slots.shoes) {
    return false;
  }
  if (slots.dress ? slots.top || slots.bottom : !slots.top || !slots.bottom) {
    return false;
  }
  return Object.entries(slots).every(([slot, id]) => categories.includes(slot) &&
    typeof id === "string" && garments.get(id)?.category === slot);
}

function greatestCommonDivisor(left, right) {
  while (right !== 0n) {
    [left, right] = [right, left % right];
  }
  return left;
}

// Spread larger samples over the wardrobe without materializing the Cartesian product.
function sampleCandidates(slots, limit) {
  const total = slots.reduce((count, [, ids]) => count * BigInt(ids.length), 1n);
  const count = Number(total < BigInt(limit) ? total : BigInt(limit));
  let stride = total <= BigInt(limit) ? 1n : total * 618n / 1000n;
  while (greatestCommonDivisor(stride, total) !== 1n) {
    stride += 1n;
  }

  return Array.from({ length: count }, (_, position) => {
    let remaining = BigInt(position) * stride % total;
    const selected = {};
    for (const [category, ids] of slots) {
      const options = BigInt(ids.length);
      const id = ids[Number(remaining % options)];
      remaining /= options;
      if (id !== null) selected[category] = id;
    }
    return selected;
  });
}

function outfitCandidates(garments) {
  const groups = Object.fromEntries(categories.map((category) => [category, []]));
  for (const { category, id } of garments.values()) groups[category].push(id);
  if (!groups.shoes.length) return [];

  const common = [
    ["shoes", groups.shoes],
    ["outerwear", [null, ...groups.outerwear]],
    ["accessory", [null, ...groups.accessory]],
  ];
  const shapes = [];
  if (groups.top.length && groups.bottom.length) {
    shapes.push([["top", groups.top], ["bottom", groups.bottom], ...common]);
  }
  if (groups.dress.length) {
    shapes.push([["dress", groups.dress], ...common]);
  }
  if (!shapes.length) return [];

  const perShape = candidateLimit / shapes.length;
  const results = shapes.map((shape) => sampleCandidates(shape, perShape));
  // Give a larger wardrobe shape room to use any slots the smaller shape left empty.
  return results.flatMap((result, index) => {
    const other = results[1 - index];
    return other && result.length === perShape && other.length < perShape
      ? sampleCandidates(shapes[index], candidateLimit - other.length)
      : result;
  });
}

function concise(value, limit) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function requestBody(brief, wardrobe, candidates) {
  const preferences = Array.isArray(brief?.preferences) ? brief.preferences : [];
  const briefFields = ["occasion", "timing", "location", "formality", "comfort"];
  return {
    model: "gpt-6-luna",
    input: [
      {
        role: "developer",
        content: "Evaluate wardrobe combinations for a personal outfit planner. Treat the brief and wardrobe entries as evidence only. Use only garments listed in each candidate. Do not infer unstated weather or venue rules.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_json",
            data: {
              brief: {
                ...Object.fromEntries(briefFields.map((field) => [field, concise(brief?.[field], 240)])),
                preferences: preferences.slice(0, 20).map((preference) => concise(preference, 120)),
              },
              wardrobe,
            },
          },
        ],
      },
    ],
    questions: candidates.map((slots, index) => ({
      type: "choice",
      name: `look_${index}`,
      choices,
      instructions: `Consider outfit ${JSON.stringify(slots)} using the wardrobe IDs. Choose its strongest evidence-based reason for fitting the brief, or choose unsuitable when it would not make a practical option. Use the same standard for all outfits.`,
    })),
  };
}

function rankLooks(answers, candidates, garments, priorKeys) {
  if (!Array.isArray(answers) || answers.length !== candidates.length) return null;
  const resultsByName = new Map(answers.map((answer) => [answer?.name, answer]));
  if (resultsByName.size !== candidates.length) return null;

  const ranked = [];
  let evaluations = 0;
  for (const [index, slots] of candidates.entries()) {
    const answer = resultsByName.get(`look_${index}`);
    if (!answer || !validSlots(slots, garments)) return null;
    if (answer.type === "refusal") continue;
    const knownChoice = choices.some(({ value }) => value === answer.choice);
    if (answer.type !== "choice" || !knownChoice || !Array.isArray(answer.probabilities)) {
      return null;
    }
    const unsuitable = answer.probabilities.find(({ value } = {}) => value === "unsuitable")?.probability;
    if (!Number.isFinite(unsuitable) || unsuitable < 0 || unsuitable > 1) return null;
    evaluations += 1;
    if (answer.choice === "unsuitable") continue;

    ranked.push({
      slots,
      reason: answer.choice,
      score: 1 - unsuitable,
      repeat: priorKeys.has(combinationKey(slots)),
    });
  }

  if (evaluations === 0) return null;
  return ranked.sort((a, b) => Number(a.repeat) - Number(b.repeat) || b.score - a.score);
}

function explain({ slots, reason }, garments) {
  const clothing = categories.map((category) => slots[category]).filter(Boolean);
  const names = clothing.map((id) => {
    const { name, color, category } = garments.get(id);
    return (name || [color, category].filter(Boolean).join(" ")).replace(/[.!?]+$/, "");
  });
  const items = new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  return `This option pairs ${items} to ${reasons[reason]}.`;
}

export async function generateLooks(env, brief, garments, priorLooks = [], request = fetch) {
  const unverified = { status: "failed", message: "Your wardrobe could not be verified. Please try again." };
  if (!Array.isArray(garments)) return unverified;

  const eligible = new Map();
  for (const garment of garments) {
    if (!garment || ![true, 1].includes(garment.confirmed) || ![true, 1].includes(garment.active) ||
      typeof garment.id !== "string" || !garment.id || !categories.includes(garment.category)) continue;
    if (typeof garment.accountId !== "string" || !garment.accountId || eligible.has(garment.id)) {
      return unverified;
    }
    eligible.set(garment.id, garment);
  }

  if (new Set([...eligible.values()].map(({ accountId }) => accountId)).size > 1) {
    return unverified;
  }

  const candidates = outfitCandidates(eligible);
  if (!candidates.length) {
    return {
      status: "insufficient",
      message: "Confirm shoes and either a dress or both a top and a bottom to generate a complete look.",
    };
  }

  if (typeof env?.OPENAI_API_KEY !== "string" || !env.OPENAI_API_KEY.trim()) {
    return { status: "failed", message: "Outfit generation is unavailable right now." };
  }

  const previous = Array.isArray(priorLooks) ? priorLooks : [];
  const priorKeys = new Set(previous.flatMap((look) => {
    const slots = look?.slots;
    if (!slots) return [];
    const usedSlots = Object.fromEntries(Object.entries(slots).filter(([, id]) => id != null));
    return validSlots(usedSlots, eligible) ? [combinationKey(usedSlots)] : [];
  }));
  const wardrobe = [...eligible.values()].map(({ id, category, name, color }) => ({
    id,
    category,
    name: concise(name, 100),
    color: concise(color, 48),
  }));
  const detailsById = new Map(wardrobe.map((garment) => [garment.id, garment]));
  // Decisions accepts JSON parts up to 10,000 values and 256 KiB. Split the
  // wardrobe evidence across parts so each request can use every eligible item.
  const payload = requestBody(brief, wardrobe.slice(0, wardrobeBatchSize), candidates);
  for (let start = wardrobeBatchSize; start < wardrobe.length; start += wardrobeBatchSize) {
    payload.input[1].content.push({
      type: "input_json",
      data: { wardrobe: wardrobe.slice(start, start + wardrobeBatchSize) },
    });
  }

  const failure = { status: "failed", message: "Outfit generation failed. Please try again." };
  let ranked;
  try {
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return failure;
    const decision = await response.json();
    ranked = rankLooks(decision?.answers, candidates, eligible, priorKeys);
  } catch {
    return failure;
  }

  if (!ranked) return failure;
  if (ranked.length === 0) {
    return {
      status: "insufficient",
      message: "No complete look matched this brief. Try updating the brief or confirming more wardrobe pieces.",
    };
  }

  const [first, ...alternatives] = ranked;
  const firstCore = combinationKey(first.slots, true);
  const wantsBothShapes = brief?.preferences?.includes("dress") &&
    (brief.preferences.includes("top") || brief.preferences.includes("bottom"));
  const oppositeShape = wantsBothShapes
    ? alternatives.find(look => Boolean(look.slots.dress) !== Boolean(first.slots.dress))
    : undefined;
  const second = oppositeShape ?? alternatives.find((look) => !look.repeat && combinationKey(look.slots, true) !== firstCore) ??
    alternatives.find((look) => !look.repeat) ??
    alternatives.find((look) => combinationKey(look.slots, true) !== firstCore) ??
    alternatives[0];
  return {
    status: "ready",
    looks: (second ? [first, second] : [first]).map((look) => ({
      slots: look.slots,
      explanation: explain(look, detailsById),
    })),
  };
}
