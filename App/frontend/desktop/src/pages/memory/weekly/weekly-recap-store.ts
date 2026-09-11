import type { WeeklyReport } from "./weekly-types.js";

export interface SavedWeeklyRecap {
  version: 1;
  report: WeeklyReport;
  savedAt: string;
}

interface SavedWeeklyRecapArchive {
  version: 2;
  recaps: SavedWeeklyRecap[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  return (
    match !== null && isDate(match[1]) && Number.isFinite(Date.parse(value))
  );
}

/** Validate the complete snapshot before trusting persisted or generated data. */
export function isWeeklyReport(value: unknown): value is WeeklyReport {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    !isDate(value.startDate) ||
    !isDate(value.endDate) ||
    value.startDate > value.endDate ||
    (value.body !== undefined && typeof value.body !== "string") ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.insights) ||
    (value.insights.length === 0 &&
      (typeof value.body !== "string" || value.body.trim().length === 0))
  )
    return false;

  const sourceIds = new Set<string>();
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      !isId(source.id) ||
      sourceIds.has(source.id) ||
      typeof source.app !== "string" ||
      typeof source.title !== "string" ||
      !isTimestamp(source.time) ||
      typeof source.excerpt !== "string"
    )
      return false;
    sourceIds.add(source.id);
  }

  const insightIds = new Set<string>();
  for (const insight of value.insights) {
    if (
      !isRecord(insight) ||
      !isId(insight.id) ||
      insightIds.has(insight.id) ||
      typeof insight.label !== "string" ||
      typeof insight.title !== "string" ||
      typeof insight.body !== "string" ||
      typeof insight.prompt !== "string" ||
      !Array.isArray(insight.sourceIds) ||
      !insight.sourceIds.every(
        (id: unknown) => isId(id) && sourceIds.has(id),
      ) ||
      new Set(insight.sourceIds).size !== insight.sourceIds.length
    )
      return false;
    insightIds.add(insight.id);
  }
  return true;
}

function isSavedWeeklyRecap(value: unknown): value is SavedWeeklyRecap {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isTimestamp(value.savedAt) &&
    isWeeklyReport(value.report)
  );
}

function periodKey(report: WeeklyReport): string {
  return `${report.startDate}/${report.endDate}`;
}

function sortRecaps(recaps: SavedWeeklyRecap[]): SavedWeeklyRecap[] {
  return recaps.sort((left, right) =>
    right.report.endDate.localeCompare(left.report.endDate) ||
    right.report.startDate.localeCompare(left.report.startDate),
  );
}

function parseSavedWeeklyRecaps(raw: string | null): SavedWeeklyRecap[] {
  if (raw === null) return [];
  const saved: unknown = JSON.parse(raw);
  if (isSavedWeeklyRecap(saved)) return [saved];
  if (
    !isRecord(saved) || saved.version !== 2 ||
    !Array.isArray(saved.recaps) || !saved.recaps.every(isSavedWeeklyRecap)
  ) throw new Error("回顾存档格式不正确。");
  const periods = saved.recaps.map((recap) => periodKey(recap.report));
  if (new Set(periods).size !== periods.length)
    throw new Error("回顾存档包含重复周次。");
  return sortRecaps(saved.recaps);
}

/** The caller owns the key, including account and preview/real-data scope. */
export function readSavedWeeklyRecaps(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
): SavedWeeklyRecap[] {
  try {
    return parseSavedWeeklyRecaps(storage?.getItem(key) ?? null);
  } catch {
    return [];
  }
}

/** Compatibility helper for callers that only display the latest saved week. */
export function readSavedWeeklyRecap(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
): SavedWeeklyRecap | null {
  return readSavedWeeklyRecaps(storage, key)[0] ?? null;
}

/** Preserve each week's first snapshot and append new weeks to the archive. */
export function saveWeeklyRecap(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  key: string,
  report: WeeklyReport,
): SavedWeeklyRecap {
  if (!storage) throw new Error("回顾尚未保存：此设备的本地存储不可用。");
  if (!isWeeklyReport(report))
    throw new Error("回顾尚未保存：报告内容不完整或格式不正确。");

  try {
    // Do not replace an archive when reading it fails or its schema is damaged.
    const existing = parseSavedWeeklyRecaps(storage.getItem(key));
    const period = periodKey(report);
    const previous = existing.find((recap) => periodKey(recap.report) === period);
    if (previous) return previous;
    const recap: SavedWeeklyRecap = {
      version: 1,
      report,
      savedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify({
      version: 2,
      recaps: sortRecaps([...existing, recap]),
    } satisfies SavedWeeklyRecapArchive);
    const snapshots = parseSavedWeeklyRecaps(serialized);
    const saved = snapshots.find((item) => periodKey(item.report) === period);
    if (!saved) throw new Error("报告快照格式不正确。");
    storage.setItem(key, serialized);
    return saved;
  } catch (cause) {
    throw new Error("回顾尚未保存：请检查本地存储空间或浏览器权限后重试。", {
      cause,
    });
  }
}
