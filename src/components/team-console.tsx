"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Brand } from "./landing";
import { SmsCode } from "./auth-form";
import { ArrowLeft, Copy, Plus, RefreshCw } from "lucide-react";
const roles: any = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑",
  reviewer: "审核",
  viewer: "只读",
};
const money = (n: any) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
export default function TeamConsole() {
  const [actor, setActor] = useState<any>(null),
    [teams, setTeams] = useState<any[]>([]),
    [members, setMembers] = useState<any[]>([]),
    [wallet, setWallet] = useState<any>({}),
    [usage, setUsage] = useState<any[]>([]),
    [ledger, setLedger] = useState<any[]>([]),
    [invites, setInvites] = useState<any[]>([]),
    [tab, setTab] = useState("team"),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [phone, setPhone] = useState("");
  const [rates, setRates] = useState<any[]>([]),
    [channels, setChannels] = useState<any[]>([]),
    [allTeams, setAllTeams] = useState<any[]>([]),
    [pending, setPending] = useState<any[]>([]);
  const managed = ["owner", "admin"].includes(actor?.teamRole);
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const a = await api("/auth/me");
      setActor(a);
      const [t, m, w, u, l] = await Promise.all([
        api("/teams"),
        api(`/teams/${a.teamId}/members`),
        api("/billing/wallet"),
        api("/billing/usage"),
        api("/billing/ledger"),
      ]);
      setTeams(t.items);
      setMembers(m.items);
      setWallet(w);
      setUsage(u.items);
      setLedger(l.items);
      if (["owner", "admin"].includes(a.teamRole))
        setInvites((await api(`/teams/${a.teamId}/invitations`)).items);
      if (a.platformAdmin) {
        const [r, c, ts, p] = await Promise.all([
          api("/platform/rates"),
          api("/channels"),
          api("/platform/teams"),
          api("/platform/reconcile"),
        ]);
        setRates(r.items);
        setChannels(c.items);
        setAllTeams(ts.items);
        setPending(p.items);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(fn: () => Promise<any>, message = "已保存") {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      setSuccess(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const form = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  };
  return (
    <main className="team-console">
      <header>
        <Brand />
        <a href="/studio/products">
          <ArrowLeft size={15} />
          返回工作台
        </a>
      </header>
      <div className="team-layout">
        <aside>
          <span className="eyebrow">WORKSPACE SETTINGS</span>
          <h1>团队与账号</h1>
          <p>{actor?.teamName ?? "正在加载…"}</p>
          {[
            ["team", "团队管理"],
            ["credits", "积分与用量"],
            ["account", "账号设置"],
            ...(actor?.platformAdmin ? [["platform", "平台管理"]] : []),
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <div className="team-balance">
            <small>当前团队可用积分</small>
            <strong>
              {money(Number(wallet.balance) - Number(wallet.frozen))}
            </strong>
            <span>冻结 {money(wallet.frozen)} 分</span>
          </div>
        </aside>
        <section className="team-content">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="notice">
              {success}
            </p>
          )}
          {tab === "team" && (
            <>
              <h2>你的团队</h2>
              <p className="muted">
                切换团队后，资料、API Key 和积分都使用该团队的上下文。
              </p>
              <div className="team-cards">
                {teams.map((t) => (
                  <article key={t.id}>
                    <h3>{t.name}</h3>
                    <span>
                      {roles[t.role]} {t.archived ? "· 已归档" : ""}
                    </span>
                    <p>
                      {money(
                        Number(t.wallet?.balance) - Number(t.wallet?.frozen),
                      )}{" "}
                      可用积分
                    </p>
                    <button
                      disabled={busy || t.archived || t.id === actor?.teamId}
                      className="button"
                      onClick={() =>
                        act(async () => {
                          await api(`/teams/${t.id}/switch`, "POST", {});
                          location.href = "/team";
                        }, "已切换")
                      }
                    >
                      {t.id === actor?.teamId ? "当前团队" : "切换到此团队"}
                    </button>
                  </article>
                ))}
              </div>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  const d = form(e);
                  void act(
                    () => api("/teams", "POST", d),
                    "团队已创建；新建团队不重复赠送积分",
                  );
                }}
              >
                <input
                  name="name"
                  aria-label="新团队名称"
                  placeholder="新团队名称"
                  maxLength={80}
                  required
                />
                <button className="button primary" disabled={busy}>
                  <Plus size={15} />
                  创建团队
                </button>
              </form>
              {managed && (
                <>
                  <h2>团队设置</h2>
                  <form
                    key={actor?.teamName}
                    className="inline-form"
                    onSubmit={(e) => {
                      const d = form(e);
                      void act(() => api(`/teams/${actor.teamId}`, "PATCH", d));
                    }}
                  >
                    <input
                      name="name"
                      aria-label="团队名称"
                      defaultValue={actor?.teamName}
                      required
                      maxLength={80}
                    />
                    <button className="button" disabled={busy}>
                      重命名
                    </button>
                  </form>
                  <h2>邀请成员</h2>
                  <p className="muted">
                    链接绑定手机号，7 天有效，仅可使用一次。请复制后自行分享。
                  </p>
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      const d = form(e);
                      void act(async () => {
                        const r = await api(
                          `/teams/${actor.teamId}/invitations`,
                          "POST",
                          d,
                        );
                        setInviteUrl(r.url);
                      }, "邀请已创建");
                    }}
                  >
                    <input
                      name="phone"
                      aria-label="受邀手机号"
                      placeholder="受邀手机号"
                      required
                      pattern="1[3-9][0-9]{9}"
                    />
                    <select
                      name="role"
                      aria-label="邀请角色"
                      defaultValue="editor"
                    >
                      {Object.entries(roles)
                        .filter(
                          ([r]) =>
                            r !== "owner" &&
                            (r !== "admin" || actor.teamRole === "owner"),
                        )
                        .map(([r, n]: any) => (
                          <option key={r} value={r}>
                            {n}
                          </option>
                        ))}
                    </select>
                    <button className="button primary" disabled={busy}>
                      生成邀请链接
                    </button>
                  </form>
                  {inviteUrl && (
                    <div className="invite-result">
                      <code>{inviteUrl}</code>
                      <button
                        className="button"
                        onClick={() =>
                          act(
                            () => navigator.clipboard.writeText(inviteUrl),
                            "链接已复制",
                          )
                        }
                      >
                        <Copy size={15} />
                        复制
                      </button>
                    </div>
                  )}
                  {invites
                    .filter(
                      (i) =>
                        !i.acceptedAt &&
                        !i.revokedAt &&
                        new Date(i.expiresAt) > new Date(),
                    )
                    .map((i) => (
                      <div className="member-row" key={i.id}>
                        <span>
                          {i.phone} · {roles[i.role]}
                        </span>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              api(
                                `/teams/${actor.teamId}/invitations/${i.id}`,
                                "DELETE",
                              ),
                            )
                          }
                        >
                          撤销邀请
                        </button>
                      </div>
                    ))}
                </>
              )}
              <h2>团队成员</h2>
              {members.map((m) => (
                <div className="member-row" key={m.id}>
                  <div>
                    <b>{m.user?.name}</b>
                    <small>{m.user?.phone ?? m.user?.email}</small>
                  </div>
                  {managed &&
                  m.role !== "owner" &&
                  m.userId !== actor?.userId ? (
                    <>
                      <select
                        aria-label={`${m.user?.name}的角色`}
                        disabled={busy}
                        value={m.role}
                        onChange={(e) =>
                          act(() =>
                            api(
                              `/teams/${actor.teamId}/members/${m.id}`,
                              "PATCH",
                              { role: e.target.value },
                            ),
                          )
                        }
                      >
                        {Object.entries(roles)
                          .filter(
                            ([r]) =>
                              r !== "owner" &&
                              (r !== "admin" ||
                                actor.teamRole === "owner" ||
                                m.role === "admin"),
                          )
                          .map(([r, n]: any) => (
                            <option key={r} value={r}>
                              {n}
                            </option>
                          ))}
                      </select>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            api(
                              `/teams/${actor.teamId}/members/${m.id}`,
                              "PATCH",
                              { active: !m.active },
                            ),
                          )
                        }
                      >
                        {m.active ? "移除成员" : "恢复成员"}
                      </button>
                    </>
                  ) : (
                    <span>{roles[m.role]}</span>
                  )}
                </div>
              ))}
              {actor?.teamRole === "owner" && (
                <details className="archive-team">
                  <summary>归档当前团队</summary>
                  <p>
                    归档保留历史。必须先完成任务、审批和冻结积分处理，并保留另一个可用团队。
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api(`/teams/${actor.teamId}`, "PATCH", {
                            archived: true,
                          }),
                        "团队已归档",
                      )
                    }
                  >
                    确认归档
                  </button>
                </details>
              )}
            </>
          )}
          {tab === "credits" && (
            <>
              <h2>团队积分</h2>
              <div className="wallet-cards">
                {[
                  ["总余额", wallet.balance],
                  ["已冻结", wallet.frozen],
                  ["可用积分", Number(wallet.balance) - Number(wallet.frozen)],
                ].map(([n, v]) => (
                  <article key={n}>
                    <small>{n}</small>
                    <strong>{money(v)}</strong>
                  </article>
                ))}
              </div>
              <p className="notice">
                1 元采购成本 = 100
                积分。无额外加价、无到期时间。本期不提供在线充值。
              </p>
              <h2>模型调用用量</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "模型 / 调用",
                        "操作者",
                        "冻结 / 结算积分",
                        "计量依据",
                        "状态",
                      ].map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.model}
                          <small>{u.invocationId}</small>
                        </td>
                        <td>
                          {members.find((m) => m.userId === u.actorId)?.user
                            ?.name ?? u.actorId}
                        </td>
                        <td>
                          {money(u.reserved)} /{" "}
                          {u.charged === null ? "—" : money(u.charged)}
                        </td>
                        <td>
                          {u.costType === "actual"
                            ? "供应商实际费用"
                            : u.costType === "calculated"
                              ? "按采购价计算"
                              : u.costType === "manual"
                                ? "管理员对账"
                                : "费用未知"}
                          <small>
                            {u.quoteLine?.units} {u.quoteLine?.unit} · 价格 v
                            {u.quoteLine?.version}
                          </small>
                        </td>
                        <td>
                          {{
                            reserved: "已冻结",
                            submitting: "调用中",
                            settled: "已结算",
                            released: "已释放",
                            reconcile: "待对账",
                          }[u.status as string] ?? u.status}
                          <small>{u.error}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!usage.length && (
                  <p className="empty-note">还没有模型调用记录</p>
                )}
              </div>
              <h2>积分流水</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>类型</th>
                      <th>积分</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((l) => (
                      <tr key={l.id}>
                        <td>{new Date(l.createdAt).toLocaleString()}</td>
                        <td>
                          {{
                            grant: "赠送",
                            reserve: "冻结",
                            charge: "扣分",
                            release: "释放",
                            adjust: "调整",
                          }[l.kind as string] ?? l.kind}
                        </td>
                        <td>{money(l.amount)}</td>
                        <td>{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "account" && (
            <>
              <h2>绑定手机号</h2>
              <p className="muted">
                绑定后可使用手机登录和找回密码，不会合并其他账号。
              </p>
              <form
                className="account-bind"
                onSubmit={(e) => {
                  const d = form(e);
                  void act(
                    () => api("/auth/bind-phone", "POST", d),
                    "手机号已绑定",
                  );
                }}
              >
                <label>
                  中国大陆手机号
                  <input
                    name="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    pattern="1[3-9][0-9]{9}"
                    placeholder="+86 手机号"
                  />
                </label>
                <SmsCode phone={phone} purpose="bind" onError={setError} />
                <button className="button primary" disabled={busy}>
                  验证并绑定
                </button>
              </form>
              <a href="/reset-password">通过短信重置密码</a>
            </>
          )}
          {tab === "platform" && actor?.platformAdmin && (
            <>
              <h2>采购价配置</h2>
              <p className="muted">
                价格仅追加版本。空供应商的价格须覆盖该渠道自动路由的合同采购成本；Token
                单位为每百万，视频为每秒。已冻结任务保留原报价。
              </p>
              <form
                className="rate-form"
                onSubmit={(e) => {
                  const d: any = form(e);
                  try {
                    d.pricingParameters = JSON.parse(
                      d.pricingParameters || "{}",
                    );
                  } catch {
                    setError("参数条件需为合法 JSON 对象");
                    return;
                  }
                  for (const k of ["inputRate", "cachedInputRate"])
                    if (d[k] === "") delete d[k];
                  void act(
                    () => api("/platform/rates", "POST", d),
                    "新采购价版本已发布",
                  );
                }}
              >
                <label>
                  渠道
                  <select name="channelId" required>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  型号
                  <input name="model" list="model-list" required />
                  <datalist id="model-list">
                    {Array.from(
                      new Set(
                        channels.flatMap((c) => Object.values(c.models).flat()),
                      ),
                    ).map((m: any) => (
                      <option key={m}>{m}</option>
                    ))}
                  </datalist>
                </label>
                <label>
                  能力
                  <select name="kind">
                    {["text", "vision", "image", "video", "audio"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  计价单位
                  <select name="unit">
                    {["token", "image", "second", "request"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  单价 / 输出价（元）
                  <input
                    name="rate"
                    type="number"
                    min="0.00000001"
                    step="0.00000001"
                    required
                  />
                </label>
                <label>
                  输入价（元 / 百万 Token）
                  <input
                    name="inputRate"
                    type="number"
                    min="0"
                    step="0.00000001"
                  />
                </label>
                <label>
                  缓存命中价（元 / 百万 Token）
                  <input
                    name="cachedInputRate"
                    type="number"
                    min="0"
                    step="0.00000001"
                  />
                </label>
                <label>
                  规格（如 720p / 2K）
                  <input name="resolution" />
                </label>
                <label>
                  实际供应商（留空为渠道合同价）
                  <input name="supplier" />
                </label>
                <label>
                  其他价格条件（JSON，如 {'{"sound":true}'}）
                  <input name="pricingParameters" defaultValue="{}" />
                </label>
                <label>
                  采购依据
                  <input name="basis" required maxLength={1000} />
                </label>
                <button className="button primary" disabled={busy}>
                  保存新版本
                </button>
              </form>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>型号 / 能力</th>
                      <th>规格 / 供应商</th>
                      <th>人民币单价</th>
                      <th>版本 / 生效</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.model}
                          <small>{r.kind}</small>
                        </td>
                        <td>
                          {r.resolution || "默认"} /{" "}
                          {r.supplier || "渠道合同价"}
                        </td>
                        <td>
                          {r.rate} / {r.unit}
                        </td>
                        <td>
                          v{r.version}
                          <small>
                            {new Date(r.effectiveAt).toLocaleString()}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>团队积分调整</h2>
              <form
                className="rate-form"
                onSubmit={(e) => {
                  const d = form(e);
                  void act(
                    () =>
                      api("/platform/credits", "POST", {
                        ...d,
                        eventKey: crypto.randomUUID(),
                      }),
                    "积分已调整",
                  );
                }}
              >
                <label>
                  团队
                  <select name="teamId">
                    {allTeams
                      .filter((t) => !t.archived)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {money(t.wallet?.balance)} 分
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  调整积分（负数为扣减）
                  <input name="amount" type="number" step="0.000001" required />
                </label>
                <label>
                  调整原因
                  <input name="reason" minLength={3} required />
                </label>
                <button className="button primary" disabled={busy}>
                  确认调整并记账
                </button>
              </form>
              <h2>待对账调用</h2>
              {pending.map((u) => (
                <form
                  className="reconcile-row"
                  key={u.id}
                  onSubmit={(e) => {
                    const d = form(e);
                    void act(
                      () => api(`/platform/reconcile/${u.id}`, "POST", d),
                      "已记录对账结果",
                    );
                  }}
                >
                  <b>{u.model}</b>
                  <small>
                    {u.teamId} · 冻结 {money(u.reserved)} 分 · {u.id}
                  </small>
                  <input
                    name="costCny"
                    type="number"
                    step="0.00000001"
                    min="0"
                    aria-label="确认的人民币费用"
                    placeholder="确认的人民币费用；未收费填 0"
                    required
                  />
                  <input
                    name="reason"
                    aria-label="对账依据"
                    placeholder="对账依据"
                    minLength={3}
                    required
                  />
                  <button className="button" disabled={busy}>
                    按确认费用结算
                  </button>
                </form>
              ))}
              {!pending.length && <p className="empty-note">没有待对账调用</p>}
              <h2>全部团队</h2>
              {allTeams.map((t) => (
                <div className="member-row" key={t.id}>
                  <span>
                    {t.name} · {t.archived ? "已归档" : "启用"}
                  </span>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        api(`/platform/teams/${t.id}`, "PATCH", {
                          archived: !t.archived,
                        }),
                      )
                    }
                  >
                    {t.archived ? "恢复团队" : "归档团队"}
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
