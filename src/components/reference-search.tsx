"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
export default function ReferenceSearch({
  productId,
  files,
  readOnly,
  onAdd,
  notify,
}: {
  productId: string;
  files: any[];
  readOnly: boolean;
  onAdd: (video: any) => void;
  notify: (text: string, kind?: string) => void;
}) {
  const [history, setHistory] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [image, setImage] = useState(""),
    [brief, setBrief] = useState(""),
    [depth, setDepth] = useState("standard"),
    [type, setType] = useState("tvc"),
    [count, setCount] = useState(30),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [minimum, setMinimum] = useState(0);
  const base = "/products/" + productId + "/reference-searches";
  useEffect(() => {
    let active = true;
    api(base)
      .then((r) => {
        if (active) {
          setHistory(r.items);
          setSelected(r.items[0] ?? null);
        }
      })
      .catch((e) => notify(e.message));
    return () => {
      active = false;
    };
  }, [base]);
  useEffect(() => {
    if (!selected?.id || !selected.upstreamId) return;
    let active = true;
    const refresh = () =>
      api(base + "/" + selected.id)
        .then((r) => {
          if (active) setSelected(r);
        })
        .catch((e) => {
          if (active) notify(e.message);
        });
    void refresh();
    const timer = setInterval(() => {
      if (
        !["failed", "succeeded", "needs_confirmation"].includes(selected.status)
      )
        void refresh();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base, selected?.id, selected?.status]);
  async function start() {
    setBusy(true);
    try {
      const job = await api(base, "POST", {
        imageFileId: image,
        brief,
        depth,
        targetCount: count,
        videoType: type,
      });
      setHistory((h) => [job, ...h]);
      setSelected(job);
      notify("检索任务已提交", "success");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const run = selected?.result?.run;
  const safe = (url: string) => /^https?:\/\//i.test(url ?? "");
  return (
    <section className="pd-panel">
      <div className="pd-section-title">
        <div>
          <h2>检索参考视频</h2>
          <p className="muted">
            用产品图与制作需求检索同品类、竞品、情绪、结构和获奖案例。AI
            评分与参考点请看片核实。
          </p>
        </div>
      </div>
      {!readOnly && (
        <div className="reference-search-form">
          <label>
            产品图片
            <select
              aria-label="检索产品图片"
              value={image}
              onChange={(e) => setImage(e.target.value)}
            >
              <option value="">选择已上传的产品图</option>
              {files
                .filter(
                  (f) =>
                    f.status === "ready" &&
                    ["image/jpeg", "image/png", "image/webp"].includes(f.mime),
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            检索需求
            <textarea
              placeholder="例如：30秒TVC，年轻白领，强调产品卖点、希望借鉴的品牌与视觉调性"
              value={brief}
              maxLength={10000}
              onChange={(e) => setBrief(e.target.value)}
            />
          </label>
          <div className="row-actions">
            <label>
              深度
              <select value={depth} onChange={(e) => setDepth(e.target.value)}>
                <option value="quick">快速</option>
                <option value="standard">标准</option>
                <option value="deep">深度</option>
              </select>
            </label>
            <label>
              视频类型
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries({
                  tvc: "TVC广告",
                  brand: "品牌片",
                  ugc: "达人种草",
                  product: "产品展示",
                  story: "剧情广告",
                  cg: "CG动画",
                  case: "获奖案例",
                  review: "开箱测评",
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              目标数量
              <input
                type="number"
                min={5}
                max={200}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <button
              className="button primary"
              disabled={!image || busy}
              onClick={start}
            >
              {busy ? "提交中…" : "开始检索"}
            </button>
          </div>
        </div>
      )}
      <label>
        检索历史
        <select
          value={selected?.id ?? ""}
          onChange={(e) =>
            setSelected(history.find((h) => h.id === e.target.value) ?? null)
          }
        >
          <option value="">选择检索任务</option>
          {history.map((h) => (
            <option value={h.id} key={h.id}>
              {new Date(h.createdAt).toLocaleString()} ·{" "}
              {h.input.brief?.slice(0, 40) || "产品参考检索"}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <p role="status">
          {selected.result?.task?.stage ||
            (
              {
                queued: "排队中",
                running: "正在检索",
                searching: "正在检索",
                awaiting_submit: "等待提交",
                succeeded: "检索完成",
                failed: "检索失败",
                needs_confirmation: "提交待确认",
              } as any
            )[selected.status]}{" "}
          {selected.result?.task?.percent ?? 0}% {selected.error}
        </p>
      )}
      {run && (
        <>
          <div className="row-actions">
            <input
              aria-label="筛选参考视频"
              placeholder="检索标题、平台、参考点"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label>
              最低评分
              <input
                type="number"
                min={0}
                max={10}
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </label>
          </div>
          {run.dimensions?.map((d: any) => (
            <div key={d.key}>
              <h3>{d.name}</h3>
              <p className="muted">
                {d.what_to_learn}
                {d.pending && " · 等待评估"}
              </p>
              <div className="reference-results">
                {d.videos
                  ?.filter(
                    (v: any) =>
                      (v.score ?? 0) >= minimum &&
                      [v.title, v.platform, v.reference]
                        .join(" ")
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((v: any) => (
                    <article key={v.url} className="reference-result">
                      {safe(v.thumbnail) && (
                        <img
                          src={v.thumbnail}
                          referrerPolicy="no-referrer"
                          alt=""
                          loading="lazy"
                        />
                      )}
                      <h4>{v.title}</h4>
                      <p>
                        {v.platform} · {v.duration ?? "—"}秒 · {v.score ?? "—"}
                        /10
                      </p>
                      <p>{v.reference}</p>
                      <div className="row-actions">
                        {safe(v.url) && (
                          <a
                            className="button"
                            href={v.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            打开原片
                          </a>
                        )}
                        {!readOnly && safe(v.url) && (
                          <button
                            className="button"
                            onClick={() => onAdd({ ...v, dimension: d.name })}
                          >
                            加入参考笔记
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
            </div>
          ))}
          {run.errors?.length > 0 && (
            <p className="muted">部分渠道检索失败，其他结果仍可使用。</p>
          )}
        </>
      )}
    </section>
  );
}
