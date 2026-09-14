// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemmyAgentClient } from "../../api/memmy-agent-client.js";
import type { ProactiveRemindersSnapshot, ProactiveSuggestion } from "../../api/proactive-reminders-contract.js";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { ProactiveReminderCard, ProactiveRemindersProvider, ProactiveRemindersSection, toLocalDateTime } from "../proactive-reminders.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const candidate = (overrides: Partial<ProactiveSuggestion> = {}): ProactiveSuggestion => ({
  id: "reminder-test-1", kind: "reminder", title: "明天下午发送修改后的方案",
  reason: "你刚才答应把修改后的方案发给同事，还没有看到发送记录。",
  evidence: "我明天下午把修改后的方案发给你。", application: "钉钉",
  detectedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  status: "pending", dueAt: null, reminderId: null, snoozedUntil: null, notifiedAt: null,
  ...overrides
});
const snapshot = (suggestions = [candidate()]): ProactiveRemindersSnapshot => ({
  enabled: true, observationState: "running", analyzing: false,
  lastAnalyzedAt: new Date().toISOString(), error: null, suggestions
});

describe("proactive reminder delivery and confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let createMacReminder: ReturnType<typeof vi.fn>;
  let openMacReminders: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    createMacReminder = vi.fn().mockResolvedValue({ id: "mac-reminder-1", title: candidate().title, listName: "提醒事项" });
    openMacReminders = vi.fn().mockResolvedValue(undefined);
    window.memmy = { platform: "darwin", createMacReminder, openMacReminders } as unknown as NonNullable<Window["memmy"]>;
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    delete window.memmy;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const button = (label: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
    expect(found, `button ${label}`).toBeDefined();
    return found!;
  };
  const renderCard = async (onAction = vi.fn().mockResolvedValue(undefined), suggestion = candidate()) => {
    const onClose = vi.fn();
    await act(async () => root.render(<I18nProvider language="zh-CN"><ProactiveReminderCard suggestion={suggestion} onAction={onAction} onClose={onClose} /></I18nProvider>));
    return { onAction, onClose };
  };

  it("requires confirmation, saves to the real default list, then opens Reminders", async () => {
    const { onAction } = await renderCard();
    expect(createMacReminder).not.toHaveBeenCalled();
    expect(container.textContent).toContain("macOS 提醒事项 · 默认清单");
    await act(async () => button("添加到提醒事项").click());
    expect(createMacReminder).toHaveBeenCalledOnce();
    expect(createMacReminder).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "reminder-test-1", title: candidate().title,
      notes: expect.stringContaining(candidate().evidence)
    }));
    expect(createMacReminder.mock.calls[0][0]).not.toHaveProperty("dueAt");
    expect(onAction).toHaveBeenCalledWith({ id: "reminder-test-1", action: "added", reminder_id: "mac-reminder-1", title: candidate().title, due_at: null });
    expect(container.textContent).toContain("已保存到「提醒事项」");
    await act(async () => button("打开提醒事项").click());
    expect(openMacReminders).toHaveBeenCalledOnce();
  });

  it("keeps an unsuccessful native write available for retry", async () => {
    createMacReminder.mockRejectedValueOnce(new Error("请允许 Memmy 访问提醒事项。"));
    const { onAction } = await renderCard();
    await act(async () => button("添加到提醒事项").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("请允许 Memmy");
    expect(onAction).not.toHaveBeenCalled();
    expect(button("添加到提醒事项").disabled).toBe(false);
    await act(async () => button("添加到提醒事项").click());
    expect(createMacReminder).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("已添加到提醒事项");
  });

  it("saves edited content and the chosen local time after confirmation", async () => {
    createMacReminder.mockImplementation(async (input) => ({ id: "mac-reminder-1", title: input.title, listName: "工作" }));
    const { onAction } = await renderCard();
    await act(async () => button("修改").click());
    const inputs = container.querySelectorAll("input");
    const dateValue = toLocalDateTime(new Date(Date.now() + 86_400_000).toISOString());
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(inputs[0], "发送活动页方案");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(inputs[1], dateValue);
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("添加到提醒事项").click());
    expect(createMacReminder).toHaveBeenCalledWith(expect.objectContaining({ title: "发送活动页方案", dueAt: new Date(dateValue).toISOString() }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ title: "发送活动页方案", due_at: new Date(dateValue).toISOString() }));
    expect(container.textContent).toContain("已保存到「工作」");
  });

  it("retries only the receipt after a native success and gateway failure", async () => {
    const onAction = vi.fn().mockRejectedValueOnce(new Error("Gateway unavailable")).mockResolvedValue(undefined);
    await renderCard(onAction);
    await act(async () => button("添加到提醒事项").click());
    expect(container.textContent).toContain("重试不会重复添加");
    await act(async () => button("重试同步").click());
    expect(createMacReminder).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("已添加到提醒事项");
  });

  it("snoozes without creating a reminder", async () => {
    const { onAction, onClose } = await renderCard();
    await act(async () => button("10 分钟后再问").click());
    expect(onAction).toHaveBeenCalledWith({ id: "reminder-test-1", action: "snooze" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(createMacReminder).not.toHaveBeenCalled();
  });

  it("explains the desktop requirement in a browser and does not write", async () => {
    delete window.memmy;
    await renderCard();
    expect(button("添加到提醒事项").disabled).toBe(true);
    expect(container.textContent).toContain("Mac 上的 Memmy 桌面端");
  });

  it("does not display a suggestion claimed by another renderer", async () => {
    const client = {
      getProactiveReminders: vi.fn().mockResolvedValue(snapshot()),
      actOnProactiveReminder: vi.fn().mockRejectedValue(new Error("409: already shown")),
      updateProactiveRemindersSettings: vi.fn()
    } as unknown as MemmyAgentClient;
    await act(async () => root.render(<I18nProvider language="zh-CN"><ProactiveRemindersProvider client={client}><ProactiveRemindersSection /></ProactiveRemindersProvider></I18nProvider>));
    expect(client.actOnProactiveReminder).toHaveBeenCalledWith({ id: "reminder-test-1", action: "shown" });
    expect(container.querySelector(".pr-card")).toBeNull();
    expect(createMacReminder).not.toHaveBeenCalled();
  });

  it("shows one claimed suggestion, preserves it on poll and allows revisiting from History", async () => {
    vi.useFakeTimers();
    let current = snapshot();
    const client = {
      getProactiveReminders: vi.fn(async () => current),
      actOnProactiveReminder: vi.fn(async () => {
        current = snapshot([candidate({ notifiedAt: new Date().toISOString() })]);
        return current;
      }),
      updateProactiveRemindersSettings: vi.fn()
    } as unknown as MemmyAgentClient;
    await act(async () => root.render(<I18nProvider language="zh-CN"><ProactiveRemindersProvider client={client}><ProactiveRemindersSection /></ProactiveRemindersProvider></I18nProvider>));
    expect(container.querySelector(".pr-card")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(client.actOnProactiveReminder).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起，保留在建议中"]')?.click());
    expect(container.querySelector(".pr-card")).toBeNull();
    await act(async () => button("查看建议（1）").click());
    await act(async () => container.querySelector<HTMLButtonElement>(".pr-record")?.click());
    expect(container.querySelector(".pr-card")).not.toBeNull();
    expect(client.actOnProactiveReminder).toHaveBeenCalledTimes(1);
  });

  it("does not claim while recording is stopped", async () => {
    const client = {
      getProactiveReminders: vi.fn().mockResolvedValue({ ...snapshot(), observationState: "stopped" }),
      actOnProactiveReminder: vi.fn(), updateProactiveRemindersSettings: vi.fn()
    } as unknown as MemmyAgentClient;
    await act(async () => root.render(<I18nProvider language="zh-CN"><ProactiveRemindersProvider client={client}><ProactiveRemindersSection /></ProactiveRemindersProvider></I18nProvider>));
    expect(client.actOnProactiveReminder).not.toHaveBeenCalled();
    expect(container.textContent).toContain("开始记录后，Memmy 会留意");
  });

  it("delivers in the background and opens the same card when the native notification is clicked", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    let clicked: ((id: string) => void) | undefined;
    const notifyProactiveReminder = vi.fn().mockResolvedValue(true);
    const unsubscribe = vi.fn();
    window.memmy!.notifyProactiveReminder = notifyProactiveReminder;
    window.memmy!.onProactiveReminderOpen = (callback) => { clicked = callback; return unsubscribe; };
    const current = snapshot([candidate({ notifiedAt: new Date().toISOString() })]);
    const client = {
      getProactiveReminders: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue(current),
      actOnProactiveReminder: vi.fn().mockResolvedValue(current), updateProactiveRemindersSettings: vi.fn()
    } as unknown as MemmyAgentClient;
    await act(async () => root.render(<I18nProvider language="zh-CN"><ProactiveRemindersProvider client={client}><ProactiveRemindersSection /></ProactiveRemindersProvider></I18nProvider>));
    expect(notifyProactiveReminder).toHaveBeenCalledWith({ id: "reminder-test-1", title: "这件事，要记下来吗？", body: candidate().title });
    expect(container.querySelector<HTMLElement>(".pr-card")?.hidden).toBe(true);
    await act(async () => {
      vi.mocked(document.hasFocus).mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
      clicked?.("reminder-test-1");
    });
    expect(container.querySelector(".pr-card")?.textContent).toContain(candidate().title);
    expect(container.querySelector<HTMLElement>(".pr-card")?.hidden).toBe(false);
    expect(client.actOnProactiveReminder).toHaveBeenCalledTimes(1);
    expect(createMacReminder).not.toHaveBeenCalled();
  });

  it("quietly closes an unattended automatic card, while manually reopened cards stay", async () => {
    vi.useFakeTimers();
    let current = snapshot();
    const client = {
      getProactiveReminders: vi.fn(async () => current),
      actOnProactiveReminder: vi.fn(async () => {
        current = snapshot([candidate({ notifiedAt: new Date().toISOString() })]);
        return current;
      }),
      updateProactiveRemindersSettings: vi.fn()
    } as unknown as MemmyAgentClient;
    await act(async () => root.render(<I18nProvider language="zh-CN"><ProactiveRemindersProvider client={client}><ProactiveRemindersSection /></ProactiveRemindersProvider></I18nProvider>));
    expect(container.querySelector(".pr-card")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(container.querySelector(".pr-card")).toBeNull();
    await act(async () => button("查看建议（1）").click());
    await act(async () => container.querySelector<HTMLButtonElement>(".pr-record")?.click());
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(container.querySelector(".pr-card")).not.toBeNull();
    expect(createMacReminder).not.toHaveBeenCalled();
  });

  it("keeps an automatic card open while editing", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await act(async () => root.render(<I18nProvider language="zh-CN"><ProactiveReminderCard suggestion={candidate()} onAction={vi.fn()} onClose={onClose} autoHide /></I18nProvider>));
    await act(async () => button("修改").click());
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("preserves the local wall-clock time in the editable reminder date", () => {
    const date = new Date(2027, 8, 11, 16, 25);
    expect(toLocalDateTime(date.toISOString())).toBe("2027-09-11T16:25");
    expect(toLocalDateTime(null)).toBe("");
    expect(toLocalDateTime("invalid")).toBe("");
  });
});
