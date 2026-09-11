import { isRecapDate, type RecapRange } from "./recap-range.js";

export interface RecapMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface RecapEntry {
  /** Use the conversation id; every generation gets a new id, even for the same range. */
  id: string;
  range: RecapRange;
  createdAt: string;
  /** The original assistant output is preserved independently of later discussion. */
  body: string;
  messages: RecapMessage[];
  /** Exact generation prompt shown to the user before this run. */
  generationPrompt?: string;
  draft?: string;
  /** Preview-only provenance when a saved sample differs from the chosen range. */
  sourceRange?: RecapRange;
}

type ArchiveFailure = { ok: false; error: string };
export type RecapArchiveResult = { ok: true; entries: RecapEntry[] } | ArchiveFailure;
export type RecapSaveResult = { ok: true; entries: RecapEntry[]; entry: RecapEntry } | ArchiveFailure;
type ReadStorage = Pick<Storage, "getItem"> | undefined;
type WriteStorage = Pick<Storage, "getItem" | "setItem"> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return match !== null && isRecapDate(match[1]) && Number.isFinite(Date.parse(value));
}

function isMessages(value: unknown): value is RecapMessage[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((message: unknown) => {
    if (!isRecord(message) || !hasText(message.id) || ids.has(message.id) ||
      (message.role !== "user" && message.role !== "assistant") || !hasText(message.content)) return false;
    ids.add(message.id);
    return true;
  });
}

function isRange(value: unknown): value is RecapRange {
  return isRecord(value) && isRecapDate(value.startDate) && isRecapDate(value.endDate) &&
    value.startDate <= value.endDate && hasText(value.label);
}

function isEntry(value: unknown): value is RecapEntry {
  return isRecord(value) && hasText(value.id) && isRange(value.range) &&
    isTimestamp(value.createdAt) && hasText(value.body) && isMessages(value.messages) &&
    (value.generationPrompt === undefined || hasText(value.generationPrompt)) &&
    (value.draft === undefined || typeof value.draft === "string") &&
    (value.sourceRange === undefined || isRange(value.sourceRange));
}

function sortEntries(entries: RecapEntry[]): RecapEntry[] {
  return entries.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

/** Keys must be scoped by account and preview/real-data mode by the caller. */
export function readRecapArchive(storage: ReadStorage, key: string): RecapArchiveResult {
  if (!storage) return { ok: false, error: "本地存储不可用，暂时无法读取历史回顾。" };
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false, error: "无法读取历史回顾，请检查浏览器的存储权限。" };
  }
  if (raw === null) return { ok: true, entries: [] };
  try {
    const archive: unknown = JSON.parse(raw);
    if (!isRecord(archive) || archive.version !== 1 || !Array.isArray(archive.entries) ||
      !archive.entries.every(isEntry) || new Set(archive.entries.map((entry: RecapEntry) => entry.id)).size !== archive.entries.length) {
      throw new Error("Invalid recap archive");
    }
    return { ok: true, entries: sortEntries(archive.entries) };
  } catch {
    return { ok: false, error: "历史回顾数据无法解析。为保护已有内容，暂时无法保存新的回顾。" };
  }
}

function writeEntries(storage: WriteStorage, key: string, entries: RecapEntry[], id: string): RecapSaveResult {
  if (!storage) return { ok: false, error: "本地存储不可用，回顾尚未保存。" };
  try {
    const serialized = JSON.stringify({ version: 1, entries: sortEntries(entries) });
    // Return detached snapshots, so caller edits cannot mutate the saved result.
    const snapshot = JSON.parse(serialized) as { version: 1; entries: RecapEntry[] };
    const entry = snapshot.entries.find((item) => item.id === id)!;
    storage.setItem(key, serialized);
    return { ok: true, entries: snapshot.entries, entry };
  } catch {
    return { ok: false, error: "回顾尚未保存，请检查存储空间或浏览器权限后重试。" };
  }
}

/** Append a generation without overwriting either the same range or the same id. */
export function saveRecap(storage: WriteStorage, key: string, entry: RecapEntry): RecapSaveResult {
  if (!isEntry(entry)) return { ok: false, error: "回顾内容不完整或格式不正确，尚未保存。" };
  const previous = readRecapArchive(storage, key);
  if (!previous.ok) return previous;
  if (previous.entries.some((item) => item.id === entry.id)) {
    return { ok: false, error: "这条回顾已经保存；重新生成需要创建新的对话。" };
  }
  return writeEntries(storage, key, [...previous.entries, entry], entry.id);
}

/** Only discussion changes; original output, range and generation time stay intact. */
export function updateRecapMessages(storage: WriteStorage, key: string, id: string, messages: RecapMessage[], draft?: string): RecapSaveResult {
  if (!isMessages(messages) || (draft !== undefined && typeof draft !== "string")) return { ok: false, error: "对话内容格式不正确，尚未保存。" };
  const previous = readRecapArchive(storage, key);
  if (!previous.ok) return previous;
  if (!previous.entries.some((entry) => entry.id === id)) return { ok: false, error: "没有找到这条回顾，无法保存对话。" };
  return writeEntries(storage, key, previous.entries.map((entry) => entry.id === id ? {
    ...entry, messages, ...(draft === undefined ? {} : { draft }),
  } : entry), id);
}
