import { describe, expect, it, vi } from "vitest";
import { createProactiveReminderNotifier } from "../src/main/proactive-reminder-notifications.js";

function fixture() {
  const listeners = new Map<string, () => void>();
  const notification = { on: vi.fn((event: string, fn: () => void) => listeners.set(event, fn)), show: vi.fn(), close: vi.fn() };
  const dependencies = { isSupported: vi.fn(() => true), isMainWindowFocused: vi.fn(() => false), createNotification: vi.fn(() => notification), onOpen: vi.fn(), now: vi.fn(() => 0) };
  return { ...dependencies, notification, listeners, notifier: createProactiveReminderNotifier(dependencies) };
}
const payload = { id: "suggestion-1", title: "记下这件事？", body: "明天下午发送方案" };

describe("proactive reminder system notification", () => {
  it("stays quiet while the main window has focus", () => {
    const state = fixture();
    state.isMainWindowFocused.mockReturnValue(true);
    expect(state.notifier.notify(payload)).toBe(false);
    expect(state.createNotification).not.toHaveBeenCalled();
  });

  it("deduplicates requests from main and pet windows and opens the same suggestion on click", () => {
    const state = fixture();
    expect(state.notifier.notify(payload)).toBe(true);
    expect(state.notifier.notify(payload)).toBe(false);
    expect(state.notification.show).toHaveBeenCalledOnce();
    state.listeners.get("click")!();
    expect(state.onOpen).toHaveBeenCalledExactlyOnceWith(payload.id);
  });

  it("allows retry if the OS rejects a notification", () => {
    const state = fixture();
    state.notifier.notify(payload);
    state.listeners.get("failed")!();
    expect(state.notifier.notify(payload)).toBe(true);
  });

  it("allows the same snoozed suggestion after ten minutes while rejecting immediate repeats", () => {
    const state = fixture();
    expect(state.notifier.notify(payload)).toBe(true);
    state.now.mockReturnValue(59_999);
    expect(state.notifier.notify(payload)).toBe(false);
    state.now.mockReturnValue(10 * 60_000);
    expect(state.notifier.notify(payload)).toBe(true);
    expect(state.notification.show).toHaveBeenCalledTimes(2);
    expect(state.notification.close).toHaveBeenCalledOnce();
  });

  it("cleans up live notifications at shutdown", () => {
    const state = fixture();
    state.notifier.notify(payload);
    state.notifier.dispose();
    expect(state.notification.close).toHaveBeenCalledOnce();
  });
});
