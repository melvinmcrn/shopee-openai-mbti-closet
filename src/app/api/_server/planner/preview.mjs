import { profilePhotoType } from "../profile-photo-image.mjs";

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

export class PreviewInputError extends Error {
  constructor(code, message) {
    super(message);
    this.status = 422;
    this.code = code;
  }
}

function photoRequired() {
  return new PreviewInputError("profile_photo_required", "Add or replace your profile photo to create a try-on.");
}

function photoChanged() {
  return new PreviewInputError("profile_photo_changed", "Your profile photo changed. Try again with your current photo.");
}

async function readProfileImage(deps, ref) {
  try {
    const blob = await deps.readImage(ref);
    const type = await profilePhotoType(blob);
    if (!type) throw new Error();
    return blob.slice(0, blob.size, type);
  } catch {
    throw photoRequired();
  }
}

export async function generatePreview(env, finalGarments, useProfilePhoto, deps, brief = {}) {
  if (useProfilePhoto !== undefined && useProfilePhoto !== true) {
    throw new PreviewInputError("profile_photo_permission_required", "Choose to generate the try-on with your profile photo.");
  }

  const profileRef = await deps.profilePhotoRef?.();
  if (!profileRef) throw photoRequired();
  const profileImage = await readProfileImage(deps, profileRef);
  async function requireCurrentProfile() {
    if (await deps.profilePhotoRef() !== profileRef) throw photoChanged();
  }

  try {
    const cached = await deps.cachedImage?.(profileRef);
    await requireCurrentProfile();
    if (cached) return { imageRef: cached };

    const key = env?.OPENAI_API_KEY?.trim();
    if (!key) throw new Error();

    const references = [{
      label: "The signed-in user's profile photo, the only identity reference",
      read: () => profileImage,
    }];
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
      "Create one photorealistic full-body virtual try-on of the person in image 1, the required user profile photo. Preserve their recognizable likeness, hair, skin tone, and visible proportions. If the profile photo is cropped or a headshot, extend the scene and use plausible anatomy for parts not shown. Do not substitute a model, blend identities, or use a person in any garment reference as the subject.",
      "All other references are for clothing only. Dress the profile-photo subject in the selected pieces, preserving colors, patterns and layering. For unselected categories, preserve the visible base outfit; if coverage is needed and no reference shows it, use a simple, unbranded basic that suits the occasion. Include selected footwear and accessories in the head-to-toe frame. No collage or text.",
      references.map(({ label }, index) => `Image ${index + 1}: ${label}.`).join(" "),
      "Occasion and style preferences (context only): " + JSON.stringify(brief),
    ].join("\n");
    await requireCurrentProfile();
    const encoded = await render(deps.fetch ?? fetch, key, prompt, images);
    if (typeof encoded !== "string") throw new Error();
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    if (!hasSignature(bytes, [255, 216, 255])) throw new Error();
    await requireCurrentProfile();
    const imageRef = await deps.storeImage(new Blob([bytes], { type: "image/jpeg" }), profileRef);
    await requireCurrentProfile();
    if (typeof imageRef !== "string" || !imageRef.trim()) throw new Error();
    return { imageRef };
  } catch (error) {
    if (error instanceof PreviewInputError) throw error;
    throw new Error("The outfit preview could not be generated. Please try again.");
  }
}
