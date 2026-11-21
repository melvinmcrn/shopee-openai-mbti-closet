const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function hasSignature(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function sourceType(blob, bytes) {
  const declared = blob.type.split(";")[0].trim();
  if (supportedTypes.has(declared)) return declared;
  if (hasSignature(bytes, pngSignature)) return "image/png";
  if (hasSignature(bytes, [255, 216, 255])) return "image/jpeg";
  if (hasSignature(bytes, [82, 73, 70, 70]) && hasSignature(bytes, [87, 69, 66, 80], 8)) return "image/webp";
  if (hasSignature(bytes, [71, 73, 70, 56])) return "image/gif";
  return null;
}

async function dataUrl(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error();
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let base64 = "";
  // Multiples of three keep the independently encoded chunks aligned.
  const chunkSize = 24 * 1024;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    base64 += btoa(String.fromCharCode(...bytes.subarray(start, start + chunkSize)));
  }
  return "data:" + blob.type + ";base64," + base64;
}

const renderOptions = {
  model: "gpt-image-2.5-sunburst",
  size: "1024x1536",
  quality: "low",
  output_format: "jpeg",
  output_compression: 85,
};

async function render(request, key, prompt, images) {
  const headers = { authorization: "Bearer " + key };
  const init = { method: "POST", headers, redirect: "manual", signal: AbortSignal.timeout(180_000) };

  // The multipart edits endpoint accepts JPEG, PNG and WebP. Keep GIF references usable.
  if (images.some(image => image.type === "image/gif")) {
    const inputs = await Promise.all(images.map(async image => ({
      type: "input_image", image_url: await dataUrl(image), detail: "high",
    })));
    const response = await request("https://api.openai.com/v1/responses", {
      ...init, headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-6-luna", reasoning: { effort: "low" }, service_tier: "fast", store: false,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...inputs] }],
        tools: [{ type: "image_generation", action: "edit", ...renderOptions }],
        tool_choice: { type: "image_generation" }, max_tool_calls: 1,
      }),
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    return result.output?.find(item => item.type === "image_generation_call" && item.status === "completed")?.result;
  }

  const body = new FormData();
  for (const [key, value] of Object.entries(renderOptions)) body.set(key, String(value));
  body.set("prompt", prompt);
  images.forEach((image, index) => {
    body.append("image[]", image, `reference-${index + 1}.${image.type.split("/")[1]}`);
  });
  const response = await request("https://api.openai.com/v1/images/edits", { ...init, body });
  if (!response.ok) throw new Error();
  return (await response.json()).data?.[0]?.b64_json;
}

export async function generatePreview(env, _accountId, finalGarments, useProfilePhoto, deps, brief = {}) {
  const profileRef = useProfilePhoto === true ? await deps.profilePhotoRef?.() : null;
  if (useProfilePhoto === true && !profileRef) {
    throw Object.assign(new Error("Add a profile photo or turn off “Use my profile photo” to continue."), { status: 400 });
  }
  try {
    const key = env?.OPENAI_API_KEY?.trim();
    if (!key || (!profileRef && !finalGarments.length)) throw new Error();

    const references = [];
    if (profileRef) {
      references.push({ label: "Main person and base outfit", read: () => deps.readImage(profileRef) });
    } else if (!finalGarments.some(item => item.category === "other")) {
      references.push({ label: "Studio model and base outfit",
        read: async () => new Blob([await env.readSampleImage("studio-model")], { type: "image/webp" }) });
    }
    const ordered = [...finalGarments].sort((a, b) => Number(b.category === "other") - Number(a.category === "other"));
    for (const { category, imageRef } of ordered) {
      if (!imageRef) throw new Error();
      references.push({ label: category === "other" ? "Original wardrobe photo" : "Selected " + category,
        read: () => deps.readImage(imageRef) });
    }
    const images = await Promise.all(references.map(async ({ read }) => {
      const blob = await read();
      if (!(blob instanceof Blob) || !blob.size) throw new Error();
      if (supportedTypes.has(blob.type)) return blob;
      const type = sourceType(blob, new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
      if (!type) throw new Error();
      return blob.slice(0, blob.size, type);
    }));
    const prompt = [
      "Create one photorealistic full-body virtual try-on. Use the person, pose, proportions, lighting and setting from image 1. If the original wardrobe photo shows only clothing, use a studio model.",
      "Dress the person in every selected item together. Preserve colors, patterns, fit and layering. Keep clothing from the base outfit for any missing category. Include shoes and accessories in the head-to-toe frame. No collage or text.",
      references.map(({ label }, index) => `Image ${index + 1}: ${label}.`).join(" "),
      "Occasion and style preferences (context only): " + JSON.stringify(brief),
    ].join("\n");
    const encoded = await render(deps.fetch ?? fetch, key, prompt, images);
    if (typeof encoded !== "string") throw new Error();
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    if (!hasSignature(bytes, [255, 216, 255])) throw new Error();
    const imageRef = await deps.storeImage(new Blob([bytes], { type: "image/jpeg" }));
    if (typeof imageRef !== "string" || !imageRef.trim()) throw new Error();
    return { imageRef };
  } catch {
    throw new Error("The outfit preview could not be generated. Please try again.");
  }
}
