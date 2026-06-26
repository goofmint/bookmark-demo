import { readdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractOgImageUrl } from "../src/server/ogp";
import { storeOgpImage } from "../src/server/storage";

describe("extractOgImageUrl", () => {
  it("extracts an absolute og:image URL", () => {
    const html = '<meta property="og:image" content="https://example.com/og.jpg">';
    expect(extractOgImageUrl(html, "https://example.com/")).toBe("https://example.com/og.jpg");
  });

  it("resolves a relative content value against baseUrl", () => {
    const html = '<meta property="og:image" content="/images/og.png">';
    expect(extractOgImageUrl(html, "https://example.com/page")).toBe(
      "https://example.com/images/og.png"
    );
  });

  it("returns null when no og:image meta tag is present", () => {
    expect(
      extractOgImageUrl("<html><head><title>No OGP</title></head></html>", "https://example.com/")
    ).toBeNull();
  });

  it("returns null for non-http/https schemes such as data:", () => {
    const html = '<meta property="og:image" content="data:image/png;base64,abc">';
    expect(extractOgImageUrl(html, "https://example.com/")).toBeNull();
  });

  it("accepts og:image:url as an alias for og:image", () => {
    const html = '<meta property="og:image:url" content="https://example.com/alias.jpg">';
    expect(extractOgImageUrl(html, "https://example.com/")).toBe("https://example.com/alias.jpg");
  });

  it("matches name= as well as property=", () => {
    const html = '<meta name="og:image" content="https://example.com/named.jpg">';
    expect(extractOgImageUrl(html, "https://example.com/")).toBe("https://example.com/named.jpg");
  });
});

describe("storeOgpImage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ogp-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fetches the og:image, saves it to storageDir, and returns its /ogp/ path", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('<meta property="og:image" content="https://example.com/og.jpg">', {
          headers: { "content-type": "text/html" }
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
          headers: { "content-type": "image/jpeg" }
        })
      );

    const path = await storeOgpImage("https://example.com/", tempDir, fetcher as typeof fetch);

    expect(path).toMatch(
      /^\/ogp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/
    );
    const files = await readdir(tempDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.jpg$/);
  });

  it("returns empty string when the page has no og:image", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("<html><title>No OGP</title></html>", {
        headers: { "content-type": "text/html" }
      })
    );

    await expect(
      storeOgpImage("https://example.com/", tempDir, fetcher as typeof fetch)
    ).resolves.toBe("");
  });

  it("returns empty string when the image content-type is not in the allow-list", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('<meta property="og:image" content="https://example.com/og.svg">', {
          headers: { "content-type": "text/html" }
        })
      )
      .mockResolvedValueOnce(
        new Response("<svg></svg>", { headers: { "content-type": "image/svg+xml" } })
      );

    await expect(
      storeOgpImage("https://example.com/", tempDir, fetcher as typeof fetch)
    ).resolves.toBe("");
  });

  it("returns empty string when the page fetch throws", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("network error"));

    await expect(
      storeOgpImage("https://example.com/", tempDir, fetcher as typeof fetch)
    ).resolves.toBe("");
  });
});
