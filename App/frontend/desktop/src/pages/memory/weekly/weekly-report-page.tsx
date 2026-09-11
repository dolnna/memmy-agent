import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { useI18n } from "../../../i18n/i18n-provider.js";
import type { WeeklyInsight, WeeklyReport } from "./weekly-types.js";
import "./weekly-report.css";

export interface WeeklyConversationDraft {
  title: string;
  prompt: string;
  context: string;
  sourceIds: string[];
}

export interface WeeklyReportPageProps {
  initialReports?: WeeklyReport[];
  preview?: boolean;
  previewLabel?: string;
  coverageLabel?: string;
  onContinue?: (draft: WeeklyConversationDraft) => void;
}

/** Prepare context for an ordinary conversation. This never sends a message. */
export function buildWeeklyConversationDraft(
  report: WeeklyReport,
  insight?: WeeklyInsight,
): WeeklyConversationDraft {
  const sourceIds =
    insight?.sourceIds ??
    (report.body
      ? report.sources.map((item) => item.id)
      : [
          ...new Set((report.insights ?? []).flatMap((item) => item.sourceIds)),
        ]);
  const sources = report.sources.filter((item) => sourceIds.includes(item.id));
  const context = [
    `记忆周报 · ${report.startDate} — ${report.endDate}`,
    ...(insight
      ? [insight.title, insight.body]
      : report.body
        ? [report.body]
        : (report.insights ?? []).map((item) => `${item.title}\n${item.body}`)),
    "参考记录（历史背景，当前状态以最新核对为准）：",
    ...sources.map(
      (item) =>
        `- ${item.app} · ${item.time} · ${item.title}\n  ${item.excerpt}`,
    ),
  ].join("\n\n");
  return {
    title: insight?.title ?? "聊聊这一周",
    prompt:
      insight?.prompt ?? "结合这一周的进展，帮我梳理下周最值得推进的事情。",
    context,
    sourceIds: sources.map((item) => item.id),
  };
}

/** A reading surface with one onward action: continue in a conversation. */
export function WeeklyReportPage({
  initialReports = [],
  preview = false,
  previewLabel,
  coverageLabel,
  onContinue,
}: WeeklyReportPageProps) {
  const { language } = useI18n();
  const zh = language === "zh-CN";
  const report = initialReports[0];
  const insights = report?.insights ?? [];

  return (
    <main
      className="wi-page"
      aria-label={zh ? "记忆周报" : "Memory weekly report"}
    >
      <header className="wi-page-heading">
        <span className="wi-page-name">
          <BookOpen size={17} />
          {zh ? "记忆周报" : "Memory weekly report"}
        </span>
        {preview && (
          <span className="wi-preview">
            {previewLabel ?? (zh ? "示例预览" : "Example preview")}
          </span>
        )}
      </header>

      {!report || !insights.length ? (
        <section className="wi-empty">
          <span className="wi-empty-icon">
            <Sparkles size={25} />
          </span>
          <h1>
            {zh ? "从这一周，发现下一步" : "Find your next step in this week"}
          </h1>
          <p>
            {zh
              ? "有了足够的记忆，这里会出现值得留意的进展、悬而未决的事情和工作习惯。"
              : "As your memories build up, find meaningful progress, open questions and working patterns here."}
          </p>
          <small>{zh ? "还没有可查看的洞察" : "No insights yet"}</small>
        </section>
      ) : (
        <>
          <section className="wi-intro">
            <div className="wi-week">
              <CalendarDays size={13} />
              <time dateTime={report.startDate}>
                {formatDate(report.startDate)} — {formatDate(report.endDate)}
              </time>
              <span>{zh ? "每周回顾" : "Weekly reflection"}</span>
            </div>
            <h1>
              {zh
                ? "这一周，有些事值得再想一步。"
                : "A few things worth a second look."}
            </h1>
            <p>
              {zh
                ? "从记忆里发现线索。想继续哪一件，我们在对话里聊。"
                : "Find a thread in your memories. Pick one to explore in a conversation."}
            </p>
          </section>

          <section
            className="wi-insights"
            aria-label={zh ? "本周洞察" : "This week's insights"}
          >
            {insights.map((insight, index) => {
              const apps = [
                ...new Set(
                  report.sources
                    .filter((item) => insight.sourceIds.includes(item.id))
                    .map((item) => item.app),
                ),
              ];
              return (
                <article
                  className={`wi-insight wi-insight--${index % 3}`}
                  key={insight.id}
                >
                  <div className="wi-insight-marker">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="wi-insight-body">
                    <span className="wi-insight-label">{insight.label}</span>
                    <h2>{insight.title}</h2>
                    <p>{insight.body}</p>
                    <div className="wi-insight-footer">
                      <button
                        className="wi-question"
                        disabled={!onContinue}
                        onClick={() =>
                          onContinue?.(
                            buildWeeklyConversationDraft(report, insight),
                          )
                        }
                      >
                        <MessageCircle size={14} />
                        <span>{insight.prompt}</span>
                        <ArrowRight size={14} />
                      </button>
                      <span className="wi-sources">{apps.join(" · ")}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <footer className="wi-footer">
            <div>
              <Sparkles size={16} />
              <span>
                {zh
                  ? "也可以从你关心的问题聊起。"
                  : "Or start with what's on your mind."}
              </span>
            </div>
            <button
              disabled={!onContinue}
              onClick={() => onContinue?.(buildWeeklyConversationDraft(report))}
            >
              {zh ? "聊聊这一周" : "Talk about this week"}
              <ArrowRight size={14} />
            </button>
          </footer>
          <p className="wi-coverage">
            {zh
              ? (coverageLabel ?? "基于已记录的内容整理，可能不包含线下进展。")
              : "Based on recorded activity. Offline progress may be missing."}
          </p>
        </>
      )}
    </main>
  );
}

function formatDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}.${Number(day)}`;
}
