// Matches property or name attribute set to og:image or og:image:url.
// Lookahead ensures we don't accidentally match og:image:type, og:image:width, etc.
const OGP_IMAGE_PROP = /(?:property|name)\s*=\s*["']?og:image(?::url)?(?=["'\s>\\/]|$)/i;
const CONTENT_ATTR = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i;

export const extractOgImageUrl = (html: string, baseUrl: string): string | null => {
  // Create per-call regex to avoid shared lastIndex state when the caller returns early
  const metaPattern = /<meta\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html)) !== null) {
    const attrs = match[1];

    if (!OGP_IMAGE_PROP.test(attrs)) {
      continue;
    }

    const contentMatch = CONTENT_ATTR.exec(attrs);
    if (!contentMatch) {
      continue;
    }

    const raw = (contentMatch[1] ?? contentMatch[2] ?? contentMatch[3] ?? "").trim();
    if (!raw) {
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(raw, baseUrl);
    } catch {
      continue;
    }

    // Reject data:, blob:, and other non-web schemes before they reach the image fetcher
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }

    return resolved.toString();
  }

  return null;
};
