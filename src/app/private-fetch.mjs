export const sessionEnded = "closet:session-ended";

export function checkSessionStatus(status) {
  if (status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(sessionEnded));
  }
}

/** @param {RequestInfo | URL} input @param {RequestInit} [options] */
export async function privateFetch(input, options) {
  const response = await fetch(input, options);
  checkSessionStatus(response.status);
  return response;
}
