"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  Sparkles,
  X,
  Plus,
  Paperclip,
  Link2,
  Send,
  Pause,
  Play,
  Download,
  LoaderCircle,
  ArrowDown,
  FileText,
} from "lucide-react";
import Markdown from "react-markdown";
import { api, labels } from "./api";

type Binding = {
  productId?: string;
  planId?: string;
  userId?: string;
  teamId?: string;
  readOnly: boolean;
};
const AssistantContext = createContext<any>(null);
export const useAssistant = () => useContext(AssistantContext);
export function AssistantProvider({
  children,
  streamEnabled = true,
}: {
  children: React.ReactNode;
  streamEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [used, setUsed] = useState(false);
  const [binding, setBinding] = useState<Binding>({ readOnly: true });
  const setContext = useCallback(
    (b: Binding) =>
      setBinding((old) =>
        (!b.userId && old.userId) || JSON.stringify(old) === JSON.stringify(b)
          ? old
          : b,
      ),
    [],
  );
  useEffect(() => {
    if (open) setUsed(true);
  }, [open]);
  return (
    <AssistantContext.Provider value={{ open, setOpen, setContext }}>
      {children}
      {used && (
        <AssistantPanel
          key={`${binding.userId ?? "loading"}:${binding.teamId ?? ""}`}
          open={open}
          close={() => setOpen(false)}
          binding={binding}
          streamEnabled={streamEnabled}
        />
      )}
    </AssistantContext.Provider>
  );
}
const extensions: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};
const activeStates = ["queued", "running", "waiting_inputs"];
const states: Record<string, string> = {
  ...labels,
  deferred: "发送后分析",
  processing: "正在分析",
  pending: "等待分析",
  interrupted: "输出已中断",
  streaming: "正在回复",
  waiting_inputs: "正在读取附件",
};
function Attachment({ file, remove, save, retry, readOnly }: any) {
  const video = useRef<HTMLVideoElement>(null),
    [preview, setPreview] = useState(false);
  const analysis = file.metadata?.analysis;
  return (
    <article className="assistant-file" data-file-id={file.id}>
      <div className="assistant-file-title">
        <FileText size={16} />
        <b>{file.name}</b>
        {remove && (
          <button aria-label={"移除 " + file.name} onClick={remove}>
            <X size={14} />
          </button>
        )}
      </div>
      <small>
        {(file.bytes / 1024 / 1024).toFixed(1)} MB ·{" "}
        {states[file.parseStatus] ?? file.parseStatus}
      </small>
      {file.parseError && <p className="error">{file.parseError}</p>}
      {file.mime?.startsWith("image/") && file.url && (
        <button
          className="assistant-image"
          aria-label={"预览 " + file.name}
          onClick={() => setPreview(!preview)}
        >
          <img
            src={file.url}
            alt={file.name}
            style={{ maxHeight: preview ? 500 : 100 }}
          />
        </button>
      )}
      {file.mime?.startsWith("video/") && file.url && (
        <video ref={video} src={file.url} controls preload="metadata" />
      )}
      {file.mime?.startsWith("audio/") && file.url && (
        <audio src={file.url} controls preload="metadata" />
      )}
      {analysis?.shots?.length > 0 && (
        <details>
          <summary>查看分镜时间轴</summary>
          <small>{analysis.timingSource}</small>
          {analysis.shots.map((s: any, i: number) => (
            <div className="assistant-shot" key={i}>
              <button
                onClick={() => {
                  if (video.current) {
                    video.current.currentTime = s.start;
                    void video.current.play().catch(() => {});
                  }
                }}
              >
                {s.start.toFixed(1)}–{s.end.toFixed(1)} 秒
              </button>
              <p>{s.visual}</p>
              {s.speech && <small>说话内容：{s.speech}</small>}
            </div>
          ))}
        </details>
      )}
      <div className="assistant-file-actions">
        {file.url && (
          <a href={file.url} target="_blank" rel="noreferrer">
            <Download size={12} />
            打开原文件
          </a>
        )}
        {!readOnly && save && <button onClick={save}>保存到产品</button>}
        {!readOnly && file.parseStatus === "failed" && (
          <button onClick={retry}>重试分析</button>
        )}
      </div>
    </article>
  );
}
function AssistantPanel({
  open,
  close,
  binding,
  streamEnabled,
}: {
  open: boolean;
  close: () => void;
  binding: Binding;
  streamEnabled: boolean;
}) {
  const [id, setId] = useState(""),
    [conversations, setConversations] = useState<any[]>([]),
    [conversation, setConversation] = useState<any>(null);
  const [text, setText] = useState(""),
    [draftIds, setDraftIds] = useState<string[]>([]),
    [files, setFiles] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false),
    [hydrated, setHydrated] = useState(false),
    [progress, setProgress] = useState(""),
    [notice, setNotice] = useState(""),
    [toolStatus, setToolStatus] = useState("");
  const [sources, setSources] = useState<any[]>([]),
    [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState("");
  const [importJobs, setImportJobs] = useState<string[]>([]),
    [width, setWidth] = useState(520),
    [viewport, setViewport] = useState(1440),
    [dragging, setDragging] = useState(false);
  const [newContent, setNewContent] = useState(false),
    [saveFile, setSaveFile] = useState<any>(null),
    [products, setProducts] = useState<any[]>([]),
    [target, setTarget] = useState("");
  const scroll = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    uploading = useRef(false),
    nearBottom = useRef(true),
    currentId = useRef("");
  const cursor = useRef("0"),
    loaded = useRef(false),
    inFlightConversation = useRef<Promise<string> | null>(null);
  const storageKey =
    "assistant:" + (binding.userId ?? "unknown") + ":" + (binding.teamId ?? "");
  const run = conversation?.runs?.[0],
    active = run && activeStates.includes(run.status);
  const readOnly = binding.readOnly || !hydrated;
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    resize();
    const w = Number(localStorage.getItem("assistant-width"));
    if (w >= 380) setWidth(w);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const refreshFile = useCallback(async (fileId: string) => {
    try {
      const f = await api("/files/" + fileId);
      setFiles((old) => ({ ...old, [fileId]: f }));
      return f;
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, []);
  const selectConversation = useCallback(
    (next: string) => {
      currentId.current = next;
      setId(next);
      setConversation(null);
      setSources([]);
      setToolStatus("");
      setNotice("");
      setImportJobs([]);
      nearBottom.current = true;
      try {
        const draft = JSON.parse(
          sessionStorage.getItem(`${storageKey}:draft:${next}`) || "{}",
        );
        setText(draft.text ?? "");
        setDraftIds(draft.ids ?? []);
        setImportJobs(draft.importJobs ?? []);
        for (const fid of draft.ids ?? []) void refreshFile(fid);
        sessionStorage.setItem(storageKey + ":selected", next);
      } catch {
        setText("");
        setDraftIds([]);
      }
    },
    [storageKey, refreshFile],
  );
  useEffect(() => {
    if (!binding.userId || loaded.current) return;
    loaded.current = true;
    void api("/conversations")
      .then((r) => {
        setConversations(r.items);
        const saved = sessionStorage.getItem(storageKey + ":selected");
        const existing = r.items.find((c: any) => c.id === saved);
        const scoped = r.items.find(
          (c: any) =>
            (!binding.productId || c.productId === binding.productId) &&
            (!binding.planId || c.planId === binding.planId),
        );
        selectConversation(
          saved === "" ? "" : (existing?.id ?? scoped?.id ?? ""),
        );
        setHydrated(true);
      })
      .catch((e) => {
        selectConversation("");
        setNotice(e.message);
        setHydrated(true);
      });
  }, [binding, selectConversation, storageKey]);
  useEffect(() => {
    if (hydrated)
      sessionStorage.setItem(
        `${storageKey}:draft:${id}`,
        JSON.stringify({ text, ids: draftIds, importJobs }),
      );
  }, [text, draftIds, importJobs, id, storageKey, hydrated]);
  useEffect(() => {
    if (!id) return;
    let mounted = true,
      stream: EventSource | undefined,
      polling: ReturnType<typeof setInterval> | undefined,
      recovering = false;
    cursor.current = "0";
    async function snapshot() {
      const c = await api("/conversations/" + id);
      if (!mounted) return;
      setConversation(c);
      cursor.current = c.cursor ?? "0";
      if (c.searches)
        setSources(c.searches.flatMap((s: any) => s.result?.sources ?? []));
      for (const fid of [
        ...new Set<string>(
          c.messages.flatMap((m: any) => m.attachmentIds ?? []),
        ),
      ])
        void refreshFile(fid);
    }
    const attach = () => {
      if (!mounted || !streamEnabled) return;
      stream = new EventSource(
        `/api/v1/conversations/${id}/events?after=${cursor.current}`,
      );
      stream.addEventListener("update", (event: MessageEvent) => {
        try {
          const e = JSON.parse(event.data);
          if (BigInt(e.seq) <= BigInt(cursor.current)) return;
          cursor.current = e.seq;
          const d = e.data;
          if (e.type === "message")
            setConversation((c: any) =>
              c
                ? {
                    ...c,
                    messages: c.messages.some((m: any) => m.id === d.id)
                      ? c.messages
                      : [...c.messages, d],
                  }
                : c,
            );
          if (e.type === "message_start")
            setConversation((c: any) =>
              c
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: d.messageId,
                        role: "assistant",
                        text: "",
                        status: "streaming",
                        runId: e.runId,
                      },
                    ],
                  }
                : c,
            );
          if (e.type === "delta" || e.type === "message_end") {
            setConversation((c: any) =>
              c
                ? {
                    ...c,
                    messages: c.messages.map((m: any) =>
                      m.id === d.messageId
                        ? {
                            ...m,
                            text:
                              e.type === "delta"
                                ? m.text + (d.text ?? "")
                                : m.text,
                            status:
                              e.type === "message_end" ? "completed" : m.status,
                          }
                        : m,
                    ),
                  }
                : c,
            );
            if (e.type === "delta") setToolStatus("");
          }
          if (
            ["run", "complete", "failed", "paused", "waiting_inputs"].includes(
              e.type,
            )
          ) {
            const status =
                d.status ?? (e.type === "complete" ? "completed" : e.type),
              rid = e.runId ?? d.id;
            setConversation((c: any) =>
              c
                ? {
                    ...c,
                    messages: (d.message &&
                    !c.messages.some((m: any) => m.id === d.message.id)
                      ? [...c.messages, d.message]
                      : c.messages
                    ).map((m: any) =>
                      m.runId === rid &&
                      m.status === "streaming" &&
                      ["stopped", "failed"].includes(status)
                        ? { ...m, status }
                        : m,
                    ),
                    runs: [
                      {
                        ...c.runs?.find((r: any) => r.id === rid),
                        id: rid,
                        status,
                      },
                      ...(c.runs ?? []).filter((r: any) => r.id !== rid),
                    ],
                  }
                : c,
            );
            if (!activeStates.includes(status)) {
              setToolStatus("");
              window.dispatchEvent(new Event("assistant:changed"));
            }
          }
          if (e.type === "tool_start" || e.type === "tool")
            setToolStatus(d.text);
          if (e.type === "tool_end") setToolStatus("");
          if (e.type === "attachment") {
            if (d.fileId) void refreshFile(d.fileId);
            setToolStatus(d.status === "processing" ? d.text : "");
          }
          if (e.type === "search") {
            setToolStatus(d.status === "running" ? "正在搜索：" + d.query : "");
            if (d.sources)
              setSources((old) => [
                ...old,
                ...d.sources.filter(
                  (s: any) => !old.some((x) => x.id === s.id),
                ),
              ]);
            if (d.status === "failed") setNotice(d.message);
          }
          if (!nearBottom.current) setNewContent(true);
        } catch {
          setNotice("消息同步暂时中断，正在恢复");
        }
      });
      stream.addEventListener("access-error", () => {
        stream?.close();
        void snapshot().catch((e) => setNotice(e.message));
      });
      stream.onopen = () => {
        recovering = false;
      };
      stream.onerror = () => {
        recovering = true;
      };
    };
    void snapshot()
      .then(attach)
      .catch((e) => {
        if (mounted) setNotice(e.message);
        recovering = true;
      });
    polling = setInterval(() => {
      if ((!streamEnabled || recovering) && mounted)
        void snapshot()
          .then(() => {
            if (!stream) attach();
          })
          .catch((e) => setNotice(e.message));
    }, 3000);
    return () => {
      mounted = false;
      stream?.close();
      if (polling) clearInterval(polling);
    };
  }, [id, streamEnabled, refreshFile]);
  useEffect(() => {
    if (nearBottom.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
      setNewContent(false);
    }
  }, [conversation?.messages, toolStatus, sources, files, open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saveFile) close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, close, saveFile]);
  useEffect(() => {
    if (!importJobs.length) return;
    let mounted = true;
    const poll = async () => {
      for (const jobId of importJobs) {
        try {
          const job = await api("/jobs/" + jobId);
          if (!mounted) return;
          if (job.status === "succeeded") {
            const fid = job.result.fileId;
            await refreshFile(fid);
            setDraftIds((old) => (old.includes(fid) ? old : [...old, fid]));
            setImportJobs((old) => old.filter((x) => x !== jobId));
          } else if (["failed", "cancelled"].includes(job.status)) {
            setNotice(job.error ?? "视频导入失败");
            setImportJobs((old) => old.filter((x) => x !== jobId));
          }
        } catch (e) {
          if (mounted) setNotice((e as Error).message);
        }
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 2000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [importJobs, refreshFile]);
  async function ensureConversation() {
    if (currentId.current) return currentId.current;
    if (!inFlightConversation.current)
      inFlightConversation.current = api("/conversations", "POST", {
        title: text.slice(0, 30) || "附件分析",
        ...(binding.productId ? { productId: binding.productId } : {}),
        ...(binding.planId ? { planId: binding.planId } : {}),
      })
        .then((c) => {
          currentId.current = c.id;
          setId(c.id);
          setConversations((old) => [c, ...old]);
          sessionStorage.setItem(storageKey + ":selected", c.id);
          return c.id;
        })
        .finally(() => {
          inFlightConversation.current = null;
        });
    return inFlightConversation.current;
  }
  async function upload(selected: File[]) {
    if (uploading.current || readOnly) return;
    if (draftIds.length + selected.length > 10) {
      setNotice("每条消息最多添加 10 个附件");
      return;
    }
    uploading.current = true;
    setBusy(true);
    setNotice("");
    try {
      const cid = await ensureConversation();
      for (const file of selected) {
        const ext = file.name.split(".").pop()!.toLowerCase(),
          mime = extensions[ext];
        if (!mime)
          throw new Error(
            "不支持此文件格式；DOC、XLS、PPT 请先转换为新版 Office 格式",
          );
        if (file.size > 512 * 1024 * 1024)
          throw new Error("单文件不能超过 512 MB");
        const init = await api("/files", "POST", {
          conversationId: cid,
          name: file.name,
          mime,
          bytes: file.size,
        });
        setProgress(file.name + " · 上传中");
        const transfer = (
          url: string,
          method: string,
          body: XMLHttpRequestBodyInit,
          headers: Record<string, string> = {},
        ) =>
          new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            xhr.timeout = 300000;
            for (const [k, v] of Object.entries(headers))
              xhr.setRequestHeader(k, v);
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable)
                setProgress(
                  `${file.name} · ${Math.round((e.loaded / e.total) * 100)}%`,
                );
            };
            xhr.onerror = xhr.ontimeout = () =>
              reject(new Error("上传连接失败"));
            xhr.onload = () =>
              xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error("上传失败，请重试"));
            xhr.send(body);
          });
        try {
          await transfer(init.uploadUrl, "PUT", file, init.headers);
        } catch {
          const form = new FormData();
          form.append("file", file);
          await transfer(
            "/api/v1/files/" + init.file.id + "/upload",
            "POST",
            form,
          );
        }
        await api("/files/" + init.file.id + "/complete", "POST", {});
        await refreshFile(init.file.id);
        setDraftIds((old) => [...old, init.file.id]);
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      uploading.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  async function importLink(value = link) {
    if (readOnly || busy) return;
    if (draftIds.length + importJobs.length >= 10) {
      setNotice("每条消息最多添加 10 个附件");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const cid = await ensureConversation();
      const result = await api("/conversations/" + cid + "/imports", "POST", {
        url: value.trim(),
      });
      setImportJobs((old) => [...old, result.jobId]);
      setLink("");
      setLinkOpen(false);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (
      readOnly ||
      busy ||
      active ||
      importJobs.length ||
      (!text.trim() && !draftIds.length)
    )
      return;
    setBusy(true);
    setNotice("");
    nearBottom.current = true;
    try {
      const cid = await ensureConversation();
      await api("/conversations/" + cid + "/messages", "POST", {
        text,
        attachmentIds: draftIds,
      });
      setText("");
      setDraftIds([]);
      window.dispatchEvent(new Event("assistant:changed"));
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry(file: any) {
    try {
      await api("/files/" + file.id + "/retry-parse", "POST", {});
      await refreshFile(file.id);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function startSave(file: any) {
    try {
      const items: any[] = [];
      let page = 1;
      for (;;) {
        const r = await api("/products?limit=100&page=" + page++);
        items.push(...r.items);
        if (items.length >= r.total || !r.items.length) break;
      }
      setProducts(items);
      setTarget(binding.productId ?? items[0]?.id ?? "");
      setSaveFile(file);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function commitSave() {
    try {
      const product = products.find((p) => p.id === target);
      await api("/files/" + saveFile.id + "/save-to-product", "POST", {
        productId: target,
        baseVersion: product.version,
      });
      setSaveFile(null);
      setNotice("资料已保存到产品");
      window.dispatchEvent(new Event("assistant:changed"));
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function resizeStart(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function resizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const value = Math.max(
      380,
      Math.min(960, window.innerWidth - 32, window.innerWidth - e.clientX),
    );
    setWidth(value);
    localStorage.setItem("assistant-width", String(value));
  }
  const shownWidth =
    viewport <= 640
      ? viewport
      : Math.min(Math.max(width, 380), viewport - 32, 960);
  return (
    <aside
      className={`chat-panel assistant-panel ${open ? "is-open" : ""} ${dragging ? "is-resizing" : ""}`}
      style={{ width: shownWidth }}
      aria-label="创意助手"
      aria-hidden={!open}
      inert={!open}
    >
      <div
        className="assistant-resizer"
        role="separator"
        aria-label="调整助手宽度"
        aria-orientation="vertical"
        aria-valuenow={Math.round(shownWidth)}
        aria-valuemin={380}
        aria-valuemax={Math.min(960, viewport - 32)}
        tabIndex={viewport > 640 ? 0 : -1}
        onPointerDown={resizeStart}
        onPointerMove={resizeMove}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onLostPointerCapture={() => setDragging(false)}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            const value = Math.max(
              380,
              Math.min(
                960,
                viewport - 32,
                shownWidth + (e.key === "ArrowLeft" ? 24 : -24),
              ),
            );
            setWidth(value);
            localStorage.setItem("assistant-width", String(value));
          }
        }}
      />
      <header>
        <span className="agent-orb">
          <Sparkles size={20} />
        </span>
        <div>
          <b>创作搭档</b>
          <small>DeepSeek Flash · 附件理解 · 联网搜索</small>
        </div>
        <button className="icon-button" aria-label="关闭聊天" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <div className="chat-select">
        <select
          aria-label="选择会话"
          disabled={!hydrated}
          value={id}
          onChange={(e) => selectConversation(e.target.value)}
        >
          <option value="">新对话</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label="新对话"
          disabled={!hydrated}
          onClick={() => selectConversation("")}
        >
          <Plus size={18} />
        </button>
      </div>
      <div
        className="chat-messages"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current!;
          nearBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (nearBottom.current) setNewContent(false);
        }}
      >
        {!conversation?.messages?.length && (
          <div className="chat-welcome">
            <Sparkles size={32} />
            <h3>
              把想法和参考资料，
              <br />
              放到一起。
            </h3>
            <p>
              支持文档、图片、音视频。发送后开始分析，也可以根据需要搜索外部资料。
            </p>
            {[
              "根据产品资料，整理一份清晰的 Brief",
              "给这个产品提出 10 个不同的创意方向",
            ].map((s) => (
              <button key={s} onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {conversation?.messages?.map((m: any) => (
          <div
            className={"message " + m.role}
            key={m.id}
            data-message-id={m.id}
          >
            <span>
              {m.role === "user" ? "你" : "创作搭档"}{" "}
              {["streaming", "stopped", "interrupted", "failed"].includes(
                m.status,
              ) && <small>{states[m.status]}</small>}
            </span>
            {(m.attachmentIds ?? []).map(
              (fid: string) =>
                files[fid] && (
                  <Attachment
                    key={fid}
                    file={files[fid]}
                    readOnly={readOnly}
                    save={() => void startSave(files[fid])}
                    retry={() => void retry(files[fid])}
                  />
                ),
            )}
            <Markdown>{m.text}</Markdown>
          </div>
        ))}
        {sources.length > 0 && (
          <details className="assistant-sources">
            <summary>参考来源 · {sources.length}</summary>
            {sources.map((s) => (
              <a key={s.id} href={s.url} target="_blank" rel="noreferrer">
                <b>{s.title}</b>
                <small>
                  {s.siteName} {s.publishedAt ?? ""}
                </small>
              </a>
            ))}
          </details>
        )}
        {toolStatus && (
          <p className="assistant-progress">
            <LoaderCircle size={14} className="spin" />
            {toolStatus}
          </p>
        )}
        {run && (
          <div className="run-status">
            <span>{states[run.status] ?? run.status}</span>
            {!readOnly &&
              (active ? (
                <button
                  className="button"
                  onClick={() =>
                    void api(
                      "/agent-runs/" + run.id + "/stop",
                      "POST",
                      {},
                    ).catch((e) => setNotice(e.message))
                  }
                >
                  <Pause size={14} />
                  停止
                </button>
              ) : (
                ["paused", "failed", "stopped"].includes(run.status) && (
                  <button
                    className="button"
                    onClick={() =>
                      void api(
                        "/agent-runs/" + run.id + "/continue",
                        "POST",
                        {},
                      ).catch((e) => setNotice(e.message))
                    }
                  >
                    <Play size={14} />
                    继续
                  </button>
                )
              ))}
          </div>
        )}
      </div>
      {newContent && (
        <button
          className="assistant-new-content"
          onClick={() => {
            nearBottom.current = true;
            if (scroll.current)
              scroll.current.scrollTop = scroll.current.scrollHeight;
            setNewContent(false);
          }}
        >
          <ArrowDown size={14} />
          有新内容
        </button>
      )}
      {notice && (
        <div role="status" className="assistant-notice">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={12} />
          </button>
        </div>
      )}
      <div
        className="chat-input"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="assistant-drafts">
          {draftIds.map(
            (fid) =>
              files[fid] && (
                <Attachment
                  key={fid}
                  file={files[fid]}
                  readOnly={readOnly}
                  remove={() =>
                    setDraftIds((old) => old.filter((x) => x !== fid))
                  }
                  retry={() => void retry(files[fid])}
                />
              ),
          )}
        </div>
        {(progress || importJobs.length > 0) && (
          <p className="assistant-progress">
            <LoaderCircle size={14} className="spin" />
            {progress || "正在导入视频…"}
          </p>
        )}
        {linkOpen && (
          <div className="assistant-link">
            <input
              aria-label="视频直链"
              placeholder="https://…/video.mp4"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button
              className="button"
              disabled={busy || !link.trim()}
              onClick={() => void importLink()}
            >
              添加
            </button>
          </div>
        )}
        <textarea
          ref={input}
          aria-label="发送给创作搭档"
          disabled={readOnly}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="描述你的想法…"
          onPaste={(e) => {
            const images = Array.from(e.clipboardData.files);
            if (images.length) {
              e.preventDefault();
              void upload(images);
            } else {
              const value = e.clipboardData.getData("text").trim();
              if (/^https:\/\/\S+\.(mp4|mov|webm)(\?\S*)?$/i.test(value)) {
                e.preventDefault();
                setLink(value);
                setLinkOpen(true);
              }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="assistant-composer-actions">
          <div>
            {!readOnly && (
              <>
                <label className="icon-button" title="上传附件">
                  <Paperclip size={18} />
                  <input
                    aria-label="上传聊天附件"
                    type="file"
                    multiple
                    disabled={busy}
                    accept={Object.keys(extensions)
                      .map((e) => "." + e)
                      .join(",")}
                    onChange={(e) => {
                      void upload(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                    hidden
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label="添加视频链接"
                  onClick={() => setLinkOpen(!linkOpen)}
                >
                  <Link2 size={18} />
                </button>
              </>
            )}
            <small>
              {readOnly ? "当前账号为只读" : "发送后分析 · 视频生成需审批"}
            </small>
          </div>
          <button
            className="button primary"
            aria-label="发送消息"
            disabled={
              readOnly ||
              busy ||
              active ||
              importJobs.length > 0 ||
              (!text.trim() && !draftIds.length)
            }
            onClick={() => void send()}
          >
            <Send size={17} />
          </button>
        </div>
      </div>
      {saveFile && (
        <div
          className="assistant-save"
          role="dialog"
          aria-label="保存附件到产品"
        >
          <h3>保存附件到产品</h3>
          <p>{saveFile.name}</p>
          <select
            aria-label="目标产品"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <div>
            <button className="button" onClick={() => setSaveFile(null)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!target}
              onClick={() => void commitSave()}
            >
              保存资料
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
