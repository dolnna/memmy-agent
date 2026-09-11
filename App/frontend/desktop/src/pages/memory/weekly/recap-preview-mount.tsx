import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../../i18n/use-translation.js";

/**
 * DEV-only extension around the original HomePage. It adds a composer shortcut and
 * routes local fixture task clicks, leaving all existing UI source files intact.
 * Selectors intentionally match the current AppFrame and SearchPalette markup.
 */
export function RecapPreviewMount(props: {
  children: ReactNode;
  homeEntry: ReactNode;
  onOpenTitle: (title: string, occurrence: number) => void;
  composerSubmitEnabled?: boolean;
  composerHasContent?: boolean;
  onComposerSubmit?: (value: string) => void;
  onNewConversation?: () => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const element = document.createElement("div");
    element.dataset.recapPreviewExtension = "true";
    const place = () => {
      const composer = container.querySelector(".home-empty-composer-stack");
      if (!composer) {
        element.remove();
        setHost((current) => current === null ? current : null);
        return;
      }
      if (composer.nextSibling !== element) composer.after(element);
      setHost((current) => current === element ? current : element);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(container, { subtree: true, childList: true });
    return () => { observer.disconnect(); element.remove(); };
  }, []);

  useLayoutEffect(() => {
    const container = root.current;
    if (!container || !props.composerSubmitEnabled) return;
    const originalButtons = new Map<HTMLButtonElement, boolean>();
    const syncSubmit = () => {
      const button = container.querySelector<HTMLButtonElement>(`.home-empty-composer button[aria-label="${CSS.escape(t("home.send"))}"]`);
      if (button) {
        if (!originalButtons.has(button)) originalButtons.set(button, button.disabled);
        const disabled = !props.composerHasContent;
        if (button.disabled !== disabled) button.disabled = disabled;
        button.dataset.recapPreviewSubmit = "true";
      }
    };
    syncSubmit();
    const observer = new MutationObserver(syncSubmit);
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    return () => {
      observer.disconnect();
      for (const [button, disabled] of originalButtons) {
        delete button.dataset.recapPreviewSubmit;
        if (button.disabled !== disabled) button.disabled = disabled;
      }
    };
  }, [props.composerSubmitEnabled, props.composerHasContent, t]);

  function titleFromButton(button: Element | null): string | null {
    return button?.querySelector(".app-frame-task-title, .search-palette-item-title")?.textContent?.trim() ?? null;
  }

  function openButton(button: Element | null) {
    const title = titleFromButton(button);
    if (!title || !button) return;
    const search = button.matches(".search-palette-item");
    const surface = button.closest(search ? ".search-palette-list" : ".app-frame-task-scroll");
    const selector = search ? "button.search-palette-item" : "button.app-frame-task-row__main";
    const identical = Array.from(surface?.querySelectorAll(selector) ?? []).filter((item) => titleFromButton(item) === title);
    props.onOpenTitle(title, Math.max(0, identical.indexOf(button)));
  }

  return <div ref={root} className="recap-preview-root"
    onClickCapture={(event) => {
      const navButton = (event.target as Element).closest("button.app-frame-nav-button");
      if (navButton?.textContent?.trim() === t("nav.chat")) props.onNewConversation?.();
      const submit = (event.target as Element).closest<HTMLButtonElement>('button[data-recap-preview-submit="true"]');
      if (submit && props.composerSubmitEnabled) {
        event.preventDefault();
        event.stopPropagation();
        const value = root.current?.querySelector<HTMLTextAreaElement>(".home-empty-composer textarea")?.value ?? "";
        props.onComposerSubmit?.(value);
        return;
      }
      const button = (event.target as Element).closest("button.app-frame-task-row__main, button.search-palette-item");
      openButton(button);
    }}
    onKeyDownCapture={(event) => {
      const target = event.target as Element;
      if (props.composerSubmitEnabled && target.matches(".home-empty-composer textarea") && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        props.onComposerSubmit?.((target as HTMLTextAreaElement).value);
        return;
      }
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      const input = target;
      if (!input.matches(".search-palette-input-row input")) return;
      openButton(input.closest(".search-palette")?.querySelector('.search-palette-item[aria-selected="true"]') ?? null);
    }}
  >
    {props.children}
    {host && createPortal(props.homeEntry, host)}
  </div>;
}
