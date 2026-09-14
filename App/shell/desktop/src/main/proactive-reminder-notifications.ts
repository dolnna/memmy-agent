import type { DesktopProactiveReminderNotification } from "@memmy/desktop-interface";

interface ReminderNotification {
  on(event: "click" | "close" | "failed", listener: () => void): unknown;
  show(): void;
  close(): void;
}

const NOTIFICATION_DEDUP_MS = 60_000;

export function createProactiveReminderNotifier(dependencies: {
  isSupported(): boolean;
  isMainWindowFocused(): boolean;
  createNotification(payload: { title: string; body: string; silent: boolean }): ReminderNotification;
  onOpen(id: string): void;
  now?: () => number;
}) {
  const notified = new Map<string, number>();
  const active = new Map<string, ReminderNotification>();
  const now = dependencies.now ?? Date.now;

  return {
    notify(raw: unknown): boolean {
      const payload = parseNotification(raw);
      const timestamp = now();
      const previousNotification = notified.get(payload.id);
      if (!dependencies.isSupported() || dependencies.isMainWindowFocused()
        || (previousNotification !== undefined && timestamp - previousNotification < NOTIFICATION_DEDUP_MS)) return false;
      // Snoozed suggestions reuse their ID. Replace their earlier native notification
      // once the short multi-window deduplication window has elapsed.
      active.get(payload.id)?.close();
      const notification = dependencies.createNotification({ title: payload.title, body: payload.body, silent: true });
      notification.on("click", () => dependencies.onOpen(payload.id));
      notification.on("close", () => {
        if (active.get(payload.id) === notification) active.delete(payload.id);
      });
      notification.on("failed", () => {
        if (active.get(payload.id) === notification) { active.delete(payload.id); notified.delete(payload.id); }
      });
      notified.set(payload.id, timestamp);
      active.set(payload.id, notification);
      try { notification.show(); }
      catch { active.delete(payload.id); notified.delete(payload.id); return false; }
      // Bound process memory; the backend owns longer display/snooze cooldowns.
      for (const [id, shownAt] of notified) {
        if (timestamp - shownAt >= NOTIFICATION_DEDUP_MS) notified.delete(id);
      }
      if (notified.size > 1_024) notified.delete(notified.keys().next().value!);
      return true;
    },
    dispose(): void {
      for (const notification of active.values()) notification.close();
      active.clear();
      notified.clear();
    },
  };
}

function parseNotification(raw: unknown): DesktopProactiveReminderNotification {
  const value = raw as Partial<DesktopProactiveReminderNotification> | undefined;
  if (!value || typeof value.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value.id)
    || typeof value.title !== "string" || !value.title.trim() || value.title.length > 500
    || typeof value.body !== "string" || value.body.length > 2_000) {
    throw new Error("主动提醒内容无效。");
  }
  return { id: value.id, title: value.title.trim(), body: value.body.trim() };
}
