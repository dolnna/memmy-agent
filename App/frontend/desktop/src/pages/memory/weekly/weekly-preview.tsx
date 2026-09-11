import { useEffect, useRef, useState } from "react";
import { AppProviders } from "../../../app/providers.js";
import { AgentRuntimeBridge } from "../../../app/agent-runtime-bridge.js";
import { I18nProvider } from "../../../i18n/i18n-provider.js";
import { ThemeProvider } from "../../../theme/theme-provider.js";
import { agentActions, appActions } from "../../../state/app-actions.js";
import { agentChatScopeKey } from "../../../state/agent-composer-state.js";
import { useAppState } from "../../../state/app-state.js";
import { HomePage } from "../../home-page.js";
import { RecapHomeEntry } from "./recap-home-entry.js";
import { readRecapArchive, saveRecap, updateRecapMessages, type RecapEntry, type RecapArchiveResult } from "./recap-archive.js";
import { recapRangeLabel, type RecapRange } from "./recap-range.js";
import { isWeeklyReport, readSavedWeeklyRecaps } from "./weekly-recap-store.js";
import { previewWeeklyReports } from "./weekly-preview-data.js";
import type { WeeklyReport } from "./weekly-types.js";
import { recapSession, recapThread, recapMessages } from "./recap-preview-conversation.js";
import { RecapPreviewMount } from "./recap-preview-mount.js";
import defaultRecapPrompt from "./weekly-insight-prompt.md?raw";
import "./recap-preview.css";

/** Reuses the unmodified app shell; generation goes through a preview-only isolated endpoint. */
export function WeeklyReportPreview() {
  return <AppProviders>
    <I18nProvider language="zh-CN"><ThemeProvider theme="light">
      <AgentRuntimeBridge><RecapWorkspacePreview /></AgentRuntimeBridge>
    </ThemeProvider></I18nProvider>
  </AppProviders>;
}

function previewStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function RecapWorkspacePreview() {
  const { state, dispatch } = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;
  const params = new URLSearchParams(window.location.search);
  const realData = params.get("data") === "memmy";
  const session = (params.get("recapPreviewSession") ?? "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  const suffix = `${realData ? "real" : "example"}:${session}`;
  const storageKey = `memmy.recap.conversation-preview.v1:${suffix}`;
  const storage = previewStorage();
  const [archive, setArchive] = useState(() => readRecapArchive(storage, storageKey));
  const [preparedDraft, setPreparedDraft] = useState<{ scopeKey: string; range: RecapRange } | null>(null);
  const currentScope = agentChatScopeKey(state.agent.currentChatId, state.agent.newChatRequestId);
  const currentPreparedRange = preparedDraft?.scopeKey === currentScope ? preparedDraft.range : null;
  const [busy, setBusy] = useState(false);
  const generationLock = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<RecapEntry | null>(null);
  const initialized = useRef(false);
  const entries = archive.ok ? archive.entries : [];

  function publish(items: RecapEntry[]) {
    dispatch(agentActions.sessionsLoaded(items.map(recapSession)));
  }

  function show(entry: RecapEntry, loading = false) {
    const requestId = crypto.randomUUID();
    dispatch(agentActions.historyLoading(`websocket:${entry.id}`, entry.id, requestId));
    dispatch(agentActions.historyLoaded(recapThread(entry, loading), requestId));
    if (!(entry.id in stateRef.current.agent.composerDraftsByScope) && entry.draft) {
      dispatch(agentActions.composerDraftUpdated(entry.id, entry.draft));
    }
    dispatch(appActions.navigate("/main"));
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    let loaded = readRecapArchive(storage, storageKey);
    // Preserve reports saved in the preceding prototype; keep its original cache untouched.
    if (loaded.ok) {
      const old = readSavedWeeklyRecaps(storage, `memmy.weekly.home-preview.v1:${suffix}`);
      for (const saved of old) {
        const id = `recap-import-${saved.report.id}-${Date.parse(saved.savedAt)}`;
        if (loaded.entries.some((entry) => entry.id === id)) continue;
        const range = reportRange(saved.report);
        const body = reportBody(saved.report);
        const result = saveRecap(storage, storageKey, {
          id, range, sourceRange: range, createdAt: saved.savedAt, body,
          messages: recapMessages(id, range, body),
        });
        if (!result.ok) { setNotice(result.error); break; }
        loaded = result;
      }
    }
    setArchive(loaded);
    if (loaded.ok) publish(loaded.entries);
    dispatch(appActions.navigate("/main"));
  }, []);

  // Reopening a saved result restores follow-up drafts without submitting them.
  useEffect(() => {
    if (!archive.ok) return;
    let updated: RecapArchiveResult = archive;
    for (const entry of archive.entries) {
      if (!(entry.id in state.agent.composerDraftsByScope) && entry.id !== state.agent.currentChatId) continue;
      const draft = state.agent.composerDraftsByScope[entry.id] ?? "";
      if (draft === (entry.draft ?? "")) continue;
      const result = updateRecapMessages(storage, storageKey, entry.id, entry.messages, draft);
      if (!result.ok) { setNotice(result.error); return; }
      updated = result;
    }
    if (updated !== archive) setArchive(updated);
  }, [state.agent.composerDraftsByScope, state.agent.currentChatId, archive]);

  async function generate(range: RecapRange, generationPrompt: string) {
    if (generationLock.current) return;
    if (unsaved) { setNotice("上一份回顾尚未保存，请先重试保存。"); return; }
    generationLock.current = true;
    setBusy(true);
    setNotice(null);
    const id = `recap-${crypto.randomUUID()}`;
    const pending: RecapEntry = {
      id, range, createdAt: new Date().toISOString(), body: "",
      messages: recapMessages(id, range, "", generationPrompt), generationPrompt,
    };
    const initial = readRecapArchive(storage, storageKey);
    const savedEntries = initial.ok ? initial.entries : entries;
    publish([pending, ...savedEntries]);
    show(pending, true);
    try {
      const report = await loadPreviewReport(realData, range, generationPrompt);
      const body = reportBody(report);
      if (!body.trim()) throw new Error("这份回顾没有可展示的内容，请稍后重试。");
      const completed: RecapEntry = {
        ...pending, body, sourceRange: reportRange(report), messages: recapMessages(id, range, body, generationPrompt),
      };
      const result = saveRecap(storage, storageKey, completed);
      if (result.ok) {
        setArchive(result); publish(result.entries); setUnsaved(null);
      } else {
        setUnsaved(completed); setNotice(result.error); publish([completed, ...savedEntries]);
      }
      if (stateRef.current.agent.currentChatId === id && stateRef.current.navigation.currentPath === "/main") show(completed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取回顾失败，请重试。";
      setNotice(message);
      publish(savedEntries);
      if (stateRef.current.agent.currentChatId === id && stateRef.current.navigation.currentPath === "/main") {
        show({ ...pending, messages: [...pending.messages, { id: `${id}-error`, role: "assistant", content: message }] });
      }
    } finally {
      generationLock.current = false;
      setBusy(false);
    }
  }

  function retrySave() {
    if (!unsaved) return;
    const result = saveRecap(storage, storageKey, unsaved);
    if (!result.ok) { setNotice(result.error); return; }
    setArchive(result); publish(result.entries); setUnsaved(null); setNotice(null);
  }

  function prepareInConversation(range: RecapRange) {
    if (unsaved) { setNotice("上一份回顾尚未保存，请先重试保存。"); return; }
    const nextDraftId = stateRef.current.agent.newChatRequestId + 1;
    const scopeKey = agentChatScopeKey(null, nextDraftId);
    const visiblePrompt = `${defaultRecapPrompt.trim()}\n\n回顾范围：${range.label}`;
    setPreparedDraft({ scopeKey, range });
    setNotice(null);
    dispatch(agentActions.newChatRequested());
    dispatch(agentActions.composerDraftUpdated(scopeKey, visiblePrompt));
    dispatch(appActions.navigate("/main"));
  }

  function submitPreparedPrompt(value: string) {
    const latestScope = agentChatScopeKey(stateRef.current.agent.currentChatId, stateRef.current.agent.newChatRequestId);
    if (!preparedDraft || preparedDraft.scopeKey !== latestScope || !value.trim() || busy) return;
    const range = preparedDraft.range;
    setPreparedDraft(null);
    void generate(range, value.trim());
  }

  const activeEntry = entries.find((entry) => entry.id === state.agent.currentChatId)
    ?? (unsaved?.id === state.agent.currentChatId ? unsaved : null);
  return <RecapPreviewMount
    homeEntry={<>
      <RecapHomeEntry disabled={busy} realGeneration={realData}
      error={!archive.ok ? archive.error : unsaved ? "上一份回顾尚未保存，请先重试保存。" : null}
      onPrepare={prepareInConversation} />
      {currentPreparedRange && <p className="recap-preview-prepared" role="status">
        回顾 {currentPreparedRange.label} · {realData ? "发送时使用当前配置模型的额度" : "发送后展示示例回复"}
      </p>}
    </>}
    composerSubmitEnabled={Boolean(currentPreparedRange) && !busy}
    composerHasContent={Boolean(state.agent.composerDraftsByScope[currentScope]?.trim())}
    onComposerSubmit={submitPreparedPrompt}
    onNewConversation={() => setPreparedDraft(null)}
    onOpenTitle={(title, occurrence) => {
      const task = state.agent.tasks.filter((item) => item.title === title)[occurrence];
      const entry = [...entries, ...(unsaved ? [unsaved] : [])].find((item) => item.id === task?.chatId);
      if (entry) show(entry);
    }}
  >
    <HomePage />
    <div className="recap-preview-label">
      <span>独立前端预览 · 生成使用 Memmy Agent · 对话发送待接入</span>
      {activeEntry?.sourceRange && <span>当前正文来自 {activeEntry.sourceRange.label} 已生成原文</span>}
    </div>
    {notice && <div className="recap-preview-error" role="alert">
      {notice}{unsaved && <button type="button" onClick={retrySave}>重试保存</button>}
      <button type="button" onClick={() => setNotice(null)}>关闭</button>
    </div>}
  </RecapPreviewMount>;
}

function reportRange(report: WeeklyReport): RecapRange {
  return { startDate: report.startDate, endDate: report.endDate, label: recapRangeLabel(report.startDate, report.endDate) };
}

function reportBody(report: WeeklyReport): string {
  return report.body ?? report.insights.map((insight) => `${insight.title}\n\n${insight.body}`).join("\n\n");
}

async function loadPreviewReport(realData: boolean, range: RecapRange, prompt: string): Promise<WeeklyReport> {
  if (!realData) {
    const report = previewWeeklyReports[0];
    if (!report) throw new Error("还没有可供预览的回顾。");
    // Yield to allow the real conversation renderer to enter its pending view.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return report;
  }
  const response = await fetch("/__weekly_preview/generate", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(210000),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ range, prompt }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(failure?.message ?? "Memmy Agent 暂时无法生成回顾，请稍后重试。");
  }
  const data: unknown = await response.json();
  const report = typeof data === "object" && data !== null && "report" in data ? data.report : null;
  if (!isWeeklyReport(report)) throw new Error("回顾内容不完整，暂时无法保存。");
  return report;
}
