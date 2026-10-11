"use client";
import { useState } from "react";
import { ArrowUpRight, Clapperboard, LoaderCircle } from "lucide-react";
export default function Login() {
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error?.message);
      window.location.href = "/studio/products";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Clapperboard size={22} />
          </span>
          frameflow<span className="brand-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">YOUR CREATIVE OPERATING SYSTEM</span>
          <h1>
            好创意，
            <br />
            值得被完整实现。
          </h1>
          <p>
            连接产品、创意与制作。
            <br />
            让人与 Agent 在同一个工作台里协作。
          </p>
          <div className="filmstrip">
            <i />
            <i />
            <i />
          </div>
        </div>
        <span className="muted">从一个想法，到每一个镜头。</span>
      </section>
      <section className="login-form">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>进入创作空间</h2>
        <p className="muted">使用团队账号登录，继续你的制作。</p>
        <form onSubmit={login}>
          <label>
            邮箱
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="you@studio.com"
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="输入账号密码"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="button primary" disabled={loading}>
            {loading ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ArrowUpRight size={18} />
            )}
            进入工作台
          </button>
        </form>
        <p className="small muted">账号由团队管理员创建。</p>
      </section>
    </main>
  );
}
