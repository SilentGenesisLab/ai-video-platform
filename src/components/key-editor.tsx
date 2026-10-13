"use client";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { api } from "./api";
import Select from "./select";
import {
  legacyPermissions,
  permissionCatalog,
  permissionGroups,
  recommendedPermissions,
  scopeSummary,
} from "../lib/permissions";

function CheckAll({
  label,
  ids,
  selected,
  disabled,
  onChange,
}: {
  label: string;
  ids: string[];
  selected: string[];
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter((id) => selected.includes(id)).length;
  useEffect(() => {
    if (ref.current)
      ref.current.indeterminate = count > 0 && count < ids.length;
  }, [count, ids.length]);
  return (
    <label className="check-row">
      <input
        ref={ref}
        type="checkbox"
        checked={!!ids.length && count === ids.length}
        disabled={disabled || !ids.length}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function PermissionPicker({
  value,
  grantable,
  onChange,
}: {
  value: string[];
  grantable: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(ids: string[], checked: boolean) {
    const next = new Set(value);
    if (checked) {
      for (const id of ids) {
        next.add(id);
        for (const dep of permissionCatalog.find((p) => p.id === id)
          ?.dependencies ?? [])
          if (grantable.includes(dep)) next.add(dep);
      }
    } else {
      ids.forEach((id) => next.delete(id));
      permissionCatalog.forEach((p) => {
        if (p.dependencies.some((dep) => !next.has(dep))) next.delete(p.id);
      });
    }
    onChange([...next].filter((id) => grantable.includes(id)));
  }
  return (
    <section className="key-permissions">
      <div className="key-section-heading">
        <div>
          <h3>权限范围</h3>
          <small>
            已选择 {value.length} / {grantable.length} 项可授权权限
          </small>
        </div>
        <div className="key-toolbar">
          <CheckAll
            label="全选权限"
            ids={grantable}
            selected={value}
            onChange={(checked) => toggle(grantable, checked)}
          />
          <button type="button" className="button" onClick={() => onChange([])}>
            清空权限
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              onChange(
                recommendedPermissions.filter((id) => grantable.includes(id)),
              )
            }
          >
            恢复推荐
          </button>
        </div>
      </div>
      <div className="key-permission-grid">
        {permissionGroups.map((group) => {
          const entries = permissionCatalog.filter((p) => p.group === group.id),
            ids = entries
              .filter((p) => grantable.includes(p.id))
              .map((p) => p.id);
          return (
            <fieldset key={group.id}>
              <legend>{group.label}</legend>
              <CheckAll
                label={`${group.label}全选`}
                ids={ids}
                selected={value}
                onChange={(checked) => toggle(ids, checked)}
              />
              <div className="key-permission-items">
                {entries.map((p) => (
                  <label className="check-row" key={p.id}>
                    <input
                      type="checkbox"
                      checked={value.includes(p.id)}
                      disabled={!grantable.includes(p.id)}
                      onChange={(e) => toggle([p.id], e.target.checked)}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="muted">
        编辑、生成及执行会同时选择对应的查看权限。API Key
        始终不能人工审批、管理成员或密钥、修改采购价、读取渠道凭据。
      </p>
    </section>
  );
}

export default function KeyPermissionsEditor({
  item,
  onClose,
  onSaved,
  notify,
  shell: Modal,
}: {
  item?: any;
  onClose: () => void;
  onSaved: () => void;
  notify: (message: string, kind?: string) => void;
  shell: ComponentType<any>;
}) {
  const [data, setData] = useState({
    name: item?.name ?? "",
    note: item?.note ?? "",
    ownerId: item?.ownerId ?? "",
    enabled: item?.enabled ?? true,
    expiresAt: item?.expiresAt ?? (null as string | null),
    permissions: item
      ? Array.isArray(item.permissions)
        ? item.permissions
        : legacyPermissions(item.scopes)
      : recommendedPermissions,
    productScopeMode:
      item?.productScopeMode ?? (item?.productIds?.length ? "selected" : "all"),
    productIds: (item?.productIds ?? []) as string[],
  });
  const [members, setMembers] = useState<any[]>([]),
    [grantable, setGrantable] = useState<string[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [products, setProducts] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [loadingProducts, setLoadingProducts] = useState(false),
    [bulk, setBulk] = useState(false);
  const field = (name: string, value: any) =>
    setData((d) => ({ ...d, [name]: value }));
  useEffect(() => {
    let live = true;
    void api("/auth/me")
      .then((me) => {
        if (me.role === "admin")
          return api("/members").then((r) => {
            if (live) setMembers(r.items);
          });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setReady(false);
    void api(
      "/api-keys/options" +
        (data.ownerId ? "?ownerId=" + encodeURIComponent(data.ownerId) : ""),
    )
      .then((r) => {
        if (!live) return;
        setGrantable(r.grantable);
        setData((d) => ({
          ...d,
          permissions: d.permissions.filter((id: string) =>
            r.grantable.includes(id),
          ),
        }));
        setReady(true);
        setError("");
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [data.ownerId]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (data.productScopeMode !== "selected") return;
    let live = true;
    setLoadingProducts(true);
    void api(`/products?limit=50&page=${page}&q=${encodeURIComponent(search)}`)
      .then((r) => {
        if (live) {
          setProducts(r.items);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoadingProducts(false);
      });
    return () => {
      live = false;
    };
  }, [data.productScopeMode, search, page]);
  async function selectResults() {
    setBulk(true);
    try {
      const ids: string[] = [];
      let current = 1;
      while (true) {
        const result = await api(
          `/products?limit=100&page=${current}&q=${encodeURIComponent(search)}`,
        );
        ids.push(...result.items.map((p: any) => p.id));
        if (current * 100 >= result.total || !result.items.length) break;
        current++;
      }
      setData((d) => ({
        ...d,
        productIds: [...new Set([...d.productIds, ...ids])],
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulk(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(
        "/api-keys" + (item ? "/" + item.id : ""),
        item ? "PATCH" : "POST",
        {
          ...data,
          ownerId: data.ownerId || undefined,
          scopes: scopeSummary(data.permissions),
          productIds: data.productScopeMode === "all" ? [] : data.productIds,
        },
      );
      notify("访问密钥及授权已保存", "success");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const invalid =
    !ready ||
    !data.name.trim() ||
    !data.permissions.length ||
    (data.productScopeMode === "selected" && !data.productIds.length);
  return (
    <Modal
      title={item ? "编辑访问密钥" : "创建 Agent 访问密钥"}
      wide
      onClose={busy ? () => {} : onClose}
    >
      <div className="key-editor-body">
        <div className="form-grid">
          <label>
            名称
            <input
              autoFocus
              value={data.name}
              onChange={(e) => field("name", e.target.value)}
              placeholder="例如：创意策划 Agent"
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
                  e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                )
              }
            />
            <small>留空表示长期有效</small>
          </label>
          <label>
            所属成员
            <Select
              aria-label="所属成员"
              value={data.ownerId}
              disabled={!!item || !members.length}
              onChange={(e) => field("ownerId", e.target.value)}
            >
              <option value="">当前成员</option>
              {members
                .filter((m) => m.active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.role}
                  </option>
                ))}
            </Select>
            <small>编辑时保留原所属成员；授权不能超过双方的实际权限。</small>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={data.enabled}
              onChange={(e) => field("enabled", e.target.checked)}
            />
            启用密钥
          </label>
          <label className="span-2">
            备注
            <textarea
              rows={2}
              value={data.note}
              onChange={(e) => field("note", e.target.value)}
            />
          </label>
        </div>
        <fieldset className="key-product-scope">
          <legend>产品范围</legend>
          <div className="key-scope-modes">
            <label className="check-row">
              <input
                type="radio"
                name="key-product-mode"
                value="all"
                checked={data.productScopeMode === "all"}
                onChange={() => field("productScopeMode", "all")}
              />
              全部可访问产品<small>包含团队以后新增的产品</small>
            </label>
            <label className="check-row">
              <input
                type="radio"
                name="key-product-mode"
                value="selected"
                checked={data.productScopeMode === "selected"}
                onChange={() => field("productScopeMode", "selected")}
              />
              指定产品<small>至少选择一个；不能创建范围外的新产品</small>
            </label>
          </div>
          {data.productScopeMode === "selected" && (
            <div>
              <div className="key-toolbar">
                <input
                  aria-label="搜索授权产品"
                  placeholder="搜索产品名称…"
                  value={query}
                  disabled={bulk}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  type="button"
                  className="button"
                  disabled={bulk || loadingProducts || query !== search}
                  onClick={() => void selectResults()}
                >
                  {bulk ? "正在选择…" : "全选当前搜索结果"}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => field("productIds", [])}
                >
                  清空产品
                </button>
                <span>已选 {data.productIds.length} 个产品</span>
              </div>
              <div className="key-product-list">
                {products.map((p) => (
                  <label className="check-row" key={p.id}>
                    <input
                      type="checkbox"
                      checked={data.productIds.includes(p.id)}
                      disabled={bulk}
                      onChange={(e) =>
                        setData((d) => ({
                          ...d,
                          productIds: e.target.checked
                            ? [...d.productIds, p.id]
                            : d.productIds.filter((id) => id !== p.id),
                        }))
                      }
                    />
                    {p.title}
                  </label>
                ))}
                {!products.length && (
                  <p className="muted">
                    {loadingProducts ? "加载产品…" : "没有匹配产品"}
                  </p>
                )}
              </div>
              <div className="key-toolbar">
                <button
                  type="button"
                  className="button"
                  disabled={page <= 1 || loadingProducts}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </button>
                <span>
                  第 {page} / {Math.max(1, Math.ceil(total / 50))} 页 · {total}{" "}
                  个产品
                </span>
                <button
                  type="button"
                  className="button"
                  disabled={page * 50 >= total || loadingProducts}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </fieldset>
        {ready ? (
          <PermissionPicker
            value={data.permissions}
            grantable={grantable}
            onChange={(ids) => field("permissions", ids)}
          />
        ) : (
          <p className="muted">正在读取可授权权限…</p>
        )}
      </div>
      <footer className="modal-actions key-editor-actions">
        <span role={error ? "alert" : undefined}>
          {error ||
            (invalid
              ? "请填写名称、选择权限及有效产品范围"
              : `已选择 ${data.permissions.length} 项权限`)}
        </span>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className="button primary"
          disabled={invalid || busy || bulk}
          onClick={() => void save()}
        >
          {busy ? "保存中…" : "确认保存"}
        </button>
      </footer>
    </Modal>
  );
}
