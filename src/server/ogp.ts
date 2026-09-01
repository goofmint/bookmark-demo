// <meta> タグ 1 個ぶんをまとめて取り出す。属性の解析は parseAttributes に任せる。
const META_TAG_PATTERN = /<meta\b[^>]*>/gi;

// name="value" / name='value' / name=value の 3 形式に対応する。
const ATTRIBUTE_PATTERN = /([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=`]+))/gi;

// og:image が本来のキーだが、og:image:url を使うサイトもあるため両方受け付ける。
const OG_IMAGE_KEYS = new Set(["og:image", "og:image:url"]);

// URL の content 属性には &amp; が含まれることが多いので最低限の実体参照を戻す。
const decodeHtmlEntities = (value: string) =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

const parseAttributes = (tag: string) => {
  const attributes = new Map<string, string>();

  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    // 同じ属性が重複していたら先に現れたものを採用する（ブラウザと同じ挙動）。
    if (!attributes.has(name)) {
      attributes.set(name, value);
    }
  }

  return attributes;
};

const isOgImageTag = (attributes: Map<string, string>) => {
  // property が正式だが name で書かれている場合もあるため両方を見る。
  const keys = [attributes.get("property"), attributes.get("name")];
  return keys.some((key) => key !== undefined && OG_IMAGE_KEYS.has(key.trim().toLowerCase()));
};

/**
 * HTML から最初の og:image の URL を取り出し、baseUrl を使って絶対 URL に解決する。
 * og:image が無い場合、または http/https 以外のスキームだった場合は null を返す。
 */
export const extractOgImageUrl = (html: string, baseUrl: string): string | null => {
  for (const [tag] of html.matchAll(META_TAG_PATTERN)) {
    const attributes = parseAttributes(tag);

    if (!isOgImageTag(attributes)) {
      continue;
    }

    const content = decodeHtmlEntities(attributes.get("content")?.trim() ?? "");
    if (!content) {
      continue;
    }

    try {
      // 相対 URL は baseUrl 基準で解決する。
      const resolved = new URL(content, baseUrl);

      // data: や javascript: などは画像取得の対象外とする。
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        return null;
      }

      return resolved.toString();
    } catch {
      return null;
    }
  }

  return null;
};
