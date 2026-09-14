import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { DesktopMacReminderRequest, DesktopMacReminderResult } from "@memmy/desktop-interface";

/**
 * Fixed JXA program. User/model text is JSON in argv, never executable source.
 * Terms follow macOS Reminders.app/Contents/Resources/Reminders.sdef.
 * Accessing Reminders asks macOS for Automation authorization on first use.
 */
export const CREATE_MAC_REMINDER_SCRIPT = String.raw`
function run(argv) {
  try {
    var input = JSON.parse(argv[0]);
    var reminders = Application("com.apple.reminders");
    var matches = reminders.reminders.whose({ body: { _contains: input.marker } })();
    for (var i = 0; i < matches.length; i++) {
      var existing = matches[i];
      if (String(existing.body() || "").split("\n").indexOf(input.marker) !== -1) {
        return JSON.stringify({ ok: true, result: {
          id: existing.id(), title: existing.name(),
          listName: existing.container().name(), alreadyExists: true
        }});
      }
    }
    var target;
    try {
      target = reminders.defaultList();
      if (!target || !target.exists()) {
        return JSON.stringify({ ok: false, code: "NO_DEFAULT_LIST" });
      }
    } catch (error) {
      if (Number(error.errorNumber) === -1743) { throw error; }
      return JSON.stringify({ ok: false, code: "NO_DEFAULT_LIST" });
    }
    var properties = {
      name: input.title,
      body: input.notes ? input.notes + "\n\n" + input.marker : input.marker
    };
    if (input.dueAt) {
      properties.dueDate = new Date(input.dueAt);
      properties.remindMeDate = new Date(input.dueAt);
    }
    var reminder = reminders.Reminder(properties);
    target.reminders.push(reminder);
    return JSON.stringify({ ok: true, result: {
      id: reminder.id(), title: reminder.name(), listName: target.name(), alreadyExists: false
    }});
  } catch (error) {
    return JSON.stringify({ ok: false, code: String(error.errorNumber || "NATIVE_FAILURE") });
  }
}
`;

type RunNativeCommand = (file: string, args: string[]) => Promise<string>;

const runNativeCommand: RunNativeCommand = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 120_000, maxBuffer: 64 * 1024, encoding: "utf8", windowsHide: true }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error(`${label}无效，请修改后重试。`);
  }
  return value.trim();
}

export function normalizeMacReminderRequest(raw: unknown): DesktopMacReminderRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("待办内容无效，请重试。");
  const input = raw as Record<string, unknown>;
  const requestId = requiredText(input.requestId, "待办标识", 256);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(requestId)) throw new Error("待办标识无效，请重试。");
  const title = requiredText(input.title, "待办标题", 500);
  const result: DesktopMacReminderRequest = { requestId, title };
  if (input.notes !== undefined) {
    if (typeof input.notes !== "string" || input.notes.length > 16_000 || input.notes.includes("\0")) {
      throw new Error("待办备注过长或格式无效，请修改后重试。");
    }
    if (input.notes.trim()) result.notes = input.notes.trim();
  }
  if (input.dueAt !== undefined) {
    if (typeof input.dueAt !== "string" || !isExplicitIsoDate(input.dueAt)) {
      throw new Error("提醒时间无效，请指定完整日期、时间和时区，或取消时间。");
    }
    result.dueAt = new Date(input.dueAt).toISOString();
  }
  return result;
}

function isExplicitIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1970 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

export function macReminderError(code: unknown): Error {
  if (String(code) === "-1743") {
    return new Error("尚未获准访问提醒事项。请在系统设置 → 隐私与安全性 → 自动化中，允许 Memmy（开发版可能显示 Electron）访问提醒事项，再重试。");
  }
  if (String(code) === "NO_DEFAULT_LIST" || String(code) === "-1728") {
    return new Error("未找到可写入的默认提醒清单。请先打开 macOS 提醒事项完成初始设置并设置默认清单，再重试。");
  }
  if (String(code) === "-128") return new Error("已取消添加提醒事项，可以稍后重试。");
  if (String(code) === "-1712" || String(code) === "TIMEOUT") {
    return new Error("提醒事项响应超时。请检查系统授权弹窗或打开提醒事项后重试；重试会先检查是否已添加。");
  }
  return new Error("暂时无法添加到提醒事项。请打开提醒事项确认可用后重试；重试会先检查是否已添加。");
}

function readReminderResult(stdout: string): DesktopMacReminderResult {
  let response: Record<string, unknown>;
  try { response = JSON.parse(stdout.trim()) as Record<string, unknown>; }
  catch { throw macReminderError("INVALID_RESULT"); }
  if (!response || response.ok !== true) throw macReminderError(response?.code);
  const result = response.result as Record<string, unknown> | undefined;
  if (!result || typeof result.id !== "string" || !result.id || typeof result.title !== "string" || typeof result.listName !== "string") {
    throw macReminderError("INVALID_RESULT");
  }
  return { id: result.id, title: result.title, listName: result.listName, alreadyExists: result.alreadyExists === true };
}

export function createMacRemindersService(options: { platform?: string; runCommand?: RunNativeCommand } = {}) {
  const platform = options.platform ?? process.platform;
  const runCommand = options.runCommand ?? runNativeCommand;
  // Serialize all creates, including requests arriving from both main and pet windows.
  // The persistent notes marker also survives restarts and ambiguous timeouts.
  let previousCreation: Promise<unknown> = Promise.resolve();

  return {
    create(raw: unknown): Promise<DesktopMacReminderResult> {
      if (platform !== "darwin") return Promise.reject(new Error("添加到 Apple 提醒事项需要使用 macOS 桌面版。"));
      let request: DesktopMacReminderRequest;
      try { request = normalizeMacReminderRequest(raw); }
      catch (error) { return Promise.reject(error); }
      const task = previousCreation.then(async () => {
        const marker = `Memmy-ID: ${createHash("sha256").update(request.requestId).digest("hex")}`;
        let stdout: string;
        try {
          stdout = await runCommand("/usr/bin/osascript", ["-l", "JavaScript", "-e", CREATE_MAC_REMINDER_SCRIPT, JSON.stringify({ ...request, marker })]);
        } catch (error) {
          const nativeError = error as { killed?: boolean; message?: string };
          throw macReminderError(nativeError.killed ? "TIMEOUT" : /-1743/.test(nativeError.message ?? "") ? "-1743" : "NATIVE_FAILURE");
        }
        return readReminderResult(stdout);
      });
      previousCreation = task.catch(() => undefined);
      return task;
    },
    async open(): Promise<void> {
      if (platform !== "darwin") throw new Error("打开 Apple 提醒事项需要使用 macOS 桌面版。");
      try { await runCommand("/usr/bin/open", ["-b", "com.apple.reminders"]); }
      catch { throw new Error("无法打开 macOS 提醒事项，请从应用程序中手动打开。"); }
    },
  };
}
