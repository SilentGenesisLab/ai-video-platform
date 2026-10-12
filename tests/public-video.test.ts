import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
const network = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
  request: network.request,
  Agent: class {
    destroy = network.destroy;
  },
}));
import { withPublicVideo } from "../src/worker/public-video";
beforeEach(() => {
  vi.clearAllMocks();
  network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
});
describe("video URL import guards", () => {
  it("rejects non-HTTPS and credential-bearing URLs before download", async () => {
    for (const url of [
      "http://example.com/a.mp4",
      "https://user:pass@example.com/a.mp4",
      "https://example.com:8080/a.mp4",
    ])
      await expect(withPublicVideo(url, vi.fn())).rejects.toThrow("公网 HTTPS");
    expect(network.request).not.toHaveBeenCalled();
  });
  it("rejects mixed public and private DNS answers", async () => {
    network.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(
      withPublicVideo("https://example.com/a.mp4", vi.fn()),
    ).rejects.toThrow("私有");
    expect(network.request).not.toHaveBeenCalled();
  });
  it("revalidates a redirect before connecting to its private destination", async () => {
    network.lookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    network.request.mockResolvedValueOnce({
      statusCode: 302,
      headers: { location: "https://metadata.example/private" },
      body: Readable.from([]),
    });
    await expect(
      withPublicVideo("https://example.com/a.mp4", vi.fn()),
    ).rejects.toThrow("私有");
    expect(network.request).toHaveBeenCalledTimes(1);
    expect(network.destroy).toHaveBeenCalledTimes(1);
  });
  it("rejects share pages and closes the connection promptly", async () => {
    network.request.mockResolvedValueOnce({
      statusCode: 200,
      headers: { "content-type": "text/html" },
      body: Readable.from(["page"]),
    });
    await expect(
      withPublicVideo("https://example.com/share", vi.fn()),
    ).rejects.toThrow("直接返回");
    expect(network.destroy).toHaveBeenCalled();
  });
  it("rejects oversized Content-Length without processing file contents", async () => {
    network.request.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(513 * 1024 * 1024),
      },
      body: Readable.from([]),
    });
    const use = vi.fn();
    await expect(
      withPublicVideo("https://example.com/a.mp4", use),
    ).rejects.toThrow("512 MB");
    expect(use).not.toHaveBeenCalled();
  });
  it("reports an expired signed link as a download failure", async () => {
    network.request.mockResolvedValueOnce({
      statusCode: 403,
      headers: {},
      body: Readable.from([]),
    });
    await expect(
      withPublicVideo("https://example.com/a.mp4", vi.fn()),
    ).rejects.toThrow("403");
  });
});
