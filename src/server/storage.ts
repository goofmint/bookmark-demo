import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fetchWithTimeout, readLimitedBody } from "./fetch";
import { extractOgImageUrl } from "./ogp";

// クライアントに返す公開パスのプレフィックス。storageDir がこのパスで配信される想定。
const OGP_PUBLIC_PATH = "/ogp";

const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// 許可する画像形式と、保存時に使う拡張子の対応。ここに無い content-type は保存しない。
const IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"]
]);

// 配信時に content-type を復元するための逆引き。許可形式の定義を 1 か所に保つ。
const IMAGE_CONTENT_TYPES = new Map(
  [...IMAGE_EXTENSIONS].map(([contentType, extension]) => [extension, contentType])
);

// 保存時に付けた「UUID + 許可拡張子」以外は受け付けず、".." などでの外部読み出しを防ぐ。
const OGP_FILE_NAME_PATTERN = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${[...IMAGE_CONTENT_TYPES.keys()].join("|")})$`
);

// "image/png; charset=utf-8" のようなパラメータ付きの値を正規化する。
const parseContentType = (response: Response) =>
  (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

/**
 * pageUrl の og:image を取得してローカルに保存し、公開パス "/ogp/<uuid>.<ext>" を返す。
 * og:image が無い場合や取得・保存に失敗した場合は空文字を返す。
 * ここでの失敗はブックマーク保存を止める理由にはならないため、例外は投げない。
 */
export const storeOgpImage = async (
  pageUrl: string,
  storageDir: string,
  fetcher: typeof fetch = fetch
): Promise<string> => {
  try {
    // fetchWithTimeout がタイムアウト・User-Agent・リダイレクト制限・SSRF 対策を担当する。
    const pageResponse = await fetchWithTimeout(pageUrl, fetcher, "text/html", FETCH_TIMEOUT_MS);
    if (!pageResponse) {
      return "";
    }

    if (parseContentType(pageResponse) !== "text/html") {
      return "";
    }

    const html = await readLimitedBody(pageResponse, MAX_HTML_BYTES);
    if (!html) {
      return "";
    }

    // 相対 URL はリダイレクト後の最終 URL を基準に解決する。
    const imageUrl = extractOgImageUrl(new TextDecoder().decode(html), pageResponse.url || pageUrl);
    if (!imageUrl) {
      return "";
    }

    const imageResponse = await fetchWithTimeout(imageUrl, fetcher, "image/*", FETCH_TIMEOUT_MS);
    if (!imageResponse) {
      return "";
    }

    const extension = IMAGE_EXTENSIONS.get(parseContentType(imageResponse));
    if (!extension) {
      return "";
    }

    // readLimitedBody は 0 バイトのときと上限超過のときに null を返す。
    const image = await readLimitedBody(imageResponse, MAX_IMAGE_BYTES);
    if (!image) {
      return "";
    }

    // ファイル名は UUID 由来にして、外部から与えられた URL がパスに影響しないようにする。
    const fileName = `${randomUUID()}.${extension}`;
    const targetDir = resolve(storageDir);

    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, fileName), image);

    return `${OGP_PUBLIC_PATH}/${fileName}`;
  } catch {
    return "";
  }
};


/**
 * storeOgpImage が保存した画像を読み出す。
 * ファイル名が想定の形式でない場合や、ファイルが存在しない場合は null を返す。
 */
export const readOgpImage = async (
  name: string,
  storageDir: string
): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string } | null> => {
  const match = name.match(OGP_FILE_NAME_PATTERN);
  if (!match) {
    return null;
  }

  const contentType = IMAGE_CONTENT_TYPES.get(match[1]);
  if (!contentType) {
    return null;
  }

  try {
    const file = await readFile(join(resolve(storageDir), name));
    // Buffer は共有プールを指す場合があるため、独立した Uint8Array に写してから返す。
    return { body: new Uint8Array(file), contentType };
  } catch {
    return null;
  }
};
