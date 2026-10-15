import { expect, test } from "vitest";
import { nextImageChannel } from "../src/worker/image-fallback";
import { generationPayload } from "../src/worker/provider";
const job = {
  kind: "image",
  input: { model: "gpt-image-2", channel: "auto", references: [] },
};
test("confirmed maintenance failure switches to untried compatible route", () => {
  expect(
    nextImageChannel(
      { ...job, input: { ...job.input, model: "gpt-image-2.5" } },
      { status: "failed", channel: "auto", error: "该模型正在修复" },
    ),
  ).toBe("teamorouter");
  expect(
    nextImageChannel(job, {
      status: "failed",
      channel: "grsai",
      error: "该模型正在修复",
    }),
  ).toBe("teamorouter");
  expect(
    nextImageChannel(
      {
        ...job,
        input: {
          ...job.input,
          channelAttempts: [{ channel: "grsai" }],
          fallbackChannel: "teamorouter",
        },
      },
      { status: "failed", channel: "teamorouter" },
    ),
  ).toBeNull();
});
test("unknown, paid, successful, cancelled and incompatible requests never regenerate", () => {
  for (const result of [
    { status: "running" },
    { status: "cancelled" },
    { status: "failed", error: "timeout" },
    { status: "failed", billed_cost: 0.3 },
    { status: "failed", result_url: "https://example.com/image" },
  ])
    expect(nextImageChannel(job, result)).toBeNull();
  expect(
    nextImageChannel({ ...job, kind: "video" }, { status: "failed" }),
  ).toBeNull();
  expect(
    nextImageChannel(
      { ...job, input: { ...job.input, references: [{ mime: "image/png" }] } },
      { status: "failed" },
    ),
  ).toBeNull();
  expect(
    nextImageChannel(
      { ...job, input: { ...job.input, model: "unknown" } },
      { status: "failed" },
    ),
  ).toBeNull();
});
test("fallback has its own upstream reference while keeping original platform task", () => {
  const payload = generationPayload({
    id: "job",
    ...job,
    input: {
      ...job.input,
      fallbackChannel: "teamorouter",
      channelAttempts: [{ channel: "grsai" }],
    },
  });
  expect(payload.channel).toBe("teamorouter");
  expect(payload.external_ref).toBe("job:fallback:1");
  expect(payload.metadata).toEqual({ platform_job_id: "job" });
});
