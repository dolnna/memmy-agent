import { describe, expect, it, vi } from "vitest";
import { readRecapArchive, saveRecap, updateRecapMessages, type RecapEntry } from "./recap-archive.js";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

function makeEntry(id = "first", createdAt = "2026-09-09T12:00:00.000Z"): RecapEntry {
  return {
    id, createdAt,
    range: { startDate: "2026-09-01", endDate: "2026-09-09", label: "2026-09-01 — 2026-09-09" },
    body: "模型生成的完整原文。\n\n第二段仍保留。",
    messages: [{ id: "assistant-original", role: "assistant", content: "模型生成的完整原文。\n\n第二段仍保留。" }],
  };
}

describe("recap conversation archive", () => {
  it("retains each generation of the same period and sorts by generation time", () => {
    const storage = makeStorage();
    const first = makeEntry();
    const second = makeEntry("second", "2026-09-09T13:00:00.000Z");
    expect(readRecapArchive(storage, "preview:user")).toEqual({ ok: true, entries: [] });
    expect(saveRecap(storage, "preview:user", second)).toMatchObject({ ok: true });
    expect(saveRecap(storage, "preview:user", first)).toMatchObject({ ok: true });
    expect(readRecapArchive(storage, "preview:user")).toEqual({ ok: true, entries: [second, first] });
    expect(readRecapArchive(storage, "real:user")).toEqual({ ok: true, entries: [] });
    first.body = "caller mutation";
    const loaded = readRecapArchive(storage, "preview:user");
    if (!loaded.ok) throw new Error(loaded.error);
    loaded.entries[1]!.messages[0]!.content = "read mutation";
    expect(readRecapArchive(storage, "preview:user")).toEqual({ ok: true, entries: [second, makeEntry()] });
    const raw = storage.getItem("preview:user");
    expect(saveRecap(storage, "preview:user", second)).toMatchObject({ ok: false });
    expect(storage.getItem("preview:user")).toBe(raw);
  });

  it("saves discussion and draft while preserving original output and provenance", () => {
    const storage = makeStorage();
    const original = { ...makeEntry(), sourceRange: { startDate: "2026-09-03", endDate: "2026-09-09", label: "2026-09-03 — 2026-09-09" }, draft: "未发送草稿" };
    saveRecap(storage, "preview", original);
    const messages = [...original.messages, { id: "follow-up", role: "user" as const, content: "继续其中的设计。" }];
    expect(updateRecapMessages(storage, "preview", original.id, messages)).toMatchObject({ ok: true, entry: { ...original, messages } });
    expect(updateRecapMessages(storage, "preview", original.id, messages, "")).toMatchObject({ ok: true, entry: { ...original, messages, draft: "" } });
    expect(readRecapArchive(storage, "preview")).toEqual({ ok: true, entries: [{ ...original, messages, draft: "" }] });
    const raw = storage.getItem("preview");
    expect(updateRecapMessages(storage, "preview", "missing", messages)).toMatchObject({ ok: false });
    expect(storage.getItem("preview")).toBe(raw);
  });

  it("reports damaged archives and never overwrites them with a save or update", () => {
    const storage = makeStorage();
    for (const raw of ["{broken", "null", JSON.stringify({ version: 2, entries: [] }), JSON.stringify({ version: 1, entries: [makeEntry(), makeEntry()] }), JSON.stringify({ version: 1, entries: [{ ...makeEntry(), range: { ...makeEntry().range, startDate: "2026-02-30" } }] })]) {
      storage.setItem("preview", raw);
      storage.setItem.mockClear();
      expect(readRecapArchive(storage, "preview")).toMatchObject({ ok: false });
      expect(saveRecap(storage, "preview", makeEntry())).toMatchObject({ ok: false });
      expect(updateRecapMessages(storage, "preview", "first", [])).toMatchObject({ ok: false });
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem("preview")).toBe(raw);
    }
  });

  it("reports storage access and quota failures rather than success", () => {
    expect(readRecapArchive(undefined, "preview")).toMatchObject({ ok: false });
    expect(saveRecap(undefined, "preview", makeEntry())).toMatchObject({ ok: false });
    const write = vi.fn();
    const inaccessible = { getItem: () => { throw new Error("denied"); }, setItem: write };
    expect(saveRecap(inaccessible, "preview", makeEntry())).toMatchObject({ ok: false });
    expect(write).not.toHaveBeenCalled();
    expect(saveRecap({ getItem: () => null, setItem: () => { throw new Error("quota"); } }, "preview", makeEntry())).toMatchObject({ ok: false });
  });
});
