import type { MemmyAgentSessionSummary, MemmyAgentWebuiThread } from "../../../api/memmy-agent-client.js";
import type { RecapEntry, RecapMessage } from "./recap-archive.js";
import type { RecapRange } from "./recap-range.js";

export function recapMessages(id: string, range: RecapRange, body: string, generationPrompt?: string): RecapMessage[] {
  return [
    { id: `${id}-request`, role: "user", content: generationPrompt ?? `结合记忆，帮我回顾 ${range.label} 的工作进展与变化。` },
    ...(body ? [{ id: `${id}-answer`, role: "assistant" as const, content: body }] : []),
  ];
}

export function recapSession(entry: RecapEntry): MemmyAgentSessionSummary {
  const time = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(entry.createdAt));
  return {
    key: `websocket:${entry.id}`, title: `记忆回顾 · ${entry.range.label} · ${time}`,
    preview: entry.body, updatedAt: entry.createdAt, projectId: null, cwd: "",
  };
}

export function recapThread(entry: RecapEntry, loading = false): MemmyAgentWebuiThread {
  return {
    schemaVersion: 1, sessionKey: `websocket:${entry.id}`,
    last_turn_id: `${entry.id}-turn`, last_turn_closed: !loading,
    messages: [
      ...entry.messages.map((message) => ({ ...message, kind: "message", createdAt: Date.parse(entry.createdAt), isStreaming: false })),
      ...(loading ? [{ id: `${entry.id}-loading`, role: "assistant", kind: "message", content: "正在串起这段时间的记忆…" }] : []),
    ],
  };
}
