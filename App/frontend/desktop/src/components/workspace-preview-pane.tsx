/** Shared workspace file tree and artifact preview used by ordinary Agent chats. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  PanelLeftClose,
  PanelLeftOpen,
  X
} from "lucide-react";
import type { WorkspaceFileEntry, WorkspaceFilesListing } from "../api/memmy-agent-client.js";
import { FileTypeIcon } from "./file-type-icon.js";
import { useTranslation } from "../i18n/use-translation.js";
import { SidebarResizeHandle, useResizableSidebar } from "../pages/sidebar-resize.js";

const ROOT_DIRECTORY_KEY = "";
const INITIAL_FOLDER_PRIORITY = ["outputs", "reports", "report", "transcripts", "recordings"];
const MAX_INITIAL_FOLDER_DEPTH = 4;
const PREVIEW_MIN_WIDTH_PX = 360;
const CONVERSATION_MIN_WIDTH_PX = 360;
const FILE_BROWSER_MIN_WIDTH_PX = 160;
const PREVIEW_DOCUMENT_MIN_WIDTH_PX = 200;
const PREVIEW_SPLIT_MIN_WIDTH_PX = 720;

export function resolveWorkspacePreviewMaxWidth(workspaceWidth: number): number {
  return Math.max(PREVIEW_MIN_WIDTH_PX, workspaceWidth - CONVERSATION_MIN_WIDTH_PX);
}

export function resolveWorkspaceFileBrowserMaxWidth(previewWidth: number): number {
  return Math.max(FILE_BROWSER_MIN_WIDTH_PX, previewWidth - PREVIEW_DOCUMENT_MIN_WIDTH_PX);
}

export interface WorkspacePreviewSection {
  heading: string;
  body: string;
}

export interface WorkspacePreviewContent {
  title: string;
  sections: WorkspacePreviewSection[];
}

export interface WorkspacePreviewPaneProps {
  sessionKey: string;
  rootLabel: string;
  loadDirectory: (sessionKey: string, relativePath: string) => Promise<WorkspaceFilesListing>;
  loadPreview: (relativePath: string) => Promise<WorkspacePreviewContent | null>;
  refreshKey?: string | number;
  onWidthChange?: (width: number) => void;
  toolbarEnd?: ReactNode;
  emptyLabel?: string;
  emptyDetail?: string;
}

function fileNameFromPath(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function firstFile(entries: WorkspaceFileEntry[]): WorkspaceFileEntry | null {
  return entries.find((entry) => entry.kind === "file") ?? null;
}

interface InitialPreviewCandidate {
  file: WorkspaceFileEntry;
  expandedDirectories: string[];
}

function firstDirectory(entries: WorkspaceFileEntry[]): WorkspaceFileEntry | null {
  const directories = entries.filter((entry) => entry.kind === "directory");
  directories.sort((left, right) => {
    const leftPriority = INITIAL_FOLDER_PRIORITY.indexOf(left.name.toLowerCase());
    const rightPriority = INITIAL_FOLDER_PRIORITY.indexOf(right.name.toLowerCase());
    const leftRank = leftPriority < 0 ? INITIAL_FOLDER_PRIORITY.length : leftPriority;
    const rightRank = rightPriority < 0 ? INITIAL_FOLDER_PRIORITY.length : rightPriority;
    return leftRank - rightRank || left.name.localeCompare(right.name);
  });
  return directories[0] ?? null;
}

async function findInitialPreviewCandidate(
  listing: WorkspaceFilesListing,
  loadDirectory: (relativePath: string) => Promise<WorkspaceFilesListing | null>,
  depth = 0
): Promise<InitialPreviewCandidate | null> {
  const directFile = firstFile(listing.entries);
  if (directFile) return { file: directFile, expandedDirectories: [] };
  if (depth >= MAX_INITIAL_FOLDER_DEPTH) return null;
  const directory = firstDirectory(listing.entries);
  if (!directory) return null;
  let child: WorkspaceFilesListing | null;
  try {
    child = await loadDirectory(directory.path);
  } catch {
    return null;
  }
  if (!child) return null;
  const nested = await findInitialPreviewCandidate(child, loadDirectory, depth + 1);
  return nested
    ? { file: nested.file, expandedDirectories: [directory.path, ...nested.expandedDirectories] }
    : null;
}

export function WorkspacePreviewPane(props: WorkspacePreviewPaneProps): ReactNode {
  const { t } = useTranslation();
  const loadDirectoryRef = useRef(props.loadDirectory);
  const loadPreviewRef = useRef(props.loadPreview);
  const previewPaneRef = useRef<HTMLElement | null>(null);
  const requestGenerationRef = useRef(0);
  const listingsByDirectoryRef = useRef<Record<string, WorkspaceFilesListing | undefined>>({});
  const openPreviewTabsRef = useRef<string[]>([]);
  const lastRefreshKeyRef = useRef(props.refreshKey);
  loadDirectoryRef.current = props.loadDirectory;
  loadPreviewRef.current = props.loadPreview;

  const [listingsByDirectory, setListingsByDirectory] = useState<Record<string, WorkspaceFilesListing | undefined>>({});
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({});
  const [treeLoadFailed, setTreeLoadFailed] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [openPreviewTabs, setOpenPreviewTabs] = useState<string[]>([]);
  const [previewContent, setPreviewContent] = useState<WorkspacePreviewContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);
  listingsByDirectoryRef.current = listingsByDirectory;
  openPreviewTabsRef.current = openPreviewTabs;
  const previewMaxWidth = workspaceWidth === null
    ? 520
    : resolveWorkspacePreviewMaxWidth(workspaceWidth);
  const previewResize = useResizableSidebar({
    storageKey: "memmy.workspacePreview.width",
    defaultWidth: 520,
    minWidth: PREVIEW_MIN_WIDTH_PX,
    maxWidth: previewMaxWidth,
    resizeDirection: -1
  });
  const fileBrowserMaxWidth = resolveWorkspaceFileBrowserMaxWidth(
    workspaceWidth !== null && workspaceWidth < PREVIEW_SPLIT_MIN_WIDTH_PX
      ? workspaceWidth
      : previewResize.width
  );
  const fileBrowserResize = useResizableSidebar({
    storageKey: "memmy.workspacePreview.fileBrowserWidth",
    defaultWidth: 200,
    minWidth: FILE_BROWSER_MIN_WIDTH_PX,
    maxWidth: fileBrowserMaxWidth
  });

  useEffect(() => {
    const workspace = previewPaneRef.current?.parentElement;
    if (!workspace) return;
    const updateWidth = () => {
      const width = workspace.getBoundingClientRect().width || workspace.clientWidth;
      if (width > 0) setWorkspaceWidth(width);
    };
    updateWidth();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateWidth);
    observer?.observe(workspace);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    props.onWidthChange?.(previewResize.width);
  }, [previewResize.width, props.onWidthChange]);

  const requestDirectory = useCallback(async (
    sessionKey: string,
    relativePath: string,
    generation: number
  ): Promise<WorkspaceFilesListing | null> => {
    if (requestGenerationRef.current !== generation) return null;
    setLoadingDirectories((state) => ({ ...state, [relativePath]: true }));
    try {
      const listing = await loadDirectoryRef.current(sessionKey, relativePath);
      if (requestGenerationRef.current !== generation) return null;
      setListingsByDirectory((state) => ({ ...state, [relativePath]: listing }));
      return listing;
    } finally {
      if (requestGenerationRef.current === generation) {
        setLoadingDirectories((state) => ({ ...state, [relativePath]: false }));
      }
    }
  }, []);

  const selectInitialPreview = useCallback(async (
    sessionKey: string,
    rootListing: WorkspaceFilesListing,
    generation: number,
    onlyWhenNoTabs = false
  ) => {
    const candidate = await findInitialPreviewCandidate(
      rootListing,
      (relativePath) => requestDirectory(sessionKey, relativePath, generation)
    );
    if (!candidate || requestGenerationRef.current !== generation) return;
    if (onlyWhenNoTabs && openPreviewTabsRef.current.length) return;
    setCollapsedFolders((state) => {
      const next = { ...state };
      for (const directory of candidate.expandedDirectories) next[directory] = false;
      return next;
    });
    setPreviewPath(candidate.file.path);
    openPreviewTabsRef.current = [candidate.file.path];
    setOpenPreviewTabs([candidate.file.path]);
  }, [requestDirectory]);

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    lastRefreshKeyRef.current = props.refreshKey;
    setListingsByDirectory({});
    setLoadingDirectories({});
    setTreeLoadFailed(false);
    setPreviewPath(null);
    openPreviewTabsRef.current = [];
    setOpenPreviewTabs([]);
    setPreviewContent(null);
    setCollapsedFolders({});
    void requestDirectory(props.sessionKey, ROOT_DIRECTORY_KEY, generation).then((rootListing) => {
      if (!rootListing || requestGenerationRef.current !== generation) return;
      return selectInitialPreview(props.sessionKey, rootListing, generation);
    }).catch(() => {
      if (requestGenerationRef.current !== generation) return;
      setListingsByDirectory({
        [ROOT_DIRECTORY_KEY]: {
          root: { kind: "task", label: props.rootLabel },
          path: ROOT_DIRECTORY_KEY,
          entries: [],
          truncated: false
        }
      });
      setTreeLoadFailed(true);
    });
    return () => {
      if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
    };
  }, [props.rootLabel, props.sessionKey, requestDirectory, selectInitialPreview]);

  useEffect(() => {
    if (Object.is(lastRefreshKeyRef.current, props.refreshKey)) return;
    lastRefreshKeyRef.current = props.refreshKey;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setLoadingDirectories({});
    setTreeLoadFailed(false);
    const loadedDirectories = Object.keys(listingsByDirectoryRef.current);
    const directories = loadedDirectories.includes(ROOT_DIRECTORY_KEY)
      ? loadedDirectories
      : [ROOT_DIRECTORY_KEY, ...loadedDirectories];
    for (const directory of directories) {
      void requestDirectory(props.sessionKey, directory, generation).then((listing) => {
        if (directory !== ROOT_DIRECTORY_KEY || !listing) return;
        return selectInitialPreview(props.sessionKey, listing, generation, true);
      }).catch(() => {
        if (directory === ROOT_DIRECTORY_KEY && requestGenerationRef.current === generation) {
          setTreeLoadFailed(true);
        }
      });
    }
  }, [props.refreshKey, props.sessionKey, requestDirectory, selectInitialPreview]);

  useEffect(() => {
    const generation = requestGenerationRef.current;
    let stale = false;
    setPreviewContent(null);
    if (!previewPath) {
      setPreviewLoading(false);
      return () => { stale = true; };
    }
    setPreviewLoading(true);
    void loadPreviewRef.current(previewPath).then((content) => {
      if (!stale && requestGenerationRef.current === generation) setPreviewContent(content);
    }).catch(() => {
      if (!stale && requestGenerationRef.current === generation) setPreviewContent(null);
    }).finally(() => {
      if (!stale && requestGenerationRef.current === generation) setPreviewLoading(false);
    });
    return () => { stale = true; };
  }, [previewPath]);

  function selectPreviewFile(path: string) {
    setPreviewPath(path);
    setOpenPreviewTabs((tabs) => tabs.includes(path) ? tabs : [...tabs, path]);
  }

  function closePreviewTab(path: string) {
    setOpenPreviewTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== path);
      if (previewPath === path) setPreviewPath(next[next.length - 1] ?? null);
      return next;
    });
  }

  function toggleDirectory(entry: WorkspaceFileEntry) {
    const collapsed = collapsedFolders[entry.path] !== false;
    setCollapsedFolders((state) => ({ ...state, [entry.path]: !collapsed }));
    if (collapsed && listingsByDirectory[entry.path] === undefined && !loadingDirectories[entry.path]) {
      const generation = requestGenerationRef.current;
      void requestDirectory(props.sessionKey, entry.path, generation).catch(() => undefined);
    }
  }

  function renderEntry(entry: WorkspaceFileEntry): ReactNode {
    if (entry.kind === "file") {
      return (
        <button
          type="button"
          key={entry.path}
          className={`litrev-file-item${previewPath === entry.path ? " litrev-file-item--active" : ""}`}
          onClick={() => selectPreviewFile(entry.path)}
        >
          <FileTypeIcon name={entry.name} surface="inline" />
          <span>{entry.name}</span>
        </button>
      );
    }
    const collapsed = collapsedFolders[entry.path] !== false;
    const childListing = listingsByDirectory[entry.path];
    return (
      <div key={entry.path} className="litrev-file-folder">
        <button type="button" className="litrev-file-folder__toggle" aria-expanded={!collapsed} onClick={() => toggleDirectory(entry)}>
          {collapsed
            ? <ChevronRight className="litrev-file-folder__chevron" size={12} />
            : <ChevronDown className="litrev-file-folder__chevron" size={12} />}
          <strong>{entry.name}</strong>
        </button>
        {!collapsed ? (
          <div className="litrev-file-folder__children">
            {loadingDirectories[entry.path] && childListing === undefined
              ? <span className="litrev-file-item">{t("common.loading")}</span>
              : (childListing?.entries ?? []).map(renderEntry)}
          </div>
        ) : null}
      </div>
    );
  }

  const rootListing = listingsByDirectory[ROOT_DIRECTORY_KEY];
  const hasEntries = Boolean(rootListing?.entries.length);
  const rootLoading = rootListing === undefined;
  const resolvedRootLabel = rootListing?.root.label || props.rootLabel;

  return (
    <>
      <SidebarResizeHandle
        label={t("workspacePreview.resize")}
        width={previewResize.width}
        minWidth={previewResize.minWidth}
        maxWidth={previewResize.maxWidth}
        isResizing={previewResize.isResizing}
        onResizeStart={previewResize.beginResize}
        onResizeBy={previewResize.resizeBy}
      />
      <aside ref={previewPaneRef} className="litrev-preview-pane litrev-preview-pane--lifted" style={previewResize.sidebarStyle}>
        <header className="litrev-preview-toolbar">
          {hasEntries ? (
            <button type="button" className="litrev-file-browser__toggle" aria-label={t("workspacePreview.toggleFiles")} aria-expanded={fileTreeOpen} onClick={() => setFileTreeOpen((open) => !open)}>
              {fileTreeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
          ) : null}
          <div className="litrev-file-tabs" role="tablist" aria-label={t("workspacePreview.openFiles")}>
            {openPreviewTabs.map((path) => {
              const active = previewPath === path;
              return (
                <div key={path} className={`litrev-file-tab${active ? " litrev-file-tab--active" : ""}`} role="presentation">
                  <button type="button" role="tab" aria-selected={active} title={path} onClick={() => setPreviewPath(path)}>{fileNameFromPath(path)}</button>
                  <button type="button" className="litrev-file-tab__close" aria-label={t("common.close")} onClick={(event) => { event.stopPropagation(); closePreviewTab(path); }}><X size={11} /></button>
                </div>
              );
            })}
          </div>
          {props.toolbarEnd ? <div className="litrev-preview-toolbar__actions">{props.toolbarEnd}</div> : null}
        </header>
        <div className="litrev-preview-body">
          <aside className={`litrev-file-browser${fileTreeOpen && hasEntries ? "" : " litrev-file-browser--collapsed"}`} style={fileBrowserResize.sidebarStyle}>
            {fileTreeOpen && hasEntries ? <nav className="litrev-file-list">{(rootListing?.entries ?? []).map(renderEntry)}</nav> : null}
          </aside>
          {fileTreeOpen && hasEntries ? (
            <SidebarResizeHandle
              label={t("workspacePreview.resizeFiles")}
              width={fileBrowserResize.width}
              minWidth={fileBrowserResize.minWidth}
              maxWidth={fileBrowserResize.maxWidth}
              isResizing={fileBrowserResize.isResizing}
              onResizeStart={fileBrowserResize.beginResize}
              onResizeBy={fileBrowserResize.resizeBy}
            />
          ) : null}
          <section className="litrev-preview-main">
            {previewPath && previewContent ? (
              <article className="litrev-preview-document">
                <div className="litrev-preview-crumb">{resolvedRootLabel} › {fileNameFromPath(previewPath)}</div>
                <h2>{previewContent.title}</h2>
                {previewContent.sections.map((section) => <section key={section.heading}><h3>{section.heading}</h3><p>{section.body}</p></section>)}
              </article>
            ) : (
              <div className="litrev-preview-empty">
                <Folder size={28} aria-hidden="true" />
                <strong>{rootLoading || previewLoading ? t("common.loading") : props.emptyLabel ?? t("workspacePreview.noFiles")}</strong>
                <small>{treeLoadFailed ? resolvedRootLabel : props.emptyDetail ?? resolvedRootLabel}</small>
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
