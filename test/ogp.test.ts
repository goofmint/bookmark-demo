import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractOgImageUrl } from "../src/server/ogp";
import { storeOgpImage } from "../src/server/storage";

const PAGE_URL = "https://example.com/page";
const IMAGE_URL = "https://example.com/hero.png";

// PNG のシグネチャだけの最小データ。中身は検証しないので保存の確認に足りる。
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const htmlResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

// URL ごとに返すレスポンスを決めるニセの fetch。実際の通信はしない。
const createFetcher = (responses: Record<string, () => Response>) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const respond = responses[url];

    if (!respond) {
      return new Response("not found", { status: 404 });
    }

    return respond();
  }) as unknown as typeof fetch;

let tempDir: string;
let storageDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bookmark-demo-ogp-"));
  storageDir = join(tempDir, "ogp");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("extractOgImageUrl", () => {
  it("extracts an absolute og:image URL", () => {
    const html = '<html><head><meta property="og:image" content="https://cdn.example.com/hero.png"></head></html>';

    expect(extractOgImageUrl(html, PAGE_URL)).toBe("https://cdn.example.com/hero.png");
  });

  it("resolves a relative og:image URL against the base URL", () => {
    const html = '<html><head><meta property="og:image" content="/img/hero.png"></head></html>';

    expect(extractOgImageUrl(html, PAGE_URL)).toBe("https://example.com/img/hero.png");
  });

  it("returns null when no og:image exists", () => {
    const html = '<html><head><meta property="og:title" content="Example"></head></html>';

    expect(extractOgImageUrl(html, PAGE_URL)).toBeNull();
  });

  it("rejects og:image URLs that are not http or https", () => {
    const html = '<html><head><meta property="og:image" content="data:image/png;base64,AAAA"></head></html>';

    expect(extractOgImageUrl(html, PAGE_URL)).toBeNull();
  });
});

describe("storeOgpImage", () => {
  it("saves the image and returns its public path", async () => {
    const fetcher = createFetcher({
      [PAGE_URL]: () => htmlResponse(`<meta property="og:image" content="${IMAGE_URL}">`),
      [IMAGE_URL]: () => new Response(PNG_BYTES, { headers: { "content-type": "image/png" } })
    });

    const result = await storeOgpImage(PAGE_URL, storageDir, fetcher);

    expect(result).toMatch(/^\/ogp\/[0-9a-f-]{36}\.png$/);
    const saved = await readFile(join(storageDir, result.replace("/ogp/", "")));
    expect(new Uint8Array(saved)).toEqual(PNG_BYTES);
  });

  it("returns an empty string when the page has no og:image", async () => {
    const fetcher = createFetcher({
      [PAGE_URL]: () => htmlResponse("<meta property=\"og:title\" content=\"Example\">")
    });

    await expect(storeOgpImage(PAGE_URL, storageDir, fetcher)).resolves.toBe("");
  });

  it("returns an empty string for a content-type that is not allowed", async () => {
    const fetcher = createFetcher({
      [PAGE_URL]: () => htmlResponse(`<meta property="og:image" content="${IMAGE_URL}">`),
      [IMAGE_URL]: () => new Response(PNG_BYTES, { headers: { "content-type": "image/svg+xml" } })
    });

    await expect(storeOgpImage(PAGE_URL, storageDir, fetcher)).resolves.toBe("");
  });

  it("returns an empty string when fetching the page fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network failed");
    });

    await expect(storeOgpImage(PAGE_URL, storageDir, fetcher as typeof fetch)).resolves.toBe("");
  });
});
