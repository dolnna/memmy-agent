/** In-memory task workspace for the labor-diagnostic PoC. */

import type {
  WorkspaceFileEntry,
  WorkspaceFilesListing
} from "../api/memmy-agent-client.js";
import type { WorkspacePreviewContent } from "../components/workspace-preview-pane.js";
import {
  LEGAL_DIAG_REPORT_PREVIEW,
  LEGAL_DIAG_WORKSHEET_PREVIEW
} from "./labor-diagnostic-demo-data.js";

export const LEGAL_DIAG_RECORDING_TAB_ID = "views/访谈录音";
export const LEGAL_DIAG_RECORDING_PATH = "recordings/访谈录音.m4a";
export const LEGAL_DIAG_TRANSCRIPT_PATH = "transcripts/访谈转写.txt";
export const LEGAL_DIAG_WORKSHEET_PATH = "diagnostics/用工合规及风险诊断表.xlsx";
export const LEGAL_DIAG_REPORT_PATH = "reports/用工风险与合规诊断报告.docx";

const ROOT_LABEL = "用工风险诊断";
export const LEGAL_DIAG_ROOT_DIRECTORIES = ["recordings", "materials", "transcripts", "diagnostics", "reports"] as const;
const TEXT_PREVIEW_EXTENSIONS = new Set(["txt", "md", "csv", "json"]);
const MATERIAL_PREVIEW_LIMIT = 12_000;

export interface LegalDiagSourceItem {
  id: string;
  label: string;
  relativePath: string;
  file: File;
  totalBytes: number;
  lastModified: number;
}

export interface LegalDiagWorkspaceState {
  recordings: LegalDiagRecordingSource[];
  transcript: string;
  materials: LegalDiagSourceItem[];
  outputsReady: boolean;
}

export interface LegalDiagRecordingSource {
  id: string;
  name: string;
  size: number;
  modifiedAt?: string | null;
}

export function legalRecordingSourcePath(recording: Pick<LegalDiagRecordingSource, "id">): string {
  return `recordings/${recording.id}`;
}

function file(name: string, path: string, size: number, modifiedAt: string | null = null): WorkspaceFileEntry {
  return { name, path, kind: "file", size, modifiedAt };
}

function directory(name: string, path: string): WorkspaceFileEntry {
  return { name, path, kind: "directory", size: null, modifiedAt: null };
}

function listing(path: string, entries: WorkspaceFileEntry[]): WorkspaceFilesListing {
  return {
    root: { kind: "task", label: ROOT_LABEL },
    path,
    entries,
    truncated: false
  };
}

export function mergeLegalDiagWorkspaceListing(
  rootLabel: string,
  projectListing: WorkspaceFilesListing | null,
  legalListing: WorkspaceFilesListing
): WorkspaceFilesListing {
  const entries = new Map<string, WorkspaceFileEntry>();
  for (const entry of projectListing?.entries ?? []) entries.set(entry.path, entry);
  for (const entry of legalListing.entries) entries.set(entry.path, entry);
  const ordered = [...entries.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
  return {
    root: { kind: "project", label: rootLabel },
    path: projectListing?.path ?? legalListing.path,
    entries: ordered,
    truncated: Boolean(projectListing?.truncated || legalListing.truncated)
  };
}

/** Normalizes one browser-provided relative path without allowing it to escape materials/. */
export function normalizeLegalMaterialPath(path: string): string {
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
}

export function legalMaterialWorkspacePath(item: Pick<LegalDiagSourceItem, "relativePath" | "file">): string {
  const relativePath = normalizeLegalMaterialPath(item.relativePath || item.file.name);
  return `materials/${relativePath || item.file.name}`;
}

function materialDirectoryEntries(relativePath: string, materials: LegalDiagSourceItem[]): WorkspaceFileEntry[] {
  const materialPrefix = relativePath === "materials"
    ? ""
    : `${relativePath.slice("materials/".length).replace(/\/+$/, "")}/`;
  const directories = new Map<string, WorkspaceFileEntry>();
  const files = new Map<string, WorkspaceFileEntry>();

  for (const material of materials) {
    const normalized = normalizeLegalMaterialPath(material.relativePath || material.file.name);
    if (!normalized.startsWith(materialPrefix)) continue;
    const remainder = normalized.slice(materialPrefix.length);
    if (!remainder) continue;
    const separator = remainder.indexOf("/");
    if (separator >= 0) {
      const name = remainder.slice(0, separator);
      const path = `${relativePath}/${name}`;
      directories.set(path, directory(name, path));
      continue;
    }
    const path = `${relativePath}/${remainder}`;
    files.set(path, file(
      remainder,
      path,
      material.totalBytes,
      material.lastModified > 0 ? new Date(material.lastModified).toISOString() : null
    ));
  }

  return [
    ...[...directories.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    ...[...files.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  ];
}

/** Builds one lazy directory level for the current diagnostic task. */
export function buildLegalDiagWorkspaceListing(
  relativePath: string,
  state: LegalDiagWorkspaceState
): WorkspaceFilesListing {
  if (!relativePath) {
    return listing("", LEGAL_DIAG_ROOT_DIRECTORIES.map((name) => directory(name, name)));
  }
  if (relativePath === "recordings") {
    return listing(relativePath, state.recordings.map((recording) => file(
      recording.name,
      legalRecordingSourcePath(recording),
      recording.size,
      recording.modifiedAt ?? null
    )));
  }
  if (relativePath === "transcripts") {
    return listing(relativePath, state.transcript.trim()
      ? [file("访谈转写.txt", LEGAL_DIAG_TRANSCRIPT_PATH, new Blob([state.transcript]).size)]
      : []);
  }
  if (relativePath === "materials" || relativePath.startsWith("materials/")) {
    return listing(relativePath, materialDirectoryEntries(relativePath, state.materials));
  }
  if (relativePath === "diagnostics") {
    return listing(relativePath, state.outputsReady
      ? [file("用工合规及风险诊断表.xlsx", LEGAL_DIAG_WORKSHEET_PATH, 6_800)]
      : []);
  }
  if (relativePath === "reports") {
    return listing(relativePath, state.outputsReady
      ? [file("用工风险与合规诊断报告.docx", LEGAL_DIAG_REPORT_PATH, 4_200)]
      : []);
  }
  return listing(relativePath, []);
}

export function findLegalDiagMaterial(
  path: string,
  materials: LegalDiagSourceItem[]
): LegalDiagSourceItem | undefined {
  return materials.find((material) => legalMaterialWorkspacePath(material) === path);
}

/** Loads the renderer-safe preview for a task artifact or uploaded material. */
export async function loadLegalDiagWorkspacePreview(
  path: string,
  state: LegalDiagWorkspaceState
): Promise<WorkspacePreviewContent | null> {
  if (path === LEGAL_DIAG_RECORDING_TAB_ID) return null;
  if (path === LEGAL_DIAG_RECORDING_PATH) {
    const recording = state.recordings[0];
    return {
      title: "访谈录音.m4a",
      sections: [{
        heading: "原始录音",
        body: recording
          ? `${formatWorkspaceFileSize(recording.size)} · 源文件已保留，可用于回听和定位转写时间戳`
          : "访谈原始录音文件已作为诊断产物保留，可用于回听和定位转写时间戳。"
      }]
    };
  }
  const recording = state.recordings.find((candidate) => legalRecordingSourcePath(candidate) === path);
  if (recording) {
    return {
      title: recording.name,
      sections: [{ heading: "原始录音", body: `${formatWorkspaceFileSize(recording.size)} · 源文件已保留` }]
    };
  }
  if (path === LEGAL_DIAG_TRANSCRIPT_PATH) {
    return {
      title: "访谈转写",
      sections: [{ heading: "自动转写", body: state.transcript.trim() }]
    };
  }
  if (path === LEGAL_DIAG_WORKSHEET_PATH) return LEGAL_DIAG_WORKSHEET_PREVIEW;
  if (path === LEGAL_DIAG_REPORT_PATH) return LEGAL_DIAG_REPORT_PREVIEW;

  const material = findLegalDiagMaterial(path, state.materials);
  if (!material) return null;
  const extension = material.file.name.split(".").pop()?.toLowerCase() ?? "";
  const metadata = `${formatWorkspaceFileSize(material.totalBytes)} · 已纳入本次诊断`;
  if (!TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return {
      title: material.file.name,
      sections: [
        { heading: "补充材料", body: metadata },
        { heading: "文件预览", body: "原文件已保留在当前任务中，可继续用于诊断和报告生成。" }
      ]
    };
  }

  const text = await material.file.text();
  const body = text.length > MATERIAL_PREVIEW_LIMIT
    ? `${text.slice(0, MATERIAL_PREVIEW_LIMIT)}\n\n…内容较长，预览已截断`
    : text;
  return {
    title: material.file.name,
    sections: [
      { heading: "补充材料", body: metadata },
      { heading: "内容", body: body || "文件内容为空" }
    ]
  };
}

function formatWorkspaceFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
