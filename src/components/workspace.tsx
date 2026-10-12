"use client";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  createContext,
  useContext,
  useId,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  Lightbulb,
  Images,
  Clapperboard,
  SlidersHorizontal,
  Activity,
  KeyRound,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Search,
  ChevronRight,
  LogOut,
  X,
  Check,
  Copy,
  RefreshCw,
  Trash2,
  Upload,
  Play,
  Pause,
  Send,
  Sparkles,
  FileText,
  Grid2X2,
  Settings2,
  Users,
  Clock,
  PanelRightClose,
  MessageSquare,
  Download,
  Link2,
  ShieldCheck,
  LoaderCircle,
  Film,
  FolderOpen,
} from "lucide-react";
import Markdown from "react-markdown";
import { api, Item, labels } from "./api";
const navigation = [
  {
    id: "products",
    name: "产品管理",
    icon: Boxes,
    sub: "产品是创作的起点",
    description: "把产品资料整理清楚，让每一个创意都有据可依。",
  },
  {
    id: "creative",
    name: "创意策划",
    icon: Lightbulb,
    sub: "让好想法进入下一幕",
    description: "从创意发散到工业分镜，在这里打磨你的故事。",
  },
  {
    id: "assets",
    name: "资产制作",
    icon: Images,
    sub: "构建你的视觉世界",
    description: "统一产品、人物与场景，让每一个镜头保持一致。",
  },
  {
    id: "production",
    name: "视频制作",
    icon: Clapperboard,
    sub: "把想法变成画面",
    description: "管理制作脚本、审批与生成结果，追溯每一次尝试。",
  },
  {
    id: "channels",
    name: "渠道管理",
    icon: SlidersHorizontal,
    sub: "连接你的创作引擎",
    description: "配置模型与生成能力，选择适合每项任务的渠道。",
  },
  {
    id: "logs",
    name: "日志状态",
    icon: Activity,
    sub: "每一步，都看得见",
    description: "查看制作进度、失败原因与所有关键操作。",
  },
  {
    id: "keys",
    name: "Agent 接入",
    icon: KeyRound,
    sub: "让你的 Agent 加入工作室",
    description: "选择访问密钥，复制 Skill 接入指令，开始协作。",
  },
];
const defaults: Record<string, any> = {
  products: {
    description: "",
    sellingPoints: [],
    audience: "",
    brief: "",
    fileIds: [],
    facts: [],
  },
  "creative-batches": { requirements: "", count: 10 },
  concepts: {
    hook: "",
    idea: "",
    structure: "",
    emotion: "",
    selfReview: "",
    comments: "",
    score: "",
  },
  plans: {
    objective: "",
    audience: "",
    message: "",
    story: "",
    visualStyle: "",
    sound: "",
    duration: 30,
    aspectRatio: "16:9",
    body: "",
  },
  storyboards: { shots: [] },
  assets: {
    category: "reference",
    purpose: "",
    constraints: "",
    prompt: "",
    parameters: {},
    referenceFileIds: [],
    candidateFileIds: [],
    selectedFileId: "",
    comments: "",
  },
  scripts: {
    prompt: "",
    shotIds: [],
    assets: [],
    referenceFileIds: [],
    duration: 5,
    aspectRatio: "16:9",
    resolution: "720p",
    sound: false,
    comments: "",
  },
  deliverables: { fileId: "", sourceJobIds: [], notes: "" },
};
const fieldLabels: Record<string, string> = {
  description: "产品描述",
  sellingPoints: "核心卖点（每行一条）",
  audience: "目标用户",
  brief: "产品 Brief · Markdown",
  fileIds: "资料文件 ID",
  coverFileId: "封面文件 ID",
  facts: "事实与假设",
  requirements: "创作要求",
  count: "计划创意数",
  hook: "开场钩子",
  idea: "一句话创意",
  structure: "叙述结构",
  emotion: "情绪曲线",
  selfReview: "自评理由",
  comments: "人工意见",
  score: "人工评分（0–10）",
  objective: "传播目标",
  message: "核心表达",
  story: "故事结构",
  visualStyle: "视觉风格",
  sound: "声音设计 / 保留音轨",
  duration: "时长（秒）",
  aspectRatio: "画幅",
  body: "策划正文 · Markdown",
  category: "资产分类",
  purpose: "用途",
  constraints: "外观约束",
  prompt: "制作提示词",
  referenceFileIds: "参考文件 ID（每行一个）",
  candidateFileIds: "候选文件 ID",
  selectedFileId: "选定文件 ID",
  parameters: "生成参数",
  shotIds: "覆盖镜头 ID（每行一个）",
  assets: "资产版本引用",
  resolution: "分辨率",
  fileId: "成片文件 ID",
  sourceJobIds: "来源片段任务 ID",
  notes: "说明",
  shots: "工业分镜",
  id: "镜头 ID",
  number: "镜号",
  framing: "景别",
  camera: "机位",
  movement: "运镜",
  action: "主体动作",
  dialogue: "对白 / 旁白",
  continuity: "连续性要求",
  imageFileId: "选定分镜图 ID",
};
function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>
      <i />
      {labels[status] ?? status}
    </span>
  );
}
function date(value?: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = "",
}: any) {
  return (
    <button
      type="button"
      className={`button ${primary ? "primary" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({ title, children, onClose, wide = false }: any) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Empty({ title, body, onCreate }: any) {
  return (
    <div className="empty">
      <div className="empty-art">
        <div />
        <FolderOpen size={34} />
        <i />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {onCreate && (
        <Button primary onClick={onCreate}>
          <Plus size={16} />
          开始创建
        </Button>
      )}
    </div>
  );
}
function FilePreview({
  id,
  compact = false,
}: {
  id?: string;
  compact?: boolean;
}) {
  const [file, setFile] = useState<any>(null);
  useEffect(() => {
    if (id)
      api("/files/" + id)
        .then(setFile)
        .catch(() => {});
  }, [id]);
  if (!id)
    return (
      <div className="media-placeholder">
        <Film size={32} />
        <span>等待你的画面</span>
      </div>
    );
  if (!file?.url)
    return (
      <div className="media-placeholder">
        <LoaderCircle size={20} className="spin" />
      </div>
    );
  return (
    <div className={"file-preview " + (compact ? "compact" : "")}>
      {file.mime.startsWith("image/") ? (
        <img src={file.url} alt={file.name} loading="lazy" />
      ) : file.mime.startsWith("video/") ? (
        <video
          src={file.url}
          controls
          preload="metadata"
          onClick={(e) => e.stopPropagation()}
        />
      ) : file.mime.startsWith("audio/") ? (
        <audio src={file.url} controls onClick={(e) => e.stopPropagation()} />
      ) : (
        <a href={file.url} target="_blank" rel="noreferrer">
          <FileText size={24} />
          {file.name}
          <Download size={16} />
        </a>
      )}
      {!compact && (
        <a className="button" href={file.url} target="_blank" rel="noreferrer">
          <Download size={14} />
          打开 / 下载原文件
        </a>
      )}
    </div>
  );
}
const JsonValidation = createContext<
  ((id: string, invalid: boolean) => void) | null
>(null);
function useJsonValidation() {
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>(
    {},
  );
  const validate = useCallback((id: string, invalid: boolean) => {
    setInvalidFields((previous) => {
      if (!!previous[id] === invalid) return previous;
      const next = { ...previous };
      if (invalid) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  return { validate, invalid: Object.keys(invalidFields).length > 0 };
}
function JsonInput({ value, onChange, label }: any) {
  const validate = useContext(JsonValidation),
    id = useId();
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState("");
  useEffect(() => {
    validate?.(id, !!error);
  }, [validate, id, error]);
  useEffect(() => () => validate?.(id, false), [validate, id]);
  return (
    <label>
      {label}
      <textarea
        className="code-input"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError("");
          } catch {
            setError("JSON 格式不完整，请修正后保存");
          }
        }}
      />
      {error && <small className="error">{error}</small>}
    </label>
  );
}
function ContentFields({ content, setContent }: any) {
  return (
    <>
      {Object.entries(content)
        .filter(([k]) => k !== "shots")
        .map(([key, value]) => (
          <div
            key={key}
            className={
              ["brief", "body", "prompt", "story", "structure"].includes(key)
                ? "span-2"
                : ""
            }
          >
            {typeof value === "boolean" ? (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) =>
                    setContent({ ...content, [key]: e.target.checked })
                  }
                />
                {fieldLabels[key] ?? key}
              </label>
            ) : (value !== null &&
                typeof value === "object" &&
                !Array.isArray(value)) ||
              (Array.isArray(value) && ["facts", "assets"].includes(key)) ? (
              <JsonInput
                label={fieldLabels[key]}
                value={value}
                onChange={(v: any) => setContent({ ...content, [key]: v })}
              />
            ) : Array.isArray(value) ? (
              <label>
                {fieldLabels[key] ?? key}
                <textarea
                  rows={3}
                  value={value.join("\n")}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      [key]: e.target.value.split("\n"),
                    })
                  }
                />
              </label>
            ) : typeof value === "number" || key === "score" ? (
              <label>
                {fieldLabels[key] ?? key}
                <input
                  type="number"
                  value={String(value)}
                  onChange={(e) =>
                    setContent({
                      ...content,
                      [key]:
                        key === "score" && e.target.value === ""
                          ? ""
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
            ) : ["category", "aspectRatio", "resolution"].includes(key) ? (
              <label>
                {fieldLabels[key]}
                <select
                  value={String(value)}
                  onChange={(e) =>
                    setContent({ ...content, [key]: e.target.value })
                  }
                >
                  {(key === "category"
                    ? [
                        "reference",
                        "product",
                        "character",
                        "environment",
                        "prop",
                      ]
                    : key === "aspectRatio"
                      ? ["16:9", "9:16", "1:1", "4:3", "3:4"]
                      : ["480p", "720p", "1080p"]
                  ).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                {fieldLabels[key] ?? key}
                <textarea
                  rows={["body", "brief", "prompt"].includes(key) ? 7 : 2}
                  value={String(value ?? "")}
                  onChange={(e) =>
                    setContent({ ...content, [key]: e.target.value })
                  }
                />
              </label>
            )}
          </div>
        ))}
    </>
  );
}

function ResourceEditor({
  route,
  item,
  products,
  productId,
  plans,
  selectedPlanId,
  onClose,
  onSaved,
  notify,
  readOnly = false,
}: any) {
  const validation = useJsonValidation();
  const [title, setTitle] = useState(item?.title ?? ""),
    [pid, setPid] = useState(item?.productId ?? productId ?? ""),
    [planId, setPlanId] = useState(item?.planId ?? selectedPlanId ?? ""),
    [parentId, setParentId] = useState(item?.parentId ?? ""),
    [status, setStatus] = useState(item?.status ?? "draft"),
    [content, setContent] = useState<any>(
      structuredClone({
        ...defaults[route],
        ...item?.content,
        ...(route === "storyboards" && item
          ? {
              shots: item.content.shots.map((s: any) => ({
                imageFileId: "",
                ...s,
              })),
            }
          : {}),
      }),
    ),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("edit"),
    [history, setHistory] = useState<any>(null);
  const set = (key: string, value: any) =>
    setContent((c: any) => ({ ...c, [key]: value }));
  useEffect(() => {
    if (item?.id)
      api("/" + route + "/" + item.id)
        .then(setHistory)
        .catch((e) => notify(e.message));
  }, [item?.id, route]);
  async function save() {
    if (readOnly || validation.invalid) return;
    setBusy(true);
    try {
      const result = await api(
        "/" + route + (item ? "/" + item.id : ""),
        item ? "PATCH" : "POST",
        {
          title,
          status,
          content: JSON.parse(
            JSON.stringify(content, (k, v) =>
              [
                "imageFileId",
                "selectedFileId",
                "coverFileId",
                "score",
              ].includes(k) && v === ""
                ? undefined
                : Array.isArray(v) && v.every((x) => typeof x === "string")
                  ? v.map((x) => x.trim()).filter(Boolean)
                  : v,
            ),
          ),
          ...(route !== "products" ? { productId: pid } : {}),
          ...(planId ? { planId } : {}),
          ...(parentId ? { parentId } : {}),
          ...(item ? { baseVersion: item.version } : {}),
        },
      );
      notify("已保存新版本", "success");
      onSaved(result);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <JsonValidation.Provider value={validation.validate}>
      <Modal
        title={
          item
            ? "编辑 · " + item.title
            : "新建" +
              (
                {
                  products: "产品",
                  concepts: "创意",
                  plans: "策划案",
                  storyboards: "工业分镜",
                  assets: "资产",
                  scripts: "制作脚本",
                  deliverables: "成片",
                  "creative-batches": "创意批次",
                } as any
              )[route]
        }
        onClose={onClose}
        wide
      >
        <div className="tabs">
          <button
            className={tab === "edit" ? "active" : ""}
            onClick={() => setTab("edit")}
          >
            内容编辑
          </button>
          {item && (
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              版本历史 <span>{item.version}</span>
            </button>
          )}
        </div>
        {history?.staleSources?.length > 0 && (
          <div className="notice">
            上游资料已有更新。本次编辑不会自动覆盖旧版本的引用。
          </div>
        )}
        {tab === "history" ? (
          <div className="history">
            {history?.revisions.map((r: any) => (
              <details key={r.id}>
                <summary>
                  V{r.version} · {r.title}
                  <span>
                    {date(r.createdAt)} · {r.actorType}
                  </span>
                </summary>
                <pre>{JSON.stringify(r.content, null, 2)}</pre>
                <small>来源：{JSON.stringify(r.sources)}</small>
              </details>
            ))}
          </div>
        ) : (
          <>
            <fieldset disabled={readOnly} className="editor-fields">
              <div className="form-grid">
                <label>
                  名称
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="为这份创作起个名字"
                  />
                </label>
                <label>
                  状态
                  <select
                    aria-label="状态"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {["draft", "selected", "rejected", "ready", "archived"].map(
                      (s) => (
                        <option key={s} value={s}>
                          {labels[s]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                {route !== "products" && (
                  <label>
                    所属产品
                    <select
                      value={pid}
                      disabled={!!item}
                      onChange={(e) => {
                        setPid(e.target.value);
                        setPlanId("");
                        setParentId("");
                      }}
                    >
                      <option value="">选择产品</option>
                      {products.map((p: Item) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {["storyboards", "assets", "scripts", "deliverables"].includes(
                  route,
                ) && (
                  <label>
                    关联策划案
                    <select
                      value={planId}
                      disabled={!!item}
                      onChange={(e) => setPlanId(e.target.value)}
                    >
                      <option value="">选择策划案</option>
                      {plans
                        .filter((p: Item) => p.productId === pid)
                        .map((p: Item) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {["concepts", "plans"].includes(route) && (
                  <label>
                    来源{route === "concepts" ? "创意批次" : "创意"} ID
                    <input
                      value={parentId}
                      disabled={!!item}
                      onChange={(e) => setParentId(e.target.value)}
                      placeholder="可选，关联已有成果"
                    />
                  </label>
                )}
                <ContentFields content={content} setContent={setContent} />
              </div>
              {route === "storyboards" && (
                <div className="shot-editor">
                  <div className="section-line">
                    <h3>
                      镜头表{" "}
                      <span className="muted">
                        {content.shots.length} 个镜头
                      </span>
                    </h3>
                    <Button
                      onClick={() =>
                        set("shots", [
                          ...content.shots,
                          {
                            id: crypto.randomUUID(),
                            number:
                              Math.max(
                                0,
                                ...content.shots.map((s: any) => s.number),
                              ) + 1,
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
                            imageFileId: "",
                            candidateFileIds: [],
                          },
                        ])
                      }
                    >
                      <Plus size={16} />
                      添加镜头
                    </Button>
                  </div>
                  {content.shots.map((shot: any, index: number) => (
                    <details
                      key={shot.id}
                      className="shot-row"
                      open={index === content.shots.length - 1}
                    >
                      <summary>
                        <b>{String(shot.number).padStart(2, "0")}</b>
                        <span>{shot.description || "待描述镜头"}</span>
                        <small>{shot.duration}s</small>
                      </summary>
                      {shot.imageFileId && (
                        <FilePreview id={shot.imageFileId} compact />
                      )}
                      <div className="form-grid">
                        <ContentFields
                          content={shot}
                          setContent={(s: any) =>
                            set(
                              "shots",
                              content.shots.map((old: any, i: number) =>
                                i === index ? s : old,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        onClick={() =>
                          set(
                            "shots",
                            content.shots.filter(
                              (_: any, i: number) => i !== index,
                            ),
                          )
                        }
                      >
                        <Trash2 size={14} />
                        移除此镜头
                      </Button>
                    </details>
                  ))}
                </div>
              )}
            </fieldset>
            <footer className="modal-actions">
              <span className="small muted">
                {readOnly
                  ? "只读权限，可查看内容和版本历史"
                  : item
                    ? `保存为 V${item.version + 1}，历史版本保留`
                    : "保存后可继续与 Agent 协作"}
              </span>
              <Button onClick={onClose}>取消</Button>
              {!readOnly && (
                <Button
                  primary
                  onClick={save}
                  disabled={busy || !title.trim() || validation.invalid}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  保存{item ? "修订" : ""}
                </Button>
              )}
            </footer>
          </>
        )}
      </Modal>
    </JsonValidation.Provider>
  );
}

function KeyEditor({ item, products, onClose, onSaved, notify }: any) {
  const [members, setMembers] = useState<any[]>([]),
    [allowed, setAllowed] = useState<string[]>(["read", "write", "generate"]);
  useEffect(() => {
    void api("/auth/me")
      .then((me) => {
        setAllowed(me.scopes);
        if (!item)
          setData((d: any) => ({
            ...d,
            scopes: d.scopes.filter((s: string) => me.scopes.includes(s)),
          }));
        if (me.role === "admin")
          void api("/members").then((r) => setMembers(r.items));
      })
      .catch(() => {});
  }, [item]);
  const [data, setData] = useState<any>(
    item
      ? {
          name: item.name,
          ownerId: item.ownerId,
          note: item.note,
          scopes: item.scopes,
          productIds: item.productIds,
          enabled: item.enabled,
          expiresAt: item.expiresAt,
        }
      : {
          name: "",
          note: "",
          scopes: ["read", "write", "generate"],
          productIds: [],
          enabled: true,
          expiresAt: null,
        },
  );
  const [busy, setBusy] = useState(false);
  const field = (k: string, v: any) => setData({ ...data, [k]: v });
  async function save() {
    setBusy(true);
    try {
      await api(
        "/api-keys" + (item ? "/" + item.id : ""),
        item ? "PATCH" : "POST",
        data,
      );
      notify("访问密钥已保存", "success");
      onSaved();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? "编辑访问密钥" : "创建 Agent 访问密钥"}
      onClose={onClose}
    >
      <div className="form-grid">
        {members.length > 0 && (
          <label className="span-2">
            所属成员
            <select
              value={data.ownerId ?? ""}
              disabled={!!item}
              onChange={(e) => field("ownerId", e.target.value || undefined)}
            >
              <option value="">当前成员</option>
              {members
                .filter((m) => m.active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.role}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="span-2">
          名称
          <input
            autoFocus
            value={data.name}
            onChange={(e) => field("name", e.target.value)}
            placeholder="例如：创意策划 Agent"
          />
        </label>
        <label className="span-2">
          备注
          <textarea
            value={data.note}
            onChange={(e) => field("note", e.target.value)}
          />
        </label>
        <label>
          有效期
          <input
            type="datetime-local"
            value={
              data.expiresAt
                ? new Date(
                    new Date(data.expiresAt).getTime() -
                      new Date().getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : ""
            }
            onChange={(e) =>
              field(
                "expiresAt",
                e.target.value ? new Date(e.target.value).toISOString() : null,
              )
            }
          />
          <small>留空表示长期有效</small>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => field("enabled", e.target.checked)}
          />
          启用密钥
        </label>
        <fieldset className="span-2">
          <legend>允许操作</legend>
          {[
            ["read", "读取资料"],
            ["write", "编辑创作"],
            ["generate", "提交生成"],
          ].map(([s, name]) => (
            <label className="check-row" key={s}>
              <input
                type="checkbox"
                checked={data.scopes.includes(s)}
                disabled={!allowed.includes(s)}
                onChange={(e) =>
                  field(
                    "scopes",
                    e.target.checked
                      ? [...data.scopes, s]
                      : data.scopes.filter((x: string) => x !== s),
                  )
                }
              />
              {name}
            </label>
          ))}
          <small>视频批准只允许人类审核，API Key 不具备此权限。</small>
        </fieldset>
        <fieldset className="span-2">
          <legend>可访问产品</legend>
          <small>不勾选表示全部产品；限定产品后不能创建新产品。</small>
          {products.map((p: Item) => (
            <label key={p.id} className="check-row">
              <input
                type="checkbox"
                checked={data.productIds.includes(p.id)}
                onChange={(e) =>
                  field(
                    "productIds",
                    e.target.checked
                      ? [...data.productIds, p.id]
                      : data.productIds.filter((x: string) => x !== p.id),
                  )
                }
              />
              {p.title}
            </label>
          ))}
        </fieldset>
      </div>
      <footer className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          primary
          disabled={!data.name || !data.scopes.length || busy}
          onClick={save}
        >
          保存密钥
        </Button>
      </footer>
    </Modal>
  );
}

function ChannelEditor({ item, onClose, onSaved, notify }: any) {
  const validation = useJsonValidation();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(
    item
      ? {
          name: item.name,
          provider: item.provider,
          baseUrl: item.baseUrl,
          apiKey: "",
          enabled: item.enabled,
          concurrency: item.concurrency,
          models: item.models,
        }
      : {
          name: "",
          provider: "aicentre",
          baseUrl: "https://aicentre2.sligenai.cn:8443",
          apiKey: "",
          enabled: true,
          concurrency: 3,
          models: {
            image: ["gpt-image-2.5"],
            video: ["seedance-2.5"],
            audio: ["suno-v6", "suno-sound"],
          },
        },
  );
  async function save() {
    if (validation.invalid || busy) return;
    setBusy(true);
    try {
      await api(
        "/channels" + (item ? "/" + item.id : ""),
        item ? "PATCH" : "POST",
        data,
      );
      onSaved();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <JsonValidation.Provider value={validation.validate}>
      <Modal title={item ? "编辑模型渠道" : "新增模型渠道"} onClose={onClose}>
        <div className="form-grid">
          {["name", "baseUrl", "apiKey"].map((k) => (
            <label className="span-2" key={k}>
              {
                { name: "名称", baseUrl: "接口地址", apiKey: "供应商 API Key" }[
                  k
                ]
              }
              <input
                type={k === "apiKey" ? "password" : "text"}
                value={data[k]}
                onChange={(e) => setData({ ...data, [k]: e.target.value })}
                placeholder={k === "apiKey" && item ? "留空保留现有凭据" : ""}
              />
            </label>
          ))}
          <label>
            适配器
            <select
              value={data.provider}
              onChange={(e) => setData({ ...data, provider: e.target.value })}
            >
              <option value="aicentre">AI Centre</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </label>
          <label>
            并发上限
            <input
              type="number"
              min={1}
              max={20}
              value={data.concurrency}
              onChange={(e) =>
                setData({ ...data, concurrency: Number(e.target.value) })
              }
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={data.enabled}
              onChange={(e) => setData({ ...data, enabled: e.target.checked })}
            />
            启用渠道
          </label>
          <div className="span-2">
            <JsonInput
              label="能力与模型列表"
              value={data.models}
              onChange={(v: any) => setData({ ...data, models: v })}
            />
          </div>
        </div>
        <footer className="modal-actions">
          <Button
            primary
            onClick={save}
            disabled={busy || validation.invalid || !data.name.trim()}
          >
            保存配置
          </Button>
        </footer>
      </Modal>
    </JsonValidation.Provider>
  );
}

function GenerationDialog({
  productId,
  defaultKind = "image",
  products,
  plans,
  channels,
  onClose,
  onSaved,
  notify,
}: any) {
  const [data, setData] = useState<any>({
    title: "",
    productId: productId ?? "",
    planId: "",
    kind: defaultKind,
    channelId:
      channels.find((c: any) => c.provider === "aicentre" && c.enabled)?.id ??
      "",
    model: "",
    prompt: "",
    refs: "",
    targetResourceId: "",
    targetShotId: "",
    duration: 5,
    resolution: "720p",
    aspectRatio: "16:9",
    sound: false,
  });
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  useEffect(() => setQuote(null), [data]);
  const availableModels: string[] =
    channels.find((c: any) => c.id === data.channelId)?.models?.[data.kind] ??
    [];
  useEffect(() => {
    if (!availableModels.includes(data.model))
      setData((current: any) => ({
        ...current,
        model: availableModels[0] ?? "",
      }));
  }, [data.channelId, data.kind, data.model, channels]);
  const set = (k: string, v: any) => setData({ ...data, [k]: v });
  async function submit() {
    setBusy(true);
    try {
      const c = channels.find((c: any) => c.id === data.channelId);
      if (!c) throw new Error("请先配置媒体渠道");
      const payload = {
        title: data.title || "新制作批次",
        productId: data.productId,
        ...(data.planId ? { planId: data.planId } : {}),
        kind: data.kind,
        entries: [
          {
            prompt: data.prompt,
            model: data.model,
            channel: "auto",
            channelId: data.channelId,
            referenceFileIds: data.refs.split("\n").filter(Boolean),
            ...(data.targetResourceId
              ? { targetResourceId: data.targetResourceId }
              : {}),
            ...(data.targetShotId ? { targetShotId: data.targetShotId } : {}),
            parameters:
              data.kind === "video"
                ? {
                    duration_seconds: data.duration,
                    resolution: data.resolution,
                    aspect_ratio: data.aspectRatio,
                    sound: data.sound,
                  }
                : data.kind === "image"
                  ? { aspect_ratio: data.aspectRatio, image_size: "2K" }
                  : { instrumental: true, title: data.title },
          },
        ],
      };
      if (!quote) {
        setQuote(await api("/billing/quotes", "POST", payload));
        return;
      }
      await api("/production-batches", "POST", {
        ...payload,
        quoteId: quote.id,
      });
      notify(
        data.kind === "video" ? "已提交，等待人工审批" : "任务已加入制作队列",
        "success",
      );
      onSaved();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="提交制作" onClose={onClose} wide>
      <div className="form-grid">
        <label>
          批次名称
          <input
            value={data.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label>
          制作类型
          <select
            value={data.kind}
            onChange={(e) =>
              setData({
                ...data,
                kind: e.target.value,
                model:
                  e.target.value === "image"
                    ? "gpt-image-2.5"
                    : e.target.value === "video"
                      ? "seedance-2.5"
                      : "suno-v6",
              })
            }
          >
            <option value="image">图片资产 / 分镜图</option>
            <option value="video">视频片段 · 需审批</option>
            <option value="audio">音乐 / 音效</option>
          </select>
        </label>
        <label>
          产品
          <select
            aria-label="产品"
            value={data.productId}
            onChange={(e) =>
              setData({
                ...data,
                productId: e.target.value,
                planId: "",
                refs: "",
                targetResourceId: "",
                targetShotId: "",
              })
            }
          >
            <option value="">选择产品</option>
            {products.map((p: Item) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          策划案
          <select
            aria-label="策划案"
            value={data.planId}
            onChange={(e) => set("planId", e.target.value)}
          >
            <option value="">选择策划案（可选）</option>
            {plans
              .filter((p: Item) => p.productId === data.productId)
              .map((p: Item) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          生成渠道
          <select
            value={data.channelId}
            onChange={(e) => set("channelId", e.target.value)}
          >
            {channels
              .filter((c: any) => c.provider === "aicentre" && c.enabled)
              .map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          模型
          <select
            aria-label="模型"
            value={data.model}
            onChange={(e) => set("model", e.target.value)}
          >
            {(
              channels.find((c: any) => c.id === data.channelId)?.models?.[
                data.kind
              ] ?? []
            ).map((m: string) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="span-2">
          制作提示词
          <textarea
            rows={7}
            value={data.prompt}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder="描述画面、主体、动作、镜头语言与声音…"
          />
        </label>
        <label className="span-2">
          参考文件 ID · 顺序即引用顺序
          <textarea
            value={data.refs}
            onChange={(e) => set("refs", e.target.value)}
            placeholder="每行一个，可从资料面板复制"
          />
        </label>
        <label>
          关联资产 / 分镜 / 脚本 ID
          <input
            value={data.targetResourceId}
            onChange={(e) => set("targetResourceId", e.target.value)}
          />
        </label>
        <label>
          目标镜头 ID（分镜图适用）
          <input
            value={data.targetShotId}
            onChange={(e) => set("targetShotId", e.target.value)}
          />
        </label>
        {data.kind !== "audio" && (
          <label>
            画幅
            <select
              value={data.aspectRatio}
              onChange={(e) => set("aspectRatio", e.target.value)}
            >
              {["16:9", "9:16", "1:1", "4:3", "3:4"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        )}
        {data.kind === "video" && (
          <>
            <label>
              时长（4–30 秒）
              <input
                type="number"
                min={4}
                max={30}
                value={data.duration}
                onChange={(e) => set("duration", Number(e.target.value))}
              />
            </label>
            <label>
              分辨率
              <select
                value={data.resolution}
                onChange={(e) => set("resolution", e.target.value)}
              >
                {["480p", "720p", "1080p"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={data.sound}
                onChange={(e) => set("sound", e.target.checked)}
              />
              保留生成音轨
            </label>
          </>
        )}
      </div>
      {data.kind === "video" && (
        <div className="notice">
          提交后生成审批快照。审核者确认后才会调用视频生成接口。
        </div>
      )}
      {quote && (
        <div className="notice">
          <b>预计冻结 {Number(quote.amount).toLocaleString()} 积分</b>
          <p>
            报价有效至 {new Date(quote.expiresAt).toLocaleTimeString()}。
            {quote.lines
              .map(
                (l: any) =>
                  `${l.model} · ${l.units} ${l.unit} · ${l.amount} 分`,
              )
              .join("；")}
            。完成后根据费用结算。
          </p>
        </div>
      )}
      <footer className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          primary
          onClick={submit}
          disabled={
            busy ||
            !data.productId ||
            !data.prompt.trim() ||
            !data.channelId ||
            !availableModels.includes(data.model)
          }
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ArrowUpRight size={16} />
          )}
          {quote
            ? data.kind === "video"
              ? "确认报价并提交审批"
              : "确认报价并生成"
            : "获取积分报价"}
        </Button>
      </footer>
    </Modal>
  );
}

function FilesDialog({ product, notify, onClose, readOnly = false }: any) {
  const [files, setFiles] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api("/files?productId=" + product.id)
        .then((r) => setFiles(r.items))
        .catch((e) => notify(e.message)),
    [product.id, notify],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!files.some((f) => ["pending", "processing"].includes(f.parseStatus)))
      return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [files, load]);
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setBusy(true);
    try {
      let mime = selected.type;
      if (!mime)
        mime = selected.name.endsWith(".md") ? "text/markdown" : "text/plain";
      const init = await api("/files", "POST", {
        productId: product.id,
        name: selected.name,
        mime,
        bytes: selected.size,
      });
      const form = new FormData();
      form.append("file", selected);
      const upload = await fetch("/api/v1/files/" + init.file.id + "/upload", {
        method: "POST",
        body: form,
      });
      if (!upload.ok) {
        const error = await upload.json();
        throw new Error(error.error?.message ?? "上传失败");
      }
      await api("/files/" + init.file.id + "/complete", "POST", {});
      const latest = await api("/products/" + product.id);
      await api("/products/" + product.id, "PATCH", {
        title: latest.title,
        status: latest.status,
        baseVersion: latest.version,
        content: {
          ...latest.content,
          fileIds: [...latest.content.fileIds, init.file.id],
          ...(!latest.content.coverFileId && mime.startsWith("image/")
            ? { coverFileId: init.file.id }
            : {}),
        },
      });
      await load();
      notify("已上传，正在解析资料", "success");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={product.title + " · 产品资料"} onClose={onClose} wide>
      <div className="section-line">
        <p className="muted">保留原始资料，并提取文本供 Agent 使用。</p>
        {!readOnly && (
          <label className="button primary upload-button">
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            上传资料
            <input type="file" disabled={busy} onChange={upload} hidden />
          </label>
        )}
      </div>
      <div className="file-grid">
        {files.map((file) => (
          <article className="file-card" key={file.id}>
            <FilePreview id={file.id} compact />
            <h4>{file.name}</h4>
            <span className="small muted">
              {(file.bytes / 1024).toFixed(0)} KB · {file.parseStatus}
            </span>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(file.id);
                notify("文件 ID 已复制", "success");
              }}
            >
              <Copy size={14} />
              复制 ID
            </Button>
            {file.parseError && !readOnly && (
              <>
                <p className="error small">{file.parseError}</p>
                <Button
                  onClick={() =>
                    api("/files/" + file.id + "/retry-parse", "POST", {})
                      .then(() => {
                        notify("解析任务已重试", "success");
                        void load();
                      })
                      .catch((e) => notify(e.message))
                  }
                >
                  重试解析
                </Button>
              </>
            )}
            {file.extractedText && (
              <details>
                <summary>解析文本</summary>
                <p className="small">{file.extractedText}</p>
              </details>
            )}
          </article>
        ))}
      </div>
      {!files.length && (
        <Empty
          title="还没有产品资料"
          body="上传产品图、说明书、演示视频或访谈记录。"
        />
      )}
    </Modal>
  );
}

function ChatPanel({
  productId,
  planId,
  onClose,
  onChanged,
  notify,
  readOnly = false,
}: any) {
  const [conversations, setConversations] = useState<any[]>([]),
    [id, setId] = useState(""),
    [conversation, setConversation] = useState<any>(null),
    [text, setText] = useState(""),
    [sending, setSending] = useState(false);
  useEffect(() => {
    api("/conversations")
      .then((r) => {
        const items = r.items.filter(
          (c: any) =>
            (!productId || c.productId === productId) &&
            (!planId || c.planId === planId),
        );
        setConversations(items);
        setId(items[0]?.id ?? "");
      })
      .catch(() => {});
  }, [productId, planId]);
  useEffect(() => {
    if (!id) {
      setConversation(null);
      return;
    }
    let mounted = true;
    const read = () =>
      api("/conversations/" + id)
        .then((c) => {
          if (mounted) setConversation(c);
        })
        .catch((e) => {
          if (mounted) notify(e.message);
        });
    void read();
    const t = setInterval(read, 2500);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [id]);
  const run = conversation?.runs?.[0],
    active = run && ["queued", "running"].includes(run.status);
  async function send() {
    if (readOnly || !text.trim() || active || sending) return;
    setSending(true);
    try {
      let cid = id;
      if (!cid) {
        const c = await api("/conversations", "POST", {
          title: text.slice(0, 30),
          ...(productId ? { productId } : {}),
          ...(planId ? { planId } : {}),
        });
        cid = c.id;
        setId(cid);
        setConversations([c, ...conversations]);
      }
      await api("/conversations/" + cid + "/messages", "POST", { text });
      setText("");
      setConversation(await api("/conversations/" + cid));
      onChanged();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <aside className="chat-panel">
      <header>
        <span className="agent-orb">
          <Sparkles size={18} />
        </span>
        <div>
          <b>创作搭档</b>
          <small>DeepSeek Flash</small>
        </div>
        <button aria-label="关闭聊天" className="icon-button" onClick={onClose}>
          <PanelRightClose size={20} />
        </button>
      </header>
      <div className="chat-select">
        <select
          aria-label="选择会话"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">新对话</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button
          aria-label="新对话"
          className="icon-button"
          onClick={() => setId("")}
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="chat-messages">
        {!conversation?.messages?.length && (
          <div className="chat-welcome">
            <Sparkles size={30} />
            <h3>
              下一个好想法，
              <br />
              从这里开始。
            </h3>
            <p>
              告诉我你想做什么，我会读取资料、保存成果，并把进度留在工作台。
            </p>
            {[
              "根据产品资料，整理一份清晰的 Brief",
              "给这个产品提出 10 个不同的创意方向",
            ].map((s) => (
              <button key={s} onClick={() => setText(s)}>
                {s}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        )}
        {conversation?.messages.map((m: any) => (
          <div className={"message " + m.role} key={m.id}>
            <span>{m.role === "user" ? "你" : "创作搭档"}</span>
            <Markdown>{m.text}</Markdown>
          </div>
        ))}
        {run && (
          <div className="run-status">
            <Badge status={run.status} />
            {active ? (
              <Button
                onClick={() =>
                  api("/agent-runs/" + run.id + "/stop", "POST", {}).catch(
                    (e) => notify(e.message),
                  )
                }
              >
                <Pause size={14} />
                停止
              </Button>
            ) : ["paused", "failed", "stopped"].includes(run.status) ? (
              <Button
                onClick={() =>
                  api("/agent-runs/" + run.id + "/continue", "POST", {}).catch(
                    (e) => notify(e.message),
                  )
                }
              >
                <Play size={14} />
                继续
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div className="chat-input">
        <textarea
          aria-label="发送给创作搭档"
          disabled={readOnly}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="描述你的想法…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <small>
            {readOnly ? "当前账号为只读，可查看已有对话" : "视频生成需人工审批"}
          </small>
          <button
            className="send"
            aria-label="发送消息"
            onClick={send}
            disabled={readOnly || active || sending || !text.trim()}
          >
            <ArrowUpRight size={20} />
          </button>
        </div>
      </div>
    </aside>
  );
}

async function allResources(path: string) {
  const first = await api(`${path}?limit=100`);
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page++) {
    const next = await api(`${path}?limit=100&page=${page}`);
    if (!next.items.length) break;
    items.push(...next.items);
  }
  return { items };
}
export default function Workspace() {
  const pathname = usePathname(),
    router = useRouter(),
    section = pathname.split("/")[2] ?? "products",
    nav = navigation.find((n) => n.id === section) ?? navigation[0];
  const [actor, setActor] = useState<any>(null),
    [products, setProducts] = useState<Item[]>([]),
    [plans, setPlans] = useState<Item[]>([]),
    [items, setItems] = useState<any[]>([]),
    [channels, setChannels] = useState<any[]>([]),
    [stats, setStats] = useState<any>({ counts: {} }),
    [productId, setProductId] = useState(""),
    [planFilter, setPlanFilter] = useState(""),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("concepts"),
    [loading, setLoading] = useState(true),
    [editor, setEditor] = useState<any>(null),
    [keyEditor, setKeyEditor] = useState<any>(null),
    [channelEditor, setChannelEditor] = useState<any>(null),
    [generation, setGeneration] = useState(false),
    [files, setFiles] = useState<Item | null>(null),
    [detail, setDetail] = useState<any>(null),
    [chat, setChat] = useState(false),
    [toast, setToast] = useState<{ text: string; kind: string } | null>(null),
    [members, setMembers] = useState<any[] | null>(null),
    [instructions, setInstructions] = useState("");
  const notify = useCallback((text: string, kind = "error") => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 6000);
  }, []);
  const route =
    section === "products"
      ? "products"
      : section === "creative"
        ? tab === "plans" || tab === "storyboards" || tab === "creative-batches"
          ? tab
          : "concepts"
        : section === "assets"
          ? "assets"
          : section === "production"
            ? tab === "scripts" || tab === "deliverables"
              ? tab
              : "production-batches"
            : section === "keys"
              ? "api-keys"
              : section === "channels"
                ? "channels"
                : tab === "audit-events"
                  ? "audit-events"
                  : "jobs";
  const loadSequence = useRef(0);
  const [itemsRoute, setItemsRoute] = useState(route);
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  useEffect(
    () => setPage(1),
    [route, productId, planFilter, search, showArchived],
  );
  const load = useCallback(async () => {
    const seq = ++loadSequence.current;
    setLoading(true);
    try {
      let suffix =
        productId &&
        ["products", "api-keys", "channels", "audit-events"].indexOf(route) < 0
          ? "?productId=" + encodeURIComponent(productId)
          : "";
      if (showArchived && defaults[route])
        suffix += (suffix ? "&" : "?") + "status=archived";
      if (defaults[route]) {
        const query = new URLSearchParams(suffix);
        query.set("page", String(page));
        query.set("limit", "30");
        if (search) query.set("q", search);
        if (
          planFilter &&
          ["storyboards", "assets", "scripts", "deliverables"].includes(route)
        )
          query.set("planId", planFilter);
        suffix = "?" + query.toString();
      }
      const [list, p, pl, ch, st] = await Promise.all([
        api("/" + route + suffix),
        allResources("/products"),
        allResources("/plans"),
        api("/channels"),
        api("/dashboard"),
      ]);
      if (seq !== loadSequence.current) return;
      setItemsRoute(route);
      setItems(list.items ?? []);
      setTotal(list.total ?? list.items?.length ?? 0);
      setProducts(p.items);
      setPlans(pl.items);
      setChannels(ch.items);
      setStats(st);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      if (seq === loadSequence.current) setLoading(false);
    }
  }, [route, productId, notify, showArchived, search, planFilter, page]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search),
      id = query.get("id"),
      batch = query.get("batch");
    if (query.get("productId")) setProductId(query.get("productId")!);
    if (batch)
      void api("/production-batches/" + batch)
        .then(setDetail)
        .catch((e) => notify(e.message));
    if (id)
      void api("/resources/" + id)
        .then((r) => {
          const routes: Record<string, string> = {
            product: "products",
            "creative-batch": "creative-batches",
            concept: "concepts",
            plan: "plans",
            storyboard: "storyboards",
            asset: "assets",
            script: "scripts",
            deliverable: "deliverables",
          };
          setTab(routes[r.kind]);
          setProductId(r.productId ?? "");
          setEditor({ route: routes[r.kind], item: r });
        })
        .catch((e) => notify(e.message));
  }, [pathname, notify]);
  useEffect(() => {
    api("/auth/me")
      .then(setActor)
      .catch(() => {});
  }, []);
  useEffect(() => {
    setItems([]);
    void load();
  }, [load]);
  useEffect(() => {
    if (!["production", "logs"].includes(section)) return;
    const t = setInterval(() => {
      void load();
    }, 8000);
    return () => clearInterval(t);
  }, [load, section]);
  const filtered = (itemsRoute === route ? items : []).filter(
    (i) =>
      (!planFilter ||
        !["storyboards", "assets", "scripts", "deliverables"].includes(route) ||
        i.planId === planFilter) &&
      (i.title ?? i.name ?? i.action ?? i.id)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const canWrite = actor?.scopes?.includes("write"),
    canGenerate = actor?.scopes?.includes("generate");
  function navigate(id: string, selectedProduct = productId) {
    setItems([]);
    setPlanFilter("");
    setTab(
      id === "production"
        ? "production-batches"
        : id === "logs"
          ? "jobs"
          : "concepts",
    );
    setSearch("");
    router.push(
      "/studio/" +
        id +
        (selectedProduct
          ? "?productId=" + encodeURIComponent(selectedProduct)
          : ""),
    );
  }
  async function copyInstructions(key: any) {
    try {
      const result = await api(
        "/api-keys/" + key.id + "/connection-instructions",
        "POST",
        {},
      );
      try {
        await navigator.clipboard.writeText(result.instructions);
        notify("完整接入指令已复制，可粘贴给其他 Agent", "success");
      } catch {
        setInstructions(result.instructions);
      }
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function keyAction(key: any, action: string) {
    if (
      !window.confirm(
        action === "rotate"
          ? "轮换后旧密钥立即失效，继续？"
          : "撤销后此 Agent 无法继续访问，继续？",
      )
    )
      return;
    try {
      await api(
        "/api-keys/" + key.id + (action === "rotate" ? "/rotate" : ""),
        action === "rotate" ? "POST" : "DELETE",
        action === "rotate" ? {} : undefined,
      );
      notify("密钥已" + (action === "rotate" ? "轮换" : "撤销"), "success");
      void load();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function openDetail(item: any) {
    try {
      setDetail(await api("/" + route + "/" + item.id));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function approve(batch: any, decision: string) {
    try {
      await api("/approvals/" + batch.id, "POST", {
        digest: batch.digest,
        decision,
      });
      setDetail(null);
      notify(
        decision === "approve" ? "已批准，任务进入制作队列" : "已拒绝该批次",
        "success",
      );
      void load();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <div className={"workspace " + (chat ? "with-chat" : "")}>
      <aside className="sidebar">
        <a className="brand" href="/studio/products">
          <span className="brand-mark">
            <Clapperboard size={21} />
          </span>
          frameflow<span className="brand-dot">.</span>
        </a>
        <div className="studio-label">
          <span className="studio-avatar">S</span>
          <div>
            <b>{actor?.teamName ?? "团队"}</b>
            <small>创作工作室</small>
          </div>
          <span className="workspace-pill">TEAM</span>
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              aria-label={n.name}
              title={n.name}
              className={section === n.id ? "active" : ""}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              <span>{n.name}</span>
              {n.id === "production" && stats.pendingApprovals > 0 && (
                <small>{stats.pendingApprovals}</small>
              )}
              {section === n.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="agent-callout">
            <div>
              <Sparkles size={19} />
              <b>与你的 Agent 协作</b>
            </div>
            <p>
              让灵感、资产和每次制作
              <br />
              都在同一个地方汇合。
            </p>
            <button onClick={() => setChat(true)}>
              开始对话 <ArrowUpRight size={15} />
            </button>
          </div>
          <a className="team-button" href="/team">
            <Users size={16} />
            团队、积分与账号
          </a>
          <div className="user-row">
            <span>{actor?.name?.[0] ?? "S"}</span>
            <div>
              <b>{actor?.name ?? "加载中"}</b>
              <small>{actor?.role ?? "工作室"}</small>
            </div>
            <button
              aria-label="退出登录"
              className="icon-button"
              onClick={() =>
                api("/auth/logout", "POST", {}).then(
                  () => (window.location.href = "/login"),
                )
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span>工作空间</span>
            <ChevronRight size={14} />
            <b>{nav.name}</b>
          </div>
          <div>
            <span className="online-dot" />
            <span>创作持续发生</span>
            <button
              className="button small-button"
              onClick={() => setChat(!chat)}
            >
              <Sparkles size={15} />
              创作搭档
            </button>
          </div>
        </header>
        <div className="page-body">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {section === "keys"
                  ? "AGENT CONNECTION"
                  : section === "creative"
                    ? "CREATIVE DEVELOPMENT"
                    : section === "production"
                      ? "PRODUCTION STUDIO"
                      : "CREATIVE WORKSPACE"}
              </span>
              <h1>
                {nav.name}
                <span className="heading-dot">.</span>
              </h1>
              <p>{nav.description}</p>
            </div>
            <div className="heading-actions">
              {section === "keys" ? (
                <Button primary onClick={() => setKeyEditor({})}>
                  <Plus size={17} />
                  创建 API Key
                </Button>
              ) : section === "channels" ? (
                actor?.platformAdmin && (
                  <Button primary onClick={() => setChannelEditor({})}>
                    <Plus size={17} />
                    添加渠道
                  </Button>
                )
              ) : section === "logs" ? (
                <Button onClick={load}>
                  <RefreshCw size={16} />
                  刷新状态
                </Button>
              ) : (
                <>
                  {["assets", "production"].includes(section) &&
                    canGenerate && (
                      <Button onClick={() => setGeneration(true)}>
                        <Play size={16} />
                        提交制作
                      </Button>
                    )}
                  {canWrite && (
                    <Button
                      primary
                      onClick={() =>
                        setEditor({
                          route:
                            route === "production-batches" ? "scripts" : route,
                        })
                      }
                    >
                      <Plus size={17} />
                      {section === "products"
                        ? "新建产品"
                        : section === "production"
                          ? "新建" +
                            (route === "deliverables" ? "成片" : "脚本")
                          : "新建" +
                            (route === "plans"
                              ? "策划案"
                              : route === "storyboards"
                                ? "工业分镜"
                                : route === "assets"
                                  ? "资产"
                                  : route === "creative-batches"
                                    ? "创意批次"
                                    : "创意")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          {section === "products" && (
            <>
              <section className="intro-banner">
                <div>
                  <span className="mini-label">FROM BRIEF TO FRAME</span>
                  <h2>
                    把产品的可能性，
                    <br />
                    变成值得被看见的故事。
                  </h2>
                  <button onClick={() => setChat(true)}>
                    与创作搭档一起开始 <ArrowRight size={16} />
                  </button>
                </div>
                <div className="pipeline-art">
                  <div className="art-card back">
                    <span>03</span>
                    <Clapperboard size={37} />
                    <small>PRODUCTION</small>
                  </div>
                  <div className="art-card middle">
                    <span>02</span>
                    <Lightbulb size={37} />
                    <small>CONCEPT</small>
                  </div>
                  <div className="art-card front">
                    <span>01</span>
                    <Boxes size={37} />
                    <small>PRODUCT</small>
                  </div>
                </div>
              </section>
              <div className="stats">
                <div>
                  <span>产品项目</span>
                  <strong>
                    {stats.counts.product ?? 0}
                    <small>个</small>
                  </strong>
                  <Boxes size={20} />
                </div>
                <div>
                  <span>创意积累</span>
                  <strong>
                    {stats.counts.concept ?? 0}
                    <small>个</small>
                  </strong>
                  <Lightbulb size={20} />
                </div>
                <div>
                  <span>制作中</span>
                  <strong>
                    {stats.runningJobs ?? 0}
                    <small>项任务</small>
                  </strong>
                  <Activity size={20} />
                </div>
                <div>
                  <span>已完成生成</span>
                  <strong>
                    {stats.completedJobs ?? 0}
                    <small>项</small>
                  </strong>
                  <Check size={20} />
                </div>
              </div>
            </>
          )}
          {section === "keys" && (
            <section className="skill-banner">
              <div className="skill-icon">
                <KeyRound size={26} />
              </div>
              <div>
                <span className="mini-label">
                  ONE SKILL. YOUR ENTIRE WORKFLOW.
                </span>
                <h2>复制一次，连接你的 Agent。</h2>
                <p>
                  选择下方密钥，复制接入指令。对方 Agent 将安装
                  Skill、配置凭据并验证权限。
                </p>
              </div>
              <a
                className="button"
                href="/skills/ai-video-platform/SKILL.md"
                target="_blank"
                rel="noreferrer"
              >
                <FileText size={16} />
                查看 Skill
              </a>
              <a
                className="icon-button"
                aria-label="下载 Skill 安装包"
                href="/skills/ai-video-platform.zip"
              >
                <Download size={18} />
              </a>
            </section>
          )}
          {section === "creative" && (
            <div className="tabs">
              {[
                ["concepts", "创意池"],
                ["creative-batches", "创意批次"],
                ["plans", "策划案"],
                ["storyboards", "工业分镜"],
              ].map(([id, name]) => (
                <button
                  key={id}
                  className={route === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {section === "production" && (
            <div className="tabs">
              {[
                ["production-batches", "制作批次"],
                ["scripts", "制作脚本"],
                ["deliverables", "成片交付"],
              ].map(([id, name]) => (
                <button
                  key={id}
                  className={route === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {section === "logs" && (
            <div className="tabs">
              {[
                ["jobs", "生成任务"],
                ["audit-events", "操作留痕"],
              ].map(([id, name]) => (
                <button
                  key={id}
                  className={route === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <div className="toolbar">
            {defaults[route] && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                已归档
              </label>
            )}
            <div>
              <h3>
                {section === "products"
                  ? "全部产品"
                  : section === "keys"
                    ? "访问密钥"
                    : "全部记录"}
              </h3>
              <span className="count">{filtered.length}</span>
            </div>
            <div>
              {!["products", "keys", "channels"].includes(section) && (
                <select
                  aria-label="按产品筛选"
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setPlanFilter("");
                  }}
                >
                  <option value="">全部产品</option>
                  {products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )}
              {planFilter && (
                <Button onClick={() => setPlanFilter("")}>策划案筛选 ×</Button>
              )}
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="搜索"
                  placeholder="搜索名称…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <button
                className="icon-button"
                aria-label="刷新列表"
                onClick={load}
              >
                <RefreshCw size={16} className={loading ? "spin" : ""} />
              </button>
            </div>
          </div>
          {loading && !items.length ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在加载工作空间…
            </div>
          ) : !filtered.length ? (
            <Empty
              title={
                section === "products"
                  ? "建立你的第一个产品"
                  : section === "keys"
                    ? "邀请第一个 Agent"
                    : "这里等待新的创作"
              }
              body={
                section === "products"
                  ? "整理好产品资料，让创意、资产与视频围绕它生长。"
                  : "你可以手动创建，也可以让创作搭档帮你完成。"
              }
              onCreate={
                section === "products" && canWrite
                  ? () => setEditor({ route: "products" })
                  : section === "keys"
                    ? () => setKeyEditor({})
                    : undefined
              }
            />
          ) : section === "keys" ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>密钥名称</th>
                    <th>访问权限</th>
                    <th>产品范围</th>
                    <th>状态 / 有效期</th>
                    <th>最近使用</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <b>{k.name}</b>
                        <code>{k.prefix}••••••••</code>
                        <small>{k.note}</small>
                      </td>
                      <td>
                        <div className="tags">
                          {k.scopes.map((s: string) => (
                            <span key={s}>
                              {
                                {
                                  read: "读取",
                                  write: "编辑",
                                  generate: "生成",
                                }[s]
                              }
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {k.productIds.length
                          ? k.productIds.length + " 个产品"
                          : "全部产品"}
                      </td>
                      <td>
                        <Badge
                          status={
                            !k.enabled
                              ? "stopped"
                              : k.expiresAt &&
                                  new Date(k.expiresAt) < new Date()
                                ? "archived"
                                : "ready"
                          }
                        />
                        <small>
                          {k.expiresAt ? date(k.expiresAt) : "长期有效"}
                        </small>
                      </td>
                      <td>{date(k.lastUsedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <Button
                            onClick={() => copyInstructions(k)}
                            disabled={
                              !k.enabled ||
                              (!!k.expiresAt &&
                                new Date(k.expiresAt) < new Date())
                            }
                          >
                            <Copy size={14} />
                            接入指令
                          </Button>
                          <button
                            className="icon-button"
                            aria-label={"编辑 " + k.name}
                            onClick={() => setKeyEditor(k)}
                          >
                            <Settings2 size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={"轮换 " + k.name}
                            onClick={() => keyAction(k, "rotate")}
                          >
                            <RefreshCw size={15} />
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label={"撤销 " + k.name}
                            onClick={() => keyAction(k, "revoke")}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : section === "channels" ? (
            <div className="channel-grid">
              {filtered.map((c) => (
                <article className="channel-card" key={c.id}>
                  <header>
                    <span className="channel-logo">
                      {c.provider === "deepseek" ? "D" : "AI"}
                    </span>
                    <Badge status={c.enabled ? "ready" : "stopped"} />
                  </header>
                  <h3>{c.name}</h3>
                  <p className="small muted">{c.baseUrl}</p>
                  <div className="channel-models">
                    {Object.entries(c.models).map(([kind, models]: any) => (
                      <div key={kind}>
                        <span>
                          {
                            (
                              {
                                text: "文本",
                                vision: "识图",
                                image: "图片",
                                video: "视频",
                                audio: "音乐",
                              } as Record<string, string>
                            )[kind]
                          }
                        </span>
                        <p>{models.join(" · ")}</p>
                      </div>
                    ))}
                  </div>
                  <footer>
                    <small>并发上限 {c.concurrency}</small>
                    {actor?.platformAdmin && (
                      <Button onClick={() => setChannelEditor(c)}>
                        <Settings2 size={15} />
                        配置
                      </Button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          ) : route === "production-batches" ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>制作批次</th>
                    <th>类型</th>
                    <th>任务数</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <b>{b.title}</b>
                        <small>
                          {products.find((p) => p.id === b.productId)?.title}
                        </small>
                      </td>
                      <td>
                        {
                          (
                            {
                              image: "图片",
                              video: "视频",
                              audio: "音乐",
                            } as Record<string, string>
                          )[b.kind]
                        }
                      </td>
                      <td>{b.jobs?.length || b.snapshot.entries.length}</td>
                      <td>
                        <Badge status={b.status} />
                      </td>
                      <td>{date(b.createdAt)}</td>
                      <td>
                        <Button onClick={() => openDetail(b)}>
                          {b.status === "pending_approval"
                            ? "查看审批"
                            : "查看结果"}
                          <ArrowUpRight size={15} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : section === "logs" ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{route === "jobs" ? "任务" : "操作"}</th>
                    <th>状态 / 身份</th>
                    <th>时间</th>
                    <th>说明</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>
                          {i.action ??
                            (
                              {
                                image: "图片生成",
                                video: "视频生成",
                                audio: "音乐生成",
                                parse: "资料解析",
                                overview: "分镜总览",
                              } as any
                            )[i.kind]}
                        </b>
                        <code>{i.id.slice(0, 16)}…</code>
                      </td>
                      <td>
                        {i.status ? <Badge status={i.status} /> : i.actorType}
                      </td>
                      <td>{date(i.createdAt)}</td>
                      <td className="truncate">
                        {i.error ?? i.actualChannel ?? i.entityId ?? "—"}
                      </td>
                      <td>
                        <Button
                          onClick={() =>
                            route === "jobs" ? openDetail(i) : setDetail(i)
                          }
                        >
                          详情
                          <ArrowUpRight size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              className={
                "resource-grid " +
                (section === "products" ? "product-grid" : "")
              }
            >
              {filtered.map((item: Item) => (
                <article key={item.id} className="resource-card">
                  <div
                    className="card-media"
                    onClick={() => setEditor({ route, item })}
                  >
                    {route === "products" ||
                    route === "assets" ||
                    route === "deliverables" ? (
                      <FilePreview
                        id={
                          item.content.coverFileId ??
                          item.content.selectedFileId ??
                          item.content.fileId
                        }
                        compact
                      />
                    ) : route === "storyboards" ? (
                      <div className="board-mini">
                        {Array.from({ length: 9 }, (_, i) => (
                          <div key={i}>
                            {item.content.shots[i]?.imageFileId && (
                              <FilePreview
                                id={item.content.shots[i].imageFileId}
                                compact
                              />
                            )}
                            <span>{String(i + 1).padStart(2, "0")}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={"text-cover " + route}>
                        <span>
                          {route === "concepts"
                            ? "THE BIG IDEA"
                            : route === "plans"
                              ? "CREATIVE TREATMENT"
                              : route === "scripts"
                                ? "PRODUCTION SCRIPT"
                                : "CREATIVE BATCH"}
                        </span>
                        <h3>
                          {item.content.idea ??
                            item.content.message ??
                            item.title}
                        </h3>
                        <ArrowUpRight size={24} />
                      </div>
                    )}
                    <div className="card-media-top">
                      <Badge status={item.status} />
                      <span className="version">V{item.version}</span>
                    </div>
                  </div>
                  <div className="card-body">
                    <h3>{item.title}</h3>
                    <p>
                      {route === "deliverables" &&
                        !item.content.sourceJobIds?.length && (
                          <span className="badge">追溯信息不完整</span>
                        )}
                      {item.content.description ??
                        item.content.hook ??
                        item.content.objective ??
                        item.content.purpose ??
                        (item.content.shots
                          ? item.content.shots.length + " 个镜头"
                          : "每一步创作都有迹可循")}
                    </p>
                    <div className="card-meta">
                      <span>
                        <Clock size={13} />
                        {date(item.updatedAt)}
                      </span>
                      <button
                        className="icon-button"
                        aria-label="复制对象 ID"
                        onClick={() => {
                          void navigator.clipboard.writeText(item.id);
                          notify("对象 ID 已复制", "success");
                        }}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <footer>
                    {route === "products" ? (
                      <>
                        <button onClick={() => setFiles(item)}>
                          <FolderOpen size={15} />
                          产品资料
                        </button>
                        <button
                          onClick={() => {
                            setProductId(item.id);
                            navigate("creative", item.id);
                          }}
                        >
                          开始策划
                          <ArrowUpRight size={15} />
                        </button>
                      </>
                    ) : route === "plans" ? (
                      <>
                        <button onClick={() => setEditor({ route, item })}>
                          {canWrite ? "编辑策划" : "查看策划"}
                        </button>
                        <button
                          onClick={() => {
                            setProductId(item.productId!);
                            setPlanFilter(item.id);
                            setTab("storyboards");
                          }}
                        >
                          查看分镜
                          <ArrowUpRight size={15} />
                        </button>
                      </>
                    ) : route === "storyboards" ? (
                      <>
                        <button onClick={() => setEditor({ route, item })}>
                          {canWrite ? "编辑分镜表" : "查看分镜表"}
                        </button>
                        {canGenerate && (
                          <button
                            onClick={() =>
                              api(
                                "/storyboards/" + item.id + "/overview",
                                "POST",
                                {},
                              )
                                .then(() =>
                                  notify(
                                    "总览任务已创建，请在日志中查看",
                                    "success",
                                  ),
                                )
                                .catch((e) => notify(e.message))
                            }
                          >
                            拼接总览
                            <Grid2X2 size={15} />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditor({ route, item })}>
                          {canWrite ? "查看与编辑" : "查看详情"}
                          <ArrowUpRight size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setProductId(item.productId ?? item.id);
                            setChat(true);
                          }}
                        >
                          <Sparkles size={15} />
                          AI 协作
                        </button>
                      </>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
          {defaults[route] && total > 30 && (
            <div className="section-line" aria-label="列表分页">
              <span>
                共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 30))}{" "}
                页
              </span>
              <div className="row-actions">
                <Button
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <Button
                  disabled={page * 30 >= total || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
          <footer className="page-footer">
            <span>FRAMEFLOW · CREATE WITH INTENTION</span>
            <span>灵感有序，创作自由。</span>
          </footer>
        </div>
      </main>
      {chat && (
        <ChatPanel
          readOnly={!canWrite}
          productId={productId || undefined}
          planId={planFilter || undefined}
          onClose={() => setChat(false)}
          onChanged={load}
          notify={notify}
        />
      )}
      {toast && (
        <div role="status" className={"toast " + toast.kind}>
          {toast.kind === "success" ? (
            <Check size={17} />
          ) : (
            <Activity size={17} />
          )}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="关闭通知"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {editor && (
        <ResourceEditor
          {...editor}
          readOnly={!canWrite}
          selectedPlanId={planFilter}
          products={products}
          productId={productId}
          plans={plans}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void load();
          }}
          notify={notify}
        />
      )}
      {keyEditor && (
        <KeyEditor
          item={keyEditor.id ? keyEditor : null}
          products={products}
          onClose={() => setKeyEditor(null)}
          onSaved={() => {
            setKeyEditor(null);
            void load();
          }}
          notify={notify}
        />
      )}
      {channelEditor && (
        <ChannelEditor
          item={channelEditor.id ? channelEditor : null}
          onClose={() => setChannelEditor(null)}
          onSaved={() => {
            setChannelEditor(null);
            void load();
          }}
          notify={notify}
        />
      )}
      {generation && (
        <GenerationDialog
          defaultKind={section === "production" ? "video" : "image"}
          productId={productId}
          products={products}
          plans={plans}
          channels={channels}
          onClose={() => setGeneration(false)}
          onSaved={() => {
            setGeneration(false);
            void load();
          }}
          notify={notify}
        />
      )}
      {files && (
        <FilesDialog
          product={files}
          readOnly={!canWrite}
          notify={notify}
          onClose={() => {
            setFiles(null);
            void load();
          }}
        />
      )}
      {instructions && (
        <Modal title="完整 Agent 接入指令" onClose={() => setInstructions("")}>
          <p>浏览器未授权剪贴板，请手动复制。此内容包含所选密钥。</p>
          <textarea
            aria-label="接入指令"
            className="code-input"
            rows={14}
            value={instructions}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </Modal>
      )}
      {detail && (
        <Modal
          title={detail.title ?? "任务详情与来源"}
          onClose={() => setDetail(null)}
          wide
        >
          {detail.status && <Badge status={detail.status} />}
          <p className="small muted">{detail.id}</p>
          {detail.input && (
            <p className="small muted">
              费用：
              {detail.result?.cost?.type === "actual"
                ? String(detail.result.cost.amount) +
                  " " +
                  (detail.result.cost.currency ?? "") +
                  "（实际）"
                : detail.result?.cost?.type === "estimated"
                  ? String(detail.result.cost.amount) + "（估算）"
                  : "未知 · 供应商未提供账单"}
            </p>
          )}
          {detail.snapshot?.entries?.map((e: any, i: number) => (
            <section className="approval-entry" key={i}>
              <h3>
                任务 {i + 1} · {e.model}
              </h3>
              <p className="preserve">{e.prompt}</p>
              <div className="tags">
                {Object.entries(e.parameters).map(([k, v]) => (
                  <span key={k}>
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
              <div className="reference-strip">
                {e.referenceFileIds.map((id: string) => (
                  <FilePreview key={id} id={id} compact />
                ))}
              </div>
              <small>来源：{JSON.stringify(e.sources)}</small>
            </section>
          ))}
          {(detail.jobs ?? [detail]).map((j: any) => (
            <div className="job-result" key={j.id}>
              {j.kind && (
                <div className="section-line">
                  <b>
                    {j.kind} · {j.id.slice(0, 8)}
                  </b>
                  <Badge status={j.status} />
                </div>
              )}
              {j.error && <p className="error">{j.error}</p>}
              <div className="file-grid">
                {j.result?.files?.map((f: any) => (
                  <div key={f.fileId}>
                    <FilePreview id={f.fileId} />
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(f.fileId);
                        notify("结果文件 ID 已复制", "success");
                      }}
                    >
                      <Copy size={14} />
                      复制文件 ID
                    </Button>
                    {j.input?.targetResourceId &&
                      f.mime?.startsWith("image/") &&
                      canWrite && (
                        <Button
                          onClick={async () => {
                            try {
                              const r = await api(
                                "/resources/" + j.input.targetResourceId,
                              );
                              if (!["asset", "storyboard"].includes(r.kind))
                                throw new Error("请在制作脚本中引用此文件");
                              const source = j.input.sources?.find(
                                (s: any) => s.resourceId === r.id,
                              );
                              if (
                                source &&
                                source.version !== r.version &&
                                !window.confirm(
                                  "目标内容在本次生成之后已有修订。仍将此图片选用到当前版本？",
                                )
                              )
                                return;
                              const content =
                                r.kind === "asset"
                                  ? {
                                      ...r.content,
                                      selectedFileId: f.fileId,
                                      candidateFileIds: [
                                        ...new Set([
                                          ...r.content.candidateFileIds,
                                          f.fileId,
                                        ]),
                                      ],
                                    }
                                  : {
                                      ...r.content,
                                      shots: r.content.shots.map((s: any) =>
                                        s.id === j.input.targetShotId
                                          ? {
                                              ...s,
                                              imageFileId: f.fileId,
                                              candidateFileIds: [
                                                ...new Set([
                                                  ...s.candidateFileIds,
                                                  f.fileId,
                                                ]),
                                              ],
                                            }
                                          : s,
                                      ),
                                    };
                              if (
                                r.kind === "storyboard" &&
                                !r.content.shots.some(
                                  (s: any) => s.id === j.input.targetShotId,
                                )
                              )
                                throw new Error("目标镜头已移除");
                              await api(
                                "/" +
                                  (r.kind === "asset"
                                    ? "assets"
                                    : "storyboards") +
                                  "/" +
                                  r.id,
                                "PATCH",
                                {
                                  title: r.title,
                                  status: r.status,
                                  baseVersion: r.version,
                                  content,
                                },
                              );
                              notify("已选用图片并保存新版本", "success");
                              void load();
                            } catch (e) {
                              notify((e as Error).message);
                            }
                          }}
                        >
                          <Check size={14} />
                          选用此图片
                        </Button>
                      )}
                  </div>
                ))}
              </div>
              {j.status === "submission_unknown" &&
                actor?.scopes?.includes("approve") && (
                  <Button
                    onClick={() => {
                      const upstreamId = window.prompt(
                        "填写供应商后台确认的任务 ID（系统会验证 external_ref）",
                      );
                      if (upstreamId)
                        void api("/jobs/" + j.id + "/reconcile", "POST", {
                          upstreamId,
                        })
                          .then(() => {
                            setDetail(null);
                            void load();
                          })
                          .catch((e) => notify(e.message));
                    }}
                  >
                    确认供应商任务
                  </Button>
                )}
              {j.status === "transfer_failed" && (
                <Button
                  onClick={() =>
                    api("/jobs/" + j.id + "/retry-transfer", "POST", {})
                      .then(() => {
                        setDetail(null);
                        void load();
                      })
                      .catch((e) => notify(e.message))
                  }
                >
                  重试转存
                </Button>
              )}
              {["queued", "running", "submitting"].includes(j.status) &&
                !j.jobs && (
                  <Button
                    onClick={() =>
                      api("/jobs/" + j.id + "/cancel", "POST", {})
                        .then(() => notify("已请求取消", "success"))
                        .catch((e) => notify(e.message))
                    }
                  >
                    请求取消
                  </Button>
                )}
            </div>
          ))}
          <details className="raw-details">
            <summary>完整参数与追溯信息</summary>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
          </details>
          {detail.status === "pending_approval" &&
            actor?.scopes?.includes("approve") && (
              <footer className="modal-actions">
                <span className="small muted">
                  确认后冻结 {detail.snapshot.estimatedCredits ?? "—"} 分，提交{" "}
                  {detail.snapshot.entries.length} 项视频任务；报价有效至{" "}
                  {new Date(
                    detail.snapshot.quoteExpiresAt,
                  ).toLocaleTimeString()}
                </span>
                <Button onClick={() => approve(detail, "reject")}>拒绝</Button>
                <Button primary onClick={() => approve(detail, "approve")}>
                  <ShieldCheck size={16} />
                  批准本批次
                </Button>
              </footer>
            )}
        </Modal>
      )}
      {members && (
        <MembersDialog
          members={members}
          onClose={() => setMembers(null)}
          notify={notify}
          refresh={() => api("/members").then((r) => setMembers(r.items))}
        />
      )}
    </div>
  );
}
function MembersDialog({ members, onClose, notify, refresh }: any) {
  const [newMember, setNewMember] = useState({
    email: "",
    name: "",
    password: "",
    role: "editor",
  });
  return (
    <Modal title="团队成员" onClose={onClose} wide>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>启用</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m: any) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>
                  <select
                    aria-label={"角色 " + m.name}
                    value={m.role}
                    onChange={(e) =>
                      api("/members/" + m.id, "PATCH", { role: e.target.value })
                        .then(refresh)
                        .catch((e) => notify(e.message))
                    }
                  >
                    {["admin", "editor", "reviewer", "viewer"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={"启用 " + m.name}
                    type="checkbox"
                    checked={m.active}
                    onChange={(e) =>
                      api("/members/" + m.id, "PATCH", {
                        active: e.target.checked,
                      })
                        .then(refresh)
                        .catch((e) => notify(e.message))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>添加成员</h3>
      <div className="form-grid">
        {["name", "email", "password"].map((k) => (
          <label key={k}>
            {
              {
                name: "姓名",
                email: "邮箱",
                password: "初始密码（至少 12 位）",
              }[k]
            }
            <input
              type={
                k === "password" ? "password" : k === "email" ? "email" : "text"
              }
              value={(newMember as any)[k]}
              onChange={(e) =>
                setNewMember({ ...newMember, [k]: e.target.value })
              }
            />
          </label>
        ))}
        <label>
          角色
          <select
            value={newMember.role}
            onChange={(e) =>
              setNewMember({ ...newMember, role: e.target.value })
            }
          >
            {["editor", "reviewer", "viewer", "admin"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <footer className="modal-actions">
        <Button
          primary
          onClick={() =>
            api("/members", "POST", newMember)
              .then(() => {
                refresh();
                setNewMember({
                  email: "",
                  name: "",
                  password: "",
                  role: "editor",
                });
                notify("成员已创建", "success");
              })
              .catch((e) => notify(e.message))
          }
        >
          创建成员
        </Button>
      </footer>
    </Modal>
  );
}
