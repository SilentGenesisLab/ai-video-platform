import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  file: {} as any,
  analysis: {} as any,
  job: {} as any,
  audio: false,
  asr: vi.fn(),
  readUrl: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../src/lib/db", () => {
  const table = (key: "file" | "analysis" | "job") => ({
    findUniqueOrThrow: async () => structuredClone(state[key]),
    update: async ({ data }: any) => Object.assign(state[key], data),
  });
  const db: any = {
    fileObject: table("file"),
    fileAnalysis: table("analysis"),
    job: table("job"),
    channel: {
      findUniqueOrThrow: async () => ({
        id: "channel",
        baseUrl: "https://ark.example/api/v3",
        ciphertext: "private",
      }),
      findFirst: async () => ({ id: "asr" }),
    },
  };
  db.$transaction = async (fn: any) => fn(db);
  return { db };
});
vi.mock("../src/lib/storage", async () => {
  const { Readable } = await import("node:stream");
  return {
    oss: () => ({
      getStream: async () => ({
        stream: Readable.from(Buffer.from("test-video")),
      }),
    }),
    readUrl: state.readUrl,
    objectKey: () => "analysis-copy.mp4",
  };
});
vi.mock("../src/lib/security", () => ({ decrypt: () => "private" }));
vi.mock("../src/lib/services", () => ({ json: (v: unknown) => v }));
vi.mock("../src/lib/channel-call", () => ({
  withChannel: async (_c: unknown, fn: any) => fn(new AbortController().signal),
}));
vi.mock("../src/worker/provider", () => ({ providerRequest: state.asr }));
vi.mock("node:child_process", () => ({
  execFile: (_bin: any, _args: any, _options: any, cb: any) =>
    cb(null, {
      stdout: JSON.stringify({
        format: { duration: "6" },
        streams: [
          { codec_type: "video", codec_name: "h264" },
          ...(state.audio ? [{ codec_type: "audio" }] : []),
        ],
      }),
    }),
}));
import { analyzeVideo } from "../src/worker/video-analysis";
const response = {
  id: "response-id",
  usage: { total_tokens: 42 },
  output: [
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            summary: "红变蓝",
            shots: [
              { start: 0, end: 3, visual: "红色" },
              { start: 3, end: 6, visual: "蓝色" },
            ],
          }),
        },
      ],
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  state.audio = false;
  state.file = {
    id: "file",
    key: "original.mp4",
    mime: "video/mp4",
    bytes: 1000,
    sha256: "stable-hash",
    metadata: {},
  };
  state.analysis = {
    id: "analysis",
    jobId: "job",
    fileId: "file",
    status: "pending",
    model: "doubao-seed-2-1-pro-260628",
    prompt: "分析",
    promptVersion: "video-v1",
  };
  state.job = { id: "job", channelId: "channel", status: "running" };
  state.readUrl.mockReturnValue("https://oss.example/fresh-signed-url");
  state.fetch.mockResolvedValue(Response.json(response));
  vi.stubGlobal("fetch", state.fetch);
});
describe("video inference reliability", () => {
  it("small silent video uses fresh URL, fixed model, no ASR, and retains usage", async () => {
    await analyzeVideo("job");
    expect(state.job.status).toBe("succeeded");
    expect(state.asr).not.toHaveBeenCalled();
    const request = JSON.parse(state.fetch.mock.calls[0][1].body);
    expect(request.model).toBe("doubao-seed-2-1-pro-260628");
    expect(request.input[0].content[0].video_url).toContain("fresh-signed-url");
    expect(state.analysis.usage.total_tokens).toBe(42);
  });
  it("large input uploads through Files API with preprocessing model and references file_id", async () => {
    state.file.bytes = 51 * 1024 * 1024;
    state.fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json({ id: "file-provider" }))
      .mockResolvedValueOnce(Response.json({ status: "active" }))
      .mockResolvedValueOnce(Response.json(response));
    await analyzeVideo("job");
    expect(state.job.status).toBe("succeeded");
    const form = state.fetch.mock.calls[0][1].body as FormData;
    expect(form.get("preprocess_configs[video][model]")).toBe(
      state.analysis.model,
    );
    expect(
      JSON.parse(state.fetch.mock.calls[2][1].body).input[0].content[0],
    ).toEqual({ type: "input_video", file_id: "file-provider" });
  });
  it("ASR failure preserves visual analysis and labels unverified speech", async () => {
    state.audio = true;
    state.asr.mockRejectedValueOnce(new Error("ASR unavailable"));
    await analyzeVideo("job");
    expect(state.job.status).toBe("succeeded");
    expect(state.analysis.result.warnings[0]).toContain("不能作为已核验转写");
    expect(state.analysis.result.transcript).toBeNull();
  });
  it("ASR result is saved separately and supplied as reference data", async () => {
    state.audio = true;
    state.asr.mockResolvedValueOnce({
      segments: [{ start: 0, end: 2, text: "测试" }],
    });
    await analyzeVideo("job");
    expect(state.analysis.result.transcript.segments[0].text).toBe("测试");
    expect(state.file.metadata.transcript).toBeTruthy();
  });
  it("ambiguous timeout is terminal and is never automatically repurchased", async () => {
    state.fetch.mockRejectedValueOnce(
      new Error("connection reset after sending"),
    );
    await analyzeVideo("job");
    expect(state.job.status).toBe("submission_unknown");
    await analyzeVideo("job");
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
  it("known provider rejection is a visible failure", async () => {
    state.fetch.mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );
    await analyzeVideo("job");
    expect(state.job.status).toBe("failed");
    expect(state.file.parseError).toContain("429");
  });
  it("restart after durable provider response finishes locally without another purchase", async () => {
    state.analysis.status = "submitting";
    state.analysis.rawResponse = response;
    state.file.metadata = {
      duration: 6,
      transcript: null,
      analysisWarnings: [],
    };
    await analyzeVideo("job");
    expect(state.job.status).toBe("succeeded");
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
