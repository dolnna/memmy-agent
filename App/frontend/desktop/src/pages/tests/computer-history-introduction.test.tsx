// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputerHistorySnapshot, MemmyAgentClient } from "../../api/memmy-agent-client.js";
import { MemmyAgentRequestError } from "../../api/memmy-agent-client.js";
import type { ProactiveRemindersSnapshot } from "../../api/proactive-reminders-contract.js";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { agentActions } from "../../state/app-actions.js";
import { agentReducer, initialAgentState } from "../../state/agent-chat-slice.js";
import { applyHistoryIntroductionSettings, ComputerHistoryIntroduction, formatHistoryIntroductionError, HISTORY_INTRO_SEEN_KEY, markComputerHistoryIntroduced, shouldIntroduceComputerHistory } from "../memory/computer-history-introduction.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function history(state: ComputerHistorySnapshot["observation"]["state"] = "running", error: string | null = null): ComputerHistorySnapshot {
  return {
    observation: { state, recorderReady: state === "running", error, narrationError: null, startedAt: null, segmentId: null, segmentStartedAt: null },
    histories: [], workflows: [], cuaRun: { kind: null, status: "idle", startedAt: null, finishedAt: null, output: "", error: null },
    privacy: { screenshots: false, audio: false, rawRetentionHours: 48, markdownDirectory: "/tmp/history", eventStreamDirectory: "/tmp/events" }
  };
}

function mockService(state: ComputerHistorySnapshot["observation"]["state"] = "running", enabled = true) {
  const current = { history: history(state), proactive: { enabled, observationState: state, analyzing: false, lastAnalyzedAt: null, error: null, suggestions: [] } as ProactiveRemindersSnapshot };
  const operations: string[] = [];
  const methods = {
    getComputerHistory: vi.fn(async () => current.history),
    getProactiveReminders: vi.fn(async () => current.proactive),
    updateProactiveRemindersSettings: vi.fn(async (value: boolean) => {
      operations.push(`proactive:${value}`);
      current.proactive = { ...current.proactive, enabled: value };
      return current.proactive;
    }),
    startComputerHistoryObservation: vi.fn(async () => {
      operations.push("start"); current.history = history("running"); return current.history;
    }),
    resumeComputerHistoryObservation: vi.fn(async () => {
      operations.push("resume"); current.history = history("running"); return current.history;
    }),
    stopComputerHistoryObservation: vi.fn(async () => {
      operations.push("stop"); current.history = history("stopped"); return current.history;
    })
  };
  return { current, operations, methods, client: methods as unknown as MemmyAgentClient };
}

describe("Computer History introduction", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    window.localStorage.removeItem(HISTORY_INTRO_SEEN_KEY);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); document.body.replaceChildren(); window.localStorage.removeItem(HISTORY_INTRO_SEEN_KEY);
    vi.useRealTimers(); vi.restoreAllMocks();
  });
  const toggle = (label: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
  const cta = () => document.querySelector<HTMLButtonElement>(".chi-primary")!;
  const render = async (client: MemmyAgentClient) => {
    const onClose = vi.fn(); const onApplied = vi.fn();
    await act(async () => root.render(<I18nProvider language="zh-CN"><ComputerHistoryIntroduction client={client} onClose={onClose} onApplied={onApplied} /></I18nProvider>));
    return { onClose, onApplied };
  };

  it("reads existing on states and keeps draft toggles local until confirmation", async () => {
    const service = mockService(); const { onClose, onApplied } = await render(service.client);
    expect(toggle("记录电脑活动").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Memmy 主动提醒").getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle("记录电脑活动").click());
    expect(document.body.textContent).toContain("主动提醒偏好会保留，开始记录后生效");
    expect(service.operations).toEqual([]);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="稍后再看"]')?.click());
    expect(onClose).toHaveBeenCalledOnce(); expect(onApplied).not.toHaveBeenCalled();
    expect(service.operations).toEqual([]);
  });

  it("shows a readable connection error and a stopped loading state, then allows reloading", async () => {
    const service = mockService();
    service.methods.getComputerHistory.mockRejectedValueOnce(new MemmyAgentRequestError("memmy-agent request failed with status 401", 401));
    await render(service.client);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("连接暂不可用，请重新打开 Memmy 或稍后重试");
    expect(document.body.textContent).not.toContain("status 401");
    expect(cta().textContent).toBe("暂不可用"); expect(cta().disabled).toBe(true);
    await act(async () => document.querySelector<HTMLButtonElement>(".chi-error button")?.click());
    expect(cta().textContent).toBe("知道了"); expect(cta().disabled).toBe(false);
  });

  it("maps connection failures while preserving specific system permission errors", () => {
    const friendly = "连接暂不可用，请重新打开 Memmy 或稍后重试。";
    expect(formatHistoryIntroductionError(new MemmyAgentRequestError("Forbidden", 403), friendly)).toBe(friendly);
    expect(formatHistoryIntroductionError(new TypeError("Failed to fetch"), friendly)).toBe(friendly);
    expect(formatHistoryIntroductionError(new Error("请在系统设置中授予输入监控权限。"), friendly)).toBe("请在系统设置中授予输入监控权限。");
    expect(formatHistoryIntroductionError(new Error("活动记录尚未就绪，请检查系统权限后重试。"), friendly)).toBe("活动记录尚未就绪，请检查系统权限后重试。");
  });

  it("applies a recording change without silently changing reminder preference", async () => {
    const service = mockService(); const { onApplied } = await render(service.client);
    await act(async () => toggle("记录电脑活动").click());
    await act(async () => cta().click());
    expect(service.operations).toEqual(["stop"]);
    expect(service.current.proactive.enabled).toBe(true);
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ observation: expect.objectContaining({ state: "stopped" }) }));
  });

  it("configures reminders before starting, and checks for asynchronous recorder failure", async () => {
    const service = mockService("stopped", false);
    service.methods.startComputerHistoryObservation.mockImplementationOnce(async () => {
      service.operations.push("start"); service.current.history = history("failed", "请授予输入监控权限"); return history("running");
    });
    await expect(applyHistoryIntroductionSettings(service.client, { recording: true, proactive: true }, async () => undefined)).rejects.toThrow("请授予输入监控权限");
    expect(service.operations).toEqual(["proactive:true", "start"]);
  });

  it("stops recording before changing reminder preference", async () => {
    const service = mockService("running", false);
    await applyHistoryIntroductionSettings(service.client, { recording: false, proactive: true }, async () => undefined);
    expect(service.operations).toEqual(["stop", "proactive:true"]);
  });

  it("preserves paused recording on acknowledgment and uses resume when explicitly enabled", async () => {
    const service = mockService("paused", true);
    const { onApplied } = await render(service.client);
    expect(document.body.textContent).toContain("记录已暂停，开启后继续记录");
    await act(async () => cta().click());
    expect(service.operations).toEqual([]);
    expect(onApplied).toHaveBeenCalledOnce();
    await applyHistoryIntroductionSettings(service.client, { recording: true }, async () => undefined);
    expect(service.operations).toEqual(["resume"]);
  });

  it("reconciles a concurrent start instead of treating an already-running response as failure", async () => {
    const service = mockService("stopped", true);
    service.methods.startComputerHistoryObservation.mockImplementationOnce(async () => {
      service.current.history = history("running"); throw new Error("409: already running");
    });
    const result = await applyHistoryIntroductionSettings(service.client, { recording: true }, async () => undefined);
    expect(result.observation.state).toBe("running");
    expect(service.methods.startComputerHistoryObservation).toHaveBeenCalledOnce();
  });

  it("keeps errors visible and allows a changed reminder choice after partial success", async () => {
    vi.useFakeTimers();
    const service = mockService("stopped", false);
    service.methods.startComputerHistoryObservation.mockImplementationOnce(async () => {
      service.operations.push("failed-start"); service.current.history = history("failed", "输入监控权限尚未授权"); return history("running");
    });
    const { onApplied } = await render(service.client);
    await act(async () => { toggle("记录电脑活动").click(); toggle("Memmy 主动提醒").click(); });
    await act(async () => cta().click());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("输入监控权限尚未授权");
    expect(onApplied).not.toHaveBeenCalled(); expect(service.current.proactive.enabled).toBe(true);
    // Turn the preference back off after its first save succeeded. This must
    // compare with the current true value, not the original false value.
    await act(async () => toggle("Memmy 主动提醒").click());
    await act(async () => cta().click());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(service.operations).toEqual(["proactive:true", "failed-start", "proactive:false", "start"]);
    expect(service.current.proactive.enabled).toBe(false);
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("does not overwrite an untouched preference changed elsewhere while the dialog was open", async () => {
    const service = mockService(); const { onApplied } = await render(service.client);
    service.current.proactive.enabled = false;
    await act(async () => cta().click());
    expect(service.operations).toEqual([]);
    expect(service.current.proactive.enabled).toBe(false); expect(onApplied).toHaveBeenCalledOnce();
  });

  it("closes on Escape and traps keyboard focus inside the dialog", async () => {
    const service = mockService(); const { onClose } = await render(service.client);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = document.querySelector<HTMLButtonElement>('[aria-label="稍后再看"]')!;
    cta().focus();
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledOnce(); expect(service.operations).toEqual([]);
  });

  it("remembers dismissal locally without changing either service switch", () => {
    expect(shouldIntroduceComputerHistory()).toBe(true);
    markComputerHistoryIntroduced();
    expect(shouldIntroduceComputerHistory()).toBe(false);
  });

  it("prepares an editable activity question without sending or replacing an existing draft", () => {
    const state = { ...initialAgentState, composerDraftsByScope: { "draft-0": "已有草稿" } };
    const next = agentReducer(state, agentActions.newChatDraftPrepared("帮我回顾一下最近的电脑活动。"));
    expect(next.blankDraftActive).toBe(true);
    expect(next.currentChatId).toBeNull(); expect(next.isSending).toBe(false);
    expect(next.newChatRequestId).toBe(0);
    expect(next.composerDraftsByScope).toEqual({ "draft-0": "已有草稿\n\n帮我回顾一下最近的电脑活动。" });
    expect(next.messages).toEqual([]);
    const repeated = agentReducer(next, agentActions.newChatDraftPrepared("帮我回顾一下最近的电脑活动。"));
    expect(repeated.composerDraftsByScope).toEqual(next.composerDraftsByScope);
  });

  it("keeps the current unsent attachment and project target reachable", () => {
    const attachment = { id: "file-1", sourceKey: "file-1", fileName: "需求.txt", kind: "file" as const, status: "ready" as const, originalBytes: 10, extension: "txt" };
    const state = { ...initialAgentState, composerPendingAttachmentsByScope: { "draft-0": [attachment] }, draftTargetsByScope: { "draft-0": { kind: "project" as const, projectId: "project-1" } } };
    const next = agentReducer(state, agentActions.newChatDraftPrepared("帮我回顾一下最近的电脑活动。"));
    expect(next.newChatRequestId).toBe(0);
    expect(next.composerPendingAttachmentsByScope["draft-0"]).toEqual([attachment]);
    expect(next.draftTargetsByScope).toEqual(state.draftTargetsByScope);
    expect(next.composerDraftsByScope["draft-0"]).toBe("帮我回顾一下最近的电脑活动。");
    expect(next.isSending).toBe(false);
  });

  it("waits for the recorder handshake instead of treating a spawned process as ready", async () => {
    const service = mockService("stopped", true);
    service.methods.startComputerHistoryObservation.mockImplementationOnce(async () => {
      service.current.history = { ...history("running"), observation: { ...history("running").observation, recorderReady: false } };
      return service.current.history;
    });
    let checks = 0;
    const result = await applyHistoryIntroductionSettings(service.client, { recording: true }, async () => {
      checks += 1;
      if (checks === 6) service.current.history = history("running");
    });
    expect(checks).toBe(6);
    expect(result.observation.recorderReady).toBe(true);
  });

  it("keeps checking actual readiness after a timeout without starting a second recorder", async () => {
    vi.useFakeTimers();
    const service = mockService("running", true);
    service.current.history.observation.recorderReady = false;
    const { onApplied } = await render(service.client);
    expect(cta().textContent).toBe("确认记录状态");
    await act(async () => cta().click());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("活动记录尚未就绪");
    expect(onApplied).not.toHaveBeenCalled(); expect(cta().textContent).toBe("确认记录状态");
    service.current.history = history("running");
    await act(async () => cta().click());
    expect(onApplied).toHaveBeenCalledOnce();
    expect(service.methods.startComputerHistoryObservation).not.toHaveBeenCalled();
  });
});
