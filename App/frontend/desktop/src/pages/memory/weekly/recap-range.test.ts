import { describe, expect, it } from "vitest";
import { parseRecapRange } from "./recap-range.js";

const now = new Date(2026, 8, 9, 0, 15);

describe("recap date range", () => {
  it("resolves suggestions and rolling ranges in local calendar days, including today", () => {
    for (const [text, startDate, endDate] of [
      ["今日", "2026-09-09", "2026-09-09"],
      ["今天", "2026-09-09", "2026-09-09"],
      ["昨日", "2026-09-08", "2026-09-08"],
      ["昨天", "2026-09-08", "2026-09-08"],
      ["本周", "2026-09-07", "2026-09-09"],
      ["本月", "2026-09-01", "2026-09-09"],
      ["最近 7 天", "2026-09-03", "2026-09-09"],
      ["最近2周", "2026-08-27", "2026-09-09"],
    ]) {
      expect(parseRecapRange(text!, now)).toMatchObject({ ok: true, range: { startDate, endDate }, truncated: false });
    }
  });

  it("handles year rollover, leap days and weeks starting on Monday", () => {
    expect(parseRecapRange("本周", new Date(2027, 0, 1))).toMatchObject({ ok: true, range: { startDate: "2026-12-28", endDate: "2027-01-01" } });
    expect(parseRecapRange("昨日", new Date(2027, 0, 1))).toMatchObject({ ok: true, range: { startDate: "2026-12-31", endDate: "2026-12-31" } });
    expect(parseRecapRange("本周", new Date(2026, 8, 7))).toMatchObject({ ok: true, range: { startDate: "2026-09-07", endDate: "2026-09-07" } });
    expect(parseRecapRange("本周", new Date(2026, 8, 13))).toMatchObject({ ok: true, range: { startDate: "2026-09-07", endDate: "2026-09-13" } });
    expect(parseRecapRange("昨日", new Date(2024, 2, 1))).toMatchObject({ ok: true, range: { startDate: "2024-02-29", endDate: "2024-02-29" } });
  });

  it("accepts explicit periods and caps a future endpoint at today", () => {
    expect(parseRecapRange("9月1日 到 9月30日", now)).toEqual({
      ok: true, range: { startDate: "2026-09-01", endDate: "2026-09-09", label: "2026-09-01 — 2026-09-09" }, truncated: true,
    });
    expect(parseRecapRange("2025-12-29到2026-01-03", now)).toMatchObject({ ok: true, range: { startDate: "2025-12-29", endDate: "2026-01-03" } });
    expect(parseRecapRange("2024-02-29", now)).toMatchObject({ ok: true, range: { startDate: "2024-02-29", endDate: "2024-02-29" } });
  });

  it("rejects impossible, reversed, ambiguous, future-start and invalid rolling periods", () => {
    for (const input of ["", "最近", "上次那个项目", "9/1-9/9", "最近0天", "最近1.5周", "最近999999999999999999天", "2026-02-29到2026-03-01", "2月30日到3月1日", "2026-09-07到2026-09-06", "12月29日到1月3日", "9月10日到9月30日", "0000-01-01到2026-01-01"]) {
      expect(parseRecapRange(input, now), input).toMatchObject({ ok: false, error: expect.any(String) });
    }
    expect(parseRecapRange("今日", new Date("invalid"))).toMatchObject({ ok: false });
  });
});
