export function suggestActs(shots: any[]) {
  const acts: any[] = [];
  let ids: string[] = [],
    duration = 0;
  for (const shot of shots) {
    if (ids.length && duration + shot.duration > 20) {
      acts.push({
        id: crypto.randomUUID(),
        title: `第${acts.length + 1}幕`,
        objective: "",
        shotIds: ids,
      });
      ids = [];
      duration = 0;
    }
    ids.push(shot.id);
    duration += shot.duration;
    if (duration >= 15) {
      acts.push({
        id: crypto.randomUUID(),
        title: `第${acts.length + 1}幕`,
        objective: "",
        shotIds: ids,
      });
      ids = [];
      duration = 0;
    }
  }
  if (ids.length) {
    const last = acts.at(-1);
    const lastDuration =
      last?.shotIds.reduce(
        (n: number, id: string) => n + shots.find((s) => s.id === id).duration,
        0,
      ) ?? 0;
    if (last && lastDuration + duration <= 20) last.shotIds.push(...ids);
    else
      acts.push({
        id: crypto.randomUUID(),
        title: `第${acts.length + 1}幕`,
        objective: "",
        shotIds: ids,
      });
  }
  return acts;
}
export function actScript(board: any, act: any, plan: any) {
  const shots = act.shotIds.map((id: string) =>
    board.content.shots.find((s: any) => s.id === id),
  );
  const duration = shots.reduce((n: number, s: any) => n + s.duration, 0);
  if (duration < 4 || duration > 20 || !Number.isInteger(duration))
    throw new Error(
      "每幕转视频须为 4–20 整秒，建议 10–20 秒；请调整镜头时长或分幕",
    );
  const assets = Array.from(
    new Map(
      shots
        .flatMap((s: any) => s.assets ?? [])
        .map((a: any) => [a.resourceId + ":" + a.version, a]),
    ).values(),
  );
  const refs = Array.from(
    new Set(shots.flatMap((s: any) => [s.imageFileId].filter(Boolean))),
  );
  return {
    title: board.title + " · " + act.title,
    productId: board.productId,
    planId: board.planId,
    status: "draft",
    sources: [{ resourceId: board.id, version: board.version }],
    content: {
      actId: act.id,
      storyboardVersion: board.version,
      shotIds: act.shotIds,
      assets,
      referenceFileIds: refs,
      duration,
      aspectRatio: plan?.content?.aspectRatio ?? "16:9",
      resolution: "720p",
      sound: false,
      comments: "按幕转换；尚未提交生成，视频需人工审批。",
      prompt: [
        act.title,
        act.objective,
        `独立片段 ${duration} 秒；保持产品、人物与场景连续。`,
        ...shots.map(
          (s: any, i: number) =>
            `镜头${i + 1}（${s.duration}秒）\n` +
            [
              "description",
              "framing",
              "camera",
              "movement",
              "action",
              "dialogue",
              "sound",
              "continuity",
            ]
              .map((k) => `${k}: ${s[k] ?? ""}`)
              .join("\n"),
        ),
      ].join("\n\n"),
    },
  };
}
