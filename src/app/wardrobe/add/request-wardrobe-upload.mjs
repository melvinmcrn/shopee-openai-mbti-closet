import { checkSessionStatus, privateFetch } from "../../private-fetch.mjs";

/**
 * @param {string} draftKey
 * @param {File} [image]
 */
export function requestWardrobeUpload(draftKey, image) {
  const body = new FormData();
  body.set("draftKey", draftKey);
  if (image) body.set("image", image);
  return privateFetch("/api/wardrobe/upload", { method: "POST", body });
}

/** @typedef {{draftKey: string, image?: File}} BatchEntry */
/** @typedef {{phase: "uploading", percent?: number} | {phase: "processing"}} BatchProgress */

/**
 * Upload one multipart body. XHR reports real bytes sent; after its upload
 * finishes, server-side garment extraction has no measurable percentage.
 * @param {BatchEntry[]} entries
 * @param {(progress: BatchProgress) => void} onProgress
 * @param {AbortSignal} [signal]
 * @returns {Promise<{status: number, body: unknown}>}
 */
export function requestWardrobeUploadBatch(entries, onProgress, signal) {
  const body = new FormData();
  body.set("batch", JSON.stringify(entries.map(({ draftKey }) => draftKey)));
  for (const { draftKey, image } of entries) {
    if (image) {
      // Bound the multipart overhead even when the selected filenames are very long.
      body.set(`image:${draftKey}`, image, `${draftKey}.${image.type === "image/png" ? "png" : "jpg"}`);
    }
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }

    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const fail = (message) => {
      cleanup();
      reject(new Error(message));
    };
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress({ phase: "uploading", percent: Math.floor(100 * event.loaded / event.total) });
      }
    });
    xhr.upload.addEventListener("load", () => onProgress({ phase: "processing" }));
    xhr.addEventListener("load", () => {
      cleanup();
      checkSessionStatus(xhr.status);
      resolve({ status: xhr.status, body: xhr.response });
    });
    xhr.addEventListener("error", () => fail("Wardrobe upload connection failed"));
    xhr.addEventListener("timeout", () => fail("Wardrobe upload timed out"));
    xhr.addEventListener("abort", () => fail("Wardrobe upload was aborted"));
    xhr.open("POST", "/api/wardrobe/upload");
    xhr.responseType = "json";
    xhr.timeout = 210_000;
    signal?.addEventListener("abort", abort, { once: true });
    onProgress({ phase: "uploading" });
    try {
      xhr.send(body);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
