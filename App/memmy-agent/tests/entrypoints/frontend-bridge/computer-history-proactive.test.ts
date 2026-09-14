import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerHistoryDemoService } from "../../../src/entrypoints/frontend-bridge/computer-history-api.js";
import { buildProactiveEvidence } from "../../../src/core/agent-runtime/computer-history/proactive-evidence.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-live-proactive-"));
  roots.push(root);
  const historyDirectory = path.join(root, "histories");
  fs.mkdirSync(historyDirectory);
  const instance = new ComputerHistoryDemoService({ historyDirectory, recordingDirectory: path.join(root, "recordings"),
    workflowDirectory: path.join(root, "workflows"), observationSettingsFile: path.join(root, "settings.json") });
  const eventsFile = path.join(root, "events.jsonl");
  const line = JSON.stringify({ sequence: 3, eventType: "mouse_click", timestamp: new Date().toISOString(),
    application: { name: "Chat", bundleId: "test.chat" },
    details: { accessibility: { role: "AXStaticText", title: "自己：我明天上午10点把最终方案发给小王。已发送" } } });
  fs.writeFileSync(eventsFile, line + "\n");
  const historyFile = path.join(historyDirectory, "live.md");
  fs.writeFileSync(historyFile, '---\ntitle: "Existing"\ndescription: "Existing activity"\nsummary_state: ready\n---\n## Recording summary\nPrevious account\n');
  const segment = { id: "live", directory: root, historyFile, eventsFile, child: null };
  const internal = instance as any;
  internal.segment = segment;
  internal.observationState = "running";
  const evidence = buildProactiveEvidence([line]);
  const response = { content: JSON.stringify({ title: "约定发送方案", description: "你答应明天发送方案。", body: "你已经发出承诺。",
    proactive: { decision: "now", title: "明天上午10点发送最终方案给小王", reason: "记下刚才答应的交付，方便按时处理。",
      confidence: 0.96, evidenceQuote: "我明天上午10点把最终方案发给小王", sourceEventIds: evidence.eventIds, dueAt: null } }) };
  return { root, instance, internal, segment, eventsFile, historyFile, response };
}

describe("live history analysis and proactive delivery", () => {
  it("shares one inference for history and suggestion, avoids overlap and skips unchanged evidence", async () => {
    const { instance, internal, segment, response, historyFile } = setup();
    const chatWithRetry = vi.fn(async (_request: any) => response);
    internal.llmRuntime = () => ({ provider: { chatWithRetry }, model: "fixture" });
    await Promise.all([internal.analyzeLiveSegment(segment), internal.analyzeLiveSegment(segment)]);
    await internal.analyzeLiveSegment(segment);
    expect(chatWithRetry).toHaveBeenCalledTimes(1);
    expect(chatWithRetry.mock.calls[0][0].messages[1].content).toContain("Previous account");
    expect(fs.readFileSync(historyFile, "utf8")).toContain("约定发送方案");
    expect(instance.proactiveSnapshot().suggestions).toHaveLength(1);
    expect(instance.proactiveSnapshot().analyzing).toBe(false);
  });

  it("discards an in-flight opportunity after observation is paused or suggestions are disabled", async () => {
    for (const stop of ["pause", "disable"]) {
      const { instance, internal, segment, response } = setup();
      let finish!: (value: typeof response) => void;
      internal.llmRuntime = () => ({ model: "fixture", provider: { chatWithRetry: () => new Promise((resolve) => { finish = resolve; }) } });
      const pending = internal.analyzeLiveSegment(segment);
      if (stop === "pause") internal.observationState = "paused";
      else instance.setProactiveEnabled(false);
      finish(response);
      await pending;
      expect(instance.proactiveSnapshot().suggestions).toHaveLength(0);
    }
  });

  it("honors current observation exclusions and never forwards old unsafe summary input", async () => {
    const { root, instance, internal, segment, response, eventsFile } = setup();
    const calls: any[] = [];
    internal.llmRuntime = () => ({ model: "fixture", provider: { chatWithRetry: async (request: any) => { calls.push(request); return response; } } });
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ observation: {
      defaultApplicationBehavior: "observe", defaultURLBehavior: "observe", rules: [{ scope: "app", bundleID: "test.chat", behavior: "do_not_observe" }],
    } }));
    await internal.analyzeLiveSegment(segment);
    expect(calls).toHaveLength(0);
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ observation: {
      defaultApplicationBehavior: "observe", defaultURLBehavior: "observe", rules: [],
    } }));
    const secret = "sk-testsecretvalueneverforwarded12345";
    fs.appendFileSync(eventsFile, JSON.stringify({ sequence: 4, timestamp: new Date().toISOString(), eventType: "mouse_click",
      application: { name: "Chat", bundleId: "test.chat" }, details: { accessibility: { role: "AXTextField", title: secret } } }) + "\n");
    await internal.analyzeLiveSegment(segment);
    expect(JSON.stringify(calls)).not.toContain(secret);
    expect(instance.proactiveSnapshot().analyzing).toBe(false);
  });

  it("keeps the standing history and exposes a recoverable failure for malformed model output", async () => {
    const { instance, internal, segment, historyFile } = setup();
    internal.llmRuntime = () => ({ model: "fixture", provider: { chatWithRetry: async () => ({ content: "bad response" }) } });
    await internal.analyzeLiveSegment(segment);
    expect(fs.readFileSync(historyFile, "utf8")).toContain("Previous account");
    expect(instance.proactiveSnapshot()).toMatchObject({ suggestions: [], analyzing: false, error: expect.any(String) });
  });
});
