"use client";
import { useState, useEffect, type InputHTMLAttributes } from "react";
import {
  Eye,
  EyeOff,
  ArrowUpRight,
  LoaderCircle,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { Brand, ProductScene } from "./landing";
import { accountLinks } from "./account-links";
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span className="password-input">
      <input {...props} type={show ? "text" : "password"} />
      <button
        type="button"
        aria-label={show ? "隐藏密码" : "显示密码"}
        aria-pressed={show}
        onClick={() => setShow(!show)}
      >
        {show ? <Eye size={19} /> : <EyeOff size={19} />}
      </button>
    </span>
  );
}
async function request(path: string, data: any) {
  const r = await fetch("/api/v1/auth/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const b = await r.json().catch(() => {
    throw new Error("登录服务暂时不可用，请稍后重试");
  });
  if (!r.ok) throw new Error(b.error?.message ?? "请求失败，请重试");
  return b;
}
export function SmsCode({
  phone,
  purpose,
  onError,
}: {
  phone: string;
  purpose: string;
  onError: (s: string) => void;
}) {
  const [seconds, setSeconds] = useState(0),
    [sending, setSending] = useState(false);
  useEffect(() => {
    if (!seconds) return;
    const t = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return (
    <label>
      短信验证码
      <span className="sms-input">
        <input
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="6 位验证码"
        />
        <button
          type="button"
          disabled={seconds > 0 || sending}
          onClick={async () => {
            onError("");
            setSending(true);
            try {
              await request("sms", { phone, purpose });
              setSeconds(60);
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? "发送中…" : seconds ? `${seconds} 秒后重发` : "获取验证码"}
        </button>
      </span>
    </label>
  );
}
export default function AuthForm({
  mode,
}: {
  mode: "login" | "register" | "reset";
}) {
  const [tab, setTab] = useState("otp"),
    [phone, setPhone] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const register = mode === "register",
    reset = mode === "reset",
    sms = register || reset || tab === "otp";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await request(
        register
          ? "register"
          : reset
            ? "reset-password"
            : tab === "otp"
              ? "otp-login"
              : "login",
        data,
      );
      if (reset) setDone(true);
      else {
        const next = new URLSearchParams(location.search).get("next");
        location.href = next?.startsWith("/invite/")
          ? next
          : "/studio/products";
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <Brand />
        <div>
          <span className="ff-kicker">YOUR CREATIVE OPERATING SYSTEM</span>
          <h1>
            每一个想法，
            <br />
            都值得一个
            <br />
            <em>完整的故事。</em>
          </h1>
          <p>
            连接产品、创意与制作。
            <br />
            让人与 Agent 在同一个空间协作。
          </p>
        </div>
        <div className="auth-scene">
          <ProductScene />
          <span>原创概念示例 / MORNING</span>
        </div>
        <small>从一个想法，到每一个镜头。</small>
      </section>
      <section className="auth-content">
        <Link href="/" className="back-home">
          <ArrowLeft size={15} /> 返回官网
        </Link>
        <div className="auth-card">
          <span className="ff-kicker">
            {register
              ? "YOUR FIRST FRAME"
              : reset
                ? "BACK TO YOUR WORKSPACE"
                : "WELCOME BACK"}
          </span>
          <h2>
            {register
              ? "开启你的创作空间"
              : reset
                ? "找回密码"
                : "继续你的创作"}
          </h2>
          <p className="auth-description">
            {register
              ? "手机注册，即得 1000 团队共享积分。"
              : reset
                ? "验证已绑定的手机号，设置新密码。"
                : "从上一次的灵感，接着往下。"}
          </p>
          {done ? (
            <div className="auth-success" role="status">
              <h3>密码已更新</h3>
              <p>原有登录会话已退出，请使用新密码登录。</p>
              <Link className="ff-button" href="/login">
                返回登录
                <ArrowUpRight size={17} />
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={submit}>
                {mode === "login" && (
                  <div
                    className="auth-tabs"
                    role="tablist"
                    aria-label="登录方式"
                  >
                    {[
                      ["otp", "验证码登录"],
                      ["phone", "手机密码"],
                      ["email", "邮箱密码"],
                    ].map(([id, title]) => (
                      <button
                        type="button"
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => {
                          setTab(id);
                          setError("");
                        }}
                      >
                        {title}
                      </button>
                    ))}
                  </div>
                )}
                {tab === "email" && mode === "login" ? (
                  <label>
                    邮箱
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                      placeholder="you@studio.com"
                    />
                  </label>
                ) : (
                  <label>
                    手机号
                    <span className="phone-input">
                      <span>+86</span>
                      <input
                        name={sms ? "phone" : "identifier"}
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        pattern="1[3-9][0-9]{9}"
                        maxLength={11}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        placeholder="请输入中国大陆手机号"
                      />
                    </span>
                  </label>
                )}
                {sms && (
                  <SmsCode
                    phone={phone}
                    purpose={register ? "register" : reset ? "reset" : "login"}
                    onError={setError}
                  />
                )}{" "}
                {register && (
                  <label>
                    昵称
                    <input
                      name="name"
                      required
                      maxLength={60}
                      autoComplete="nickname"
                      placeholder="怎么称呼你"
                    />
                  </label>
                )}
                {(!sms || register || reset) && (
                  <label>
                    {reset ? "新密码" : "密码"}
                    <PasswordInput
                      name="password"
                      autoComplete={
                        register || reset ? "new-password" : "current-password"
                      }
                      minLength={register || reset ? 12 : undefined}
                      maxLength={72}
                      required
                      placeholder={
                        register || reset ? "至少 12 位字符" : "请输入密码"
                      }
                    />
                  </label>
                )}
                {mode === "login" && (
                  <Link className="auth-forgot" href="/reset-password">
                    忘记密码？
                  </Link>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  className="ff-button auth-submit"
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <ArrowUpRight size={18} />
                  )}{" "}
                  {busy
                    ? "正在处理…"
                    : register
                      ? "注册并开始创作"
                      : reset
                        ? "重置密码"
                        : "进入工作台"}
                </button>
              </form>
              <p className="auth-switch">
                {register ? "已有账号？" : "还没有账号？"}{" "}
                <Link href={register ? "/login" : "/register"}>
                  {register ? "立即登录" : "立即注册"}
                </Link>
              </p>
              {register && (
                <p className="auth-note">
                  积分发放至你的初始团队。创建其他团队或加入团队，不会重复赠送。
                </p>
              )}
              {mode === "login" && (
                <p className="auth-note">
                  验证码登录仅适用于已注册账号。原有邮箱账号可继续登录。
                </p>
              )}
            </>
          )}
        </div>
        <div className="auth-protocols"><a href={accountLinks.agreement} target="_blank" rel="noopener noreferrer">产品用户协议</a><span>·</span><a href={accountLinks.privacy} target="_blank" rel="noopener noreferrer">隐私政策</a></div>
        <span className="auth-bottom">FRAMEFLOW · YOUR CREATIVE WORKSPACE</span>
      </section>
    </main>
  );
}
