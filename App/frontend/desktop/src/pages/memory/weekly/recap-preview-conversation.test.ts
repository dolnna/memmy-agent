import { describe, expect, it } from "vitest";
import { agentActions, appActions } from "../../../state/app-actions.js";
import { appReducer, createInitialAppState, type AppState } from "../../../state/app-reducer.js";
import { agentChatScopeKey } from "../../../state/agent-composer-state.js";
import type { RecapEntry } from "./recap-archive.js";
import { recapMessages, recapSession, recapThread } from "./recap-preview-conversation.js";

function entry(id: string, body = "第一段原文。\n\n第二段 **保留格式**。", createdAt = "2026-09-09T15:00:00.000Z"): RecapEntry {
  const range = { startDate: "2026-09-03", endDate: "2026-09-09", label: "2026-09-03 — 2026-09-09" };
  return { id, range, createdAt, body, messages: recapMessages(id, range, body) };
}

function open(state: AppState, recap: RecapEntry, loading = false): AppState {
  const requestId = `${recap.id}-${loading ? "pending" : "saved"}`;
  return appReducer(
    appReducer(state, agentActions.historyLoading(`websocket:${recap.id}`, recap.id, requestId)),
    agentActions.historyLoaded(recapThread(recap, loading), requestId),
  );
}

describe("recap fixtures with the real app reducer", () => {
  it("opens full original output as an ordinary conversation and retains separate same-range histories", () => {
    const first = entry("recap-first");
    const second = entry("recap-second", "新生成的独立原文。", "2026-09-09T15:05:00.000Z");
    let state = appReducer(createInitialAppState(), agentActions.sessionsLoaded([first, second].map(recapSession)));
    state = appReducer(state, appActions.navigate("/main"));
    state = open(state, first);
    expect(state.agent.tasks.map((task) => task.chatId)).toEqual([second.id, first.id]);
    expect(state.agent.currentSessionKey).toBe(`websocket:${first.id}`);
    expect(state.agent.messages.map(({ role, content }) => ({ role, content }))).toEqual(
      first.messages.map(({ role, content }) => ({ role, content })),
    );
    expect(state.agent.isLoadingHistory).toBe(false);
    expect(state.agent.isSending).toBe(false);
    expect(state.agent.connectionStatus).toBe("idle");
    state = open(state, second);
    state = open(state, first);
    expect(state.agent.messages.at(-1)?.content).toBe(first.body);
    expect(state.agent.messagesByChatId[second.id]?.at(-1)?.content).toBe(second.body);
  });

  it("replaces the pending view with the full result without leaving a loading message or sending state", () => {
    const pending = entry("recap-pending", "");
    const completed = entry(pending.id);
    let state = appReducer(createInitialAppState(), agentActions.sessionsLoaded([recapSession(pending)]));
    state = open(state, pending, true);
    expect(state.agent.messages.at(-1)?.content).toBe("正在串起这段时间的记忆…");
    state = appReducer(state, agentActions.sessionsLoaded([recapSession(completed)]));
    state = open(state, completed);
    expect(state.agent.messages).toHaveLength(2);
    expect(state.agent.messages.at(-1)?.content).toBe(completed.body);
    expect(state.agent.messages.some((message) => message.id.endsWith("-loading"))).toBe(false);
    expect(state.agent.isSending).toBe(false);
    expect(state.agent.isLoadingHistory).toBe(false);
  });

  it("keeps blank-chat and follow-up drafts when opening another recap and returning", () => {
    const first = entry("recap-first");
    const second = entry("recap-second");
    let state = createInitialAppState();
    const blankScope = agentChatScopeKey(null, state.agent.newChatRequestId);
    state = appReducer(state, agentActions.composerDraftUpdated(blankScope, "原来输入框中的未发送内容"));
    state = appReducer(state, agentActions.sessionsLoaded([first, second].map(recapSession)));
    state = open(state, first);
    state = appReducer(state, agentActions.composerDraftUpdated(first.id, "想继续追问，但还没发送"));
    state = open(state, second);
    state = open(state, first);
    expect(state.agent.composerDraftsByScope[blankScope]).toBe("原来输入框中的未发送内容");
    expect(state.agent.composerDraftsByScope[first.id]).toBe("想继续追问，但还没发送");
    expect(state.agent.messages).toHaveLength(2);
    state = appReducer(state, agentActions.newChatRequested());
    expect(state.agent.currentChatId).toBeNull();
    expect(state.agent.composerDraftsByScope[first.id]).toBe("想继续追问，但还没发送");
    expect(state.agent.messagesByChatId[first.id]?.at(-1)?.content).toBe(first.body);
  });
});
