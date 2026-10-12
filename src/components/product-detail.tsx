"use client";
import Select from "./select";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Save,
  Upload,
  Sparkles,
  History,
  ArrowUpRight,
  FileText,
  Image as ImageIcon,
  Film,
  Link as LinkIcon,
  X,
  Download,
  Copy,
  Check,
  LoaderCircle,
} from "lucide-react";
import { api, Item } from "./api";
import { adaptProductContent, materialCategory } from "@/lib/product-content";
import "./product-detail.css";

const tabs = {
  overview: "产品概览",
  insights: "产品洞察",
  brief: "产品 Brief",
  materials: "产品素材",
  references: "参考视频",
};
const categories: Record<string, string> = {
  "product-image": "产品图",
  "product-video": "产品视频",
  document: "产品资料",
  other: "其他附件",
};
const parseLabels: Record<string, string> = {
  pending: "等待解析",
  processing: "正在解析",
  succeeded: "已解析",
  completed: "已解析",
  failed: "解析失败",
  skipped: "未自动解析",
};
const briefTemplate =
  "# 产品 Brief\n\n## 产品事实\n\n## 目标人群\n\n## 场景与痛点\n\n## 核心价值\n\n## 支撑证据\n\n## 表达限制\n\n## 待验证假设\n";
const blank = () => ({
  title: "",
  status: "draft",
  content: adaptProductContent(),
});
type Draft = ReturnType<typeof blank>;
type Field = {
  key: string;
  label: string;
  type?: "files" | "select" | "tags";
  options?: Record<string, string>;
};
const evidence: Field[] = [
  { key: "evidence", label: "证据说明" },
  { key: "fileIds", label: "关联资料", type: "files" },
  { key: "sourceUrl", label: "来源链接" },
];
const insightLists: {
  key: string;
  title: string;
  noun: string;
  fields: Field[];
  empty: any;
}[] = [
  {
    key: "sellingPointItems",
    title: "产品卖点",
    noun: "卖点",
    empty: {
      title: "",
      feature: "",
      benefit: "",
      evidence: "",
      fileIds: [],
      sourceUrl: "",
    },
    fields: [
      { key: "title", label: "卖点描述" },
      { key: "feature", label: "产品特点" },
      { key: "benefit", label: "用户收益" },
      ...evidence,
    ],
  },
  {
    key: "audienceSegments",
    title: "目标用户",
    noun: "人群",
    empty: { name: "", scenario: "", pain: "", needs: "", objections: "" },
    fields: [
      { key: "name", label: "人群名称" },
      { key: "scenario", label: "典型场景" },
      { key: "pain", label: "主要痛点" },
      { key: "needs", label: "需求" },
      { key: "objections", label: "购买顾虑" },
    ],
  },
  {
    key: "userQuotes",
    title: "用户原话",
    noun: "原话",
    empty: { text: "", source: "", evidence: "", fileIds: [], sourceUrl: "" },
    fields: [
      { key: "text", label: "用户原话" },
      { key: "source", label: "来源说明" },
      ...evidence,
    ],
  },
  {
    key: "facts",
    title: "事实与假设",
    noun: "事实或假设",
    empty: { text: "", kind: "hypothesis", source: "", sourceUrl: "" },
    fields: [
      { key: "text", label: "内容" },
      {
        key: "kind",
        label: "证据状态",
        type: "select",
        options: { fact: "已证实事实", hypothesis: "待验证假设" },
      },
      { key: "source", label: "来源说明" },
      { key: "fileId", label: "关联资料", type: "files" },
      { key: "sourceUrl", label: "来源链接" },
    ],
  },
  {
    key: "questions",
    title: "待确认问题",
    noun: "问题",
    empty: { text: "", note: "", status: "pending" },
    fields: [
      { key: "text", label: "问题" },
      { key: "note", label: "补充说明" },
      {
        key: "status",
        label: "确认状态",
        type: "select",
        options: { pending: "待确认", confirmed: "已确认" },
      },
    ],
  },
];
const referenceFields: Field[] = [
  { key: "title", label: "参考名称" },
  { key: "source", label: "来源／作者" },
  { key: "purpose", label: "参考目的" },
  { key: "tags", label: "标签（逗号分隔）", type: "tags" },
  ...[
    ["hook", "钩子"],
    ["structure", "叙事结构"],
    ["rhythm", "节奏"],
    ["shots", "镜头"],
    ["sound", "声音"],
    ["takeaways", "可借鉴点"],
    ["avoid", "不适合照搬的部分"],
  ].map(([key, label]) => ({ key, label })),
];
function reference(file?: any) {
  return {
    id: crypto.randomUUID(),
    title: file?.name ?? "",
    type: file ? "file" : "link",
    ...(file ? { fileId: file.id } : {}),
    url: "",
    source: "",
    purpose: "",
    tags: [],
    hook: "",
    structure: "",
    rhythm: "",
    shots: "",
    sound: "",
    takeaways: "",
    avoid: "",
  };
}

function EditorField({
  field,
  value,
  change,
  readOnly,
  files,
}: {
  field: Field;
  value: any;
  change: (v: any) => void;
  readOnly: boolean;
  files: any[];
}) {
  const label = field.label;
  return (
    <label className="pd-field">
      {label}
      {field.type === "select" ? (
        <Select
          aria-label={label}
          value={value ?? ""}
          disabled={readOnly}
          onChange={(e) => change(e.target.value)}
        >
          {Object.entries(field.options!).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </Select>
      ) : field.type === "files" ? (
        <Select
          aria-label={label}
          multiple={field.key === "fileIds"}
          value={value ?? (field.key === "fileIds" ? [] : "")}
          disabled={readOnly}
          onChange={(e) =>
            change(
              field.key === "fileIds"
                ? Array.from(e.target.selectedOptions, (o) => o.value)
                : e.target.value || undefined,
            )
          }
        >
          {field.key === "fileId" && <option value="">未关联</option>}
          {files.map((f) => (
            <option value={f.id} key={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      ) : field.type === "tags" ? (
        <input
          aria-label={label}
          value={(value ?? []).join(", ")}
          readOnly={readOnly}
          onChange={(e) =>
            change(e.target.value.split(/[,，]/).map((s) => s.trim()))
          }
        />
      ) : (
        <textarea
          aria-label={label}
          rows={
            ["title", "name", "sourceUrl", "url"].includes(field.key) ? 1 : 3
          }
          value={value ?? ""}
          readOnly={readOnly}
          onChange={(e) => change(e.target.value)}
        />
      )}
    </label>
  );
}
function Rows({
  title,
  noun,
  rows,
  fields,
  empty,
  onChange,
  readOnly,
  files,
  render,
}: {
  title: string;
  noun: string;
  rows: any[];
  fields: Field[];
  empty: any;
  onChange: (rows: any[]) => void;
  readOnly: boolean;
  files: any[];
  render?: (row: any) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const knownRows = useRef(new Set(rows.map((row) => row.id)));
  useEffect(() => {
    const added = rows.filter((row) => !knownRows.current.has(row.id));
    if (added.length) setExpanded(added[added.length - 1].id);
    knownRows.current = new Set(rows.map((row) => row.id));
  }, [rows]);
  function move(i: number, delta: number) {
    const result = [...rows];
    [result[i], result[i + delta]] = [result[i + delta], result[i]];
    onChange(result);
  }
  return (
    <section className="pd-panel">
      <div className="pd-section-title">
        <div>
          <h2>{title}</h2>
          <span className="muted">{rows.length} 条 · 每一条都可以继续补充</span>
        </div>
        {!readOnly && (
          <button
            className="button"
            onClick={() => {
              const id = crypto.randomUUID();
              onChange([...rows, { ...structuredClone(empty), id }]);
              setExpanded(id);
            }}
          >
            <Plus size={15} />
            添加{noun}
          </button>
        )}
      </div>
      {!rows.length && (
        <p className="pd-empty">
          还没有{title}。先记下已知内容，其他细节可以稍后补充。
        </p>
      )}
      <div className="pd-rows">
        {rows.map((row, index) => (
          <article className="pd-row" key={row.id}>
            <div className="pd-row-head">
              <button
                className="pd-row-toggle"
                aria-expanded={expanded === row.id}
                onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              >
                <span className="pd-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>
                  {row.title || row.name || row.text || `新${noun}`}
                </strong>
                <span>{expanded === row.id ? "收起" : "展开"}</span>
              </button>
              {!readOnly && (
                <div className="pd-row-actions">
                  <button
                    className="icon-button"
                    disabled={!index}
                    aria-label={`上移${noun}`}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={index === rows.length - 1}
                    aria-label={`下移${noun}`}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除${noun}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除这条${noun}？保存后生效，历史版本仍保留。`,
                        )
                      )
                        onChange(rows.filter((r) => r.id !== row.id));
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
            {expanded === row.id && (
              <div className="pd-row-content">
                {render?.(row)}
                <div className="pd-fields">
                  {fields.map((field) => (
                    <EditorField
                      key={field.key}
                      field={field}
                      value={row[field.key]}
                      readOnly={readOnly}
                      files={files}
                      change={(value) =>
                        onChange(
                          rows.map((r) =>
                            r.id === row.id ? { ...r, [field.key]: value } : r,
                          ),
                        )
                      }
                    />
                  ))}
                  {row.type === "link" && (
                    <EditorField
                      field={{ key: "url", label: "视频链接" }}
                      value={row.url}
                      readOnly={readOnly}
                      files={files}
                      change={(url) =>
                        onChange(
                          rows.map((r) =>
                            r.id === row.id ? { ...r, url } : r,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
function FileView({
  id,
  onZoom,
}: {
  id: string;
  onZoom: (url: string) => void;
}) {
  const [file, setFile] = useState<any>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api(`/files/${id}`)
        .then((f) => {
          setFile(f);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    let active = true;
    api(`/files/${id}`)
      .then((f) => active && setFile(f))
      .catch((e) => active && setError(e.message));
    const t = setInterval(
      () => {
        if (active) void load();
      },
      50 * 60 * 1000,
    );
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [id, load]);
  if (error)
    return (
      <p className="error">
        {error}{" "}
        {file?.url && (
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            download={file.name}
          >
            下载原文件
          </a>
        )}
        <button className="button" onClick={load}>
          重新加载
        </button>
      </p>
    );
  if (!file) return <div className="pd-preview-placeholder">加载文件…</div>;
  return (
    <>
      <div className="pd-preview">
        {file.url && file.mime.startsWith("image/") ? (
          <button
            onClick={() => onZoom(file.url)}
            aria-label={`放大 ${file.name}`}
          >
            <img
              src={file.url}
              alt={file.name}
              onError={() => setError("图片加载失败，可刷新链接重试")}
            />
          </button>
        ) : file.url && file.mime.startsWith("video/") ? (
          <video
            controls
            preload="metadata"
            src={file.url}
            aria-label={file.name}
            onError={() => setError("视频无法播放，可下载或刷新链接重试")}
          />
        ) : file.url && file.mime.startsWith("audio/") ? (
          <audio controls preload="metadata" src={file.url} />
        ) : (
          <FileText size={32} />
        )}
      </div>
      <div className="pd-file-links">
        <span>{(file.bytes / 1024 / 1024).toFixed(2)} MB</span>
        {file.url && (
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            download={file.name}
          >
            <Download size={14} />
            下载原文件
          </a>
        )}
      </div>
    </>
  );
}

type UploadItem = {
  key: string;
  file: File;
  reference: boolean;
  category: string;
  status: string;
  progress: number;
  error?: string;
  fileId?: string;
  uploaded?: boolean;
};
export default function ProductDetail({
  id,
  readOnly,
  notify,
  onDirtyChange,
  onChat,
  onSaved,
}: {
  id: string;
  readOnly: boolean;
  notify: (text: string, kind?: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onChat: () => void;
  onSaved: () => void;
}) {
  const router = useRouter(),
    searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") ?? "overview",
    tab = Object.hasOwn(tabs, requestedTab) ? requestedTab : "overview";
  const [draft, setDraft] = useState<Draft>(blank),
    [saved, setSaved] = useState(""),
    [product, setProduct] = useState<Item | null>(null),
    [loading, setLoading] = useState(id !== "new"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [conflict, setConflict] = useState(false);
  const [files, setFiles] = useState<any[]>([]),
    [uploads, setUploads] = useState<UploadItem[]>([]),
    [picker, setPicker] = useState<"material" | "reference" | null>(null),
    [zoom, setZoom] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [uploadCategory, setUploadCategory] = useState("auto"),
    [briefMode, setBriefMode] = useState("split");
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [mergeLatest, setMergeLatest] = useState<Item | null>(null);
  const [mergeChoices, setMergeChoices] = useState<Record<string, string>>({});
  const fieldNames: Record<string, string> = {
    title: "产品名称",
    status: "产品状态",
    description: "产品描述",
    positioning: "一句话定位",
    sellingPointItems: "产品卖点",
    audienceSegments: "目标用户",
    brief: "产品 Brief",
    materials: "产品素材",
    referenceVideos: "参考视频",
    userQuotes: "用户原话",
    facts: "事实与假设",
    questions: "待确认问题",
    coverFileId: "产品封面",
  };
  const flatten = (d: any) => {
    const c = { ...d.content };
    delete c.sellingPoints;
    delete c.audience;
    delete c.fileIds;
    return { title: d.title, status: d.status, ...c };
  };
  const baseFields = saved ? flatten(JSON.parse(saved)) : {};
  const localFields = flatten(draft),
    latestFields = mergeLatest ? flatten(mergeLatest) : {};
  const mergeConflicts = mergeLatest
    ? Object.keys(localFields).filter(
        (k) =>
          JSON.stringify(localFields[k]) !== JSON.stringify(baseFields[k]) &&
          JSON.stringify(latestFields[k]) !== JSON.stringify(baseFields[k]) &&
          JSON.stringify(localFields[k]) !== JSON.stringify(latestFields[k]),
      )
    : [];
  function applyMerge() {
    if (!mergeLatest) return;
    const result: any = { ...latestFields };
    for (const key of Object.keys(localFields))
      if (
        JSON.stringify(localFields[key]) !== JSON.stringify(baseFields[key]) &&
        (!mergeConflicts.includes(key) || mergeChoices[key] === "local")
      )
        result[key] = localFields[key];
    const { title, status, ...content } = result;
    setProduct(mergeLatest);
    setSaved(
      JSON.stringify({
        title: mergeLatest.title,
        status: mergeLatest.status,
        content: adaptProductContent(mergeLatest.content),
      }),
    );
    setDraft({ title, status, content: adaptProductContent(content) });
    setMergeLatest(null);
    setConflict(false);
    notify("已合并到最新版本，请检查内容后保存", "success");
  }
  const dirty =
    !loading &&
    (JSON.stringify(draft) !== saved ||
      uploads.some((u) => u.status === "uploading" || u.status === "pending"));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const active = useRef(true),
    xhrs = useRef(new Set<XMLHttpRequest>());
  const baselineUrl = useRef(""),
    baselineState = useRef<any>(null);
  const content = draft.content;
  const savingRef = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      xhrs.current.forEach((x) => x.abort());
      onDirtyChange(false);
    };
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    baselineUrl.current = window.location.href;
    baselineState.current = window.history.state;
  }, [searchParams]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const back = (e: PopStateEvent) => {
      if (
        new URL(baselineUrl.current).pathname !== window.location.pathname &&
        dirtyRef.current &&
        !window.confirm("产品有未保存的修改，确定离开？")
      ) {
        e.stopImmediatePropagation();
        window.history.pushState(
          baselineState.current,
          "",
          baselineUrl.current,
        );
      }
    };
    const link = (e: MouseEvent) => {
      const a = (e.target as Element)?.closest?.("a");
      if (
        a &&
        !a.target &&
        new URL(a.href).pathname !== window.location.pathname &&
        dirtyRef.current &&
        !window.confirm("产品有未保存的修改，确定离开？")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", back, true);
    document.addEventListener("click", link, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", back, true);
      document.removeEventListener("click", link, true);
    };
  }, []);
  const loadFiles = useCallback(async () => {
    if (id === "new") return;
    const result: any[] = [];
    let page = 1;
    while (true) {
      const data = await api(`/files?productId=${id}&limit=100&page=${page++}`);
      result.push(...data.items);
      if (!data.hasMore) break;
    }
    if (active.current) setFiles(result);
  }, [id]);
  const loadProduct = useCallback(async () => {
    if (id === "new") {
      const value = blank();
      setDraft(value);
      setSaved(JSON.stringify(value));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const p = await api(`/products/${id}`);
      if (!active.current) return;
      const value = {
        title: p.title,
        status: p.status,
        content: adaptProductContent(p.content),
      };
      setProduct(p);
      setDraft(value);
      setSaved(JSON.stringify(value));
      setConflict(false);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void loadProduct();
    void loadFiles().catch((e) => notify(e.message));
  }, [loadProduct, loadFiles, notify]);
  useEffect(() => {
    const changed = () => {
      if (dirtyRef.current) setConflict(true);
      else void loadProduct();
    };
    window.addEventListener("product-updated", changed);
    return () => window.removeEventListener("product-updated", changed);
  }, [loadProduct]);
  useEffect(() => {
    if (
      !files.some(
        (f) =>
          f.status === "ready" &&
          ["pending", "processing"].includes(f.parseStatus),
      )
    )
      return;
    const t = setInterval(() => void loadFiles().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [files, loadFiles]);
  function change(key: string, value: any) {
    setDraft((d) => ({ ...d, content: { ...d.content, [key]: value } }));
  }
  function leave(url: string) {
    if (!dirty || window.confirm("产品有未保存的修改，确定离开？"))
      router.push(url);
  }
  async function save() {
    if (savingRef.current || readOnly) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const c = { ...content };
      delete c.sellingPoints;
      delete c.audience;
      delete c.fileIds;
      const body = {
        ...draft,
        content: c,
        ...(product ? { baseVersion: product.version } : {}),
      };
      const p = await api(
        id === "new" ? "/products" : `/products/${id}`,
        id === "new" ? "POST" : "PATCH",
        body,
      );
      const value = {
        title: p.title,
        status: p.status,
        content: adaptProductContent(p.content),
      };
      setProduct(p);
      setDraft(value);
      setSaved(JSON.stringify(value));
      dirtyRef.current = false;
      onDirtyChange(false);
      setConflict(false);
      notify("产品资料已保存", "success");
      onSaved();
      if (id === "new") router.replace(`/studio/products/${p.id}?tab=${tab}`);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) setConflict(true);
      notify(err.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  function attach(file: any, isReference: boolean, chosenCategory = "auto") {
    setDraft((d) => {
      const c = d.content;
      if (isReference)
        return c.referenceVideos.some((r: any) => r.fileId === file.id)
          ? d
          : {
              ...d,
              content: {
                ...c,
                referenceVideos: [...c.referenceVideos, reference(file)],
              },
            };
      if (c.materials.some((m: any) => m.fileId === file.id)) return d;
      return {
        ...d,
        content: {
          ...c,
          materials: [
            ...c.materials,
            {
              id: crypto.randomUUID(),
              fileId: file.id,
              title: file.name,
              category:
                chosenCategory === "auto"
                  ? materialCategory(file.mime)
                  : chosenCategory,
              note: "",
            },
          ],
        },
      };
    });
  }
  function progress(entry: UploadItem, patch: Partial<UploadItem>) {
    Object.assign(entry, patch);
    if (active.current)
      setUploads((all) =>
        all.map((u) => (u.key === entry.key ? { ...entry } : u)),
      );
  }
  async function upload(entry: UploadItem) {
    if (entry.status === "uploading" || readOnly) return;
    progress(entry, { status: "uploading", error: "" });
    try {
      const mime =
        entry.file.type ||
        (entry.file.name.toLowerCase().endsWith(".md")
          ? "text/markdown"
          : "text/plain");
      if (entry.reference && !mime.startsWith("video/"))
        throw new Error("参考视频请上传视频文件");
      if (!entry.fileId) {
        const init = await api("/files", "POST", {
          productId: id,
          name: entry.file.name,
          mime,
          bytes: entry.file.size,
          parsePolicy: entry.reference ? "skip" : "auto",
        });
        entry.fileId = init.file.id;
      }
      if (!entry.uploaded)
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrs.current.add(xhr);
          xhr.open("POST", `/api/v1/files/${entry.fileId}/upload`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              progress(entry, {
                progress: Math.round((e.loaded / e.total) * 95),
              });
          };
          xhr.onloadend = () => xhrs.current.delete(xhr);
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              entry.uploaded = true;
              resolve();
            } else {
              let message = "上传失败";
              try {
                message =
                  JSON.parse(xhr.responseText).error?.message ?? message;
              } catch {}
              reject(new Error(message));
            }
          };
          xhr.onerror = () => reject(new Error("网络中断，请重试"));
          xhr.onabort = () => reject(new Error("上传已取消"));
          const form = new FormData();
          form.append("file", entry.file);
          xhr.send(form);
        });
      await api(`/files/${entry.fileId}/complete`, "POST", {});
      if (!active.current) return;
      attach(
        { id: entry.fileId, name: entry.file.name, mime },
        entry.reference,
        entry.category,
      );
      progress(entry, { status: "ready", progress: 100 });
      await loadFiles();
    } catch (e) {
      progress(entry, { status: "failed", error: (e as Error).message });
    }
  }
  async function selectUploads(list: FileList | null, isReference: boolean) {
    if (!list) return;
    const queue = Array.from(list).map((file) => ({
      key: crypto.randomUUID(),
      file,
      reference: isReference,
      category: uploadCategory,
      status: "pending",
      progress: 0,
    }));
    setUploads((all) => [...all, ...queue]);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (cursor < queue.length && active.current)
          await upload(queue[cursor++]);
      }),
    );
  }
  function uploader(isReference: boolean) {
    return (
      <div className="pd-upload-actions">
        {id === "new" ? (
          <p className="muted">先保存产品，即可上传文件或选择已有文件。</p>
        ) : (
          !readOnly && (
            <>
              {!isReference && (
                <Select
                  aria-label="上传分类"
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                >
                  <option value="auto">按文件类型建议分类</option>
                  {Object.entries(categories).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </Select>
              )}
              <label className="button primary">
                <Upload size={16} />
                {isReference ? "上传参考视频" : "上传素材"}
                <input
                  aria-label={
                    isReference ? "上传参考视频文件" : "上传产品素材文件"
                  }
                  type="file"
                  hidden
                  multiple
                  accept={
                    isReference
                      ? "video/mp4,video/webm,video/quicktime"
                      : undefined
                  }
                  onChange={(e) => {
                    void selectUploads(e.target.files, isReference);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                className="button"
                onClick={() => {
                  setPicker(isReference ? "reference" : "material");
                  void loadFiles();
                }}
              >
                选择已上传文件
              </button>
            </>
          )
        )}
      </div>
    );
  }
  const associatedFiles = files.filter((f) =>
    content.materials.some((m: any) => m.fileId === f.id),
  );
  const checks = [
    ["产品描述", !!content.description.trim()],
    ["一句话定位", !!content.positioning.trim()],
    ["核心卖点", !!content.sellingPointItems.length],
    ["目标用户", !!content.audienceSegments.length],
    ["产品 Brief", !!content.brief.trim()],
    ["产品素材", !!content.materials.length],
  ] as [string, boolean][];
  const materialRows = content.materials.filter(
    (m: any) =>
      (category === "all" || m.category === category) &&
      `${m.title} ${m.note} ${files.find((f) => f.id === m.fileId)?.name ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (loading)
    return (
      <div className="pd-loading">
        <LoaderCircle className="spin" />
        正在读取产品资料…
      </div>
    );
  if (error)
    return (
      <section className="pd-panel">
        <p className="error">{error}</p>
        <button className="button" onClick={loadProduct}>
          重新加载
        </button>
      </section>
    );
  return (
    <div className="product-detail">
      <button className="pd-back" onClick={() => leave("/studio/products")}>
        <ArrowLeft size={16} />
        全部产品
      </button>
      <header className="pd-header">
        <div className="pd-heading">
          {content.coverFileId && (
            <div className="pd-heading-cover">
              <FileView id={content.coverFileId} onZoom={setZoom} />
            </div>
          )}
          <span className="eyebrow">PRODUCT INSIGHT</span>
          <h1>
            {draft.title || "新建产品"}
            <span className="heading-dot">.</span>
          </h1>
          <p>从真实资料出发，让每一个创意都有依据。</p>
          <div className="pd-badges">
            <span className="badge">
              {
                (
                  {
                    draft: "草稿",
                    ready: "已就绪",
                    selected: "已入选",
                    archived: "已归档",
                    rejected: "已淘汰",
                  } as any
                )[draft.status]
              }
            </span>
            <span className="version">
              {product ? `V${product.version}` : "尚未保存"}
            </span>
            <span role="status">
              {dirty ? "有未保存的修改" : "所有修改已保存"}
            </span>
          </div>
        </div>
        <div className="pd-header-actions">
          {product && (
            <>
              <button
                className="button"
                onClick={async () => {
                  try {
                    setHistoryItem(await api(`/products/${id}`));
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <History size={15} />
                历史版本
              </button>
              <button
                className="button"
                onClick={() => leave(`/studio/creative?productId=${id}`)}
              >
                开始策划
                <ArrowUpRight size={15} />
              </button>
              <button className="button" onClick={onChat}>
                <Sparkles size={15} />
                创作搭档
              </button>
            </>
          )}
          {!readOnly && (
            <button
              className="button primary"
              disabled={
                saving ||
                uploads.some(
                  (u) => u.status === "uploading" || u.status === "pending",
                ) ||
                (!dirty && !!product)
              }
              onClick={save}
            >
              {saving ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Save size={16} />
              )}
              {saving ? "保存中…" : "保存产品"}
            </button>
          )}
        </div>
      </header>
      {conflict && (
        <div className="pd-conflict" role="alert">
          产品已有新版本。当前草稿已保留，请先查看最新内容再合并修改。
          <button
            className="button"
            onClick={async () => setHistoryItem(await api(`/products/${id}`))}
          >
            查看最新版本
          </button>
          <button
            className="button"
            onClick={() => {
              if (window.confirm("放弃当前草稿并加载最新版本？"))
                void loadProduct();
            }}
          >
            放弃草稿并重新加载
          </button>
          <button
            className="button"
            onClick={() => {
              const blob = new Blob([JSON.stringify(draft, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "product-draft.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            下载当前草稿
          </button>
          <button
            className="button"
            onClick={async () => {
              try {
                setMergeLatest(await api(`/products/${id}`));
                setMergeChoices({});
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          >
            合并到最新版本
          </button>
        </div>
      )}
      <nav className="pd-tabs" aria-label="产品详情标签">
        {Object.entries(tabs).map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            aria-current={tab === key ? "page" : undefined}
            onClick={() =>
              router.push(`/studio/products/${id}?tab=${key}`, {
                scroll: false,
              })
            }
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="pd-overview">
          <section className="pd-panel">
            <div className="pd-section-title">
              <h2>认识这个产品</h2>
              <span className="muted">基础信息</span>
            </div>
            <div className="pd-fields">
              <label className="pd-field">
                产品名称
                <input
                  aria-label="产品名称"
                  value={draft.title}
                  readOnly={readOnly}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                />
              </label>
              <label className="pd-field">
                产品状态
                <Select
                  aria-label="产品状态"
                  value={draft.status}
                  disabled={readOnly}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, status: e.target.value }))
                  }
                >
                  {Object.entries({
                    draft: "草稿",
                    ready: "已就绪",
                    selected: "已入选",
                    rejected: "已淘汰",
                    archived: "已归档",
                  }).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="pd-full">
                <EditorField
                  field={{ key: "positioning", label: "一句话定位" }}
                  value={content.positioning}
                  readOnly={readOnly}
                  files={[]}
                  change={(v) => change("positioning", v)}
                />
              </div>
              <div className="pd-full">
                <EditorField
                  field={{ key: "description", label: "产品描述" }}
                  value={content.description}
                  readOnly={readOnly}
                  files={[]}
                  change={(v) => change("description", v)}
                />
              </div>
            </div>
          </section>
          <aside className="pd-panel">
            <h2>产品封面</h2>
            {content.coverFileId ? (
              <FileView id={content.coverFileId} onZoom={setZoom} />
            ) : (
              <div className="pd-cover-placeholder">
                <ImageIcon size={36} />
                <span>在产品素材中选择一张产品图</span>
              </div>
            )}
            {!readOnly && (
              <label className="pd-field">
                选择封面
                <Select
                  value={content.coverFileId ?? ""}
                  onChange={(e) =>
                    change("coverFileId", e.target.value || undefined)
                  }
                >
                  <option value="">不设置封面</option>
                  {associatedFiles
                    .filter((f) => f.mime.startsWith("image/"))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </Select>
              </label>
            )}
            <div className="pd-stat">
              <strong>{content.materials.length}</strong> 份素材{" "}
              <strong>{content.referenceVideos.length}</strong> 条参考
            </div>
          </aside>
          <section className="pd-panel pd-full">
            <div className="pd-section-title">
              <h2>资料待完善项</h2>
              <span>
                {checks.filter(([, ready]) => ready).length} / {checks.length}{" "}
                已填写
              </span>
            </div>
            <p className="muted">用于提醒缺少的资料，不代表产品质量评分。</p>
            <div className="pd-checks">
              {checks.map(([label, ready]) => (
                <span key={label} className={ready ? "done" : ""}>
                  {ready ? <Check size={15} /> : <Plus size={15} />}
                  {label}
                </span>
              ))}
            </div>
          </section>
        </div>
      )}
      {tab === "insights" && (
        <div className="pd-insights">
          <p className="pd-intro">
            把卖点与用户需求逐条连接起来。保留证据，也记录仍需确认的假设。
          </p>
          {insightLists.map((list) => (
            <Rows
              key={list.key}
              title={list.title}
              noun={list.noun}
              fields={list.fields}
              empty={list.empty}
              rows={content[list.key]}
              onChange={(rows) => change(list.key, rows)}
              readOnly={readOnly}
              files={associatedFiles}
            />
          ))}
        </div>
      )}
      {tab === "brief" && (
        <section className="pd-panel">
          <div className="pd-section-title">
            <div>
              <h2>产品 Brief</h2>
              <p className="muted">
                以 Markdown 整理共识，作为后续创意策划的依据。
              </p>
            </div>
            <div className="pd-row-actions">
              {!readOnly && (
                <button
                  className="button"
                  disabled={!!content.brief.trim()}
                  onClick={() => change("brief", briefTemplate)}
                >
                  插入空白模板
                </button>
              )}
              <button
                className="button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(content.brief)
                    .then(() => notify("Brief 已复制", "success"))
                    .catch(() => notify("复制失败，请手动选择文本复制"))
                }
              >
                <Copy size={14} />
                复制
              </button>
              <button
                className="button"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([content.brief], {
                      type: "text/markdown;charset=utf-8",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${draft.title || "product"}-brief.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={14} />
                下载 .md
              </button>
            </div>
          </div>
          <div className="pd-mode">
            {[...[...(!readOnly ? ["edit", "split"] : [])], "preview"].map(
              (mode) => (
                <button
                  className={briefMode === mode ? "active" : ""}
                  key={mode}
                  onClick={() => setBriefMode(mode)}
                >
                  {
                    (
                      {
                        edit: "编辑",
                        split: "编辑与预览",
                        preview: "预览",
                      } as any
                    )[mode]
                  }
                </button>
              ),
            )}
          </div>
          <div className={`pd-brief ${readOnly ? "preview" : briefMode}`}>
            {!readOnly && (
              <textarea
                aria-label="产品 Brief Markdown"
                className="pd-markdown-input"
                value={content.brief}
                placeholder="# 产品 Brief"
                onChange={(e) => change("brief", e.target.value)}
              />
            )}
            <div className="pd-markdown-preview markdown">
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                {content.brief ||
                  "*还没有 Brief。整理产品信息后，在这里写下你的共识。*"}
              </Markdown>
            </div>
          </div>
        </section>
      )}
      {tab === "materials" && (
        <section className="pd-panel">
          <div className="pd-section-title">
            <div>
              <h2>产品素材</h2>
              <p className="muted">
                原始产品资料与生成资产分开管理。上传后保存产品，关联才会生效。
              </p>
            </div>
          </div>
          {uploader(false)}
          <div className="pd-material-filters">
            <input
              aria-label="搜索产品素材"
              placeholder="搜索文件名或备注…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              aria-label="素材分类筛选"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">全部分类</option>
              {Object.entries(categories).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="pd-material-grid">
            {materialRows.map((m: any) => {
              const file = files.find((f) => f.id === m.fileId);
              const update = (patch: any) =>
                change(
                  "materials",
                  content.materials.map((x: any) =>
                    x.id === m.id ? { ...x, ...patch } : x,
                  ),
                );
              return (
                <article className="pd-material" key={m.id}>
                  <div className="pd-material-top">
                    <span className="badge">{categories[m.category]}</span>
                    {!product?.content.materials?.some(
                      (x: any) => x.fileId === m.fileId,
                    ) && <span className="pd-pending">待保存</span>}
                  </div>
                  <FileView id={m.fileId} onZoom={setZoom} />
                  <h3 className="pd-material-name">{m.title || file?.name}</h3>
                  <details className="pd-material-edit">
                    <summary>编辑资料信息</summary>
                    <label className="pd-field">
                      素材名称
                      <input
                        value={m.title}
                        readOnly={readOnly}
                        onChange={(e) => update({ title: e.target.value })}
                      />
                    </label>
                    <label className="pd-field">
                      分类
                      <Select
                        value={m.category}
                        disabled={readOnly}
                        onChange={(e) => update({ category: e.target.value })}
                      >
                        {Object.entries(categories).map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="pd-field">
                      备注
                      <textarea
                        rows={2}
                        value={m.note}
                        readOnly={readOnly}
                        onChange={(e) => update({ note: e.target.value })}
                      />
                    </label>
                  </details>
                  <span className="muted small">
                    {parseLabels[file?.parseStatus] ??
                      file?.parseStatus ??
                      "读取中"}
                  </span>
                  {file?.parseError && (
                    <p className="error">{file.parseError}</p>
                  )}
                  {file?.parseError &&
                    /采购价|转写型号/.test(file.parseError) && (
                      <a
                        className="button"
                        href="/team?tab=platform#purchase-rates"
                      >
                        配置解析采购价
                      </a>
                    )}
                  {file?.parseStatus === "failed" && !readOnly && (
                    <button
                      className="button"
                      onClick={() =>
                        api(`/files/${m.fileId}/retry-parse`, "POST", {})
                          .then(loadFiles)
                          .catch((e) => notify(e.message))
                      }
                    >
                      重试解析
                    </button>
                  )}
                  {file?.extractedText && (
                    <details>
                      <summary>查看解析文本</summary>
                      <pre className="pd-extracted">{file.extractedText}</pre>
                    </details>
                  )}
                  {!readOnly && (
                    <div className="pd-row-actions">
                      {file?.mime.startsWith("image/") && (
                        <button
                          className="button"
                          onClick={() => change("coverFileId", m.fileId)}
                        >
                          {content.coverFileId === m.fileId
                            ? "当前封面"
                            : "设为封面"}
                        </button>
                      )}
                      <button
                        className="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              "从产品资料中移除？原文件与历史引用会保留。",
                            )
                          )
                            change(
                              "materials",
                              content.materials.filter(
                                (x: any) => x.id !== m.id,
                              ),
                            );
                        }}
                      >
                        移除关联
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!materialRows.length && (
            <p className="pd-empty">
              暂无匹配素材。上传产品图、演示视频、说明书或访谈记录。
            </p>
          )}
        </section>
      )}
      {tab === "references" && (
        <>
          <section className="pd-panel">
            <div className="pd-section-title">
              <div>
                <h2>参考视频</h2>
                <p className="muted">
                  记录值得借鉴的表达方式，也写清不适合照搬的部分。外链不抓取，上传不自动拆解。
                </p>
              </div>
              {!readOnly && (
                <button
                  className="button"
                  onClick={() =>
                    change("referenceVideos", [
                      ...content.referenceVideos,
                      reference(),
                    ])
                  }
                >
                  <LinkIcon size={15} />
                  添加视频链接
                </button>
              )}
            </div>
            {uploader(true)}
          </section>
          <Rows
            title="参考笔记"
            noun="参考笔记"
            rows={content.referenceVideos}
            fields={referenceFields}
            empty={reference()}
            onChange={(rows) => change("referenceVideos", rows)}
            readOnly={readOnly}
            files={[]}
            render={(row) =>
              row.type === "file" ? (
                <FileView id={row.fileId} onZoom={setZoom} />
              ) : /^https?:\/\//i.test(row.url) ? (
                <a
                  className="pd-reference-link"
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <LinkIcon size={15} />
                  打开来源链接
                  <ArrowUpRight size={15} />
                </a>
              ) : (
                <span className="muted">填写 HTTP 或 HTTPS 视频来源链接</span>
              )
            }
          />
        </>
      )}
      {!!uploads.length && (
        <details
          className="pd-panel pd-upload-queue"
          open={uploads.some((u) => u.status !== "ready")}
        >
          <summary>上传记录 · {uploads.length} 个文件</summary>
          {uploads.map((u) => (
            <div key={u.key}>
              <span>{u.file.name}</span>
              <progress max={100} value={u.progress} />
              <span>
                {u.status === "ready"
                  ? "已上传，请保存产品关联"
                  : u.status === "failed"
                    ? u.error
                    : `${u.progress}%`}
              </span>
              {u.status === "failed" && (
                <button className="button" onClick={() => upload(u)}>
                  重试上传
                </button>
              )}
            </div>
          ))}
        </details>
      )}
      {mergeLatest && (
        <div className="modal-backdrop">
          <section
            className="pd-picker pd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="合并产品修改"
          >
            <div className="pd-section-title">
              <h2>合并产品修改 · V{mergeLatest.version}</h2>
              <button
                className="icon-button"
                aria-label="关闭合并"
                onClick={() => setMergeLatest(null)}
              >
                <X />
              </button>
            </div>
            <p>
              互不冲突的修改会自动合并。同一部分被同时修改时，请选择保留内容，再继续编辑。
            </p>
            {mergeConflicts.map((key) => (
              <section className="pd-row-content" key={key}>
                <h3>{fieldNames[key] ?? key}</h3>
                <div className="pd-fields">
                  <div>
                    <b>当前草稿</b>
                    <pre className="pd-extracted">
                      {JSON.stringify(localFields[key], null, 2)}
                    </pre>
                  </div>
                  <div>
                    <b>服务器最新内容</b>
                    <pre className="pd-extracted">
                      {JSON.stringify(latestFields[key], null, 2)}
                    </pre>
                  </div>
                </div>
                <Select
                  aria-label={`合并${fieldNames[key] ?? key}`}
                  value={mergeChoices[key] ?? ""}
                  onChange={(e) =>
                    setMergeChoices((c) => ({ ...c, [key]: e.target.value }))
                  }
                >
                  <option value="">请选择保留内容</option>
                  <option value="local">保留当前草稿</option>
                  <option value="server">使用服务器最新内容</option>
                </Select>
              </section>
            ))}
            {!mergeConflicts.length && <p>没有重叠修改，可以直接合并。</p>}
            <button
              className="button primary"
              disabled={mergeConflicts.some((k) => !mergeChoices[k])}
              onClick={applyMerge}
            >
              合并并继续编辑
            </button>
          </section>
        </div>
      )}
      {historyItem && (
        <div className="modal-backdrop" onClick={() => setHistoryItem(null)}>
          <section
            className="pd-picker pd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="产品历史版本"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pd-section-title">
              <h2>产品历史版本</h2>
              <button
                className="icon-button"
                aria-label="关闭历史版本"
                onClick={() => setHistoryItem(null)}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              每次保存都会保留当时的产品内容、资料关联和参考笔记。
            </p>
            {historyItem.revisions?.map((rev: any) => {
              const c = adaptProductContent(rev.content);
              return (
                <details className="pd-history-revision" key={rev.id}>
                  <summary>
                    V{rev.version} · {new Date(rev.createdAt).toLocaleString()}{" "}
                    · {rev.title}
                  </summary>
                  <p>{c.positioning}</p>
                  <p>{c.description}</p>
                  {insightLists.map((list) => (
                    <div key={list.key}>
                      <h3>{list.title}</h3>
                      {c[list.key].map((row: any) => (
                        <dl key={row.id}>
                          {list.fields
                            .filter((f) => row[f.key]?.length || row[f.key])
                            .map((field) => (
                              <div key={field.key}>
                                <dt>{field.label}</dt>
                                <dd>
                                  {Array.isArray(row[field.key])
                                    ? row[field.key].join("、")
                                    : (field.options?.[row[field.key]] ??
                                      row[field.key])}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      ))}
                    </div>
                  ))}
                  <h3>产品 Brief</h3>
                  <div className="pd-markdown-preview">
                    <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                      {c.brief}
                    </Markdown>
                  </div>
                  <h3>关联素材</h3>
                  {c.materials.map((m: any) => (
                    <div key={m.id}>
                      <p>
                        {categories[m.category]} · {m.title} · {m.note}
                      </p>
                      <FileView id={m.fileId} onZoom={setZoom} />
                    </div>
                  ))}
                  <h3>参考视频</h3>
                  {c.referenceVideos.map((r: any) => (
                    <div key={r.id}>
                      <h4>{r.title}</h4>
                      {r.type === "file" ? (
                        <FileView id={r.fileId} onZoom={setZoom} />
                      ) : (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          打开参考来源
                        </a>
                      )}
                      <dl>
                        {referenceFields
                          .filter((f) => r[f.key]?.length)
                          .map((f) => (
                            <div key={f.key}>
                              <dt>{f.label}</dt>
                              <dd>
                                {Array.isArray(r[f.key])
                                  ? r[f.key].join("、")
                                  : r[f.key]}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </div>
                  ))}
                </details>
              );
            })}
          </section>
        </div>
      )}
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="选择已上传文件"
            className="pd-picker pd-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pd-section-title">
              <h2>选择已上传文件</h2>
              <button
                className="icon-button"
                aria-label="关闭文件选择"
                onClick={() => setPicker(null)}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              包含本产品已上传但尚未关联的文件；不会自动加入生成资产。
            </p>
            {files
              .filter(
                (f) =>
                  f.status === "ready" &&
                  (picker !== "reference" || f.mime.startsWith("video/")),
              )
              .map((f) => (
                <div className="pd-picker-row" key={f.id}>
                  {f.mime.startsWith("video/") ? (
                    <Film size={18} />
                  ) : (
                    <FileText size={18} />
                  )}
                  <span>{f.name}</span>
                  <button
                    className="button"
                    disabled={(picker === "reference"
                      ? content.referenceVideos
                      : content.materials
                    ).some((x: any) => x.fileId === f.id)}
                    onClick={() =>
                      attach(f, picker === "reference", uploadCategory)
                    }
                  >
                    加入{picker === "reference" ? "参考" : "资料"}
                  </button>
                </div>
              ))}
            {!files.some(
              (f) =>
                f.status === "ready" &&
                (picker !== "reference" || f.mime.startsWith("video/")),
            ) && <p className="pd-empty">暂无可选文件</p>}
          </section>
        </div>
      )}
      {zoom && (
        <div
          className="pd-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setZoom("")}
        >
          <button
            className="button"
            aria-label="关闭图片预览"
            onClick={() => setZoom("")}
          >
            <X />
            关闭
          </button>
          <img
            src={zoom}
            alt="产品资料大图"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
