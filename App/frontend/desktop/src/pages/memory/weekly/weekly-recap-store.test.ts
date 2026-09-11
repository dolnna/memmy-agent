import { describe, expect, it, vi } from "vitest";
import { previewWeeklyReports } from "./weekly-preview-data.js";
import {
  isWeeklyReport,
  readSavedWeeklyRecap,
  readSavedWeeklyRecaps,
  saveWeeklyRecap,
} from "./weekly-recap-store.js";
import type { WeeklyReport } from "./weekly-types.js";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function makeReport() {
  return {
    ...structuredClone(previewWeeklyReports[0]!),
    body: "# 我的一周\n\n完整原文及后续建议。",
  };
}

describe("weekly recap persistence", () => {
  it("restores the full report after a new read with isolated snapshots and keys", () => {
    const storage = makeStorage();
    const report = makeReport();
    const saved = saveWeeklyRecap(storage, "preview:account-one", report);

    expect(saved).toMatchObject({ version: 1, report });
    expect(Number.isFinite(Date.parse(saved.savedAt))).toBe(true);
    expect(saved.report).not.toBe(report);
    expect(readSavedWeeklyRecap(storage, "preview:account-one")).toEqual(saved);
    expect(saved.report.sources).toEqual(report.sources);
    expect(saved.report.insights).toEqual(report.insights);
    expect(readSavedWeeklyRecap(storage, "real:account-one")).toBeNull();
    expect(readSavedWeeklyRecap(storage, "preview:account-two")).toBeNull();

    report.sources[0]!.excerpt = "caller mutation";
    saved.report.sources[0]!.excerpt = "returned snapshot mutation";
    const loaded = readSavedWeeklyRecap(storage, "preview:account-one")!;
    expect(loaded.report).toEqual(makeReport());
    loaded.report.insights[0]!.title = "read snapshot mutation";
    expect(
      readSavedWeeklyRecap(storage, "preview:account-one")!.report,
    ).toEqual(makeReport());

    const bodyOnlyReport = { ...makeReport(), insights: [] };
    saveWeeklyRecap(storage, "real:account-one", bodyOnlyReport);
    expect(readSavedWeeklyRecap(storage, "real:account-one")!.report).toEqual(
      bodyOnlyReport,
    );
  });

  it("treats absent, corrupt, unsupported and inconsistent snapshots as missing", () => {
    const storage = makeStorage();
    const report = makeReport();
    const saved = { version: 1, savedAt: "2026-09-09T12:00:00.000Z", report };
    const invalidReports = [
      { ...report, startDate: "2026-02-30" },
      { ...report, startDate: "2026-9-01" },
      { ...report, endDate: "2026-08-30" },
      { ...report, body: 42 },
      { ...report, insights: [], body: "  " },
      { ...report, insights: [], body: undefined },
      { ...report, insights: [report.insights[0], report.insights[0]] },
      { ...report, sources: [report.sources[0], report.sources[0]] },
      {
        ...report,
        sources: [{ ...report.sources[0], time: "2026-02-30T10:00:00Z" }],
      },
      {
        ...report,
        insights: [{ ...report.insights[0], sourceIds: ["missing"] }],
      },
      {
        ...report,
        insights: [
          {
            ...report.insights[0],
            sourceIds: [report.sources[0]!.id, report.sources[0]!.id],
          },
        ],
      },
    ];
    expect(readSavedWeeklyRecap(storage, "week")).toBeNull();
    for (const raw of [
      "{broken",
      "null",
      JSON.stringify({ ...saved, version: 2 }),
      JSON.stringify({ version: 2, recaps: [saved, saved] }),
      JSON.stringify({ version: 2, recaps: [saved, { ...saved, version: 3 }] }),
      JSON.stringify({ ...saved, savedAt: "yesterday" }),
      ...invalidReports.map((invalidReport) =>
        JSON.stringify({ ...saved, report: invalidReport }),
      ),
    ]) {
      storage.setItem("week", raw);
      expect(readSavedWeeklyRecap(storage, "week")).toBeNull();
      expect(readSavedWeeklyRecaps(storage, "week")).toEqual([]);
    }
    expect(isWeeklyReport(previewWeeklyReports[0])).toBe(true);
    expect(isWeeklyReport(report)).toBe(true);
  });

  it("returns no cache when storage reads are unavailable", () => {
    expect(readSavedWeeklyRecap(undefined, "week")).toBeNull();
    expect(
      readSavedWeeklyRecap(
        {
          getItem: () => {
            throw new Error("Access denied");
          },
        },
        "week",
      ),
    ).toBeNull();
  });

  it("throws a readable error instead of reporting success when saving fails", () => {
    const report = makeReport();
    expect(() => saveWeeklyRecap(undefined, "week", report)).toThrow(
      "尚未保存",
    );
    const setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveWeeklyRecap({ getItem: () => null, setItem }, "week", report)).toThrow(
      "尚未保存",
    );
    expect(setItem).toHaveBeenCalledOnce();

    const storage = makeStorage();
    const previous = saveWeeklyRecap(storage, "week", report);
    expect(() =>
      saveWeeklyRecap(storage, "week", {
        ...report,
        sources: [],
      } as WeeklyReport),
    ).toThrow("格式不正确");
    expect(readSavedWeeklyRecap(storage, "week")).toEqual(previous);

    const inaccessibleWrite = vi.fn();
    expect(() => saveWeeklyRecap({
      getItem: () => { throw new Error("Access denied"); },
      setItem: inaccessibleWrite,
    }, "week", report)).toThrow("尚未保存");
    expect(inaccessibleWrite).not.toHaveBeenCalled();
    storage.setItem("week", "{broken archive");
    expect(() => saveWeeklyRecap(storage, "week", report)).toThrow("尚未保存");
    expect(storage.getItem("week")).toBe("{broken archive");
  });

  it("reads a legacy snapshot and retains it when migrating on the next save", () => {
    const storage = makeStorage();
    const legacy = {
      version: 1,
      report: makeReport(),
      savedAt: "2026-09-07T12:00:00.000Z",
    };
    const original = JSON.stringify(legacy);
    storage.setItem("week", original);
    expect(readSavedWeeklyRecaps(storage, "week")).toEqual([legacy]);
    expect(readSavedWeeklyRecap(storage, "week")).toEqual(legacy);
    expect(storage.getItem("week")).toBe(original);

    const next = saveWeeklyRecap(storage, "week", {
      ...makeReport(),
      id: "next-week",
      startDate: "2026-09-07",
      endDate: "2026-09-13",
      insights: [],
      body: "下一周的完整回顾。",
    });
    expect(JSON.parse(storage.getItem("week")!)).toEqual({
      version: 2,
      recaps: [next, legacy],
    });
  });

  it("keeps every week and returns newest first regardless of save order", () => {
    const storage = makeStorage();
    const middle = saveWeeklyRecap(storage, "week", makeReport());
    const newest = saveWeeklyRecap(storage, "week", {
      ...makeReport(),
      id: "newest-week",
      startDate: "2026-09-07",
      endDate: "2026-09-13",
    });
    const oldest = saveWeeklyRecap(storage, "week", {
      ...makeReport(),
      id: "oldest-week",
      startDate: "2026-08-24",
      endDate: "2026-08-30",
    });
    expect(readSavedWeeklyRecaps(storage, "week")).toEqual([newest, middle, oldest]);
    expect(readSavedWeeklyRecap(storage, "week")).toEqual(newest);
    expect(JSON.parse(storage.getItem("week")!)).toEqual({
      version: 2,
      recaps: [newest, middle, oldest],
    });
  });

  it("returns the first snapshot for the same dates without overwriting it", () => {
    const storage = makeStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const original = saveWeeklyRecap(storage, "week", makeReport());
    const raw = storage.getItem("week");
    const repeated = saveWeeklyRecap(storage, "week", {
      ...makeReport(),
      id: "a-different-report-id-for-the-same-week",
      body: "同一期的新内容，不应覆盖已保存回顾。",
      insights: [],
      sources: [],
    });
    expect(repeated).toEqual(original);
    expect(repeated).not.toBe(original);
    expect(setItem).toHaveBeenCalledOnce();
    expect(storage.getItem("week")).toBe(raw);
    expect(readSavedWeeklyRecaps(storage, "week")).toEqual([original]);
  });
});
