import { describe, expect, it } from "vitest";
import {
  LEGAL_DIAG_REPORT_PATH,
  LEGAL_DIAG_TRANSCRIPT_PATH,
  buildLegalDiagWorkspaceListing,
  legalMaterialWorkspacePath,
  loadLegalDiagWorkspacePreview,
  mergeLegalDiagWorkspaceListing,
  type LegalDiagSourceItem,
  type LegalDiagWorkspaceState
} from "../labor-diagnostic-workspace.js";

function material(relativePath: string, contents = "内容"): LegalDiagSourceItem {
  const fileName = relativePath.split("/").pop()!;
  const file = new File([contents], fileName, { type: "text/plain", lastModified: 1234 });
  return {
    id: `${relativePath}:${file.size}`,
    label: relativePath,
    relativePath,
    file,
    totalBytes: file.size,
    lastModified: file.lastModified
  };
}

function workspace(overrides: Partial<LegalDiagWorkspaceState> = {}): LegalDiagWorkspaceState {
  return {
    recordings: [],
    transcript: "",
    materials: [],
    outputsReady: false,
    ...overrides
  };
}

describe("labor diagnostic task workspace", () => {
  it("keeps the complete file tree visible even when its folders are empty", () => {
    const root = buildLegalDiagWorkspaceListing("", workspace());
    expect(root.root).toEqual({ kind: "task", label: "用工风险诊断" });
    expect(root.entries.map((entry) => entry.name)).toEqual([
      "recordings",
      "materials",
      "transcripts",
      "reports"
    ]);
    expect(buildLegalDiagWorkspaceListing("reports", workspace()).entries).toEqual([]);
  });

  it("merges the real project root with virtual diagnostic folders without opening a file", () => {
    const legal = buildLegalDiagWorkspaceListing("", workspace());
    const merged = mergeLegalDiagWorkspaceListing("memmy-agent", {
      root: { kind: "project", label: "memmy-agent" },
      path: "",
      truncated: false,
      entries: [
        { name: ".git", path: ".git", kind: "directory", size: null, modifiedAt: null },
        { name: "App", path: "App", kind: "directory", size: null, modifiedAt: null },
        { name: "README.md", path: "README.md", kind: "file", size: 10, modifiedAt: null }
      ]
    }, legal);

    expect(merged.root).toEqual({ kind: "project", label: "memmy-agent" });
    expect(merged.entries.map((entry) => entry.name)).toEqual([
      ".git",
      "App",
      "materials",
      "recordings",
      "reports",
      "transcripts",
      "README.md"
    ]);
  });

  it("keeps the transcript as a reopenable task file", async () => {
    const state = workspace({
      transcript: "发言人 1  00:00\n已核对劳动合同。\n\n发言人 2  00:12\n还需补充考勤记录。"
    });
    expect(buildLegalDiagWorkspaceListing("transcripts", state).entries[0]?.path).toBe(LEGAL_DIAG_TRANSCRIPT_PATH);
    const preview = await loadLegalDiagWorkspacePreview(LEGAL_DIAG_TRANSCRIPT_PATH, state);
    expect(preview?.sections[0]?.body).toContain("已核对劳动合同");
    expect(preview?.sections[0]?.body).toContain("发言人 2");
  });

  it("keeps completed recording source files in recordings", () => {
    const state = workspace({
      recordings: [{ id: "interview-1", name: "现场访谈录音.m4a", size: 4096 }]
    });
    expect(buildLegalDiagWorkspaceListing("recordings", state).entries).toEqual([{
      name: "现场访谈录音.m4a",
      path: "recordings/interview-1",
      kind: "file",
      size: 4096,
      modifiedAt: null
    }]);
  });

  it("preserves uploaded folder hierarchy under materials", async () => {
    const handbook = material("HR资料/制度/员工手册.md", "员工手册正文");
    const contract = material("HR资料/合同模板.docx");
    const note = material("律师记录.txt", "律师现场记录");
    const state = workspace({ materials: [handbook, contract, note] });

    expect(buildLegalDiagWorkspaceListing("materials", state).entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ["directory", "HR资料"],
      ["file", "律师记录.txt"]
    ]);
    expect(buildLegalDiagWorkspaceListing("materials/HR资料", state).entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ["directory", "制度"],
      ["file", "合同模板.docx"]
    ]);
    expect(buildLegalDiagWorkspaceListing("materials/HR资料/制度", state).entries[0]?.name).toBe("员工手册.md");
    expect(legalMaterialWorkspacePath(handbook)).toBe("materials/HR资料/制度/员工手册.md");
    const preview = await loadLegalDiagWorkspacePreview(legalMaterialWorkspacePath(handbook), state);
    expect(preview?.sections[1]?.body).toBe("员工手册正文");
  });

  it("adds only the Word report after generation and does not produce a diagnostic workbook", async () => {
    const state = workspace({ outputsReady: true });
    expect(buildLegalDiagWorkspaceListing("diagnostics", state).entries).toEqual([]);
    expect(await loadLegalDiagWorkspacePreview("diagnostics/用工合规及风险诊断表.xlsx", state)).toBeNull();
    expect(buildLegalDiagWorkspaceListing("reports", state).entries).toHaveLength(1);
    expect(buildLegalDiagWorkspaceListing("reports", state).entries[0]?.path).toBe(LEGAL_DIAG_REPORT_PATH);
    expect(LEGAL_DIAG_REPORT_PATH).toBe("reports/用工风险诊断报告.docx");
  });
});
