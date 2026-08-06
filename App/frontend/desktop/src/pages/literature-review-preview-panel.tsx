import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  File,
  FileText,
  FolderOpen,
  X,
} from "lucide-react";
import { AgentMessageContent } from "./agent-message-content.js";

type PreviewGroup = "artifacts" | "project";
type PreviewKind = "markdown" | "code" | "pdf" | "docx" | "xlsx" | "pptx";
type PreviewMode = "render" | "source";
type FileListMode = "artifacts" | "project";

export interface LiteraturePreviewFile {
  id: string;
  name: string;
  path: string;
  group: PreviewGroup;
  kind: PreviewKind;
  content: string;
}

const MOCK_OUTLINE = `# 大模型长期记忆：文献综述大纲

## 1. 引言
- 研究背景与问题定义
- 综述范围与排除边界

## 2. 记忆表征与存储
- 参数化记忆与外部记忆
- 向量库、知识图谱与混合结构

## 3. 写入与更新机制
- 记忆抽取、压缩与冲突消解
- 时效性与遗忘策略

## 4. 检索与注入
- 检索增强生成（RAG）
- 记忆调度与上下文拼装

## 5. 评测与基准
- 长期一致性、个性化与抗噪声

## 6. 开放问题与展望

### 检索关键词
\`long-term memory\`、\`LLM memory\`、\`memory management\`、\`RAG evaluation\`
`;

const MOCK_REVIEW = `# 大模型长期记忆：方法、系统与评测

## 摘要

大语言模型在单轮推理上表现突出，但跨会话的**长期记忆**仍缺乏稳定、可追溯的实现路径。本文围绕 2021—2025 年公开研究，从记忆表征、写入更新、检索注入和评测体系四个维度进行梳理。

## 1. 引言

现有工作可以分为参数化记忆与外部记忆两类。前者将知识写入模型参数，后者通过向量库、结构化图谱或文件系统保存信息，并在推理时动态召回。

$$
\\operatorname{Recall}(q)=\\operatorname{TopK}\\big(\\operatorname{sim}(q,m_i)\\big)
$$

## 2. 记忆表征

向量方案部署简单，但对时间和冲突的建模较弱；图谱方案能够表达实体关系，却提高了写入与维护成本。

## 参考文献

1. Packer et al. *MemGPT*. 2023.
2. Zhong et al. *MemoryBank*. 2024.
`;

const MOCK_CODE = `export interface MemoryRecord {
  id: string;
  content: string;
  createdAt: string;
  confidence: number;
}

export function rankMemory(candidates: MemoryRecord[]) {
  return candidates
    .filter((item) => item.confidence >= 0.65)
    .slice(0, 20);
}
`;

export const LITERATURE_PREVIEW_MOCK_FILES: LiteraturePreviewFile[] = [
  { id: "outline", name: "大模型长期记忆-大纲.md", path: "成果/大模型长期记忆-大纲.md", group: "artifacts", kind: "markdown", content: MOCK_OUTLINE },
  { id: "review", name: "大模型长期记忆-正文.md", path: "成果/大模型长期记忆-正文.md", group: "artifacts", kind: "markdown", content: MOCK_REVIEW },
  { id: "review-docx", name: "大模型长期记忆-正文.docx", path: "成果/大模型长期记忆-正文.docx", group: "artifacts", kind: "docx", content: "大模型长期记忆：方法、系统与评测" },
  { id: "paper", name: "MemGPT.pdf", path: "文献/MemGPT.pdf", group: "artifacts", kind: "pdf", content: "MEMGPT: TOWARDS LLMs AS OPERATING SYSTEMS" },
  { id: "proposal", name: "开题报告.docx", path: "研究资料/课题材料/开题报告.docx", group: "project", kind: "docx", content: "面向长期交互的大语言模型记忆机制研究" },
  { id: "matrix", name: "文献对照表.xlsx", path: "研究资料/文献整理/方法对比/文献对照表.xlsx", group: "project", kind: "xlsx", content: "文献对照表" },
  { id: "slides", name: "中期汇报.pptx", path: "汇报材料/2026/中期汇报.pptx", group: "project", kind: "pptx", content: "研究进展与下一步计划" },
  { id: "code", name: "memory-ranking.ts", path: "实验代码/检索模块/memory-ranking.ts", group: "project", kind: "code", content: MOCK_CODE },
];

interface PreviewTreeNode {
  name: string;
  path: string;
  children: PreviewTreeNode[];
  file?: LiteraturePreviewFile;
}

function mockFile(id: string): LiteraturePreviewFile | undefined {
  return LITERATURE_PREVIEW_MOCK_FILES.find((file) => file.id === id);
}

export function LiteratureReviewPreviewPanel(props: {
  sessionKey: string;
  projectName: string | null;
  requestedFileId: string | null;
  onRevealFile?: (path: string) => Promise<void>;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const tabDragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; moved: boolean } | null>(null);
  const suppressTabClickRef = useRef(false);
  const [filesVisible, setFilesVisible] = useState(true);
  const [fileListMode, setFileListMode] = useState<FileListMode>("artifacts");
  const [openIds, setOpenIds] = useState(["outline", "review", "paper"]);
  const [activeId, setActiveId] = useState("outline");
  const [modeById, setModeById] = useState<Record<string, PreviewMode>>({});
  const activeFile = mockFile(activeId) ?? null;
  const mode = activeFile ? modeById[activeFile.id] ?? "render" : "render";

  useEffect(() => {
    setFilesVisible(true);
    setFileListMode("artifacts");
    setOpenIds(["outline", "review", "paper"]);
    setActiveId("outline");
    setModeById({});
  }, [props.sessionKey]);

  useEffect(() => {
    if (!props.projectName && fileListMode === "project") {
      setFileListMode("artifacts");
    }
  }, [fileListMode, props.projectName]);

  useEffect(() => {
    if (!props.requestedFileId || !mockFile(props.requestedFileId)) return;
    setFilesVisible(true);
    setOpenIds((current) => current.includes(props.requestedFileId!)
      ? current
      : [...current, props.requestedFileId!]);
    setActiveId(props.requestedFileId);
    setFileListMode(mockFile(props.requestedFileId)?.group === "project" ? "project" : "artifacts");
  }, [props.requestedFileId]);

  function openFile(id: string) {
    setOpenIds((current) => current.includes(id) ? current : [...current, id]);
    activateFile(id);
  }

  function activateFile(id: string) {
    setActiveId(id);
    const file = mockFile(id);
    if (file?.group === "project" && props.projectName) {
      setFileListMode("project");
    } else if (file?.group === "artifacts") {
      setFileListMode("artifacts");
    }
  }

  function closeFile(id: string) {
    setOpenIds((current) => {
      const index = current.indexOf(id);
      const next = current.filter((item) => item !== id);
      if (activeId === id) setActiveId(next[index] ?? next[index - 1] ?? next[0] ?? "");
      if (!next.length) setFilesVisible(true);
      return next;
    });
  }

  function startTabDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    tabDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTabDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = tabDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) < 4 && !drag.moved) return;
    drag.moved = true;
    event.currentTarget.scrollLeft = drag.scrollLeft - delta;
    event.preventDefault();
  }

  function finishTabDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = tabDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressTabClickRef.current = drag.moved;
    tabDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useEffect(() => {
    if (!filesVisible || !activeId) return;
    const frame = requestAnimationFrame(() => {
      const fileList = rootRef.current?.querySelector<HTMLElement>(".literature-preview__files");
      const target = rootRef.current?.querySelector<HTMLElement>(`[data-preview-file-id="${activeId}"]`);
      if (!fileList || !target) return;
      const listRect = fileList.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (targetRect.top < listRect.top) {
        fileList.scrollTop -= listRect.top - targetRect.top;
      } else if (targetRect.bottom > listRect.bottom) {
        fileList.scrollTop += targetRect.bottom - listRect.bottom;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, fileListMode, filesVisible]);

  return (
    <aside ref={rootRef} className={`literature-preview${filesVisible ? "" : " is-files-hidden"}`} aria-label="项目预览">
      {filesVisible ? (
        <div className="literature-preview__files">
        <header className="literature-preview__files-header">
          <h2>{props.projectName ? "文件" : "产物"}</h2>
          <button
            type="button"
            className="literature-preview__files-collapse"
            title="收起文件列表"
            aria-label="收起文件列表"
            onClick={() => setFilesVisible(false)}
          >
            <ChevronLeft size={14} />
          </button>
        </header>
        {props.projectName ? (
          <div className="literature-preview__file-tabs" role="tablist" aria-label="文件范围">
            <button
              type="button"
              role="tab"
              aria-selected={fileListMode === "artifacts"}
              className={fileListMode === "artifacts" ? "is-active" : ""}
              onClick={() => setFileListMode("artifacts")}
            >
              <span>产物</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={fileListMode === "project"}
              className={fileListMode === "project" ? "is-active" : ""}
              title={props.projectName}
              onClick={() => setFileListMode("project")}
            >
              <span>项目空间</span>
            </button>
          </div>
        ) : null}
        {fileListMode === "artifacts" ? (
          <PreviewFileGroup title="产物" group="artifacts" activeId={activeId} openIds={openIds} onOpen={openFile} />
        ) : (
          <PreviewProjectTree activeId={activeId} openIds={openIds} onOpen={openFile} />
        )}
        </div>
      ) : null}

      <div className="literature-preview__viewer">
        {openIds.length ? (
          <>
            <div
              className="literature-preview__tabs"
              role="tablist"
              onPointerDown={startTabDrag}
              onPointerMove={moveTabDrag}
              onPointerUp={finishTabDrag}
              onPointerCancel={finishTabDrag}
              onClickCapture={(event) => {
                if (!suppressTabClickRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                suppressTabClickRef.current = false;
              }}
            >
              {!filesVisible ? (
                <button
                  type="button"
                  className="literature-preview__files-reopen"
                  title="展开文件列表"
                  aria-label="展开文件列表"
                  onClick={() => setFilesVisible(true)}
                >
                  <ChevronRight size={14} />
                  <span>文件</span>
                </button>
              ) : null}
              {openIds.map((id) => {
                const file = mockFile(id);
                if (!file) return null;
                const active = id === activeId;
                return (
                  <div key={id} className={`literature-preview__tab${active ? " is-active" : ""}`} role="tab" aria-selected={active}>
                    <button type="button" title={file.path} onClick={() => activateFile(id)}>{file.name}</button>
                    <button type="button" aria-label={`关闭 ${file.name}`} onClick={() => closeFile(id)}><X size={12} /></button>
                  </div>
                );
              })}
            </div>
            {activeFile ? (
              <>
                <div className="literature-preview__toolbar">
                      <PreviewBreadcrumb path={activeFile.path} />
                  <div>
                    {activeFile.kind === "markdown" ? (
                      <span className="literature-preview__mode">
                        <button type="button" className={mode === "render" ? "is-active" : ""} onClick={() => setModeById((current) => ({ ...current, [activeFile.id]: "render" }))}><Eye size={13} />预览</button>
                        <button type="button" className={mode === "source" ? "is-active" : ""} onClick={() => setModeById((current) => ({ ...current, [activeFile.id]: "source" }))}><Code2 size={13} />源码</button>
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="literature-preview__toolbar-icon"
                      title="在 Finder 中显示"
                      aria-label="在 Finder 中显示"
                      disabled={!props.onRevealFile}
                      onClick={() => void props.onRevealFile?.(activeFile.path).catch(() => undefined)}
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </div>
                <div className="literature-preview__body">
                  <PreviewContent file={activeFile} mode={mode} />
                </div>
                <footer className="literature-preview__status">{previewType(activeFile.kind)} · 只读预览，可划词复制</footer>
              </>
            ) : null}
          </>
        ) : (
          <div className="literature-preview__empty">
            <span className="literature-preview__empty-icon"><FileText size={20} /></span>
            <strong>选择文件开始预览</strong>
            <p>从文件列表打开产物或项目文件，可同时打开多个。</p>
            <small>支持 Markdown、PDF、Office 和常见代码文件</small>
          </div>
        )}
      </div>
    </aside>
  );
}

function PreviewBreadcrumb(props: { path: string }) {
  const parts = props.path.split("/").filter(Boolean);
  return (
    <nav className="literature-preview__breadcrumb" aria-label="文件路径" title={props.path}>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? <ChevronRight size={10} aria-hidden="true" /> : null}
          <span className={index === parts.length - 1 ? "is-current" : ""}>{part}</span>
        </span>
      ))}
    </nav>
  );
}

function PreviewFileGroup(props: {
  title: string;
  group: PreviewGroup;
  activeId: string;
  openIds: string[];
  onOpen: (id: string) => void;
}) {
  const files = LITERATURE_PREVIEW_MOCK_FILES.filter((file) => file.group === props.group);
  return (
    <section className="literature-preview__group" aria-label={props.title}>
      {files.map((file) => (
        <PreviewFileRow
          key={file.id}
          file={file}
          active={file.id === props.activeId}
          open={props.openIds.includes(file.id)}
          onOpen={props.onOpen}
        />
      ))}
    </section>
  );
}

function PreviewProjectTree(props: {
  activeId: string;
  openIds: string[];
  onOpen: (id: string) => void;
}) {
  const projectFiles = useMemo(
    () => LITERATURE_PREVIEW_MOCK_FILES.filter((file) => file.group === "project"),
    [],
  );
  const tree = useMemo(() => buildPreviewTree(projectFiles), [projectFiles]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(folderPaths(projectFiles)));

  useEffect(() => {
    const activeFile = projectFiles.find((file) => file.id === props.activeId);
    if (!activeFile) return;
    setExpandedPaths((current) => new Set([...current, ...folderPaths([activeFile])]));
  }, [projectFiles, props.activeId]);

  function toggleFolder(folderPath: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }

  return (
    <section className="literature-preview__group literature-preview__project-tree" aria-label="项目文件">
      <div role="tree" aria-label="项目文件">
        {tree.map((node) => (
          <PreviewTreeRow
            key={node.path}
            node={node}
            depth={0}
            expandedPaths={expandedPaths}
            activeId={props.activeId}
            openIds={props.openIds}
            onToggle={toggleFolder}
            onOpen={props.onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function PreviewTreeRow(props: {
  node: PreviewTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  activeId: string;
  openIds: string[];
  onToggle: (path: string) => void;
  onOpen: (id: string) => void;
}) {
  if (props.node.file) {
    const file = props.node.file;
    return (
      <PreviewFileRow
        file={file}
        active={file.id === props.activeId}
        open={props.openIds.includes(file.id)}
        depth={props.depth}
        treeItem
        onOpen={props.onOpen}
      />
    );
  }

  const expanded = props.expandedPaths.has(props.node.path);
  return (
    <div role="treeitem" aria-expanded={expanded}>
      <button
        type="button"
        className="literature-preview__tree-folder"
        style={{ paddingLeft: `${7 + props.depth * 12}px` }}
        title={props.node.path}
        onClick={() => props.onToggle(props.node.path)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{props.node.name}</span>
      </button>
      {expanded ? (
        <div role="group">
          {props.node.children.map((child) => (
            <PreviewTreeRow
              key={child.path}
              node={child}
              depth={props.depth + 1}
              expandedPaths={props.expandedPaths}
              activeId={props.activeId}
              openIds={props.openIds}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewFileRow(props: {
  file: LiteraturePreviewFile;
  active: boolean;
  open: boolean;
  depth?: number;
  treeItem?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role={props.treeItem ? "treeitem" : undefined}
      className={`literature-preview__file-row${props.active ? " is-active" : ""}${props.open && !props.active ? " is-open" : ""}`}
      data-preview-file-id={props.file.id}
      style={props.depth == null ? undefined : { paddingLeft: `${9 + props.depth * 12}px` }}
      title={props.file.path}
      onClick={() => props.onOpen(props.file.id)}
    >
      <span className="literature-preview__file-row-icon"><File size={13} /></span>
      <span className="literature-preview__file-row-name">{props.file.name}</span>
    </button>
  );
}

function buildPreviewTree(files: LiteraturePreviewFile[]): PreviewTreeNode[] {
  const roots: PreviewTreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let level = roots;
    let currentPath = "";
    for (const [index, part] of parts.entries()) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.find((item) => item.name === part);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          children: [],
          ...(isFile ? { file } : {}),
        };
        level.push(node);
      }
      level = node.children;
    }
  }
  return roots;
}

function folderPaths(files: LiteraturePreviewFile[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      paths.add(parts.slice(0, index).join("/"));
    }
  }
  return [...paths];
}

function PreviewContent(props: { file: LiteraturePreviewFile; mode: PreviewMode }) {
  if (props.mode === "source" && (props.file.kind === "markdown" || props.file.kind === "code")) {
    return <pre className="literature-preview__source">{props.file.content}</pre>;
  }
  if (props.file.kind === "markdown") return <AgentMessageContent content={props.file.content} className="literature-preview__markdown" />;
  if (props.file.kind === "code") return <pre className="literature-preview__source">{props.file.content}</pre>;
  if (props.file.kind === "pdf") {
    return (
      <div className="literature-preview__document-stage">
        <article className="literature-preview__paper is-pdf">
          <small>UC BERKELEY · 2023</small>
          <h1>{props.file.content}</h1>
          <p className="authors">Charles Packer · Vivian Fang · Shishir G. Patil · Kevin Lin</p>
          <hr />
          <h2>Abstract</h2>
          <p>Large language models are increasingly being used as the core of agentic systems. We introduce virtual context management inspired by hierarchical memory systems in traditional operating systems.</p>
          <div className="columns"><p>1. Introduction<br />LLM agents require memory beyond a fixed context window...</p><p>2. MemGPT<br />The system moves information between main context and external storage...</p></div>
          <span className="page">1 / 19</span>
        </article>
      </div>
    );
  }
  if (props.file.kind === "docx") {
    return (
      <div className="literature-preview__document-stage">
        <article className="literature-preview__paper is-docx">
          <h1>{props.file.content}</h1>
          <p className="subtitle">文献综述 · 研究背景与相关工作</p>
          <h2>一、研究背景</h2>
          <p>大语言模型的上下文窗口持续扩展，但跨会话知识保持、用户偏好积累与历史经验复用仍依赖外部记忆机制。</p>
          <h2>二、研究目标</h2>
          <p>构建一套可持续更新、证据可追溯的长期记忆框架，并通过公开基准评估其一致性和抗噪声能力。</p>
          <ul><li>比较不同记忆表征方法</li><li>分析写入、遗忘与冲突消解机制</li><li>建立覆盖长期一致性的评测指标</li></ul>
        </article>
      </div>
    );
  }
  if (props.file.kind === "xlsx") {
    return (
      <div className="literature-preview__sheet">
        <div>A1　{props.file.content}</div>
        <table><thead><tr><th>文献</th><th>记忆形态</th><th>更新机制</th><th>评测重点</th></tr></thead><tbody>
          <tr><td>MemGPT</td><td>分层外部记忆</td><td>函数调用</td><td>长上下文管理</td></tr>
          <tr><td>MemoryBank</td><td>用户记忆库</td><td>时间衰减</td><td>个性化对话</td></tr>
          <tr><td>Generative Agents</td><td>记忆流</td><td>反思归纳</td><td>行为可信度</td></tr>
          <tr><td>LongMemEval</td><td>评测数据集</td><td>—</td><td>跨会话一致性</td></tr>
        </tbody></table>
        <footer><span>方法对比</span><span>引用核验</span><span>检索结果</span></footer>
      </div>
    );
  }
  return (
    <div className="literature-preview__slide-stage">
      <article className="literature-preview__slide">
        <small>03</small><h1>{props.file.content}</h1><p>从“存得下”走向“记得准、用得对”</p>
        <div><span>记忆写入<small>抽取 · 压缩</small></span><i>→</i><span>记忆组织<small>向量 · 图谱</small></span><i>→</i><span>检索注入<small>召回 · 调度</small></span></div>
        <footer>Memmy Research · 2026</footer>
      </article>
    </div>
  );
}

function previewType(kind: PreviewKind): string {
  return { markdown: "Markdown", code: "TypeScript", pdf: "PDF", docx: "Word", xlsx: "Excel", pptx: "PowerPoint" }[kind];
}
