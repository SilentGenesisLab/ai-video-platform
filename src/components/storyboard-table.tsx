"use client";
import { useState } from "react";
import { suggestActs } from "../lib/storyboard-acts";
import { api } from "./api";
export default function StoryboardTable({
  draft,
  item,
  dirty,
  content,
  files,
  assets,
  upload,
  Picture,
  notify,
}: any) {
  const [busy, setBusy] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const shots = draft.content.shots;
  const acts = draft.content.acts ?? [];
  const groups = acts.length
    ? acts
    : [
        {
          id: "unassigned",
          title: "未分幕",
          objective: "",
          shotIds: shots.map((s: any) => s.id),
        },
      ];
  const patchShot = (id: string, key: string, value: any) =>
    content(
      "shots",
      shots.map((s: any) => (s.id === id ? { ...s, [key]: value } : s)),
    );
  const update = (next: any[], nextActs: any[]) => {
    content("__board", { ...draft.content, shots: next, acts: nextActs });
  };
  const patchAct = (id: string, key: string, value: any) =>
    content(
      "acts",
      acts.map((a: any) => (a.id === id ? { ...a, [key]: value } : a)),
    );
  async function convert(a: any) {
    setBusy(a.id);
    try {
      const script = await api(`/storyboards/${item.id}/convert-act`, "POST", {
        baseVersion: item.version,
        actId: a.id,
      });
      setResults((v) => ({ ...v, [a.id]: script.id }));
      notify("已创建该幕制作脚本，尚未提交视频生成", "success");
    } catch (e: any) {
      notify(e.message, "error");
    } finally {
      setBusy("");
    }
  }
  function add(a: any) {
    const s = {
      id: crypto.randomUUID(),
      number: shots.length + 1,
      duration: 5,
      description: "",
      assets: [],
      candidateFileIds: [],
    };
    const index = shots.findIndex((s: any) => s.id === a.shotIds.at(-1)) + 1;
    const next = [...shots];
    next.splice(index, 0, s);
    update(
      next,
      acts.map((x: any) =>
        x.id === a.id ? { ...x, shotIds: [...x.shotIds, s.id] } : x,
      ),
    );
  }
  return (
    <div className="sb-workspace">
      <div className="cd-section">
        <h2>分幕镜头表</h2>
        <button
          className="button"
          onClick={() => {
            if (
              !acts.length ||
              confirm("重新建议分幕会替换当前分幕，镜头内容保留。继续？")
            )
              content("acts", suggestActs(shots));
          }}
        >
          建议分幕（10–20 秒）
        </button>
      </div>
      <p>
        每行一个镜头，每幕对应一个独立视频片段。先保存分幕，再转换制作脚本；视频提交仍须人工审批。
      </p>
      {!shots.length && (
        <button
          className="button"
          onClick={() =>
            content("shots", [
              {
                id: crypto.randomUUID(),
                number: 1,
                duration: 5,
                description: "",
                assets: [],
                candidateFileIds: [],
              },
            ])
          }
        >
          添加首个镜头
        </button>
      )}
      {groups.map((a: any, gi: number) => {
        const selected = a.shotIds
          .map((id: string) => shots.find((s: any) => s.id === id))
          .filter(Boolean);
        const duration = selected.reduce(
          (n: number, s: any) => n + s.duration,
          0,
        );
        return (
          <section className="sb-act" key={a.id}>
            <div className="sb-act-head">
              <strong>{String(gi + 1).padStart(2, "0")}</strong>
              <input
                aria-label={`第${gi + 1}幕名称`}
                value={a.title}
                disabled={!acts.length}
                onChange={(e) => patchAct(a.id, "title", e.target.value)}
              />
              <span>
                {selected.length} 镜头 · {duration} 秒{" "}
                {duration < 10 || duration > 20
                  ? "（建议调整至 10–20 秒）"
                  : ""}
              </span>
              {acts.length > 0 && (
                <>
                  <button className="button" onClick={() => add(a)}>
                    添加镜头
                  </button>
                  <button
                    className="button"
                    disabled={!item || dirty || !!busy || !!results[a.id]}
                    onClick={() => convert(a)}
                  >
                    {busy === a.id
                      ? "转换中…"
                      : results[a.id]
                        ? "已转为制作脚本"
                        : "转为制作脚本"}
                  </button>
                </>
              )}
            </div>
            {acts.length > 0 && (
              <label className="sb-objective">
                本幕目标
                <input
                  value={a.objective}
                  onChange={(e) => patchAct(a.id, "objective", e.target.value)}
                />
              </label>
            )}
            {results[a.id] && (
              <a href={`/studio/production?tab=scripts&id=${results[a.id]}`}>
                查看本幕制作脚本 →
              </a>
            )}
            <div
              className="sb-scroll"
              role="region"
              aria-label={`${a.title}镜头表`}
              tabIndex={0}
            >
              <table className="sb-table">
                <thead>
                  <tr>
                    {[
                      "镜号／时长",
                      "分镜图／资产",
                      "画面与动作",
                      "景别／机位／运镜",
                      "对白／声音",
                      "连续性",
                      "操作",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.map((s: any, si: number) => {
                    const index = shots.findIndex((x: any) => x.id === s.id);
                    const edit = (k: string, label: string) => (
                      <label>
                        {label}
                        <textarea
                          aria-label={`镜头${index + 1} · ${label}`}
                          value={s[k] ?? ""}
                          onChange={(e) => patchShot(s.id, k, e.target.value)}
                        />
                      </label>
                    );
                    return (
                      <tr className="sb-shot" key={s.id}>
                        <td>
                          <strong>{String(index + 1).padStart(2, "0")}</strong>
                          <label>
                            时长（秒）
                            <input
                              aria-label={`镜头${index + 1}时长（秒）`}
                              type="number"
                              min="0.1"
                              step="0.1"
                              value={s.duration}
                              onChange={(e) =>
                                patchShot(
                                  s.id,
                                  "duration",
                                  Number(e.target.value),
                                )
                              }
                            />
                          </label>
                        </td>
                        <td>
                          <div className="cd-pictures">
                            {s.imageFileId && <Picture id={s.imageFileId} />}
                          </div>
                          <select
                            aria-label={`镜头${index + 1}分镜图`}
                            value={s.imageFileId ?? ""}
                            onChange={(e) =>
                              patchShot(s.id, "imageFileId", e.target.value)
                            }
                          >
                            <option value="">选择分镜图</option>
                            {files
                              .filter(
                                (f: any) =>
                                  f.status === "ready" &&
                                  f.mime.startsWith("image/"),
                              )
                              .map((f: any) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                          </select>
                          <details>
                            <summary>候选图与引用资产</summary>
                            <input
                              aria-label={`镜头${index + 1}上传候选图`}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={(e) => {
                                if (e.target.files?.[0])
                                  void upload(index, e.target.files[0]);
                                e.target.value = "";
                              }}
                            />
                            {(s.candidateFileIds ?? []).map((id: string) => (
                              <div className="cd-pictures" key={id}>
                                <Picture id={id} />
                                <button
                                  className="button"
                                  onClick={() =>
                                    patchShot(s.id, "imageFileId", id)
                                  }
                                >
                                  选用
                                </button>
                              </div>
                            ))}
                            {(s.assets ?? []).map((ref: any) => (
                              <div key={ref.resourceId}>
                                {assets.find(
                                  (x: any) => x.id === ref.resourceId,
                                )?.title ?? "关联资产"}{" "}
                                · V{ref.version}
                                <button
                                  className="button"
                                  onClick={() =>
                                    patchShot(
                                      s.id,
                                      "assets",
                                      s.assets.filter(
                                        (r: any) =>
                                          r.resourceId !== ref.resourceId,
                                      ),
                                    )
                                  }
                                >
                                  移除引用
                                </button>
                              </div>
                            ))}
                            <select
                              aria-label={`镜头${index + 1}添加资产`}
                              value=""
                              onChange={(e) => {
                                const asset = assets.find(
                                  (x: any) => x.id === e.target.value,
                                );
                                if (
                                  asset &&
                                  !s.assets?.some(
                                    (r: any) => r.resourceId === asset.id,
                                  )
                                )
                                  patchShot(s.id, "assets", [
                                    ...(s.assets ?? []),
                                    {
                                      resourceId: asset.id,
                                      version: asset.version,
                                    },
                                  ]);
                              }}
                            >
                              <option value="">添加资产</option>
                              {assets.map((x: any) => (
                                <option key={x.id} value={x.id}>
                                  {x.title} · V{x.version}
                                </option>
                              ))}
                            </select>
                          </details>
                        </td>
                        <td>
                          {edit("description", "画面")}
                          {edit("action", "动作")}
                        </td>
                        <td>
                          {edit("framing", "景别")}
                          {edit("camera", "机位")}
                          {edit("movement", "运镜")}
                        </td>
                        <td>
                          {edit("dialogue", "对白 / 旁白")}
                          {edit("sound", "声音")}
                        </td>
                        <td>{edit("continuity", "连续性要求")}</td>
                        <td>
                          <button
                            className="button"
                            aria-label={`上移镜头${index + 1}`}
                            disabled={si === 0}
                            onClick={() => {
                              const next = [...shots];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              update(
                                next,
                                acts.map((x: any) =>
                                  x.id === a.id
                                    ? {
                                        ...x,
                                        shotIds: next
                                          .filter((s) =>
                                            a.shotIds.includes(s.id),
                                          )
                                          .map((s) => s.id),
                                      }
                                    : x,
                                ),
                              );
                            }}
                          >
                            ↑
                          </button>
                          <button
                            className="button"
                            aria-label={`下移镜头${index + 1}`}
                            disabled={si === selected.length - 1}
                            onClick={() => {
                              const next = [...shots];
                              [next[index + 1], next[index]] = [
                                next[index],
                                next[index + 1],
                              ];
                              update(
                                next,
                                acts.map((x: any) =>
                                  x.id === a.id
                                    ? {
                                        ...x,
                                        shotIds: next
                                          .filter((s) =>
                                            a.shotIds.includes(s.id),
                                          )
                                          .map((s) => s.id),
                                      }
                                    : x,
                                ),
                              );
                            }}
                          >
                            ↓
                          </button>
                          <button
                            className="button"
                            onClick={() => {
                              if (confirm("移除镜头？保存后生效。"))
                                update(
                                  shots.filter((x: any) => x.id !== s.id),
                                  acts
                                    .map((x: any) => ({
                                      ...x,
                                      shotIds: x.shotIds.filter(
                                        (id: string) => id !== s.id,
                                      ),
                                    }))
                                    .filter((x: any) => x.shotIds.length),
                                );
                            }}
                          >
                            删除
                          </button>
                          {acts.length > 0 && si > 0 && (
                            <button
                              className="button"
                              onClick={() => {
                                const cut = si;
                                const part = {
                                  id: crypto.randomUUID(),
                                  title: a.title + " · 后段",
                                  objective: a.objective,
                                  shotIds: a.shotIds.slice(cut),
                                };
                                content(
                                  "acts",
                                  acts.flatMap((x: any) =>
                                    x.id === a.id
                                      ? [
                                          {
                                            ...x,
                                            shotIds: a.shotIds.slice(0, cut),
                                          },
                                          part,
                                        ]
                                      : [x],
                                  ),
                                );
                              }}
                            >
                              从此拆幕
                            </button>
                          )}
                          {gi > 0 && si === 0 && (
                            <button
                              className="button"
                              onClick={() =>
                                content(
                                  "acts",
                                  acts.flatMap((x: any, i: number) =>
                                    i === gi
                                      ? []
                                      : i === gi - 1
                                        ? [
                                            {
                                              ...x,
                                              shotIds: [
                                                ...x.shotIds,
                                                ...a.shotIds,
                                              ],
                                            },
                                          ]
                                        : [x],
                                  ),
                                )
                              }
                            >
                              并入上一幕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
