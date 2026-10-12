"use client";
import React, {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

type Option = { value: string; label: string; disabled: boolean };
function optionList(children: React.ReactNode): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement(child)) return [];
    const p = child.props as any;
    if (child.type === "option")
      return [
        {
          value: String(p.value ?? p.children ?? ""),
          label: String(p.children ?? ""),
          disabled: !!p.disabled,
        },
      ];
    return optionList(p.children);
  });
}

/** One styled selection control for forms, filters and multi-file references. */
export default function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  const {
    children,
    multiple,
    disabled,
    value,
    defaultValue,
    onChange,
    className,
    style,
    ...rest
  } = props;
  const options = optionList(children),
    id = useId();
  const native = useRef<HTMLSelectElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState<string | string[]>(
    (defaultValue as any) ?? (multiple ? [] : (options[0]?.value ?? "")),
  );
  const selected = value ?? internal;
  const values = Array.isArray(selected)
    ? selected.map(String)
    : [String(selected ?? "")];
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [label, setLabel] = useState<string>(),
    [position, setPosition] = useState({
      top: 0,
      left: 0,
      width: 200,
      maxHeight: 280,
    });
  const shown = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    const parent = trigger.current?.closest("label");
    setLabel(
      props["aria-label"] ??
        (parent
          ? Array.from(parent.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent)
              .join("")
              .trim()
          : undefined) ??
        props.name,
    );
  }, [props["aria-label"], props.name]);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = trigger.current!.getBoundingClientRect(),
        available = window.innerHeight - r.bottom - 12;
      const above = available < 180 && r.top > available;
      const height = Math.min(320, above ? r.top - 12 : available);
      setPosition({
        top: above ? Math.max(8, r.top - height - 6) : r.bottom + 6,
        left: Math.min(
          r.left,
          window.innerWidth - Math.min(r.width, window.innerWidth - 16) - 8,
        ),
        width: Math.min(r.width, window.innerWidth - 16),
        maxHeight: height,
      });
    };
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    measure();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    (menu.current?.querySelector('[role="listbox"]') as HTMLElement)?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);
  function choose(o: Option) {
    if (o.disabled) return;
    const next = multiple
      ? values.includes(o.value)
        ? values.filter((v) => v !== o.value)
        : [...values, o.value]
      : o.value;
    setInternal(next);
    if (native.current) {
      const nextValues = Array.isArray(next) ? next : [next];
      Array.from(native.current.options).forEach((option) => {
        option.selected = nextValues.includes(option.value);
      });
      onChange?.({
        target: native.current,
        currentTarget: native.current,
      } as React.ChangeEvent<HTMLSelectElement>);
    }
    if (!multiple) {
      setOpen(false);
      trigger.current?.focus();
    }
  }
  function keyboard(e: React.KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") {
        e.preventDefault();
        trigger.current?.focus();
      }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      setActive((i) =>
        Math.max(
          0,
          Math.min(
            shown.length - 1,
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? shown.length - 1
                : i + (e.key === "ArrowDown" ? 1 : -1),
          ),
        ),
      );
    } else if (
      e.key === "Enter" ||
      (e.key === " " && (e.target as HTMLElement).tagName !== "INPUT")
    ) {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    }
  }
  useEffect(() => {
    menu.current
      ?.querySelector(`[data-option-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (
      value === undefined &&
      !multiple &&
      options.length &&
      !options.some((o) => o.value === internal)
    )
      setInternal(options[0].value);
  }, [children, value, multiple, internal]);
  const names = options
    .filter((o) => values.includes(o.value))
    .map((o) => o.label);
  return (
    <span className={"ff-select " + (className ?? "")} style={style}>
      <select
        {...rest}
        ref={native}
        multiple={multiple}
        disabled={disabled}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={onChange}
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: "none" }}
      >
        {children}
      </select>
      <button
        ref={trigger}
        id={props.id ? props.id + "-trigger" : undefined}
        type="button"
        className="ff-select-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setActive(
            Math.max(
              0,
              options.findIndex((o) => values.includes(o.value)),
            ),
          );
        }}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>
          {names.length
            ? multiple && names.length > 2
              ? `${names.slice(0, 2).join("、")} 等 ${names.length} 项`
              : names.join("、")
            : "请选择"}
        </span>
        <ChevronDown size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="ff-select-menu"
            style={{ position: "fixed", ...position }}
            tabIndex={-1}
            onKeyDown={keyboard}
          >
            {(options.length > 7 || multiple) && (
              <div className="ff-select-search">
                <Search size={14} />
                <input
                  aria-label={`搜索${label ?? "选项"}`}
                  placeholder="搜索选项…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                />
              </div>
            )}
            <div
              id={id}
              role="listbox"
              aria-label={label}
              aria-multiselectable={multiple || undefined}
              aria-activedescendant={
                shown[active] ? `${id}-${active}` : undefined
              }
            >
              {shown.map((o, i) => (
                <div
                  id={`${id}-${i}`}
                  key={o.value}
                  data-option-index={i}
                  role="option"
                  aria-selected={values.includes(o.value)}
                  aria-disabled={o.disabled}
                  className={
                    (active === i ? "active " : "") +
                    (values.includes(o.value) ? "selected" : "")
                  }
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(o)}
                >
                  <span>{o.label || "未选择"}</span>
                  {values.includes(o.value) && <Check size={15} />}
                </div>
              ))}
              {!shown.length && <p className="muted">没有匹配选项</p>}
            </div>
            {multiple && (
              <button
                type="button"
                className="ff-select-done"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                完成选择
              </button>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
