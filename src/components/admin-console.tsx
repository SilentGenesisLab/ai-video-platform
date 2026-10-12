"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { api } from "./api";
import { Brand } from "./landing";
import {
  ArrowLeft,
  BarChart3,
  Settings2,
  Users,
  RefreshCw,
  Plus,
  LayoutDashboard,
  X,
} from "lucide-react";
const n = (v: any) =>
  Number(v ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
const kinds: any = {
  text: "文本",
  vision: "识图",
  image: "图片",
  video: "视频",
  audio: "音乐/音频",
  video_understanding: "视频理解",
  search: "搜索",
};
const costNames: any = {
  actual: "实际费用",
  calculated: "采购价计算",
  estimated: "临时估算",
  manual: "人工对账",
  unknown: "待对账",
};
function Trend({
  title,
  points,
  field,
  color,
}: {
  title: string;
  points: any[];
  field: string;
  color: string;
}) {
  const max = Math.max(1, ...points.map((p) => Number(p[field])));
  const coordinates = points
    .map(
      (p, i) => `${10 + (i * 480) / 13},${110 - (Number(p[field]) / max) * 85}`,
    )
    .join(" ");
  return (
    <article className="admin-trend">
      <h3>{title}</h3>
      <svg
        viewBox="0 0 500 130"
        role="img"
        aria-label={`${title}：${points.map((p) => `${p.day} ${n(p[field])}`).join("，")}`}
      >
        <path d="M10 110H490" stroke="currentColor" opacity=".12" />
        <polygon
          points={`10,110 ${coordinates} 490,110`}
          fill={color}
          opacity=".09"
        />
        <polyline
          points={coordinates}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={p.day}
            cx={10 + (i * 480) / 13}
            cy={110 - (Number(p[field]) / max) * 85}
            r="3"
            fill={color}
          >
            <title>
              {p.day}：{n(p[field])}
            </title>
          </circle>
        ))}
      </svg>
      <div>
        <small>{points[0]?.day}</small>
        <small>{points.at(-1)?.day}</small>
      </div>
    </article>
  );
}
export default function AdminConsole() {
  const [actor, setActor] = useState<any>(),
    [tab, setTab] = useState("dashboard"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<any[]>([]),
    [rates, setRates] = useState<any[]>([]),
    [teams, setTeams] = useState<any[]>([]),
    [users, setUsers] = useState<any>({ items: [], total: 0, page: 1 }),
    [settings, setSettings] = useState<any>({ fallbackCny: 1 }),
    [pending, setPending] = useState<any[]>([]),
    [dashboard, setDashboard] = useState<any>(),
    [overview, setOverview] = useState<any>();
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<any>(null),
    [channelForm, setChannelForm] = useState(false),
    [newUser, setNewUser] = useState(false),
    [detail, setDetail] = useState<any>(),
    [filters, setFilters] = useState<any>({
      days: "30",
      teamId: "",
      actorId: "",
      channelId: "",
      model: "",
      from: "",
      to: "",
    });
  async function load() {
    try {
      const a = await api("/auth/me");
      setActor(a);
      if (!a.platformAdmin) return;
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== "") as string[][],
      );
      const [c, r, t, u, s, p, d, o] = await Promise.all([
        api("/channels"),
        api("/platform/rates"),
        api("/platform/teams"),
        api(`/platform/users?page=${page}&q=${encodeURIComponent(q)}`),
        api("/platform/settings"),
        api("/platform/reconcile"),
        api("/platform/dashboard?" + params),
        api("/platform/overview"),
      ]);
      setChannels(c.items);
      setRates(r.items);
      setTeams(t.items);
      setUsers(u);
      setSettings(s);
      setPending(p.items);
      setDashboard(d);
      setOverview(o);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [page]);
  async function act(fn: () => Promise<any>, message = "已保存") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
      if (detail) setDetail(await api("/platform/users/" + detail.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function form(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as any;
  }
  if (actor && !actor.platformAdmin)
    return (
      <main className="team-console">
        <Brand />
        <h1>没有管理后台权限</h1>
        <p>仅平台管理员可访问。</p>
        <a href="/studio/products">返回工作台</a>
      </main>
    );
  return (
    <main className="team-console admin-console">
      <header>
        <Brand />
        <a href="/studio/products">
          <ArrowLeft size={16} />
          返回工作台
        </a>
      </header>
      <div className="team-layout">
        <aside>
          <span className="eyebrow">PLATFORM ADMIN</span>
          <h1>管理后台</h1>
          <p>渠道、账号与积分，统一管理。</p>
          {[
            ["dashboard", "仪表盘", LayoutDashboard],
            ["analytics", "经营分析", BarChart3],
            ["channels", "AI 能力管理", Settings2],
            ["users", "用户管理", Users],
          ].map(([id, label, Icon]: any) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setError("");
                setNotice("");
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
          <a href="/team">团队与个人账号</a>
        </aside>
        <section className="team-content">
          {error && !detail && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && !detail && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {tab === "dashboard" && (
            <>
              <div className="admin-top">
                <h2>仪表盘</h2>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw size={15} />
                  刷新
                </button>
              </div>
              <p className="muted">
                北京时间 ·
                活跃按当天模型调用的独立操作者统计，任务按模型调用次数统计。
              </p>
              <div className="admin-stats overview-stats">
                {[
                  ["今日注册", overview?.today?.registrations],
                  ["今日活跃（调用）", overview?.today?.active],
                  ["今日调用任务", overview?.today?.requests],
                  ["今日积分消耗", overview?.today?.credits],
                ].map(([label, value]) => (
                  <article key={label}>
                    <small>{label}</small>
                    <strong>{overview ? n(value) : "—"}</strong>
                  </article>
                ))}
              </div>
              <div className="admin-trends">
                <Trend
                  title="近 14 天注册"
                  points={overview?.trend ?? []}
                  field="registrations"
                  color="#8b75c9"
                />
                <Trend
                  title="近 14 天调用任务"
                  points={overview?.trend ?? []}
                  field="requests"
                  color="#389175"
                />
                <Trend
                  title="近 14 天积分消耗"
                  points={overview?.trend ?? []}
                  field="credits"
                  color="#cf735b"
                />
              </div>
              <h3>最近失败调用</h3>
              <div className="team-table">
                <table>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>模型</th>
                      <th>错误</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview?.failures?.map((f: any) => (
                      <tr key={f.id}>
                        <td>{kinds[f.kind] ?? f.kind}</td>
                        <td>{f.model}</td>
                        <td className="admin-failure-message">{f.error}</td>
                        <td>
                          {new Date(f.createdAt).toLocaleString("zh-CN", {
                            timeZone: "Asia/Shanghai",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {overview && !overview.failures.length && (
                  <p className="muted">暂无失败调用。</p>
                )}
              </div>
            </>
          )}
          {tab === "analytics" && (
            <>
              <div className="admin-top">
                <h2>经营分析</h2>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw size={15} />
                  刷新
                </button>
              </div>
              <p className="muted">
                实际费用、按采购价计算和临时估算分别列出。
              </p>
              <form
                className="admin-filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  void load();
                }}
              >
                <label>
                  时间范围
                  <select
                    value={filters.days}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        days: e.target.value,
                        from: "",
                        to: "",
                      })
                    }
                  >
                    <option value="1">今天</option>
                    <option value="7">近7天</option>
                    <option value="30">近30天</option>
                  </select>
                </label>
                <label>
                  开始日期
                  <input
                    type="date"
                    value={filters.from.split("T")[0]}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        from: e.target.value + "T00:00:00+08:00",
                      })
                    }
                  />
                </label>
                <label>
                  结束日期
                  <input
                    type="date"
                    value={filters.to.split("T")[0]}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        to: e.target.value + "T23:59:59+08:00",
                      })
                    }
                  />
                </label>
                <label>
                  团队
                  <select
                    value={filters.teamId}
                    onChange={(e) =>
                      setFilters({ ...filters, teamId: e.target.value })
                    }
                  >
                    <option value="">全部团队</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  用户
                  <select
                    value={filters.actorId}
                    onChange={(e) =>
                      setFilters({ ...filters, actorId: e.target.value })
                    }
                  >
                    <option value="">全部用户</option>
                    {users.items.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  渠道
                  <select
                    value={filters.channelId}
                    onChange={(e) =>
                      setFilters({ ...filters, channelId: e.target.value })
                    }
                  >
                    <option value="">全部渠道</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  模型
                  <input
                    value={filters.model}
                    placeholder="所有模型"
                    onChange={(e) =>
                      setFilters({ ...filters, model: e.target.value })
                    }
                  />
                </label>
                <button className="button dark">应用筛选</button>
              </form>
              <div className="admin-stats">
                {[
                  ["用户", dashboard?.users],
                  ["团队", dashboard?.teams],
                  ["活跃用户", dashboard?.activeUsers],
                  ["请求", dashboard?.requests],
                  ["成功率", `${n((dashboard?.successRate ?? 0) * 100)}%`],
                  ["待对账", dashboard?.reconcile],
                ].map(([label, value]) => (
                  <article key={label}>
                    <small>{label}</small>
                    <strong>
                      {typeof value === "string" ? value : n(value)}
                    </strong>
                  </article>
                ))}
              </div>
              <h3>费用与积分</h3>
              <div className="team-table">
                <table>
                  <thead>
                    <tr>
                      <th>费用依据</th>
                      <th>人民币费用</th>
                      <th>积分消耗</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard?.costs.map((r: any) => (
                      <tr key={r.costType}>
                        <td>{costNames[r.costType] ?? r.costType}</td>
                        <td>¥ {n(r._sum.costCny)}</td>
                        <td>{n(r._sum.charged)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>模型使用</h3>
              <div className="admin-bars">
                {dashboard?.models.map((m: any) => (
                  <article key={m.channelId + m.model}>
                    <span>{m.model}</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.max(2, (m._count._all / Math.max(1, dashboard.requests)) * 100)}%`,
                        }}
                      />
                    </div>
                    <small>
                      {m._count._all} 次 · {n(m._sum.charged)} 积分
                    </small>
                  </article>
                ))}
              </div>
              <h3>尚未核实价格的模型</h3>
              <p className="muted">
                以下模型可以正常调用，暂按每次 ¥{n(settings.fallbackCny)} 结算。
              </p>
              <div className="admin-tags">
                {dashboard?.missingRates.map((r: any) => (
                  <span key={r.channelId + r.kind + r.model}>
                    {r.channel} · {r.model} · {kinds[r.kind]}
                  </span>
                ))}
              </div>
              <p>渠道失败/未完成调用：{dashboard?.failures ?? 0}</p>
              <h3>待对账调用</h3>
              <p className="muted">
                只有取得费用依据后才能人工结算，确认未收费可填0。
              </p>
              {pending.map((p) => (
                <form
                  className="inline-form"
                  key={p.id}
                  onSubmit={(e) => {
                    const d = form(e);
                    void act(() =>
                      api("/platform/reconcile/" + p.id, "POST", {
                        costCny: Number(d.costCny),
                        reason: d.reason,
                      }),
                    );
                  }}
                >
                  <span>
                    {p.model} · 冻结 {n(p.reserved)} · {p.error}
                  </span>
                  <label>
                    实际人民币费用
                    <input
                      type="number"
                      name="costCny"
                      min="0"
                      step="0.000001"
                      required
                    />
                  </label>
                  <label>
                    对账依据
                    <input name="reason" minLength={3} required />
                  </label>
                  <button className="button" disabled={busy}>
                    对账结算
                  </button>
                </form>
              ))}
            </>
          )}
          {tab === "channels" && (
            <>
              <div className="admin-top">
                <h2>AI 能力管理</h2>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api("/platform/rates/confirm-current", "POST", {}),
                      "当前采购价已核实",
                    )
                  }
                >
                  核实全部当前配置
                </button>
                <div className="admin-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    <RefreshCw size={15} />
                    刷新
                  </button>
                  <button
                    className="button dark"
                    onClick={() => {
                      setEditing(null);
                      setChannelForm(true);
                    }}
                  >
                    <Plus size={16} />
                    新增渠道
                  </button>
                </div>
              </div>
              <div className="team-cards">
                {channels.map((c) => (
                  <article key={c.id}>
                    <h3>{c.name}</h3>
                    <p>
                      {c.provider} · {c.enabled ? "启用" : "停用"} ·{" "}
                      {c.configured ? "凭据已配置" : "缺少凭据"}
                    </p>
                    <small>{c.baseUrl}</small>
                    <p>
                      {Object.entries(c.models)
                        .map(
                          ([k, v]: any) => `${kinds[k] ?? k}：${v.join("、")}`,
                        )
                        .join(" / ")}
                    </p>
                    <button
                      className="button"
                      onClick={() => {
                        setEditing(c);
                        setChannelForm(true);
                      }}
                    >
                      编辑配置
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          api("/channels/" + c.id, "PATCH", {
                            ...c,
                            enabled: !c.enabled,
                          }),
                        )
                      }
                    >
                      {c.enabled ? "停用" : "启用"}
                    </button>
                  </article>
                ))}
              </div>
              {channelForm && (
                <form
                  key={editing?.id ?? "new"}
                  className="admin-form"
                  onSubmit={(e) => {
                    const d = form(e);
                    void act(async () => {
                      await api(
                        "/channels" + (editing ? "/" + editing.id : ""),
                        editing ? "PATCH" : "POST",
                        {
                          name: d.name,
                          provider: d.provider,
                          baseUrl: d.baseUrl,
                          ...(d.apiKey ? { apiKey: d.apiKey } : {}),
                          enabled: d.enabled === "on",
                          concurrency: Number(d.concurrency),
                          options: {
                            timeoutMs: Number(d.timeoutMs),
                            searchLimit: Number(d.searchLimit),
                          },
                          models: JSON.parse(d.models),
                        },
                      );
                      setChannelForm(false);
                    });
                  }}
                >
                  <h3>{editing ? "编辑渠道" : "新增渠道"}</h3>
                  <label>
                    渠道名称
                    <input name="name" defaultValue={editing?.name} required />
                  </label>
                  <label>
                    供应商
                    <select
                      name="provider"
                      defaultValue={editing?.provider ?? "deepseek"}
                    >
                      {["deepseek", "aicentre", "volcengine", "bocha"].map(
                        (p) => (
                          <option key={p}>{p}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    API地址
                    <input
                      name="baseUrl"
                      type="url"
                      defaultValue={
                        editing?.baseUrl ?? "https://api.deepseek.com"
                      }
                      required
                    />
                  </label>
                  <label>
                    供应商密钥
                    <input
                      name="apiKey"
                      type="password"
                      autoComplete="new-password"
                      placeholder={editing ? "留空保留现有密钥" : "输入密钥"}
                      required={!editing}
                    />
                  </label>
                  <label>
                    并发
                    <input
                      type="number"
                      min="1"
                      max="20"
                      name="concurrency"
                      defaultValue={editing?.concurrency ?? 3}
                    />
                  </label>
                  <label>
                    超时毫秒
                    <input
                      type="number"
                      min="1000"
                      max="600000"
                      name="timeoutMs"
                      defaultValue={editing?.options?.timeoutMs ?? 180000}
                    />
                  </label>
                  <label>
                    每次回答搜索上限
                    <input
                      type="number"
                      min="1"
                      max="20"
                      name="searchLimit"
                      defaultValue={editing?.options?.searchLimit ?? 5}
                    />
                  </label>
                  <label className="wide">
                    模型能力配置
                    <textarea
                      name="models"
                      rows={5}
                      defaultValue={JSON.stringify(
                        editing?.models ?? { text: ["deepseek-flash"] },
                        null,
                        2,
                      )}
                      required
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={editing?.enabled ?? true}
                    />
                    启用渠道
                  </label>
                  <div className="wide">
                    <button className="button dark" disabled={busy}>
                      保存渠道
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => setChannelForm(false)}
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}
              <h3>缺价默认收费</h3>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  const d = form(e);
                  void act(
                    () =>
                      api("/platform/settings", "PATCH", {
                        fallbackCny: Number(d.fallbackCny),
                      }),
                    "默认估算价格已更新",
                  );
                }}
              >
                <label>
                  每请求人民币金额
                  <input
                    key={settings.fallbackCny}
                    name="fallbackCny"
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    defaultValue={Number(settings.fallbackCny)}
                  />
                </label>
                <button className="button" disabled={busy}>
                  保存默认值
                </button>
              </form>
              <PriceForm
                channels={channels}
                busy={busy}
                onSave={(d: any) =>
                  act(
                    () => api("/platform/rates", "POST", d),
                    "价格新版本已发布",
                  )
                }
              />
              <div className="team-table">
                <table>
                  <thead>
                    <tr>
                      <th>模型/能力</th>
                      <th>价格</th>
                      <th>依据</th>
                      <th>来源/版本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates
                      .filter(
                        (r, i, all) =>
                          all.findIndex(
                            (v) =>
                              v.channelId === r.channelId &&
                              v.model === r.model &&
                              v.resolution === r.resolution &&
                              v.supplier === r.supplier,
                          ) === i,
                      )
                      .map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.model}
                            <small>
                              {kinds[r.kind]} · {r.resolution || "通用规格"}
                            </small>
                          </td>
                          <td>
                            {r.unit === "token"
                              ? `输入 ${n(r.inputRate)} / 缓存 ${n(r.cachedInputRate)} / 输出 ${n(r.rate)} 元/百万Token`
                              : `${n(r.rate)} 元/${r.unit}`}
                          </td>
                          <td>
                            {r.sourceType === "estimated"
                              ? "临时估算"
                              : "已核实"}
                            <small>{r.basis}</small>
                          </td>
                          <td>
                            {r.sourceUrl && (
                              <a
                                href={r.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                价格来源
                              </a>
                            )}
                            <small>
                              v{r.version} ·{" "}
                              {r.checkedAt
                                ? new Date(r.checkedAt).toLocaleDateString()
                                : "未核实"}
                            </small>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "users" && (
            <>
              <div className="admin-top">
                <h2>用户管理</h2>
                <div className="admin-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    <RefreshCw size={15} />
                    刷新
                  </button>
                  <button
                    className="button dark"
                    onClick={() => setNewUser(!newUser)}
                  >
                    创建用户
                  </button>
                </div>
              </div>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setPage(1);
                  void load();
                }}
              >
                <input
                  aria-label="搜索用户"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="姓名、邮箱或手机号"
                />
                <button className="button">搜索</button>
              </form>
              {newUser && (
                <form
                  className="admin-form"
                  onSubmit={(e) => {
                    const d = form(e);
                    void act(async () => {
                      await api("/platform/users", "POST", {
                        ...d,
                        platformAdmin: d.platformAdmin === "on",
                      });
                      setNewUser(false);
                    }, "用户已创建");
                  }}
                >
                  <label>
                    用户姓名
                    <input name="name" required />
                  </label>
                  <label>
                    用户邮箱
                    <input type="email" name="email" required />
                  </label>
                  <label>
                    初始密码
                    <input
                      type="password"
                      name="password"
                      minLength={12}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <label>
                    <input type="checkbox" name="platformAdmin" />
                    平台管理员
                  </label>
                  <button className="button dark" disabled={busy}>
                    保存用户
                  </button>
                </form>
              )}
              <div className="team-table">
                <table>
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>身份/状态</th>
                      <th>个人积分</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.items.map((u: any) => (
                      <tr key={u.id}>
                        <td>
                          {u.name}
                          <small>{u.email ?? u.phone}</small>
                        </td>
                        <td>
                          {u.platformAdmin ? "管理员" : "普通用户"} ·{" "}
                          {u.active ? "启用" : "停用"}
                        </td>
                        <td>
                          {n(u.wallet.balance)}
                          <small>冻结 {n(u.wallet.frozen)}</small>
                        </td>
                        <td>
                          <button
                            className="button"
                            onClick={() =>
                              void act(
                                async () =>
                                  setDetail(
                                    await api("/platform/users/" + u.id),
                                  ),
                                "用户详情已加载",
                              )
                            }
                          >
                            详情 / 编辑
                          </button>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                api("/platform/users/" + u.id, "PATCH", {
                                  active: !u.active,
                                }),
                              )
                            }
                          >
                            {u.active ? "停用用户" : "启用用户"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-top">
                <span>
                  共 {users.total} 位用户 · 第 {page} 页
                </span>
                <div>
                  <button
                    className="button"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    上一页
                  </button>
                  <button
                    className="button"
                    disabled={page * 20 >= users.total}
                    onClick={() => setPage(page + 1)}
                  >
                    下一页
                  </button>
                </div>
              </div>
              {detail && (
                <UserDialog onClose={() => setDetail(null)}>
                  <h2>{detail.name}的用户详情</h2>
                  <p className="muted">
                    {detail.email ?? detail.phone} ·{" "}
                    {detail.platformAdmin ? "管理员" : "普通用户"} ·{" "}
                    {detail.active ? "启用" : "停用"}
                  </p>
                  <p>
                    注册时间：
                    {new Date(detail.createdAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </p>
                  {error && (
                    <p role="alert" className="error">
                      {error}
                    </p>
                  )}
                  {notice && (
                    <p role="status" className="notice">
                      {notice}
                    </p>
                  )}
                  <form
                    className="admin-form"
                    key={detail.id + detail.name}
                    onSubmit={(e) => {
                      const d = form(e);
                      void act(() =>
                        api("/platform/users/" + detail.id, "PATCH", {
                          name: d.name,
                          platformAdmin: d.platformAdmin === "on",
                        }),
                      );
                    }}
                  >
                    <label>
                      姓名
                      <input name="name" defaultValue={detail.name} required />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="platformAdmin"
                        defaultChecked={detail.platformAdmin}
                      />
                      平台管理员
                    </label>
                    <button className="button" disabled={busy}>
                      更新账号
                    </button>
                  </form>
                  <p>
                    所属团队：
                    {detail.teams
                      .map((t: any) => `${t.name}（${t.role}）`)
                      .join("、")}
                  </p>
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      const d = form(e);
                      void act(
                        () =>
                          api(
                            `/platform/users/${detail.id}/reset-password`,
                            "POST",
                            d,
                          ),
                        "密码已重置，原登录会话失效",
                      );
                    }}
                  >
                    <label>
                      新密码
                      <input
                        type="password"
                        name="password"
                        minLength={12}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                    <button className="button" disabled={busy}>
                      重置密码
                    </button>
                  </form>
                  <div className="admin-stats">
                    <article>
                      <small>个人余额</small>
                      <strong>{n(detail.wallet?.balance)}</strong>
                    </article>
                    <article>
                      <small>冻结积分</small>
                      <strong>{n(detail.wallet?.frozen)}</strong>
                    </article>
                  </div>
                  <form
                    className="admin-form"
                    onSubmit={(e) => {
                      const d = form(e);
                      void act(
                        () =>
                          api("/platform/personal-credits", "POST", {
                            ...d,
                            userId: detail.id,
                            amount: Number(d.amount),
                            eventKey: crypto.randomUUID(),
                          }),
                        "个人积分已调整",
                      );
                    }}
                  >
                    <h3 className="wide">调整个人积分</h3>
                    <label>
                      个人调整积分
                      <input
                        name="amount"
                        type="number"
                        step="0.000001"
                        placeholder="正数增加，负数扣减"
                        required
                      />
                    </label>
                    <label>
                      个人调整原因
                      <input name="reason" minLength={3} required />
                    </label>
                    <button className="button dark" disabled={busy}>
                      确认调整个人积分
                    </button>
                  </form>
                  <h3>该用户创建的团队</h3>
                  <p className="muted">
                    仅列出创建者为该用户的团队；受邀加入的团队不在此列。
                  </p>
                  {(detail.createdTeams ?? []).map((t: any) => (
                    <form
                      className="admin-form"
                      key={t.id}
                      onSubmit={(e) => {
                        const d = form(e);
                        void act(
                          () =>
                            api("/platform/credits", "POST", {
                              ...d,
                              teamId: t.id,
                              amount: Number(d.amount),
                              eventKey: crypto.randomUUID(),
                            }),
                          "团队公共积分已调整",
                        );
                      }}
                    >
                      <h4 className="wide">
                        {t.name}
                        {t.archived ? "（已归档）" : ""}
                      </h4>
                      <p className="wide">
                        余额 {n(t.wallet?.balance)} · 冻结 {n(t.wallet?.frozen)}{" "}
                        · 可用{" "}
                        {n(
                          Number(t.wallet?.balance ?? 0) -
                            Number(t.wallet?.frozen ?? 0),
                        )}
                      </p>
                      <label>
                        团队调整积分
                        <input
                          name="amount"
                          type="number"
                          step="0.000001"
                          required
                        />
                      </label>
                      <label>
                        团队调整原因
                        <input name="reason" minLength={3} required />
                      </label>
                      <button className="button" disabled={busy || t.archived}>
                        确认调整团队积分
                      </button>
                    </form>
                  ))}
                  {!detail.createdTeams?.length && (
                    <p className="muted">该用户尚未创建团队。</p>
                  )}
                  <h3>积分调整记录</h3>
                  <div className="team-table">
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>积分变动</th>
                          <th>原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.ledger.map((l: any) => (
                          <tr key={l.id}>
                            <td>{new Date(l.createdAt).toLocaleString()}</td>
                            <td>{n(l.amount)}</td>
                            <td>{l.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h3>个人用量</h3>
                  <div className="team-table">
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>模型</th>
                          <th>状态</th>
                          <th>消耗</th>
                          <th>依据</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.usage.map((u: any) => (
                          <tr key={u.id}>
                            <td>{new Date(u.createdAt).toLocaleString()}</td>
                            <td>{u.model}</td>
                            <td>{u.status}</td>
                            <td>{n(u.charged)}</td>
                            <td>{costNames[u.costType]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="button" onClick={() => setDetail(null)}>
                    关闭详情
                  </button>
                </UserDialog>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
function PriceForm({ channels, busy, onSave }: any) {
  const [priceError, setPriceError] = useState("");
  const [cid, setCid] = useState(""),
    [kind, setKind] = useState("text");
  const c = channels.find((c: any) => c.id === cid);
  return (
    <form
      className="admin-form"
      onSubmit={(e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget)) as any;
        let schedule;
        try {
          schedule = d.billingSchedule
            ? JSON.parse(d.billingSchedule)
            : undefined;
        } catch {
          setPriceError("时段价格规则必须是有效 JSON");
          return;
        }
        setPriceError("");
        onSave({
          ...d,
          rate: Number(d.rate),
          inputRate: d.inputRate !== "" ? Number(d.inputRate) : undefined,
          cachedInputRate:
            d.cachedInputRate !== "" ? Number(d.cachedInputRate) : undefined,
          checkedAt: new Date().toISOString(),
          billingSchedule: schedule,
          ...(d.sourceUrl ? {} : { sourceUrl: undefined }),
        });
      }}
    >
      <h3 className="wide">发布采购价版本</h3>
      {priceError && (
        <p role="alert" className="wide">
          {priceError}
        </p>
      )}
      <label>
        价格渠道
        <select
          name="channelId"
          value={cid}
          onChange={(e) => setCid(e.target.value)}
          required
        >
          <option value="">选择渠道</option>
          {channels.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        能力
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {Object.entries(kinds).map(([k, v]: any) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        型号
        <select name="model" required>
          {(c?.models[kind] ?? []).map((m: string) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label>
        计费单位
        <select
          name="unit"
          key={kind}
          defaultValue={
            ["text", "vision", "video_understanding"].includes(kind)
              ? "token"
              : "request"
          }
        >
          <option value="token">百万Token</option>
          <option value="request">每请求</option>
          <option value="image">每张图片</option>
          <option value="second">每秒</option>
        </select>
      </label>
      <label>
        单价/输出价
        <input
          name="rate"
          type="number"
          min="0.00000001"
          step="0.00000001"
          required
        />
      </label>
      <label>
        输入价
        <input name="inputRate" type="number" min="0" step="0.00000001" />
      </label>
      <label>
        缓存输入价
        <input name="cachedInputRate" type="number" min="0" step="0.00000001" />
      </label>
      <label>
        分辨率
        <input name="resolution" placeholder="通用规格留空" />
      </label>
      <label className="wide">
        价格来源链接
        <input type="url" name="sourceUrl" />
      </label>
      <label className="wide">
        时段价格规则（无时段差异留空）
        <textarea
          name="billingSchedule"
          rows={3}
          placeholder="可填写 Asia/Shanghai、peakWeekdays、peakHours、holidayDates、offPeakMultiplier"
        />
      </label>
      <label className="wide">
        价格依据
        <input
          name="basis"
          placeholder="官方人民币价格或合同价，注明适用条件"
          required
        />
      </label>
      <button className="button dark" disabled={busy}>
        发布价格
      </button>
    </form>
  );
}

function UserDialog({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
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
  return (
    <dialog
      ref={ref}
      className="admin-user-dialog admin-console"
      aria-label="用户详情"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="admin-dialog-body">
        <button
          type="button"
          className="account-close admin-dialog-close"
          aria-label="关闭用户详情"
          onClick={onClose}
        >
          <X size={22} />
        </button>
        {children}
      </div>
    </dialog>
  );
}
