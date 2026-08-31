// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import type { WorkspaceFilesListing } from "../../api/memmy-agent-client.js";
import {
  WorkspacePreviewPane,
  resolveWorkspaceFileBrowserMaxWidth,
  resolveWorkspacePreviewMaxWidth,
} from "../workspace-preview-pane.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function listing(path: string): WorkspaceFilesListing {
  return {
    root: { kind: "project", label: "法律项目" },
    path,
    truncated: false,
    entries: path === "reports" ? [{
      name: "诊断报告.md",
      path: "reports/诊断报告.md",
      kind: "file",
      size: 10,
      modifiedAt: null,
    }] : [
      { name: "访谈转写.txt", path: "访谈转写.txt", kind: "file", size: 8, modifiedAt: null },
      { name: "reports", path: "reports", kind: "directory", size: null, modifiedAt: null },
    ],
  };
}

describe("WorkspacePreviewPane", () => {
  let container: HTMLDivElement;
  let root: Root;
  const loadDirectory = vi.fn(async (_sessionKey: string, path: string) => listing(path));
  const loadPreview = vi.fn(async (path: string) => ({
    title: path.split("/").pop()!,
    sections: [{ heading: "预览", body: path }],
  }));

  beforeEach(async () => {
    window.localStorage.clear();
    loadDirectory.mockClear();
    loadPreview.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkspacePreviewPane
            sessionKey="websocket:legal"
            rootLabel="法律项目"
            loadDirectory={loadDirectory}
            loadPreview={loadPreview}
          />
        </I18nProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("keeps enough width for the conversation and preview document", () => {
    expect(resolveWorkspacePreviewMaxWidth(720)).toBe(360);
    expect(resolveWorkspacePreviewMaxWidth(850)).toBe(490);
    expect(resolveWorkspacePreviewMaxWidth(1140)).toBe(780);
    expect(resolveWorkspaceFileBrowserMaxWidth(360)).toBe(160);
    expect(resolveWorkspaceFileBrowserMaxWidth(470)).toBe(270);
    expect(resolveWorkspaceFileBrowserMaxWidth(760)).toBe(560);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("loads the session root and previews its first file", () => {
    expect(loadDirectory).toHaveBeenCalledWith("websocket:legal", "");
    expect(container.querySelector(".litrev-preview-crumb")?.textContent).toContain("法律项目");
    expect(container.querySelector(".litrev-file-tab--active")?.textContent).toContain("访谈转写.txt");
  });

  it("loads folders lazily and opens files in tabs", async () => {
    const folder = container.querySelector<HTMLButtonElement>(".litrev-file-folder__toggle")!;
    await act(async () => {
      folder.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadDirectory).toHaveBeenCalledWith("websocket:legal", "reports");
    const report = [...container.querySelectorAll<HTMLButtonElement>("button.litrev-file-item")]
      .find((button) => button.textContent?.includes("诊断报告.md"))!;
    await act(async () => {
      report.click();
      await Promise.resolve();
    });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(loadPreview).toHaveBeenLastCalledWith("reports/诊断报告.md");
  });

  it("closes an opened file tab and returns to the remaining file", async () => {
    const folder = container.querySelector<HTMLButtonElement>(".litrev-file-folder__toggle")!;
    await act(async () => {
      folder.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const report = [...container.querySelectorAll<HTMLButtonElement>("button.litrev-file-item")]
      .find((button) => button.textContent?.includes("诊断报告.md"))!;
    await act(async () => {
      report.click();
      await Promise.resolve();
    });
    const closeButtons = container.querySelectorAll<HTMLButtonElement>(".litrev-file-tab__close");
    await act(async () => {
      closeButtons[1]!.click();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(container.querySelector(".litrev-file-tab--active")?.textContent).toContain("访谈转写.txt");
  });

  it("collapses and restores the file tree without closing its active tab", () => {
    const toggle = container.querySelector<HTMLButtonElement>(".litrev-file-browser__toggle")!;
    act(() => toggle.click());
    expect(container.querySelector(".litrev-file-list")).toBeNull();
    expect(container.querySelector(".litrev-file-tab--active")?.textContent).toContain("访谈转写.txt");
    act(() => toggle.click());
    expect(container.querySelector(".litrev-file-list")).not.toBeNull();
  });

  it("refreshes loaded directories without resetting open tabs", async () => {
    const folder = container.querySelector<HTMLButtonElement>(".litrev-file-folder__toggle")!;
    await act(async () => {
      folder.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const report = [...container.querySelectorAll<HTMLButtonElement>("button.litrev-file-item")]
      .find((button) => button.textContent?.includes("诊断报告.md"))!;
    await act(async () => {
      report.click();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkspacePreviewPane
            sessionKey="websocket:legal"
            rootLabel="法律项目"
            loadDirectory={loadDirectory}
            loadPreview={loadPreview}
            refreshKey={1}
          />
        </I18nProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(container.querySelector(".litrev-file-tab--active")?.textContent).toContain("诊断报告.md");
    expect(loadDirectory).toHaveBeenLastCalledWith("websocket:legal", "reports");
  });

  it("opens the first report when the root contains folders only", async () => {
    const folderOnlyLoader = vi.fn(async (_sessionKey: string, path: string): Promise<WorkspaceFilesListing> => ({
      root: { kind: "project", label: "法律项目" },
      path,
      truncated: false,
      entries: path === "reports"
        ? [{ name: "初步诊断.md", path: "reports/初步诊断.md", kind: "file", size: 12, modifiedAt: null }]
        : [{ name: "reports", path: "reports", kind: "directory", size: null, modifiedAt: null }],
    }));

    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkspacePreviewPane
            sessionKey="websocket:folders-only"
            rootLabel="法律项目"
            loadDirectory={folderOnlyLoader}
            loadPreview={loadPreview}
          />
        </I18nProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(folderOnlyLoader).toHaveBeenCalledWith("websocket:folders-only", "reports");
    expect(container.querySelector(".litrev-file-folder__toggle")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".litrev-file-tab--active")?.textContent).toContain("初步诊断.md");
  });
});
