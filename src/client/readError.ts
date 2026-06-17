import type { ApiError } from "../shared/bookmarks";

// The API returns errors as JSON: { "error": "message" }. Fall back to a generic
// message when the body is missing or not JSON so the UI never breaks with a
// second exception.
export const readError = async (response: Response) => {
  try {
    const body = (await response.json()) as ApiError;
    return body.error || "Request failed.";
  } catch {
    return "Request failed.";
  }
};
