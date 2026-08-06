import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronUp } from "lucide-react";
import type { AgentChatMessage } from "../state/agent-chat-slice.js";
import type { AgentArtifactClient } from "./agent-message-content.js";
import { AgentThreadMessages } from "./agent-thread-messages.js";

export const LITERATURE_TODO_ITEMS = [
  "检索并下载文献",
  "批量阅读",
  "撰写正文",
  "生成参考文献",
  "引用检查",
];

export function LiteratureReviewWorkflowMock(props: {
  completedTodoCount: number;
  onOpenArtifact: (fileId: string) => void;
}) {
  const messages = useMemo(
    () => buildLiteratureWorkflowMessages(props.completedTodoCount),
    [props.completedTodoCount],
  );
  const artifactClient = useMemo<AgentArtifactClient>(() => ({
    resolveArtifact: async (path) => ({
      ok: true,
      path,
      name: path.split("/").pop() || path,
      kind: "file",
    }),
    openArtifact: async (path) => {
      props.onOpenArtifact(path.includes("大纲") ? "outline" : "review");
    },
    revealArtifact: async (path) => {
      props.onOpenArtifact(path.includes("大纲") ? "outline" : "review");
    },
  }), [props.onOpenArtifact]);
  const todoIndex = messages.findIndex((message) => message.id === "literature-assistant-start");
  const beforeTodo = messages.slice(0, todoIndex + 1);
  const afterTodo = messages.slice(todoIndex + 1);
  return (
    <div className="literature-workflow-dialogue">
      <AgentThreadMessages chatScopeKey="literature-workflow-before-todo" messages={beforeTodo} isSending={false} artifactClient={artifactClient} />
      {afterTodo.length ? (
        <AgentThreadMessages chatScopeKey="literature-workflow-after-todo" messages={afterTodo} isSending={false} artifactClient={artifactClient} />
      ) : null}
    </div>
  );
}

export function LiteratureTodo(props: { completedCount: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const total = LITERATURE_TODO_ITEMS.length;
  const activeStep = Math.min(props.completedCount + 1, total);
  const currentItem = LITERATURE_TODO_ITEMS[Math.min(props.completedCount, total - 1)];
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);
  return (
    <div ref={rootRef} className="literature-todo-inline-wrap">
      {open ? (
        <section className="literature-todo-popover" aria-label="完整 To-do">
          <header>
            <strong>To-do</strong>
            <span>{props.completedCount}/{total}</span>
          </header>
          <ol>
            {LITERATURE_TODO_ITEMS.map((item, index) => {
              const completed = index < props.completedCount;
              const current = props.completedCount < total && index === props.completedCount;
              return (
                <li key={item} className={completed ? "is-complete" : current ? "is-current" : ""}>
                  <span className="literature-todo-popover__status">
                    {completed ? <Check size={11} /> : null}
                  </span>
                  <span>{item}</span>
                  {current ? <small>进行中</small> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <button
        type="button"
        className={`literature-todo-inline${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-label="查看完整 To-do"
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="literature-todo-inline__ring"
          style={{
            background: `conic-gradient(var(--color-action-sky) ${(props.completedCount / total) * 100}%, color-mix(in srgb, var(--color-border-stone) 42%, transparent) 0)`,
          }}
          aria-hidden="true"
        />
        <span>{props.completedCount >= total ? `${total}/${total} 步完成` : `第 ${activeStep}/${total} 步 · ${currentItem}`}</span>
        <ChevronUp size={11} aria-hidden="true" />
      </button>
    </div>
  );
}

function buildLiteratureWorkflowMessages(completedTodoCount: number): AgentChatMessage[] {
  const now = Date.now();
  const turnId = "literature-workflow-turn";
  const activitySegmentId = "literature-workflow-activity";
  const messages: AgentChatMessage[] = [
    {
      id: "literature-user-request",
      role: "user",
      content: "帮我梳理近 5 年大模型长期记忆的研究进展，最后写成一篇中文综述。",
      createdAt: now - 180_000,
    },
    {
      id: "literature-assistant-clarify",
      role: "assistant",
      content: "可以。为了避免后面反复确认，还需要补充：\n\n- 更关注方法、系统还是应用？\n- 篇幅和输出格式是什么？\n- 是否有明确排除的方向？",
      createdAt: now - 165_000,
    },
    {
      id: "literature-user-scope",
      role: "user",
      content: "重点比较方法和系统，排除纯参数编辑；约 8–12 页，使用 Markdown。",
      createdAt: now - 145_000,
    },
    {
      id: "literature-assistant-outline",
      role: "assistant",
      content: "已整理需求并生成大纲，请确认：\n\n需求：方法与系统对比 · 近 5 年 · 排除纯参数编辑 · 中文 · 8–12 页 · Markdown\n\n1. 引言与研究范围\n2. 记忆表征与存储\n3. 写入、更新与遗忘\n4. 检索与上下文注入\n5. 评测方法与基准\n6. 开放问题与展望\n\n检索词：`long-term memory`、`LLM memory`、`memory management`、`RAG evaluation`",
      media: [
        { kind: "file", name: "大模型长期记忆-大纲.md", path: "/Users/demo/大模型长期记忆-大纲.md" },
      ],
      createdAt: now - 125_000,
    },
    {
      id: "literature-user-confirm",
      role: "user",
      content: "大纲可以，开始吧。",
      createdAt: now - 105_000,
    },
    {
      id: "literature-assistant-start",
      role: "assistant",
      content: "已生成执行计划，接下来直接执行，不再要求确认：",
      turnId,
      createdAt: now - 95_000,
    },
  ];

  if (completedTodoCount < LITERATURE_TODO_ITEMS.length) {
    return messages;
  }

  messages.push(
    {
      id: "literature-reasoning-plan",
      role: "assistant",
      content: "",
      reasoning: "先按大纲拆分检索方向，为每个章节准备独立的中英文关键词组合。优先覆盖近 5 年综述、代表性方法论文和公开评测基准。",
      turnId,
      activitySegmentId,
      createdAt: now - 90_000,
    },
    {
      id: "literature-tools-one",
      role: "tool",
      kind: "trace",
      content: "",
      turnId,
      activitySegmentId,
      toolEvents: [
        { phase: "end", call_id: "outline", name: "write_file", arguments: { path: "大模型长期记忆-大纲.md" }, result: "done" },
        { phase: "end", call_id: "search", name: "web_search", arguments: { query: "long-term memory LLM" }, result: "done" },
        { phase: "end", call_id: "download", name: "download_file", arguments: { count: 42 }, result: "done" },
      ],
      createdAt: now - 80_000,
    },
    {
      id: "literature-narration-search",
      role: "assistant",
      kind: "narration",
      content: "已完成检索与去重，接下来按全文可用性和章节相关性分批阅读。",
      turnId,
      activitySegmentId,
      createdAt: now - 68_000,
    },
    {
      id: "literature-reasoning-synthesis",
      role: "assistant",
      content: "",
      reasoning: "阅读时区分论文原文、摘要信息和模型归纳，只把能够追溯到文献的结论写入正文。不同方法统一按表征、写入、更新、检索和评测维度比较。",
      turnId,
      activitySegmentId,
      createdAt: now - 58_000,
    },
    {
      id: "literature-tools-two",
      role: "tool",
      kind: "trace",
      content: "",
      turnId,
      activitySegmentId,
      toolEvents: [
        { phase: "end", call_id: "read", name: "read_file", arguments: { count: 42 }, result: "done" },
        { phase: "end", call_id: "write", name: "write_file", arguments: { path: "大模型长期记忆-正文.md" }, result: "done" },
      ],
      createdAt: now - 42_000,
    },
    {
      id: "literature-reasoning-citations",
      role: "assistant",
      content: "",
      reasoning: "正文完成后逐条比对文内引用和参考文献，检查标题、作者、年份及引用位置；无法从全文确认的内容不补写页码或细节。",
      turnId,
      activitySegmentId,
      createdAt: now - 30_000,
    },
    {
      id: "literature-tools-three",
      role: "tool",
      kind: "trace",
      content: "",
      turnId,
      activitySegmentId,
      toolEvents: [
        { phase: "end", call_id: "citation", name: "grep", arguments: { pattern: "citations" }, result: "done" },
      ],
      createdAt: now - 20_000,
    },
    {
      id: "literature-assistant-result",
      role: "assistant",
      content: "正文已完成，包含主要方法与系统对比、评测总结和参考文献：",
      turnId,
      media: [
        { kind: "file", name: "大模型长期记忆-正文.md", path: "/Users/demo/大模型长期记忆-正文.md" },
      ],
      createdAt: now,
    },
  );
  return messages;
}
