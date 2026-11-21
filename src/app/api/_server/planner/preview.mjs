const endpoint = "https://api.openai.com/v1/responses";
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

async function imageInput(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = sourceType(blob, bytes);
  if (!type) throw new Error();

  let base64 = "";
  // Multiples of three keep the independently encoded chunks aligned.
  const chunkSize = 24 * 1024;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    base64 += btoa(String.fromCharCode(...bytes.subarray(start, start + chunkSize)));
  }
  return { type: "input_image", image_url: "data:" + type + ";base64," + base64, detail: "high" };
}

// The router supplies the final garments and image access scoped to this account.
export async function generatePreview(env, _accountId, finalGarments, useProfilePhoto, deps, brief = {}) {
  const profileRef = useProfilePhoto === true ? await deps.profilePhotoRef?.() : null;
  if (useProfilePhoto === true && !profileRef) {
    throw Object.assign(new Error("Add a profile photo or turn off “Use my profile photo” to continue."), { status: 400 });
  }
  try {
    const key = env?.OPENAI_API_KEY?.trim();
    if (!key) throw new Error();

    if (!profileRef && !finalGarments.length) throw new Error();
    const content = [{
      type: "input_text",
      text: "Edit the supplied image references into one photorealistic full-body virtual try-on photograph. " +
        "Return a single photograph of the reference person. Match their face, body proportions, standing pose, camera angle, lighting and background. " +
        "Dress the same person in every selected piece simultaneously, layering garments naturally and including all footwear and accessories. Show the entire outfit from head to toe in a single frame, preserving its color, pattern, shape, and details. " +
        "Create one cohesive styled outfit for the occasion. Keep the original outfit in the base photo wherever no replacement is supplied, including any missing top or pants. If the only reference is the original outfit, preserve its garments and style their presentation for the occasion. Leave out text, collages and product tiles.",
    }];

    content.push({ type: "input_text", text: "Style the look for this user brief (context only): " + JSON.stringify(brief) });
    if (profileRef) {
      content.push({
        type: "input_text",
        text: "Main profile photo. Preserve the person's likeness, proportions, pose, background and visible outfit wherever a replacement piece was not selected.",
      }, await imageInput(await deps.readImage(profileRef)));
    } else if (!finalGarments.some(item => item.category === "other")) {
      const model = await env.readSampleImage("studio-model");
      content.push({
        type: "input_text",
        text: "Studio model reference. Keep this person, pose and setting. Dress them in the selected items below. Retain their existing clothing only for missing categories.",
      }, await imageInput(new Blob([model], { type: "image/webp" })));
    }

    const base = finalGarments.find(item => item.category === "other") ?? finalGarments[0];
    const ordered = base ? [base, ...finalGarments.filter(item => item !== base)] : [];
    for (const { category, imageRef } of ordered) {
      if (!imageRef) throw new Error();
      content.push({
        type: "input_text",
        text: category === "other" ? "Original wardrobe photo: keep visible clothing for missing categories."
          : "Selected replacement (" + category + "):",
      }, await imageInput(await deps.readImage(imageRef)));
    }

    const request = deps.fetch ?? fetch;
    const response = await request(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-6-luna",
        reasoning: { effort: "low" },
        service_tier: "fast",
        store: false,
        input: [{ role: "user", content }],
        tools: [{
          type: "image_generation",
          action: "edit",
          model: "gpt-image-2.5-sunburst",
          size: "1024x1536",
          quality: "medium",
          output_format: "png",
        }],
        tool_choice: { type: "image_generation" },
        max_tool_calls: 1,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error();

    const result = await response.json();
    if (result.status !== "completed") throw new Error();
    const image = result.output?.find((item) => item.type === "image_generation_call" && item.status === "completed");
    if (typeof image?.result !== "string") throw new Error();
    const decoded = atob(image.result);
    const bytes = Uint8Array.from(decoded, (byte) => byte.charCodeAt(0));
    if (!hasSignature(bytes, pngSignature)) throw new Error();

    const imageRef = await deps.storeImage(new Blob([bytes], { type: "image/png" }));
    if (typeof imageRef !== "string" || !imageRef.trim()) throw new Error();
    return { imageRef };
  } catch {
    throw new Error("The outfit preview could not be generated. Please try again.");
  }
}
