import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CalendarDays, ChevronDown, X } from "lucide-react";
import { BrainCircuit } from "../memory-prototype-icons.js";
import { parseRecapRange, type RecapRange } from "./recap-range.js";
import "./recap-home-entry.css";

/** A small new-conversation shortcut. The editable prompt stays in the native composer. */
export function RecapHomeEntry(props: {
  onPrepare: (range: RecapRange) => void;
  disabled?: boolean;
  error?: string | null;
  realGeneration?: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const resolved = parseRecapRange(customText);
  const blocked = props.disabled || Boolean(props.error);

  function close(restoreFocus = false) {
    setCustomOpen(false);
    if (restoreFocus) anchor.current?.focus();
  }

  function prepare(text: string) {
    const result = parseRecapRange(text);
    if (blocked || !result.ok) return;
    props.onPrepare(result.range);
    close();
  }

  useLayoutEffect(() => {
    if (!customOpen) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(300, window.innerWidth - 24);
      const height = panel.current?.offsetHeight ?? 230;
      const below = rect.bottom + 8;
      setPosition({
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, below + height <= window.innerHeight - 12 ? below : rect.top - height - 8),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [customOpen]);

  useEffect(() => {
    if (!customOpen) return;
    input.current?.focus();
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
  }, [customOpen]);

  return <>
    <div className="recap-home-entry" role="group" aria-label="用记忆开始对话">
      <span className="recap-home-entry-label"><span className="recap-home-entry-icon"><BrainCircuit size={15} aria-hidden="true" /></span>记忆回顾</span>
      <button type="button" disabled={blocked} onClick={() => prepare("今日")}>今日</button>
      <button type="button" disabled={blocked} onClick={() => prepare("本周")}>本周</button>
      <button ref={anchor} type="button" disabled={blocked} aria-haspopup="dialog" aria-expanded={customOpen}
        aria-controls={customOpen ? id : undefined} onClick={() => setCustomOpen((value) => !value)}>自定义<ChevronDown size={12} aria-hidden="true" /></button>
    </div>
    {props.error && <p className="recap-home-entry-error" role="alert">{props.error}</p>}
    {customOpen && createPortal(<div ref={panel} id={id} role="dialog" aria-label="自定义回顾时间" className="recap-home-custom" style={position}>
      <header><h2>自定义回顾时间</h2><button type="button" aria-label="关闭自定义时间" onClick={() => close(true)}><X size={15} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); prepare(customText); }}>
        <input ref={input} aria-label="回顾时间" aria-describedby={`${id}-hint`} value={customText}
          placeholder="如：昨日、本月、9月1日到9月8日" aria-invalid={Boolean(customText.trim()) && !resolved.ok}
          onChange={(event) => setCustomText(event.target.value)} autoComplete="off" />
        <p id={`${id}-hint`} className={`recap-home-date${customText.trim() && !resolved.ok ? " recap-home-entry-error" : ""}`} aria-live="polite">
          <CalendarDays size={12} />{resolved.ok ? resolved.range.label : customText.trim() ? resolved.error : "也支持最近 7 天或一段具体日期"}
        </p>
        <button className="recap-home-prepare" type="submit" disabled={blocked || !resolved.ok}>带入对话<ArrowRight size={13} /></button>
        <p className="recap-home-custom-note">可在输入框修改 Prompt，发送后{props.realGeneration ? "使用当前配置模型的额度" : "展示示例回复"}。</p>
      </form>
    </div>, document.body)}
  </>;
}
