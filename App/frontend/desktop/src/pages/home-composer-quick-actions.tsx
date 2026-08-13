/**
 * Composer quick actions for the new-task screen (design-complete mock).
 *
 * Implements attach (+) and reference (@) affordances, plus selected context
 * chips in the composer toolbar.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { AtSign, LibraryBig, Plus } from "lucide-react";
import { FileTypeIcon, FolderTypeIcon } from "../components/file-type-icon.js";
import { Tooltip } from "../components/tooltip.js";
import { useTranslation } from "../i18n/use-translation.js";
import type { ComposerContextReference } from "../state/agent-composer-state.js";
import { AgentAttachmentCard } from "./agent-file-attachment-chip.js";
import {
  buildDemoKnowledgeBases,
  buildDemoLibraryFiles,
  type KbKnowledgeBase
} from "./knowledge-demo-data.js";

export type ComposerContextChip = ComposerContextReference;
export interface HomeReferenceItem {
  path: string;
  meta: string;
}

const HOME_KNOWLEDGE_BASES: KbKnowledgeBase[] = buildDemoKnowledgeBases();
const HOME_REFERENCE_ITEMS: HomeReferenceItem[] = buildDemoLibraryFiles().map((file) => ({
  path: file.path,
  meta: `${file.size} · ${file.updated}`
}));

/** Extracts a trailing `@token` mention query from the composer input, or null. */
export function mentionQueryFromInput(input: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(input);
  return match ? (match[1] ?? "") : null;
}

/** Replaces the trailing `@token` mention in the input after a pick. */
export function stripMentionFromInput(input: string): string {
  return input.replace(/(^|\s)@[^\s@]*$/, "$1");
}

export function ComposerQuickActionButtons(props: {
  onAttach: () => void;
  onInsertMention: () => void;
  /** Anchored directly under the @ button. */
  referenceMenu?: ReactNode;
}) {
  const { t } = useTranslation();
  const buttonClass = "composer-quick-actions__btn";
  const referenceOpen = Boolean(props.referenceMenu);
  return (
    <div className="composer-quick-actions" data-composer-quick-actions-root>
      <Tooltip content={t("home.quick.attachHint")}>
        <button
          type="button"
          aria-label={t("home.quick.attach")}
          className={buttonClass}
          onClick={props.onAttach}
        >
          <Plus size={15} />
        </button>
      </Tooltip>
      <div className="composer-quick-actions__anchor">
        <Tooltip content={t("home.quick.referenceHint")}>
          <button
            type="button"
            aria-label={t("home.quick.reference")}
            aria-expanded={referenceOpen}
            className={`${buttonClass}${referenceOpen ? " composer-quick-actions__btn--active" : ""}`}
            onClick={props.onInsertMention}
          >
            <AtSign size={15} />
          </button>
        </Tooltip>
        {referenceOpen ? (
          <div className="composer-quick-actions__popover composer-quick-actions__popover--reference" data-composer-quick-popover="reference">
            {props.referenceMenu}
          </div>
        ) : null}
      </div>
    </div>
  );
}
/**
 * Reference panel anchored under the `@` button when mention/reference is active.
 * Searchable list of knowledge bases and files (no folders).
 */
export function ComposerReferencePanel(props: {
  open: boolean;
  /** Query synced from a trailing `@token` in the composer, if any. */
  externalQuery?: string | null;
  onClose: () => void;
  onPickKnowledgeBase: (base: KbKnowledgeBase) => void;
  onPickReference: (item: HomeReferenceItem) => void;
}) {
  const { t } = useTranslation();
  const [localQuery, setLocalQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);
  const query = localQuery.trim().toLowerCase();
  const bases = HOME_KNOWLEDGE_BASES.filter((base) => !query || base.name.toLowerCase().includes(query));
  const items = HOME_REFERENCE_ITEMS.filter((item) => !query || item.path.toLowerCase().includes(query));

  useEffect(() => {
    if (props.open && !wasOpenRef.current) {
      setLocalQuery(props.externalQuery ?? "");
      queueMicrotask(() => searchInputRef.current?.focus());
    }
    wasOpenRef.current = props.open;
  }, [props.open, props.externalQuery]);

  useEffect(() => {
    if (!props.open || props.externalQuery == null) return;
    setLocalQuery(props.externalQuery);
  }, [props.externalQuery, props.open]);

  useEffect(() => {
    if (!props.open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (rootRef.current?.contains(target as Node)) return;
      if (target?.closest("[data-composer-quick-actions-root]")) return;
      props.onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [props.onClose, props.open]);

  if (!props.open) return null;

  return (
    <div ref={rootRef} className="home-reference-panel" role="listbox" aria-label={t("home.quick.reference")}>
      <header className="home-reference-panel__head">
        <strong>{t("home.quick.reference")}</strong>
        <label className="home-reference-panel__search">
          <input
            ref={searchInputRef}
            value={localQuery}
            placeholder={t("home.quick.referenceSearch")}
            aria-label={t("home.quick.referenceSearch")}
            onChange={(event) => setLocalQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onClose();
              }
            }}
          />
        </label>
      </header>
      <div className="home-reference-panel__list">
        <div className="home-reference-panel__heading">{t("home.quick.kbSection")}</div>
        {bases.map((base) => (
          <button
            type="button"
            key={base.id}
            className="home-reference-panel__item"
            role="option"
            onClick={() => props.onPickKnowledgeBase(base)}
          >
            <span className="home-reference-panel__icon"><LibraryBig size={14} /></span>
            <span className="home-reference-panel__text">
              <strong>{base.name}</strong>
              <small>{t("home.quick.kbSearchScope", { count: base.fileIds.length })}</small>
            </span>
            <code>{t("home.quick.kind.kb")}</code>
          </button>
        ))}
        <div className="home-reference-panel__heading">{t("home.quick.fileSection")}</div>
        {items.map((item) => (
          <button
            type="button"
            key={item.path}
            className="home-reference-panel__item"
            role="option"
            onClick={() => props.onPickReference(item)}
          >
            <FileTypeIcon name={item.path} surface="row" />
            <span className="home-reference-panel__text">
              <strong>{item.path}</strong>
              <small>{item.meta}</small>
            </span>
            <code>{t("home.quick.kind.file")}</code>
          </button>
        ))}
        {!bases.length && !items.length ? (
          <div className="home-reference-panel__empty">{t("home.quick.noMatches")}</div>
        ) : null}
      </div>
    </div>
  );
}

export function HomeContextChips(props: {
  chips: ComposerContextChip[];
  onRemove?: (chip: ComposerContextChip) => void;
}) {
  const { t } = useTranslation();
  if (!props.chips.length) return null;
  return (
    <div className="home-context-chips">
      {props.chips.map((chip) => {
        const folder = chip.kind === "path" && chip.label.endsWith("/");
        const kindLabel = chip.kind === "kb"
          ? t("home.quick.kind.kb")
          : folder
            ? t("home.quick.kind.folder")
            : t("home.quick.kind.file");
        return (
          <AgentAttachmentCard
            key={`${chip.kind}:${chip.id}`}
            kind="file"
            name={chip.label}
            subline={kindLabel}
            title={chip.label}
            removable={Boolean(props.onRemove)}
            removeLabel={props.onRemove ? t("common.remove") : undefined}
            onRemove={props.onRemove ? () => props.onRemove?.(chip) : undefined}
            leading={(
              chip.kind === "kb" ? (
                <span className="home-context-card__icon home-context-card__icon--kb">
                  <LibraryBig size={16} aria-hidden="true" />
                </span>
              ) : folder ? (
                <FolderTypeIcon surface="card" />
              ) : (
                <FileTypeIcon name={chip.label} surface="card" />
              )
            )}
          />
        );
      })}
    </div>
  );
}
