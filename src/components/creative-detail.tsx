"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Save,
  Trash2,
  Plus,
  History,
  Sparkles,
  Copy,
} from "lucide-react";
import { api } from "./api";
import "./creative-detail.css";

const planFields: Record<string, string> = {
  objective: "传播目标",
  audience: "目标用户",
  message: "核心表达",
  story: "故事结构",
  visualStyle: "视觉风格",
  sound: "声音设计 / 保留音轨",
};
const shotFields: Record<string, string> = {
  description: "画面",
  framing: "景别",
  camera: "机位",
  movement: "运镜",
  action: "动作",
  dialogue: "对白 / 旁白",
  sound: "声音",
  continuity: "连续性要求",
};
function LongText({ label, value, onChange, wide = false }: any) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "0px";
      el.style.height = Math.max(90, el.scrollHeight + 2) + "px";
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el.parentElement!);
    return () => observer.disconnect();
  }, [value]);
  return (
    <label className={wide ? "cd-wide" : ""}>
      {label}
      <textarea
        ref={ref}
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Picture({ id }: { id: string }) {
  const [file, setFile] = useState<any>(null);
  useEffect(() => {
    let active = true;
    api("/files/" + id)
      .then((f) => {
        if (active) setFile(f);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  return file?.url ? (
    <a href={file.url} target="_blank" rel="noreferrer">
      <img src={file.url} alt={file.name} loading="lazy" />
      <span>{file.name}</span>
    </a>
  ) : (
    <span>图片加载中</span>
  );
}
function AssetThumbnail({ id, version }: { id: string; version: number }) {
  const [asset, setAsset] = useState<any>(null);
  useEffect(() => {
    let active = true;
    api("/assets/" + id)
      .then((r) => {
        if (active)
          setAsset(
            r.revisions?.find((v: any) => v.version === version) ??
              (r.version === version ? r : null),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, version]);
  return asset?.content?.selectedFileId ? (
    <Picture id={asset.content.selectedFileId} />
  ) : null;
}
async function collection(path: string) {
  const first = await api(path);
  let items = [...first.items];
  for (let page = 2; items.length < (first.total ?? items.length); page++) {
    const next = await api(path + "&page=" + page);
    if (!next.items.length) break;
    items.push(...next.items);
  }
  return { ...first, items };
}
const planDefault = {
  objective: "",
  audience: "",
  message: "",
  story: "",
  visualStyle: "",
  sound: "",
  duration: 30,
  aspectRatio: "16:9",
  body: "",
};
export default function CreativeDetail({
  route,
  id,
  readOnly,
  notify,
  onDirtyChange,
  onReference,
}: any) {
  const router = useRouter(),
    params = useSearchParams(),
    isBoard = route === "storyboards";
  const [item, setItem] = useState<any>(null),
    [draft, setDraft] = useState<any>(null),
    [baseline, setBaseline] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [bodyMode, setBodyMode] = useState(readOnly ? "preview" : "edit"),
    [history, setHistory] = useState<any>(null),
    [historyVersion, setHistoryVersion] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]),
    [plans, setPlans] = useState<any[]>([]),
    [assets, setAssets] = useState<any[]>([]),
    [files, setFiles] = useState<any[]>([]),
    [concepts, setConcepts] = useState<any[]>([]),
    [boards, setBoards] = useState<any[]>([]);
  const dirty = !!draft && JSON.stringify(draft) !== baseline,
    dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const back = params.get("returnTo");
  const returnUrl =
    back?.startsWith("/studio/creative?") ||
    /^\/studio\/creative\/(plans|storyboards)\/[^?]+(?:\?.*)?$/.test(back ?? "")
      ? back!
      : "/studio/creative?tab=" +
        route +
        (draft?.productId ? "&productId=" + draft.productId : "");
  const navigate = useCallback(
    (url: string) => {
      if (dirtyRef.current && !window.confirm("有未保存的修改，确定离开？"))
        return;
      onDirtyChange(false);
      router.push(url);
    },
    [router, onDirtyChange],
  );
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const load = async () => {
      const record = id === "new" ? null : await api("/" + route + "/" + id);
      const d = {
        title: record?.title ?? "",
        status: record?.status ?? "draft",
        productId: record?.productId ?? params.get("productId") ?? "",
        planId: record?.planId ?? params.get("planId") ?? "",
        parentId: record?.parentId ?? params.get("parentId") ?? "",
        content: structuredClone(
          record?.content ?? (isBoard ? { shots: [] } : planDefault),
        ),
      };
      if (active) {
        setItem(record);
        setDraft(d);
        setBaseline(JSON.stringify(d));
        setConflict(false);
      }
      const p = await collection("/products?limit=100");
      if (d.productId && !p.items.some((r: any) => r.id === d.productId)) {
        try {
          p.items.push(await api("/products/" + d.productId));
        } catch {}
      }
      if (active) setProducts(p.items);
    };
    load()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route, id]);
  useEffect(() => {
    if (!draft?.productId) return;
    let active = true;
    const q =
      "?productId=" + encodeURIComponent(draft.productId) + "&limit=100";
    Promise.all([
      collection("/plans" + q),
      collection("/assets" + q),
      api("/files" + q),
      collection("/concepts" + q),
      collection("/storyboards" + q),
    ])
      .then(async ([p, a, f, c, b]) => {
        if (
          draft.parentId &&
          !c.items.some((r: any) => r.id === draft.parentId)
        ) {
          try {
            c.items.push(await api("/concepts/" + draft.parentId));
          } catch {}
        }
        if (draft.planId && !p.items.some((r: any) => r.id === draft.planId)) {
          try {
            p.items.push(await api("/plans/" + draft.planId));
          } catch {}
        }
        const assetIds = [
          ...new Set<string>(
            (draft.content.shots ?? []).flatMap((s: any) =>
              (s.assets ?? []).map((r: any) => r.resourceId),
            ),
          ),
        ];
        for (const id of assetIds)
          if (!a.items.some((r: any) => r.id === id)) {
            try {
              a.items.push(await api("/assets/" + id));
            } catch {}
          }
        const imageIds = [
          ...new Set<string>(
            (draft.content.shots ?? []).flatMap((s: any) =>
              [s.imageFileId, ...(s.candidateFileIds ?? [])].filter(Boolean),
            ),
          ),
        ];
        for (const id of imageIds)
          if (!f.items.some((r: any) => r.id === id)) {
            try {
              f.items.push(await api("/files/" + id));
            } catch {}
          }
        if (active) {
          setPlans(p.items);
          setAssets(a.items);
          setFiles(f.items);
          setConcepts(c.items);
          setBoards(b.items);
        }
      })
      .catch((e) => notify(e.message));
    return () => {
      active = false;
    };
  }, [draft?.productId]);
  const set = (key: string, value: any) =>
    setDraft((d: any) => ({ ...d, [key]: value }));
  const content = (key: string, value: any) =>
    setDraft((d: any) => ({ ...d, content: { ...d.content, [key]: value } }));
  const shot = (index: number, key: string, value: any) =>
    content(
      "shots",
      draft.content.shots.map((s: any, i: number) =>
        i === index ? { ...s, [key]: value } : s,
      ),
    );
  async function save() {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      const saved = await api(
        "/" + route + (item ? "/" + item.id : ""),
        item ? "PATCH" : "POST",
        {
          title: draft.title,
          status: draft.status,
          productId: draft.productId,
          ...(draft.planId ? { planId: draft.planId } : {}),
          ...(draft.parentId ? { parentId: draft.parentId } : {}),
          content: JSON.parse(
            JSON.stringify(
              {
                ...draft.content,
                ...(isBoard
                  ? {
                      shots: draft.content.shots.map((s: any, i: number) => ({
                        ...s,
                        number: i + 1,
                      })),
                    }
                  : {}),
              },
              (k, v) => (k === "imageFileId" && !v ? undefined : v),
            ),
          ),
          ...(item ? { baseVersion: item.version } : {}),
        },
      );
      const next = {
        title: saved.title,
        status: saved.status,
        productId: saved.productId,
        planId: saved.planId ?? "",
        parentId: saved.parentId ?? "",
        content: saved.content,
      };
      setItem(saved);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setConflict(false);
      onDirtyChange(false);
      notify("已保存新版本", "success");
      if (id === "new")
        router.replace(
          "/studio/creative/" +
            route +
            "/" +
            saved.id +
            "?returnTo=" +
            encodeURIComponent(returnUrl),
        );
    } catch (e: any) {
      if (e.status === 409) setConflict(true);
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function historyOpen() {
    try {
      setHistory(await api("/" + route + "/" + item.id));
      setHistoryVersion(null);
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function remove() {
    if (!window.confirm("删除后移入已归档，历史版本与关联资料保留。确定删除？"))
      return;
    if (dirty && !window.confirm("删除会放弃未保存的修改，确定继续？")) return;
    setBusy(true);
    try {
      await api("/" + route + "/" + item.id, "DELETE", {
        baseVersion: item.version,
      });
      onDirtyChange(false);
      dirtyRef.current = false;
      notify("已删除，可在已归档中恢复", "success");
      router.push(returnUrl);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(index: number, file: File) {
    setBusy(true);
    try {
      const r = await api("/files", "POST", {
        productId: draft.productId,
        name: file.name,
        mime: file.type,
        bytes: file.size,
        parsePolicy: "skip",
      });
      const response = await fetch(r.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw Error("图片上传失败");
      await api("/files/" + r.file.id + "/complete", "POST", {});
      setFiles((f) => [...f, { ...r.file, status: "ready" }]);
      const s = draft.content.shots[index];
      shot(index, "candidateFileIds", [
        ...new Set([...(s.candidateFileIds ?? []), r.file.id]),
      ]);
      notify("图片已上传，选择后保存分镜", "success");
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return <p role="status">加载{isBoard ? "工业分镜" : "策划案"}…</p>;
  if (error || !draft)
    return (
      <div role="alert">
        <p>{error || "内容不存在"}</p>
        <button className="button" onClick={() => navigate(returnUrl)}>
          返回列表
        </button>
      </div>
    );
  const associated = concepts.find((c) => c.id === draft.parentId),
    plan = plans.find((p) => p.id === draft.planId),
    board = boards.find((b) => b.planId === item?.id);
  return (
    <div className="creative-detail">
      <button className="button" onClick={() => navigate(returnUrl)}>
        <ArrowLeft size={16} />
        返回{isBoard ? "工业分镜" : "策划案"}列表
      </button>
      <header className="cd-heading">
        <div>
          <span className="eyebrow">
            {isBoard ? "INDUSTRIAL STORYBOARD" : "CREATIVE PLAN"}
          </span>
          <h1>{draft.title || (isBoard ? "新建工业分镜" : "新建策划案")}</h1>
          <p>
            {products.find((p) => p.id === draft.productId)?.title ??
              "选择所属产品"}{" "}
            · {item ? "V" + item.version : "新建"} ·{" "}
            {dirty ? "有未保存的修改" : "已保存"}
            {readOnly && " · 只读"}
          </p>
          {isBoard && (
            <p>
              {draft.content.shots.length}个镜头 · 总时长{" "}
              {draft.content.shots.reduce(
                (n: number, s: any) => n + Number(s.duration || 0),
                0,
              )}{" "}
              秒
            </p>
          )}
        </div>
        <div className="cd-actions">
          {item && (
            <button className="button" onClick={historyOpen}>
              <History size={16} />
              历史版本
            </button>
          )}
          {item && (
            <button className="button" onClick={() => onReference(item)}>
              <Sparkles size={16} />
              AI 协作
            </button>
          )}
          {item && isBoard && !readOnly && (
            <button
              className="button"
              disabled={busy || dirty}
              title={dirty ? "请先保存分镜" : ""}
              onClick={() =>
                api("/storyboards/" + item.id + "/overview", "POST", {})
                  .then(() => notify("总览任务已创建，请在日志查看", "success"))
                  .catch((e) => notify(e.message))
              }
            >
              拼接总览
            </button>
          )}
          {item && !isBoard && (
            <button
              className="button"
              onClick={() =>
                navigate(
                  "/studio/creative/storyboards/" +
                    (board?.id ?? "new") +
                    "?productId=" +
                    draft.productId +
                    "&planId=" +
                    item.id +
                    "&returnTo=" +
                    encodeURIComponent("/studio/creative/plans/" + item.id),
                )
              }
            >
              {board ? "查看工业分镜" : "新建工业分镜"}
            </button>
          )}
          {item && !readOnly && (
            <button className="button danger" disabled={busy} onClick={remove}>
              <Trash2 size={16} />
              删除
            </button>
          )}
          {!readOnly && (
            <button
              className="button dark"
              disabled={
                busy ||
                !draft.title.trim() ||
                !draft.productId ||
                (isBoard && !draft.planId)
              }
              onClick={save}
            >
              <Save size={16} />
              {busy ? "处理中…" : "保存修订"}
            </button>
          )}
        </div>
      </header>
      {conflict && (
        <section role="alert" className="cd-conflict">
          内容已被其他人更新，本地修改已保留。
          <button className="button" onClick={historyOpen}>
            查看最新版本
          </button>
          <button
            className="button"
            onClick={async () => {
              if (!confirm("放弃本地修改并加载最新版本？")) return;
              const r = await api("/" + route + "/" + id);
              const d = {
                ...draft,
                title: r.title,
                status: r.status,
                content: r.content,
              };
              setItem(r);
              setDraft(d);
              setBaseline(JSON.stringify(d));
              setConflict(false);
            }}
          >
            放弃修改并加载最新
          </button>
        </section>
      )}
      {history && (
        <section className="cd-panel">
          <div className="cd-section">
            <h2>版本历史</h2>
            <button className="button" onClick={() => setHistory(null)}>
              关闭历史
            </button>
          </div>
          <div className="cd-actions">
            {history.revisions?.map((r: any) => (
              <button
                key={r.version}
                className="button"
                onClick={() => setHistoryVersion(r)}
              >
                V{r.version} · {new Date(r.createdAt).toLocaleString()}
              </button>
            ))}
          </div>
          {historyVersion && (
            <article>
              <h3>
                {historyVersion.title} · V{historyVersion.version}
              </h3>
              {isBoard ? (
                historyVersion.content.shots.map((s: any) => (
                  <p key={s.id}>
                    {s.number} · {s.description}
                  </p>
                ))
              ) : (
                <Markdown remarkPlugins={[remarkGfm]}>
                  {Object.entries(historyVersion.content)
                    .map(
                      ([k, v]) =>
                        `### ${planFields[k] ?? (k === "body" ? "策划正文" : k)}\n\n${v}`,
                    )
                    .join("\n\n")}
                </Markdown>
              )}
              <p className="muted">
                来源：{JSON.stringify(historyVersion.sources)}
              </p>
            </article>
          )}
        </section>
      )}
      <fieldset disabled={readOnly || busy} className="cd-fields">
        <section className="cd-panel">
          <h2>基础信息</h2>
          <div className="cd-grid">
            <label>
              名称
              <input
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>
            <label>
              状态
              <select
                value={draft.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {Object.entries({
                  draft: "草稿",
                  selected: "已入选",
                  rejected: "已淘汰",
                  ready: "就绪",
                  archived: "已归档",
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              所属产品
              <select
                disabled={!!item}
                value={draft.productId}
                onChange={(e) => {
                  set("productId", e.target.value);
                  set("planId", "");
                  set("parentId", "");
                }}
              >
                <option value="">选择产品</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            {isBoard ? (
              <label>
                关联策划案
                <select
                  disabled={!!item}
                  value={draft.planId}
                  onChange={(e) => set("planId", e.target.value)}
                >
                  <option value="">选择策划案</option>
                  {plan && !plans.some((p) => p.id === plan.id) && (
                    <option value={plan.id}>{plan.title}</option>
                  )}
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                来源创意
                <select
                  disabled={!!item}
                  value={draft.parentId}
                  onChange={(e) => set("parentId", e.target.value)}
                >
                  <option value="">无关联创意</option>
                  {draft.parentId && !associated && (
                    <option value={draft.parentId}>关联创意（历史对象）</option>
                  )}
                  {concepts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!isBoard && (
              <>
                <label>
                  时长（秒）
                  <input
                    type="number"
                    min={1}
                    max={3600}
                    value={draft.content.duration}
                    onChange={(e) =>
                      content("duration", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  画幅
                  <select
                    value={draft.content.aspectRatio}
                    onChange={(e) => content("aspectRatio", e.target.value)}
                  >
                    {["16:9", "9:16", "1:1", "4:3", "3:4"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </section>
        {!isBoard ? (
          <>
            <section className="cd-panel">
              <h2>创作方向</h2>
              <div className="cd-grid">
                {Object.entries(planFields).map(([k, label]) => (
                  <LongText
                    key={k}
                    label={label}
                    value={draft.content[k]}
                    wide={k === "story" || k === "message"}
                    onChange={(v: string) => content(k, v)}
                  />
                ))}
              </div>
            </section>
            <section className="cd-panel">
              <div className="cd-section">
                <h2>策划正文</h2>
                <div className="cd-actions">
                  <button
                    className="button"
                    onClick={() => setBodyMode("edit")}
                  >
                    编辑 Markdown
                  </button>
                  <button
                    className="button"
                    onClick={() => setBodyMode("preview")}
                  >
                    预览正文
                  </button>
                </div>
              </div>
              {bodyMode === "edit" ? (
                <LongText
                  label="策划正文 · Markdown"
                  value={draft.content.body}
                  onChange={(v: string) => content("body", v)}
                />
              ) : (
                <article className="cd-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {draft.content.body || "暂无正文"}
                  </Markdown>
                </article>
              )}
            </section>
          </>
        ) : (
          <>
            <div className="cd-section">
              <h2>完整镜头表</h2>
              <button
                className="button"
                onClick={() =>
                  content("shots", [
                    ...draft.content.shots,
                    {
                      id: crypto.randomUUID(),
                      number: draft.content.shots.length + 1,
                      duration: 5,
                      description: "",
                      framing: "",
                      camera: "",
                      movement: "",
                      action: "",
                      dialogue: "",
                      sound: "",
                      continuity: "",
                      assets: [],
                      candidateFileIds: [],
                    },
                  ])
                }
              >
                <Plus size={16} />
                添加镜头
              </button>
            </div>
            {draft.content.shots.map((s: any, index: number) => (
              <section className="cd-panel cd-shot" key={s.id}>
                <div className="cd-section">
                  <h3>镜头 {String(index + 1).padStart(2, "0")}</h3>
                  <div className="cd-actions">
                    <button
                      className="button"
                      disabled={index === 0}
                      aria-label={"上移镜头" + (index + 1)}
                      onClick={() => {
                        const a = [...draft.content.shots];
                        [a[index - 1], a[index]] = [a[index], a[index - 1]];
                        content("shots", a);
                      }}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      className="button"
                      disabled={index === draft.content.shots.length - 1}
                      aria-label={"下移镜头" + (index + 1)}
                      onClick={() => {
                        const a = [...draft.content.shots];
                        [a[index + 1], a[index]] = [a[index], a[index + 1]];
                        content("shots", a);
                      }}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        if (confirm("移除此镜头？保存后生效。"))
                          content(
                            "shots",
                            draft.content.shots.filter(
                              (_: any, i: number) => i !== index,
                            ),
                          );
                      }}
                    >
                      <Trash2 size={16} />
                      移除镜头
                    </button>
                  </div>
                </div>
                <div className="cd-grid">
                  <label>
                    镜头{index + 1}时长（秒）
                    <input
                      type="number"
                      min={0.1}
                      max={300}
                      step={0.1}
                      value={s.duration}
                      onChange={(e) =>
                        shot(index, "duration", Number(e.target.value))
                      }
                    />
                  </label>
                  {Object.entries(shotFields).map(([k, label]) => (
                    <LongText
                      key={k}
                      label={"镜头" + (index + 1) + " · " + label}
                      wide={k === "description"}
                      value={s[k]}
                      onChange={(v: string) => shot(index, k, v)}
                    />
                  ))}
                </div>
                <div className="cd-grid">
                  <label>
                    选用分镜图
                    <select
                      value={s.imageFileId ?? ""}
                      onChange={(e) =>
                        shot(index, "imageFileId", e.target.value)
                      }
                    >
                      <option value="">暂未选择</option>
                      {files
                        .filter(
                          (f) =>
                            f.status === "ready" && f.mime.startsWith("image/"),
                        )
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    上传候选图
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          void upload(index, e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <div className="cd-pictures">
                  {s.imageFileId && <Picture id={s.imageFileId} />}
                  <div>
                    {(s.candidateFileIds ?? [])
                      .filter((fid: string) => fid !== s.imageFileId)
                      .map((fid: string) => (
                        <div key={fid}>
                          <Picture id={fid} />
                          <button
                            className="button"
                            onClick={() => shot(index, "imageFileId", fid)}
                          >
                            选用此图
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
                <h4>引用资产（固定版本）</h4>
                {s.assets?.map((ref: any, i: number) => (
                  <div className="cd-actions" key={ref.resourceId}>
                    <AssetThumbnail id={ref.resourceId} version={ref.version} />
                    <span>
                      {assets.find((a) => a.id === ref.resourceId)?.title ??
                        "关联资产"}
                    </span>
                    <label>
                      版本
                      <input
                        type="number"
                        min={1}
                        value={ref.version}
                        onChange={(e) =>
                          shot(
                            index,
                            "assets",
                            s.assets.map((a: any, j: number) =>
                              i === j
                                ? { ...a, version: Number(e.target.value) }
                                : a,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      className="button"
                      onClick={() =>
                        shot(
                          index,
                          "assets",
                          s.assets.filter((_: any, j: number) => j !== i),
                        )
                      }
                    >
                      移除引用
                    </button>
                  </div>
                ))}
                <label>
                  添加资产
                  <select
                    value=""
                    onChange={(e) => {
                      const a = assets.find((a) => a.id === e.target.value);
                      if (
                        a &&
                        !s.assets.some((r: any) => r.resourceId === a.id)
                      )
                        shot(index, "assets", [
                          ...s.assets,
                          { resourceId: a.id, version: a.version },
                        ]);
                    }}
                  >
                    <option value="">选择产品资产</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title} · V{a.version}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            ))}
          </>
        )}
      </fieldset>
      {item && (
        <div className="cd-actions">
          <button
            className="button"
            onClick={() =>
              navigator.clipboard
                .writeText(item.id)
                .then(() => notify("对象 ID 已复制", "success"))
            }
          >
            <Copy size={15} />
            复制对象 ID
          </button>
          {draft.parentId && (
            <button
              className="button"
              onClick={() => navigator.clipboard.writeText(draft.parentId)}
            >
              复制来源创意 ID
            </button>
          )}
        </div>
      )}
    </div>
  );
}
