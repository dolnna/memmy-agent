import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { CREATE_MAC_REMINDER_SCRIPT, createMacRemindersService, normalizeMacReminderRequest } from "../src/main/mac-reminders.js";

const result = { id: "x-apple-reminder://123", title: "明天下午发方案", listName: "提醒事项", alreadyExists: false };
const success = () => JSON.stringify({ ok: true, result });

describe("macOS reminder bridge", () => {
  it("passes Chinese and potentially executable text only in the JSON argument", async () => {
    const runCommand = vi.fn().mockResolvedValue(success());
    const reminders = createMacRemindersService({ platform: "darwin", runCommand });
    const title = "发方案；`$(touch /tmp/should-not-exist)` ' \\\" 中文";
    const notes = '第一行\n"; Application("Terminal").activate(); //';
    await expect(reminders.create({ requestId: "suggestion-1", title, notes, dueAt: "2026-09-12T15:00:00+08:00" })).resolves.toEqual(result);
    const [executable, args] = runCommand.mock.calls[0]!;
    expect(executable).toBe("/usr/bin/osascript");
    expect(args.slice(0, 4)).toEqual(["-l", "JavaScript", "-e", CREATE_MAC_REMINDER_SCRIPT]);
    expect(JSON.parse(args[4])).toMatchObject({ title, notes, dueAt: "2026-09-12T07:00:00.000Z" });
    expect(JSON.parse(args[4]).marker).toMatch(/^Memmy-ID: [a-f0-9]{64}$/);
  });

  it.each([
    { requestId: {}, title: "测试" },
    { requestId: "suggestion\n1", title: "测试" },
    { requestId: "suggestion-1", title: " " },
    { requestId: "suggestion-1", title: "测试", dueAt: "明天" },
    { requestId: "suggestion-1", title: "测试", dueAt: "2026-09-12T15:00:00" },
    { requestId: "suggestion-1", title: "测试", dueAt: "2026-02-30T15:00:00Z" },
    { requestId: "suggestion-1", title: "测试", notes: "a".repeat(16_001) },
  ])("rejects invalid payload before talking to another application: %j", async (payload) => {
    const runCommand = vi.fn();
    const reminders = createMacRemindersService({ platform: "darwin", runCommand });
    await expect(reminders.create(payload)).rejects.toThrow();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not invent a due date when the suggestion has none", () => {
    expect(normalizeMacReminderRequest({ requestId: "abc", title: " 确认方案 ", notes: " " })).toEqual({ requestId: "abc", title: "确认方案" });
  });

  it("serializes creation from multiple windows and allows retry after native failure", async () => {
    let release!: (value: string) => void;
    const runCommand = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(success());
    const reminders = createMacRemindersService({ platform: "darwin", runCommand });
    const first = reminders.create({ requestId: "first", title: "方案" });
    const rejected = expect(first).rejects.toThrow("未找到可写入");
    const second = reminders.create({ requestId: "second", title: "方案" });
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1));
    release(JSON.stringify({ ok: false, code: "NO_DEFAULT_LIST" }));
    await rejected;
    await expect(second).resolves.toEqual(result);
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["-1743", "自动化"], ["NO_DEFAULT_LIST", "默认提醒清单"], ["-1712", "响应超时"], ["-128", "已取消"],
  ])("maps native code %s to a useful recovery message", async (code, message) => {
    const reminders = createMacRemindersService({ platform: "darwin", runCommand: async () => JSON.stringify({ ok: false, code }) });
    await expect(reminders.create({ requestId: "test", title: "方案" })).rejects.toThrow(message);
  });

  it("maps process timeout without leaking the command or note text", async () => {
    const reminders = createMacRemindersService({ platform: "darwin", runCommand: async () => { throw Object.assign(new Error("private content"), { killed: true }); } });
    await expect(reminders.create({ requestId: "test", title: "方案" })).rejects.toThrow("响应超时");
  });

  it("opens only the fixed Reminders bundle and handles unsupported platforms", async () => {
    const runCommand = vi.fn().mockResolvedValue("");
    await createMacRemindersService({ platform: "darwin", runCommand }).open();
    expect(runCommand).toHaveBeenCalledWith("/usr/bin/open", ["-b", "com.apple.reminders"]);
    const unsupported = createMacRemindersService({ platform: "win32", runCommand });
    await expect(unsupported.create({ requestId: "test", title: "方案" })).rejects.toThrow("macOS 桌面版");
    await expect(unsupported.open()).rejects.toThrow("macOS 桌面版");
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("reuses a persistent notes marker even with a fresh bridge and changed title", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const target = { exists: () => true, name: () => "我的清单", reminders: { push: (entry: Record<string, unknown>) => entries.push(entry) } };
    const app = {
      defaultList: () => target,
      Reminder: (properties: Record<string, unknown>) => ({
        ...properties, name: () => properties.name, body: () => properties.body,
        id: () => "x-apple-reminder://saved", container: () => target,
      }),
      reminders: { whose: (filter: { body: { _contains: string } }) => () => entries.filter((entry) => (entry.body as () => string)().includes(filter.body._contains)) },
    };
    const runCommand = async (_file: string, args: string[]) => runInNewContext(`${args[3]}; run(input)`, { Application: () => app, input: [args[4]] }) as string;
    const first = createMacRemindersService({ platform: "darwin", runCommand });
    await expect(first.create({ requestId: "same", title: "发方案", dueAt: "2026-09-12T15:00:00+08:00" })).resolves.toMatchObject({ alreadyExists: false, listName: "我的清单" });
    expect((entries[0]!.dueDate as Date).toISOString()).toBe("2026-09-12T07:00:00.000Z");
    expect((entries[0]!.remindMeDate as Date).toISOString()).toBe("2026-09-12T07:00:00.000Z");
    const afterRestart = createMacRemindersService({ platform: "darwin", runCommand });
    await expect(afterRestart.create({ requestId: "same", title: "修改后的标题" })).resolves.toMatchObject({ alreadyExists: true, title: "发方案" });
    expect(entries).toHaveLength(1);
  });

  it.skipIf(process.platform !== "darwin")("compiles the fixed program with macOS JXA without executing Apple Events", () => {
    const scratch = mkdtempSync(join(tmpdir(), "memmy-reminders-compile-"));
    try {
      execFileSync("/usr/bin/osacompile", ["-l", "JavaScript", "-e", CREATE_MAC_REMINDER_SCRIPT, "-o", join(scratch, "reminders.scpt")], { timeout: 15_000 });
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
});
