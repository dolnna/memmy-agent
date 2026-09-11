import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  Loader2,
  MessageCircle,
} from "lucide-react";
import {
  readSavedWeeklyRecap,
  saveWeeklyRecap,
  type SavedWeeklyRecap,
} from "./weekly-recap-store.js";
import type { WeeklyReport } from "./weekly-types.js";

interface WeeklyHomeCardProps {
  storageKey: string;
  generate(): Promise<WeeklyReport>;
  onDiscuss(report: WeeklyReport): void;
}

const pendingGenerations = new Map<string, Promise<WeeklyReport>>();

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function weeklyReportBody(report: WeeklyReport): string {
  return (
    report.body ??
    report.insights.map((item) => `${item.title}\n${item.body}`).join("\n\n")
  );
}

/** A report is stored once, then read as an unchanged document on later visits. */
export function WeeklyHomeCard({
  storageKey,
  generate,
  onDiscuss,
}: WeeklyHomeCardProps) {
  const [saved, setSaved] = useState<SavedWeeklyRecap | null>(() =>
    readSavedWeeklyRecap(browserStorage(), storageKey),
  );
  const [unsavedReport, setUnsavedReport] = useState<WeeklyReport | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const report = saved?.report ?? unsavedReport;
  const paragraphs = report
    ? weeklyReportBody(report)
        .split(/\n\s*\n/)
        .filter(Boolean)
    : [];

  function persist(value: WeeklyReport) {
    try {
      const next = saveWeeklyRecap(browserStorage(), storageKey, value);
      if (mounted.current) {
        setSaved(next);
        setUnsavedReport(null);
        setJustSaved(true);
        setError("");
      }
    } catch (failure) {
      if (!mounted.current) return;
      setUnsavedReport(value);
      setError(
        failure instanceof Error
          ? failure.message
          : "这份回顾未能保存，请重试。",
      );
    }
  }

  async function generateOnce() {
    if (busy.current || report) return;
    const existing = readSavedWeeklyRecap(browserStorage(), storageKey);
    if (existing) {
      setSaved(existing);
      return;
    }
    busy.current = true;
    setStatus("generating");
    setError("");
    const request =
      pendingGenerations.get(storageKey) ?? Promise.resolve().then(generate);
    pendingGenerations.set(storageKey, request);
    try {
      const next = await request;
      persist(next);
      if (mounted.current) setStatus("idle");
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : "这次没有生成成功，请再试一次。",
        );
        setStatus("error");
      }
    } finally {
      busy.current = false;
      if (pendingGenerations.get(storageKey) === request)
        pendingGenerations.delete(storageKey);
    }
  }

  return (
    <section
      className={`wh-recap${report ? " wh-recap--saved" : ""}`}
      aria-label="我的一周"
    >
      <div className="wh-recap-heading">
        <div className="wh-recap-icon">
          <BookOpen size={20} />
        </div>
        <div>
          <h2>我的一周</h2>
          <p>
            {report
              ? `${shortDate(report.startDate)} — ${shortDate(report.endDate)}`
              : "把最近的工作，串起来看看"}
          </p>
        </div>
        {saved && (
          <span className="wh-saved-tag">
            <Check size={12} />
            已保存
          </span>
        )}
      </div>

      {!report ? (
        <div className="wh-recap-intro">
          <p>
            这一周推进了什么，又有哪些事情值得继续聊？
            <br />
            Memmy 会结合你的记忆，整理一份属于你的回顾。
          </p>
          <div className="wh-generate-row">
            <button
              className="wh-primary"
              disabled={status === "generating"}
              onClick={() => void generateOnce()}
            >
              {status === "generating" ? (
                <Loader2 size={14} className="wh-spin" />
              ) : (
                <BookOpen size={14} />
              )}
              {status === "generating"
                ? "正在整理…"
                : status === "error"
                  ? "重新生成"
                  : "生成本周回顾"}
            </button>
            <span>使用当前模型额度 · 仅生成一次</span>
          </div>
          <small>生成后自动保存，下次可以直接回看。</small>
        </div>
      ) : (
        <div className="wh-recap-result">
          <p className="wh-recap-summary">{paragraphs[0]}</p>
          <button
            className="wh-expand"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起全文" : "展开全文"}
            <ArrowDown
              size={12}
              style={{ transform: expanded ? "rotate(180deg)" : undefined }}
            />
          </button>
          {expanded && (
            <div className="wh-recap-body">
              {paragraphs.slice(1).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          )}
          <div className="wh-saved-footer">
            <span>
              {saved ? "回看已保存内容，不再消耗额度" : "本次结果尚未保存"}
            </span>
            <button onClick={() => onDiscuss(report)}>
              <MessageCircle size={14} />
              聊聊这份回顾
              <ArrowRight size={13} />
            </button>
          </div>
          {justSaved && saved && (
            <div className="wh-saved-hint" role="status">
              <Check size={13} />
              已留在首页。离开或刷新后，回来仍能看到。
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="wh-error" role="alert">
          {error}
          {unsavedReport && (
            <button onClick={() => persist(unsavedReport)}>重新保存</button>
          )}
        </div>
      )}
    </section>
  );
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}.${Number(day)}`;
}
