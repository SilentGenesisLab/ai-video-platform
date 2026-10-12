"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
export function AllocationForm({ teams, busy, onSave }: any) {
  const [teamId, setTeamId] = useState(""),
    [members, setMembers] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (teamId)
      void api(`/teams/${teamId}/members`)
        .then((r) => {
          setMembers(r.items);
          setError("");
        })
        .catch((e) => setError(e.message));
  }, [teamId]);
  return (
    <form
      className="admin-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...Object.fromEntries(new FormData(e.currentTarget)),
          teamId,
        });
      }}
    >
      <h3 className="wide">团队分配给成员</h3>
      {error && <p role="alert">{error}</p>}
      <label>
        分配团队
        <select
          required
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
        >
          <option value="">选择团队</option>
          {teams.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        接收成员
        <select required name="userId">
          <option value="">选择成员</option>
          {members
            .filter((m) => m.active !== false)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user?.name ?? m.name ?? m.userId}
              </option>
            ))}
        </select>
      </label>
      <label>
        分配积分
        <input
          type="number"
          name="amount"
          min="0.000001"
          step="0.000001"
          required
        />
      </label>
      <label>
        分配原因
        <input name="reason" minLength={3} required />
      </label>
      <button className="button dark" disabled={busy || !teamId}>
        确认分配积分
      </button>
    </form>
  );
}
