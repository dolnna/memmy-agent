import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listWorkspaceFiles,
  WorkspaceFilesError,
} from "../../../src/entrypoints/frontend-bridge/workspace-files.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-workspace-files-"));
  roots.push(root);
  return fs.realpathSync(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace files", () => {
  it("lists one directory level and sorts folders first", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "README.md"), "hello", "utf8");
    const listing = listWorkspaceFiles(root, { rootKind: "project", rootLabel: "Memmy" });
    expect(listing.root).toEqual({ kind: "project", label: "Memmy" });
    expect(listing.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["src", "directory"],
      ["README.md", "file"],
    ]);
  });

  it("loads a nested directory lazily and reports truncation", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "a", "utf8");
    fs.writeFileSync(path.join(root, "src", "b.ts"), "b", "utf8");
    const listing = listWorkspaceFiles(root, {
      rootKind: "task",
      rootLabel: "task-1",
      relativePath: "src",
      maxEntries: 2,
    });
    expect(listing.entries.map((entry) => entry.path)).toEqual(["src/nested", "src/a.ts"]);
    expect(listing.truncated).toBe(true);
  });

  it.each(["../secret", "src/../secret", "/etc", "C:/Windows", "src\\nested", "bad\0path"])(
    "rejects unsafe relative path %s",
    (relativePath) => {
      const root = makeRoot();
      expect(() => listWorkspaceFiles(root, {
        rootKind: "task",
        rootLabel: "task",
        relativePath,
      })).toThrowError(expect.objectContaining<Partial<WorkspaceFilesError>>({
        code: "workspace_files_path_invalid",
        status: 400,
      }));
    },
  );

  it.skipIf(process.platform === "win32")("does not expose symlinks", () => {
    const root = makeRoot();
    const outside = makeRoot();
    fs.symlinkSync(outside, path.join(root, "linked"));
    expect(listWorkspaceFiles(root, { rootKind: "task", rootLabel: "task" }).entries)
      .not.toContainEqual(expect.objectContaining({ name: "linked" }));
  });
});
