import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CalendarDays, ChevronRight, Clock3, PencilLine, X } from "lucide-react";
import { BrainCircuit } from "../memory-prototype-icons.js";
import { parseRecapRange, type RecapRange } from "./recap-range.js";
import type { RecapEntry } from "./recap-archive.js";
import "./recap-popover.css";

export interface RecapPopoverProps {
  entries: RecapEntry[];
  onPrepare: (range: RecapRange) => void;
  onOpen: (entry: RecapEntry) => void;
  generationNotice: string;
  error?: string | null;
  busy?: boolean;
}

/** Time selection and history only; generated content belongs in the conversation. */
export function RecapPopover(props: RecapPopoverProps) {
  const [open, setOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState<"今日" | "昨日" | "本周" | "本月" | "custom">("本周");
  const [customText, setCustomText] = useState("");
  const [position, setPosition] = useState({ left: 220, top: 100 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const resolved = parseRecapRange(rangeMode === "custom" ? customText : rangeMode);
  const existing = resolved.ok ? props.entries.find((entry) =>
    entry.range.startDate === resolved.range.startDate && entry.range.endDate === resolved.range.endDate
  ) : undefined;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(352, window.innerWidth - 24);
      const height = panel.current?.offsetHeight ?? 500;
      setPosition({
        left: Math.max(12, Math.min(rect.right + 10, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.top, window.innerHeight - height - 12)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (rangeMode === "custom") input.current?.focus();
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!panel.current?.contains(node) && !trigger.current?.contains(node)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keyboard); };
  }, [open, rangeMode]);

  function generate() {
    if (!resolved.ok || props.busy || props.error) return;
    props.onPrepare(resolved.range);
    close();
  }

  function openEntry(entry: RecapEntry) {
    props.onOpen(entry);
    close();
  }

  return <>
    <button
      ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined}
      className={`app-frame-nav-button recap-nav-button relative flex items-center gap-2 transition-all cursor-pointer ${open ? "app-frame-nav-button--active" : "text-text-ink/75 hover:bg-canvas-oat/60 hover:text-text-ink/85"}`}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="shrink-0"><BrainCircuit size={16} /></span>
      <span className="flex-1 text-left">记忆回顾</span>
    </button>
    {open && createPortal(
      <div ref={panel} id={id} role="dialog" aria-label="记忆回顾" className="recap-popover" style={position}>
        <header className="recap-popover-heading">
          <h2>记忆回顾</h2>
          <button type="button" aria-label="关闭记忆回顾" className="recap-icon-button" onClick={() => close(true)}><X size={16} /></button>
        </header>
        <p className="recap-description">串起不同对话里的记忆，回顾这段时间的进展与变化。</p>
        <form onSubmit={(event) => { event.preventDefault(); if (existing) openEntry(existing); else generate(); }}>
          <div className="recap-field-label">想回顾哪段时间？</div>
          <div className="recap-shortcuts">
            {(["今日", "昨日", "本周", "本月"] as const).map((label) => <button type="button" key={label} aria-pressed={rangeMode === label} onClick={() => setRangeMode(label)}>{label}</button>)}
          </div>
          <button type="button" className="recap-custom-toggle" aria-expanded={rangeMode === "custom"}
            onClick={() => setRangeMode("custom")}><PencilLine size={13} />自定义时间</button>
          {rangeMode === "custom" && <input ref={input} id={`${id}-range`} className="recap-range-input" value={customText}
            placeholder="如：最近7天、9月1日到9月8日" autoComplete="off"
            aria-label="自定义时间" aria-invalid={!resolved.ok} aria-describedby={`${id}-dates`}
            onChange={(event) => setCustomText(event.target.value)} />}
          <p id={`${id}-dates`} className={`recap-date-hint${resolved.ok ? "" : " recap-error"}`} aria-live="polite">
            <CalendarDays size={13} />
            <span>{resolved.ok ? `${resolved.range.label}${resolved.truncated ? "（截至今日）" : ""}` : resolved.error}</span>
          </p>
          {props.error && <p className="recap-error" role="alert">{props.error}</p>}
          <button className="recap-generate" type="submit" disabled={props.busy || !resolved.ok || (!existing && Boolean(props.error))}>
            <span>{existing ? "打开已有回顾" : "在对话中生成"}</span><ArrowRight size={15} />
          </button>
          {existing && <button className="recap-regenerate" type="button" disabled={props.busy || Boolean(props.error)} onClick={generate}>重新生成，保留原来的回顾</button>}
          <p className="recap-cost-note">{existing ? "打开已有内容不会重新生成。" : ""}{props.generationNotice}</p>
        </form>
        <section className="recap-history" aria-label="之前生成的回顾">
          <h3><Clock3 size={13} />之前生成的</h3>
          {props.entries.length ? <div className="recap-history-list">
            {props.entries.map((entry) => <button type="button" key={entry.id} onClick={() => openEntry(entry)} className="recap-history-item">
              <span><strong>{entry.range.label}</strong><small>{formatGenerationTime(entry.createdAt)} 生成</small></span><ChevronRight size={14} />
            </button>)}
          </div> : <p className="recap-history-empty">生成后会留在这里，也能在对话历史中找到。</p>}
        </section>
      </div>, document.body
    )}
  </>;
}


function formatGenerationTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
