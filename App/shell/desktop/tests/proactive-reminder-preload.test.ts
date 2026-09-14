import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function loadPreload() {
  const source = readFileSync(fileURLToPath(new URL("../src/preload/preload.cts", import.meta.url)), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  let api!: {
    createMacReminder(request: unknown): Promise<unknown>;
    onProactiveReminderOpen(callback: (id: string) => void): () => void;
  };
  const invoke = vi.fn().mockResolvedValue({ id: "saved" });
  const electron = {
    contextBridge: { exposeInMainWorld: (_key: string, value: typeof api) => { api = value; } },
    ipcRenderer: { invoke, send: vi.fn(), on: (channel: string, callback: (event: unknown, payload: unknown) => void) => listeners.set(channel, callback), removeListener: vi.fn() },
  };
  const module = { exports: {} };
  Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "electron") return electron;
    throw new Error(`Unexpected import: ${specifier}`);
  }, module, module.exports);
  return { api, invoke, emit: (id: string) => listeners.get("memmy:proactive-reminder-open")!({}, id) };
}

describe("proactive reminder preload delivery", () => {
  it("retains a notification click until the renderer mounts, without replaying it on remount", () => {
    const { api, emit } = loadPreload();
    const first = vi.fn();
    const second = vi.fn();
    emit("suggestion-before-mount");
    const unsubscribe = api.onProactiveReminderOpen(first);
    expect(first).toHaveBeenCalledExactlyOnceWith("suggestion-before-mount");
    unsubscribe();
    api.onProactiveReminderOpen(second);
    expect(second).not.toHaveBeenCalled();
    emit("suggestion-after-mount");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledExactlyOnceWith("suggestion-after-mount");
  });

  it("passes a confirmed reminder request through the dedicated IPC and returns its result", async () => {
    const { api, invoke } = loadPreload();
    const request = { requestId: "suggestion-1", title: "确认方案" };
    await expect(api.createMacReminder(request)).resolves.toEqual({ id: "saved" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("memmy:create-mac-reminder", request);
  });
});
