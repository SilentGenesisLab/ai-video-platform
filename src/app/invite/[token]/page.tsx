"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Brand } from "@/components/landing";
import "../../marketing.css";
export default function Invite() {
  const { token } = useParams();
  const [invite, setInvite] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function request(method = "GET") {
    const r = await fetch("/api/v1/invitations/" + token, {
      method,
      ...(method === "POST"
        ? { headers: { "Content-Type": "application/json" }, body: "{}" }
        : {}),
    });
    if (r.status === 401) {
      location.href = "/login?next=" + encodeURIComponent(location.pathname);
      return;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message ?? "邀请不可用");
    return d;
  }
  useEffect(() => {
    request()
      .then(setInvite)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
      <Brand />
      <h1 style={{ marginTop: 50 }}>加入团队</h1>
      {invite && (
        <>
          <h2>{invite.teamName}</h2>
          <p>邀请角色：{invite.role}。加入后可在团队设置中切换工作空间。</p>
          <button
            className="ff-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request("POST");
                location.href = "/team";
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            接受邀请
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        <a href="/team">前往账号设置绑定手机号</a>
      </p>
    </main>
  );
}
