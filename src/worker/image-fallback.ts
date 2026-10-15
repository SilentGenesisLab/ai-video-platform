/** Only retry a confirmed failed, unbilled image on a compatible, untried route. */
export function nextImageChannel(
  job: { kind: string; input: any },
  result: any,
) {
  const input = job.input;
  if (job.kind !== "image" || (result.status ?? result.state) !== "failed")
    return null;
  if (result.result_url || result.result_urls?.length) return null;
  if (Number(result.fallback_count ?? 0) > 0) return null;
  const costs = [
    result.billed_cost,
    result.billed_cost_cny,
    result.billing?.cost,
  ];
  if (
    costs.some(
      (v) => v != null && (!Number.isFinite(Number(v)) || Number(v) !== 0),
    )
  )
    return null;
  // Ambiguous completion, network failures and safety rejection must never buy a second job.
  if (
    /timeout|timed.out|超时|network|网络|cancel|取消|policy|moderation|安全|违规|审核/i.test(
      JSON.stringify(result.error ?? ""),
    )
  )
    return null;
  if (input.references?.length) return null; // TeamORouter is text-to-image only.
  if (
    ![
      "gpt-image-2.5",
      "gpt-image-2",
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-flare",
    ].includes(input.model)
  )
    return null;
  const tried = new Set(
    (input.channelAttempts ?? []).map((a: any) =>
      a.channel === "auto" ? "grsai" : a.channel,
    ),
  );
  if (input.fallbackChannel) tried.add(input.fallbackChannel);
  const reportedChannel =
    result.channel === "auto" ? undefined : result.channel;
  tried.add(
    reportedChannel ??
      input.fallbackChannel ??
      (input.channel !== "auto" ? input.channel : "grsai"),
  );
  return ["grsai", "teamorouter"].find((c) => !tried.has(c)) ?? null;
}
