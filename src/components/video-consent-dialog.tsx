"use client";
import { useEffect, useRef, useState } from "react";
import { X, LoaderCircle } from "lucide-react";
import { api } from "./api";
export default function VideoConsentDialog({
  batch,
  close,
  decided,
}: {
  batch: any;
  close: () => void;
  decided: () => void;
}) {
  const [quote, setQuote] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [available, setAvailable] = useState<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const updated = await api(
        `/production-batches/${batch.id}/refresh-quote`,
        "POST",
        {},
      );
      if (!mounted.current) return;
      setQuote(updated);
      if (updated.payerIsCurrentUser) {
        const wallet = await api("/billing/wallet");
        if (mounted.current)
          setAvailable(Number(wallet.balance) - Number(wallet.frozen));
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    dialog.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, [batch.id]);
  async function decide(decision: "approve" | "reject") {
    if (busy || loading || !quote) return;
    if (
      decision === "approve" &&
      new Date(quote.quoteExpiresAt).getTime() <= Date.now()
    ) {
      await refresh();
      setError("报价已更新，请核对积分后再次确认。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/approvals/${batch.id}`, "POST", {
        digest: quote.digest,
        decision,
      });
      if (mounted.current) decided();
    } catch (e) {
      if (!mounted.current) return;
      if ((e as any).status === 409) {
        await refresh();
        setError("生成内容或报价已变化，请核对新报价后再次确认。");
      } else setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const points = Number(quote?.estimatedCredits ?? 0);
  const insufficient = available !== null && available < points;
  return (
    <div className="assistant-consent-overlay">
      <div
        className="assistant-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="确认视频生成"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            close();
          }
          if (e.key === "Tab") {
            const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            );
            if (!buttons?.length) return;
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === dialog.current)
            ) {
              e.preventDefault();
              last.focus();
            } else if (
              !e.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === dialog.current)
            ) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button
          className="icon-button assistant-consent-close"
          aria-label="稍后决定"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
        <h3>确认视频生成</h3>
        <p>{batch.title}</p>
        {loading ? (
          <p role="status">
            <LoaderCircle size={16} className="spin" /> 正在获取积分报价…
          </p>
        ) : (
          quote && (
            <>
              <div className="assistant-consent-cost">
                <strong>
                  {points.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
                </strong>
                <span>积分 · 共 {quote.count} 个视频</span>
              </div>
              <p>
                {quote.payerIsCurrentUser
                  ? "从你的个人积分扣除"
                  : "从发起人的个人积分扣除"}
                {available !== null &&
                  `，当前可用 ${available.toLocaleString("zh-CN")} 积分`}
                。
              </p>
              <small>
                同意后开始生成并冻结上述积分，按最终账单结算，多余积分退回。确认前不扣积分。
              </small>
              <details>
                <summary>查看生成内容</summary>
                {quote.entries.map((entry: any, i: number) => (
                  <div key={i}>
                    <b>
                      视频 {i + 1} · {entry.parameters.duration_seconds ?? 5} 秒
                      · {entry.parameters.resolution ?? "720p"}
                    </b>
                    <p>{entry.prompt}</p>
                  </div>
                ))}
              </details>
              {insufficient && (
                <p className="error" role="alert">
                  积分不足，请补充积分后刷新报价。
                </p>
              )}
            </>
          )
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="assistant-consent-actions">
          <button
            className="button"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            刷新报价
          </button>
          <button
            className="button"
            disabled={loading || busy || !quote}
            onClick={() => void decide("reject")}
          >
            取消生成
          </button>
          <button
            className="button primary"
            disabled={loading || busy || !quote || insufficient}
            onClick={() => void decide("approve")}
          >
            {busy ? "正在处理…" : "同意生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
