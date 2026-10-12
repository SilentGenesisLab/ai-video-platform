"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Settings,
  HelpCircle,
  ExternalLink,
  LogOut,
  X,
  Upload,
  Sun,
  Moon,
  ShieldCheck,
  Camera,
  FileText,
} from "lucide-react";
import { api, readApiResponse } from "./api";
import { PasswordInput, SmsCode } from "./auth-form";
import { accountLinks } from "./account-links";
const roleNames: Record<string, string> = {
  owner: "团队所有者",
  admin: "团队管理员",
  editor: "编辑",
  reviewer: "审核",
  viewer: "只读成员",
};
async function upload(path: string, form: FormData) {
  const r = await fetch("/api/v1" + path, { method: "POST", body: form });
  const data = await readApiResponse(r);
  if (!r.ok) throw new Error(data.error?.message ?? "提交失败");
  return data;
}
function AccountDialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="account-dialog"
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="account-dialog-inner">
        <header>
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="account-close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
export default function AccountMenu({
  actor,
  onProfileChange,
  canLeave = () => true,
}: {
  actor: any;
  onProfileChange?: (name: string) => void;
  canLeave?: () => boolean;
}) {
  const [open, setOpen] = useState(false),
    [modal, setModal] = useState<"profile" | "feedback" | null>(null),
    [profile, setProfile] = useState<any>(null),
    [theme, setTheme] = useState("light");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    api("/auth/profile")
      .then(setProfile)
      .catch(() => {});
    const saved = localStorage.getItem("frameflow-studio-theme");
    if (saved === "dark") {
      setTheme(saved);
      document.documentElement.dataset.studioTheme = saved;
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const name = profile?.name ?? actor?.name ?? "加载中",
    role = roleNames[actor?.teamRole ?? actor?.role] ?? "团队成员";
  function closeModal() {
    setModal(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <div className="account-menu-root" ref={root}>
      {open && (
        <div
          className="account-popover"
          role="menu"
          aria-label="账号菜单"
          onKeyDown={(e) => {
            const items = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitem"]',
              ),
            );
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              items[
                (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length
              ]?.focus();
            }
          }}
        >
          <div className="account-menu-heading">
            <b>{name}</b>
            <small>{role}</small>
          </div>
          <div className="account-theme">
            <small>显示模式</small>
            <div>
              {["light", "dark"].map((t) => (
                <button
                  type="button"
                  key={t}
                  aria-pressed={theme === t}
                  onClick={() => {
                    setTheme(t);
                    localStorage.setItem("frameflow-studio-theme", t);
                    document.documentElement.dataset.studioTheme = t;
                  }}
                >
                  {t === "light" ? <Sun size={16} /> : <Moon size={16} />}{" "}
                  {t === "light" ? "浅色" : "深色"}
                </button>
              ))}
            </div>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setModal("profile");
            }}
          >
            <Settings size={18} />
            个人设置
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setModal("feedback");
            }}
          >
            <HelpCircle size={18} />
            帮助与反馈
          </button>
          <a
            role="menuitem"
            href={accountLinks.official}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={18} />
            官网
            <ExternalLink className="account-outlink" size={13} />
          </a>
          <div className="account-protocols">
            <a
              role="menuitem"
              href={accountLinks.agreement}
              target="_blank"
              rel="noopener noreferrer"
            >
              产品用户协议
            </a>
            <a
              role="menuitem"
              href={accountLinks.privacy}
              target="_blank"
              rel="noopener noreferrer"
            >
              隐私政策
            </a>
          </div>
          <button
            role="menuitem"
            className="account-logout"
            onClick={async () => {
              if (!canLeave()) return;
              try {
                await api("/auth/logout", "POST", {});
                window.location.href = "/login";
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            <LogOut size={18} />
            退出登录
          </button>
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-label="账号菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLElement>('[role="menuitem"]')
                ?.focus(),
            );
          }
        }}
      >
        <span className="account-avatar">
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" />
          ) : (
            name[0]
          )}
        </span>
        <span className="account-identity">
          <b>{name}</b>
          <small>{role}</small>
        </span>
        <ChevronDown
          size={17}
          className={open ? "account-chevron open" : "account-chevron"}
        />
      </button>
      {modal === "profile" && (
        <AccountDialog title="个人设置" onClose={closeModal}>
          <ProfileSettings
            profile={profile}
            onUpdate={(p) => {
              setProfile(p);
              onProfileChange?.(p.name);
            }}
          />
        </AccountDialog>
      )}
      {modal === "feedback" && (
        <AccountDialog
          title="帮助与反馈"
          description="你的建议将帮助我们持续改善产品体验"
          onClose={closeModal}
        >
          <FeedbackForm onClose={closeModal} admin={actor?.platformAdmin} />
        </AccountDialog>
      )}
    </div>
  );
}
function ProfileSettings({
  profile,
  onUpdate,
}: {
  profile: any;
  onUpdate: (p: any) => void;
}) {
  const [tab, setTab] = useState("profile"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [phone, setPhone] = useState("");
  function start() {
    setBusy(true);
    setError("");
    setSuccess("");
  }
  return (
    <div className="account-dialog-body">
      <div className="account-tabs" role="tablist" aria-label="个人设置分类">
        <button
          role="tab"
          aria-selected={tab === "profile"}
          onClick={() => {
            setTab("profile");
            setError("");
            setSuccess("");
          }}
        >
          <Settings size={16} />
          资料
        </button>
        <button
          role="tab"
          aria-selected={tab === "security"}
          onClick={() => {
            setTab("security");
            setError("");
            setSuccess("");
          }}
        >
          <ShieldCheck size={16} />
          安全设置
        </button>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="account-success">
          {success}
        </p>
      )}
      {tab === "profile" ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            start();
            try {
              const name = String(new FormData(e.currentTarget).get("name"));
              await api("/auth/profile", "PATCH", { name });
              onUpdate({ ...profile, name });
              setSuccess("资料已保存");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="account-avatar-edit">
            <span className="account-avatar large">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="个人头像" />
              ) : (
                (profile?.name?.[0] ?? "S")
              )}
            </span>
            <div>
              <label className="account-upload-button">
                <Camera size={16} />
                {busy ? "处理中…" : "上传头像"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    start();
                    try {
                      if (file.size > 512 * 1024)
                        throw new Error("头像不能超过 512KB");
                      const form = new FormData();
                      form.append("file", file);
                      const data = await upload("/auth/avatar", form);
                      onUpdate({ ...profile, avatarUrl: data.avatarUrl });
                      setSuccess("头像已更新");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
              <p>PNG、JPEG 或 WebP，不超过 512KB</p>
            </div>
          </div>
          <label>
            账户名
            <input
              name="name"
              defaultValue={profile?.name ?? ""}
              required
              maxLength={60}
            />
          </label>
          <label>
            当前手机号
            <span className="account-value">
              {profile?.phone ?? "尚未绑定"}
            </span>
          </label>
          {profile?.email && (
            <label>
              邮箱<span className="account-value">{profile.email}</span>
            </label>
          )}
          <button className="account-primary" disabled={busy}>
            保存资料
          </button>
        </form>
      ) : (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              start();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              if (data.password !== data.confirm) {
                setError("两次输入的新密码不一致");
                setBusy(false);
                return;
              }
              const form = e.currentTarget;
              try {
                await api("/auth/change-password", "POST", data);
                form.reset();
                setSuccess("密码已更新，其他登录会话已退出");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>修改密码</h3>
            <label>
              当前密码
              <PasswordInput
                name="currentPassword"
                required
                autoComplete="current-password"
              />
            </label>
            <label>
              新密码
              <PasswordInput
                name="password"
                required
                minLength={12}
                maxLength={72}
                autoComplete="new-password"
                placeholder="至少 12 位"
              />
            </label>
            <label>
              确认新密码
              <PasswordInput
                name="confirm"
                required
                minLength={12}
                maxLength={72}
                autoComplete="new-password"
              />
            </label>
            <button className="account-primary" disabled={busy}>
              更新密码
            </button>
          </form>
          <div className="account-security-phone">
            <h3>手机号</h3>
            {profile?.phone ? (
              <p>已绑定 {profile.phone}。找回密码可在登录页通过短信验证。</p>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  start();
                  try {
                    await api(
                      "/auth/bind-phone",
                      "POST",
                      Object.fromEntries(new FormData(e.currentTarget)),
                    );
                    onUpdate(await api("/auth/profile"));
                    setSuccess("手机号已绑定");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  手机号
                  <input
                    name="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    type="tel"
                    required
                    placeholder="中国大陆手机号"
                  />
                </label>
                <SmsCode phone={phone} purpose="bind" onError={setError} />
                <button className="account-primary" disabled={busy}>
                  验证并绑定
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
function FeedbackForm({
  onClose,
  admin,
}: {
  onClose: () => void;
  admin: boolean;
}) {
  const [content, setContent] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [history, setHistory] = useState<any[] | null>(null);
  if (done)
    return (
      <div className="account-dialog-body account-feedback-done">
        <HelpCircle size={38} />
        <h3>反馈已提交</h3>
        <p>已保存反馈内容和附件，感谢你的建议。</p>
        <button className="account-primary" onClick={onClose}>
          完成
        </button>
      </div>
    );
  return (
    <form
      className="account-dialog-body"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const data = new FormData(e.currentTarget);
          files.forEach((f) => data.append("files", f));
          await upload("/feedback", data);
          setDone(true);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <label>
        反馈类型
        <select name="type">
          <option>产品建议</option>
          <option>问题反馈</option>
          <option>使用咨询</option>
          <option>其他</option>
        </select>
      </label>
      <label>
        反馈内容
        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          minLength={5}
          maxLength={2000}
          placeholder="请描述你遇到的问题、建议或期望……"
          rows={6}
        />
        <span className="account-counter">{content.length}/2000</span>
      </label>
      <label>
        附件 <small>最多 3 个，单个不超过 5MB</small>
        <span className="account-dropzone">
          <Upload size={25} />
          <span>点击选择文件</span>
          <small>图片、PDF 或 TXT</small>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"
            onChange={(e) => {
              const next = [...files, ...Array.from(e.target.files ?? [])];
              if (next.length > 3) {
                setError("最多上传 3 个附件");
              } else if (next.some((f) => f.size > 5 * 1024 * 1024)) {
                setError("单个附件不能超过 5MB");
              } else {
                setFiles(next);
                setError("");
              }
              e.target.value = "";
            }}
          />
        </span>
      </label>
      {files.map((f, i) => (
        <div className="account-file" key={i}>
          <FileText size={16} />
          <span>{f.name}</span>
          <button
            type="button"
            aria-label={"移除 " + f.name}
            onClick={() => setFiles(files.filter((_, j) => i !== j))}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <div className="account-feedback-history">
        <button
          type="button"
          onClick={async () => {
            try {
              setHistory(await api("/feedback"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {admin ? "查看本团队反馈" : "我的反馈"}
        </button>
        {history?.map((r) => (
          <article key={r.id}>
            <b>{r.type}</b>
            <small>{new Date(r.createdAt).toLocaleString("zh-CN")}</small>
            <p>{r.content}</p>
            {r.attachments?.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const links = await api(
                      "/feedback/" + r.id + "/attachments",
                    );
                    setHistory(
                      (rows) =>
                        rows?.map((row) =>
                          row.id === r.id ? { ...row, links } : row,
                        ) ?? null,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                获取附件下载链接
              </button>
            )}
            {r.links?.map((f: any, i: number) => (
              <a key={i} href={f.url} target="_blank" rel="noopener noreferrer">
                {f.name}
              </a>
            ))}
          </article>
        ))}
      </div>
      <footer className="account-form-footer">
        <button type="button" className="account-secondary" onClick={onClose}>
          取消
        </button>
        <button className="account-primary" disabled={busy}>
          {busy ? "提交中…" : "提交反馈"}
        </button>
      </footer>
    </form>
  );
}
