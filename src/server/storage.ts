import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fetchWithTimeout, readLimitedBody } from "./fetch";
import { extractOgImageUrl } from "./ogp";

const MAX_OGP_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Restrict to common raster formats only — SVG is excluded because it can embed scripts,
// and unknown MIME types may not be valid images safe to serve to browsers
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// Returns "" on any failure so a missing OGP image never blocks bookmark creation
export const storeOgpImage = async (
  pageUrl: string,
  storageDir: string,
  fetcher: typeof fetch = fetch
): Promise<string> => {
  try {
    const htmlResponse = await fetchWithTimeout(pageUrl, fetcher, "text/html", 5000);
    if (!htmlResponse) {
      return "";
    }

    const contentType = htmlResponse.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return "";
    }

    const htmlBytes = await readLimitedBody(htmlResponse, MAX_OGP_HTML_BYTES);
    if (!htmlBytes) {
      return "";
    }

    const html = new TextDecoder().decode(htmlBytes);
    const imageUrl = extractOgImageUrl(html, pageUrl);
    if (!imageUrl) {
      return "";
    }

    const imageResponse = await fetchWithTimeout(imageUrl, fetcher, "image/*", 5000);
    if (!imageResponse) {
      return "";
    }

    const imageMime = (imageResponse.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
    const ext = ALLOWED_IMAGE_TYPES[imageMime];
    if (!ext) {
      return "";
    }

    // readLimitedBody returns null for empty bodies and bodies exceeding MAX_IMAGE_BYTES
    const imageBytes = await readLimitedBody(imageResponse, MAX_IMAGE_BYTES);
    if (!imageBytes) {
      return "";
    }

    mkdirSync(storageDir, { recursive: true });
    const filename = `${randomUUID()}.${ext}`;
    writeFileSync(join(storageDir, filename), imageBytes);
    return `/ogp/${filename}`;
  } catch {
    return "";
  }
};
