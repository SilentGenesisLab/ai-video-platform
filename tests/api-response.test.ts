import { strict as assert } from "node:assert";
import { test } from "vitest";
import { api, readApiResponse } from "../src/components/api";

test("HTML gateway error yields a friendly error, without parsing page markup", async () => {
  await assert.rejects(
    readApiResponse(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    ),
    /服务暂时不可用.*502/,
  );
});
test("malformed JSON response does not expose a SyntaxError", async () => {
  await assert.rejects(
    readApiResponse(
      new Response("<html>", {
        headers: { "content-type": "application/json" },
      }),
    ),
    /服务返回了异常响应/,
  );
});
test("GET recovers from a transient gateway failure; POST is never retried", async () => {
  const original = globalThis.fetch;
  try {
    let requests = 0;
    globalThis.fetch = async () =>
      ++requests === 1
        ? new Response("<html>unavailable</html>", {
            status: 503,
            headers: { "content-type": "text/html" },
          })
        : Response.json({ ok: true });
    assert.deepEqual(await api("/auth/me"), { ok: true });
    assert.equal(requests, 2);
    requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response("<html>unavailable</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      });
    };
    await assert.rejects(
      api("/production-batches", "POST", {}),
      /服务暂时不可用/,
    );
    assert.equal(requests, 1);
    requests = 0;
    globalThis.fetch = async () => {
      requests++;
      throw new Error("network offline");
    };
    await assert.rejects(api("/feedback", "POST", {}), /网络连接失败/);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});
