import assert from "node:assert/strict";
import test from "node:test";
import { generateLooks } from "../src/app/api/_server/planner/decision.mjs";

const env = { OPENAI_API_KEY: "test-key" };
const brief = {
  occasion: "Gallery opening",
  timing: "Evening",
  location: "Indoors",
  formality: "Smart casual",
  comfort: "Standing for two hours",
  preferences: ["dress", "top", "bottom"],
};

function garment(id, category, name, fields = {}) {
  return { id, category, name, color: "Black", accountId: "owner", confirmed: true, active: true, ...fields };
}

const top = garment("top-1", "top", "Silk shirt");
const bottom = garment("bottom-1", "bottom", "Wide-leg trousers");
const dress = garment("dress-1", "dress", "Column dress");
const shoes = garment("shoes-1", "shoes", "Loafers");
const outerwear = garment("outerwear-1", "outerwear", "Blazer");
const wardrobe = [top, bottom, dress, shoes, outerwear];

function slotsFor(question) {
  return JSON.parse(question.instructions.match(/\{[^{}]+\}/u)[0]);
}

function responseAnswer(question, choice, unsuitable) {
  return {
    name: question.name,
    type: "choice",
    choice,
    probabilities: [
      { value: choice === "unsuitable" ? "coordination" : choice, probability: 1 - unsuitable },
      { value: "unsuitable", probability: unsuitable },
    ],
  };
}

function mockDecisions(select) {
  const calls = [];
  const request = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    return Response.json({
      answers: body.questions.map((question) => select(question, slotsFor(question))).reverse(),
    });
  };
  return { calls, request };
}

test("evaluates dresses and separates together using only confirmed, active garments", async () => {
  const ignored = [
    garment("pending-top", "top", "Unconfirmed top", { confirmed: false }),
    garment("retired-dress", "dress", "Inactive dress", { active: false }),
  ];
  const provider = mockDecisions((question, slots) =>
    responseAnswer(question, "formality", slots.dress ? 0.3 : slots.outerwear ? 0.2 : 0.1),
  );

  const result = await generateLooks(env, brief, [...wardrobe, ...ignored], [], provider.request);

  assert.equal(provider.calls.length, 1);
  const [{ url, options, body }] = provider.calls;
  assert.equal(url, "https://api.openai.com/v1/decisions");
  assert.equal(options.method, "POST");
  assert.equal(new Headers(options.headers).get("authorization"), "Bearer test-key");
  const evidence = body.input.find(({ role }) => role === "user").content[0];
  assert.equal(evidence.type, "input_json");
  assert.deepEqual(evidence.data.brief, brief);
  assert.deepEqual(evidence.data.wardrobe.map(({ id }) => id).sort(), wardrobe.map(({ id }) => id).sort());
  assert.equal(body.questions.length, 4);
  assert.equal(body.questions.every(({ type }) => type === "choice"), true);
  const candidates = body.questions.map(slotsFor);
  assert.equal(candidates.filter(({ dress: dressId }) => dressId).length, 2);
  assert.equal(candidates.filter(({ top: topId, bottom: bottomId }) => topId && bottomId).length, 2);
  for (const slots of candidates) {
    assert.equal(slots.shoes, shoes.id);
    assert.equal(Boolean(slots.dress), !slots.top && !slots.bottom);
    for (const [category, id] of Object.entries(slots)) {
      assert.equal(wardrobe.find((item) => item.id === id)?.category, category);
    }
  }

  assert.equal(result.status, "ready");
  assert.deepEqual(result.looks.map(({ slots }) => slots), [
    { top: top.id, bottom: bottom.id, shoes: shoes.id },
    { dress: dress.id, shoes: shoes.id },
  ]);
  assert.match(result.looks[0].explanation, /Silk shirt.*Wide-leg trousers.*Loafers.*dress code/u);
  assert.match(result.looks[1].explanation, /Column dress.*Loafers.*dress code/u);
});

test("prefers two fresh alternatives to a previously shown, higher-scoring look", async () => {
  const priorLook = { slots: { dress: dress.id, shoes: shoes.id }, explanation: "Prior look" };
  const provider = mockDecisions((question, slots) =>
    responseAnswer(question, "coordination", slots.dress ? 0.01 : 0.3),
  );

  const result = await generateLooks(env, brief, wardrobe, [priorLook], provider.request);

  assert.equal(result.status, "ready");
  assert.deepEqual(result.looks.map(({ slots }) => slots), [
    { dress: dress.id, shoes: shoes.id, outerwear: outerwear.id },
    { top: top.id, bottom: bottom.id, shoes: shoes.id },
  ]);
});

test("returns one complete look when the other candidate is unsuitable", async () => {
  const provider = mockDecisions((question, slots) => slots.dress
    ? responseAnswer(question, "comfort", 0.15)
    : responseAnswer(question, "unsuitable", 0.95),
  );

  const result = await generateLooks(env, brief, [top, bottom, dress, shoes], [], provider.request);

  assert.equal(result.status, "ready");
  assert.equal(result.looks.length, 1);
  assert.deepEqual(result.looks[0].slots, { dress: dress.id, shoes: shoes.id });
  assert.match(result.looks[0].explanation, /comfort/u);
});

test("reports zero viable looks when Decisions marks every candidate unsuitable", async () => {
  const provider = mockDecisions((question) => responseAnswer(question, "unsuitable", 0.95));

  const result = await generateLooks(env, brief, [dress, shoes], [], provider.request);

  assert.equal(provider.calls.length, 1);
  assert.equal(result.status, "insufficient");
  assert.match(result.message, /No look matched/u);
  assert.equal(result.looks, undefined);
});

test("reports an insufficient wardrobe before contacting Decisions", async () => {
  const provider = mockDecisions((question) => responseAnswer(question, "formality", 0.1));

  const result = await generateLooks(env, brief, [{ ...shoes, confirmed: false }], [], provider.request);

  assert.equal(provider.calls.length, 0);
  assert.equal(result.status, "insufficient");
  assert.match(result.message, /confirm a wardrobe photo/u);
  assert.equal(result.looks, undefined);
});

test("each supported category can generate a look on its own", async () => {
  const accessory = garment("bag-1", "accessory", "Bag");
  for (const item of [...wardrobe, accessory]) {
    const provider = mockDecisions((question) => responseAnswer(question, "preferences", 0.1));
    const result = await generateLooks(env, brief, [item], [], provider.request);
    assert.equal(result.status, "ready", item.category);
    assert.deepEqual(result.looks.map(({ slots }) => slots), [{ [item.category]: item.id }]);
  }
});

test("rejects an invalid Decisions response without returning any partial looks", async (context) => {
  const invalidResponses = {
    "missing evaluation": (answers) => answers.slice(0, 1),
    "unexpected choice": ([first, second]) => [first, { ...second, choice: "invented-reason" }],
    "invalid probability": ([first, second]) => [first, { ...second, probabilities: [{ value: "unsuitable", probability: -0.1 }] }],
  };

  for (const [label, invalidate] of Object.entries(invalidResponses)) {
    await context.test(label, async () => {
      const request = async (_url, options) => {
        const { questions } = JSON.parse(options.body);
        const answers = questions.map((question) => responseAnswer(question, "coordination", 0.2));
        return Response.json({ answers: invalidate(answers) });
      };

      const result = await generateLooks(env, brief, [top, bottom, dress, shoes], [], request);

      assert.equal(result.status, "failed");
      assert.equal(result.looks, undefined);
    });
  }
});

test("reports provider errors as generation failures", async (context) => {
  await context.test("HTTP error", async () => {
    const request = async () => new Response(null, { status: 503 });
    const result = await generateLooks(env, brief, [dress, shoes], [], request);

    assert.equal(result.status, "failed");
    assert.equal(result.looks, undefined);
  });

  await context.test("transport error", async () => {
    const request = async () => {
      throw new TypeError("Network failed");
    };
    const result = await generateLooks(env, brief, [dress, shoes], [], request);

    assert.equal(result.status, "failed");
    assert.equal(result.looks, undefined);
  });
});
