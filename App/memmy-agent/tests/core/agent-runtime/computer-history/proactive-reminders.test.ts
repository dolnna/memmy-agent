import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProactiveReminders } from "../../../../src/core/agent-runtime/computer-history/proactive-reminders.js";
import { buildProactiveEvidence } from "../../../../src/core/agent-runtime/computer-history/proactive-evidence.js";

const roots: string[] = [];
const START = Date.parse("2026-09-11T07:00:00Z");
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-proactive-test-"));
  roots.push(directory);
  let now = START;
  const file = path.join(directory, "state.json");
  const clock = () => now;
  return { store: new ProactiveReminders(file, clock), file, clock, advance: (ms: number) => { now += ms; } };
}

function evidence(text = "我明天下午把修改后的方案发给你", now = START) {
  return buildProactiveEvidence([JSON.stringify({
    sequence: 1, timestamp: new Date(now).toISOString(), eventType: "mouse_click",
    application: { name: "Chat", bundleId: "test.chat" },
    details: { accessibility: { role: "AXStaticText", title: text } },
  })], { now });
}

function proposal(input = evidence(), changes: Record<string, unknown> = {}) {
  return {
    decision: "now", title: "明天下午发送修改后的方案", reason: "你刚才答应发送方案，记下来方便后续处理。",
    confidence: 0.95, evidenceQuote: "我明天下午把修改后的方案发给你", sourceEventIds: input.eventIds,
    dueAt: null, ...changes,
  };
}

describe("proactive reminder proposals", () => {
  it("requires exact evidence and refuses fabricated citations or low confidence", () => {
    const { store } = setup();
    const input = evidence();
    for (const patch of [
      { sourceEventIds: ["invented"] }, { evidenceQuote: "我明天要支付一大笔费用" },
      { confidence: 0.7 }, { confidence: 2 }, { sourceEventIds: [] },
    ]) store.accept(proposal(input, patch), input);
    expect(store.snapshot("running").suggestions).toHaveLength(0);
    store.accept(proposal(input), input);
    expect(store.snapshot("running").suggestions[0]).toMatchObject({ title: "明天下午发送修改后的方案", dueAt: null, status: "pending" });
  });

  it("does not accept a quote from an event other than the cited one", () => {
    const { store } = setup();
    const first = evidence();
    const second = evidence("这是与待办无关的其他内容");
    const mixed = { ...first, text: first.text + "\n" + second.text, eventIds: [...first.eventIds, ...second.eventIds] };
    store.accept(proposal(mixed, { sourceEventIds: second.eventIds }), mixed);
    expect(store.snapshot("running").suggestions).toHaveLength(0);
  });

  it("does not treat event metadata, redaction markers, or removed text as reminder evidence", () => {
    const { store } = setup();
    for (const [kind, data, quote] of [
      ["mouse_click", {}, "mouse_click"],
      ["text_input", { details: { redacted: true } }, "textNotRetained"],
      ["application_changed", { ax: { mode: "diffFromPrevious", text: "- AXStaticText||我明天要发送修改方案|||" } }, "我明天要发送修改方案"],
    ] as const) {
      const input = buildProactiveEvidence([JSON.stringify({ sequence: 1, eventType: kind, timestamp: new Date(START).toISOString(), application: { name: "Chat" }, ...data })], { now: START });
      store.accept(proposal(input, { evidenceQuote: quote }), input);
    }
    expect(store.snapshot("running").suggestions).toHaveLength(0);
  });

  it("does not auto-present a stale now decision until new evidence renews it", () => {
    const { store, advance, clock } = setup();
    store.accept(proposal(), evidence());
    const id = store.snapshot("running").suggestions[0].id;
    advance(4 * 60_000);
    expect(() => store.action({ id, action: "shown" }, "running")).toThrow();
    const fresh = evidence("我明天下午把修改后的方案发给你", clock());
    store.accept(proposal(fresh), fresh);
    store.action({ id, action: "shown" }, "running");
    expect(store.snapshot("running").suggestions).toHaveLength(1);
  });

  it("retains a later candidate for reasoning without surfacing it on a timer", () => {
    const { store, advance } = setup();
    const input = evidence();
    store.accept(proposal(input, { decision: "later" }), input);
    advance(15 * 60_000);
    expect(store.snapshot("running").suggestions).toHaveLength(0);
    expect(store.context(input).deferred).toMatchObject({ title: "明天下午发送修改后的方案" });
  });

  it("claims presentation atomically and suppresses rephrased ignored evidence after restart", () => {
    const { store, file, clock } = setup();
    const input = evidence();
    store.accept(proposal(input), input);
    const id = store.snapshot("running").suggestions[0].id;
    store.action({ id, action: "shown" }, "running");
    expect(() => store.action({ id, action: "shown" }, "running")).toThrow(/再次显示/);
    store.action({ id, action: "dismiss" }, "running");
    const restarted = new ProactiveReminders(file, clock);
    restarted.accept(proposal(input, { title: "记得把方案交给对方" }), input);
    expect(restarted.snapshot("running").suggestions).toHaveLength(1);
    expect(restarted.context(input).recentSuggestions[0].status).toBe("dismissed");
  });

  it("allows snoozed suggestions only after the waiting period and expires old ones", () => {
    const { store, advance } = setup();
    store.accept(proposal(), evidence());
    const id = store.snapshot("running").suggestions[0].id;
    store.action({ id, action: "shown" }, "running");
    store.action({ id, action: "snooze" }, "running");
    advance(9 * 60_000);
    expect(() => store.action({ id, action: "shown" }, "running")).toThrow();
    advance(60_000);
    store.action({ id, action: "shown" }, "running");
    expect(store.snapshot("running").suggestions[0].status).toBe("pending");
    advance(51 * 60_000);
    expect(store.snapshot("running").suggestions[0].status).toBe("expired");
  });

  it("does not present while paused, stopped, disabled or when analysis arrived too late", () => {
    const { store, advance } = setup();
    const input = evidence();
    store.accept(proposal(input), input);
    const id = store.snapshot("running").suggestions[0].id;
    for (const state of ["paused", "stopped", "failed"]) expect(() => store.action({ id, action: "shown" }, state)).toThrow();
    store.setEnabled(false);
    expect(() => store.action({ id, action: "shown" }, "running")).toThrow();
    store.setEnabled(true);
    advance(6 * 60_000);
    store.accept(proposal(input, { title: "late" }), input);
    expect(store.snapshot("running").suggestions.filter((s) => s.status === "pending")).toHaveLength(0);
  });

  it("uses completed-action evidence to withdraw a still-pending suggestion", () => {
    const { store } = setup();
    store.accept(proposal(), evidence());
    const id = store.snapshot("running").suggestions[0].id;
    const done = evidence("修改后的方案已经发送完成了");
    store.accept({ decision: "none", resolvedSuggestionIds: [id], confidence: 0.96,
      evidenceQuote: "修改后的方案已经发送完成了", sourceEventIds: done.eventIds }, done);
    expect(store.snapshot("running").suggestions[0].status).toBe("expired");
  });

  it("saves only after a native receipt and preserves actual user edits on retry", () => {
    const { store } = setup();
    store.accept(proposal(), evidence());
    const id = store.snapshot("running").suggestions[0].id;
    expect(() => store.action({ id, action: "added" }, "running")).toThrow(/保存结果/);
    expect(store.snapshot("running").suggestions[0].status).toBe("pending");
    store.action({ id, action: "added", reminder_id: "native-id", title: "发送最终方案", due_at: "2026-09-12T07:00:00Z" }, "running");
    store.action({ id, action: "added", reminder_id: "native-id" }, "running");
    expect(store.snapshot("running").suggestions[0]).toMatchObject({ status: "added", title: "发送最终方案", reminderId: "native-id", dueAt: "2026-09-12T07:00:00.000Z" });
  });

  it("fails closed for corrupt persisted settings", () => {
    const { file, clock } = setup();
    fs.writeFileSync(file, "{broken");
    const store = new ProactiveReminders(file, clock);
    expect(store.snapshot("running")).toMatchObject({ enabled: false, suggestions: [], error: expect.any(String) });
  });
});
