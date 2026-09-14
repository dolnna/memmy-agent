import { Bell, Check, ChevronDown, ChevronRight, ListTodo, Pencil, Sparkles, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { MemmyAgentClient } from "../api/memmy-agent-client.js";
import type { ProactiveReminderAction, ProactiveRemindersSnapshot, ProactiveSuggestion } from "../api/proactive-reminders-contract.js";
import { useTranslation } from "../i18n/use-translation.js";
import "./proactive-reminders.css";

interface ProactiveContextValue {
  snapshot: ProactiveRemindersSnapshot | null;
  error: string | null;
  setEnabled(enabled: boolean): Promise<void>;
  open(id: string): void;
}

const ProactiveContext = createContext<ProactiveContextValue | null>(null);
const POLL_MS = 4_000;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isCurrent(suggestion: ProactiveSuggestion): boolean {
  return suggestion.status === "pending" && new Date(suggestion.expiresAt).getTime() > Date.now();
}

/** One host owns polling and delivery across every route in the main window. */
export function ProactiveRemindersProvider(props: { client: MemmyAgentClient | null; children: ReactNode }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ProactiveRemindersSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const [foreground, setForeground] = useState(() => document.visibilityState !== "hidden" && document.hasFocus());
  const activeRef = useRef(activeId);
  const deliveringRef = useRef(false);
  const pollingRef = useRef(false);
  activeRef.current = activeId;
  const close = useCallback(() => setActiveId(null), []);
  const open = useCallback((id: string) => {
    setAutomatic(false);
    setActiveId(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!props.client || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const next = await props.client.getProactiveReminders();
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      pollingRef.current = false;
    }
  }, [props.client]);

  useEffect(() => {
    setSnapshot(null);
    setActiveId(null);
    if (!props.client) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [props.client, refresh]);

  useEffect(() => {
    const update = () => setForeground(document.visibilityState !== "hidden" && document.hasFocus());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => window.memmy?.onProactiveReminderOpen?.((id) => {
    open(id);
    void refresh();
  }), [open, refresh]);

  useEffect(() => {
    const client = props.client;
    if (!client || !snapshot?.enabled || snapshot.observationState !== "running" || activeId || deliveringRef.current) return;
    // Let an introduction or settings dialog finish before claiming a card
    // that would otherwise be hidden behind it.
    if (document.querySelector('[aria-modal="true"]')) return;
    // An ordinary hidden browser tab cannot deliver a native notification.
    if (!foreground && !window.memmy?.notifyProactiveReminder) return;
    const suggestion = snapshot.suggestions.find((item) => isCurrent(item) && !item.notifiedAt);
    if (!suggestion) return;
    deliveringRef.current = true;
    void (async () => {
      try {
        // The gateway atomically claims the first delivery; another renderer
        // receives 409 and must not display the same suggestion.
        const next = await client.actOnProactiveReminder({ id: suggestion.id, action: "shown" });
        setSnapshot(next);
        if (activeRef.current || !next.enabled) return;
        setAutomatic(true);
        setActiveId(suggestion.id);
        if (!foreground) {
          await window.memmy?.notifyProactiveReminder?.({
            id: suggestion.id,
            title: t("proactive.notificationTitle"),
            body: suggestion.title
          });
        }
      } catch {
        // A claimed, rate-limited or expired candidate is reconciled on the
        // next poll. Delivery errors do not block the rest of the app.
      } finally {
        deliveringRef.current = false;
      }
    })();
  }, [activeId, foreground, props.client, snapshot, t]);

  const action = useCallback(async (input: ProactiveReminderAction) => {
    if (!props.client) throw new Error(t("proactive.unavailable"));
    const next = await props.client.actOnProactiveReminder(input);
    setSnapshot(next);
  }, [props.client, t]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!props.client) return;
    try {
      const next = await props.client.updateProactiveRemindersSettings(enabled);
      setSnapshot(next);
      if (!enabled) setActiveId(null);
      setError(null);
    } catch (cause) {
      setError(message(cause));
    }
  }, [props.client]);

  const active = snapshot?.suggestions.find((item) => item.id === activeId);
  return (
    <ProactiveContext.Provider value={{ snapshot, error, setEnabled, open }}>
      {props.children}
      {active ? (
        <ProactiveReminderCard key={active.id} suggestion={active} onAction={action} onClose={close} autoHide={automatic && foreground} hidden={!foreground} />
      ) : null}
    </ProactiveContext.Provider>
  );
}

/** A durable place to return to suggestions whose notification was missed. */
export function ProactiveRemindersSection() {
  const context = useContext(ProactiveContext);
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  if (!context) return null;
  const { snapshot, error } = context;
  const pending = snapshot?.suggestions.filter((item) => isCurrent(item) || item.status === "snoozed") ?? [];
  const saved = snapshot?.suggestions.filter((item) => item.status === "added") ?? [];
  const visible = showSaved ? saved : pending;
  const status = !snapshot?.enabled ? "proactive.off"
    : snapshot.observationState !== "running" ? "proactive.waitingRecording"
      : snapshot.analyzing ? "proactive.analyzing" : "proactive.listening";
  return (
    <section className="pr-section" aria-label={t("proactive.title")}>
      <div className="pr-section__head">
        <div className="pr-section__intro">
          <span className="pr-section__icon"><Sparkles size={17} aria-hidden /></span>
          <div><h2>{t("proactive.title")}</h2><p>{t("proactive.description")}</p></div>
        </div>
        <button
          className="pr-switch" type="button" role="switch" aria-label={t("proactive.title")}
          aria-checked={snapshot?.enabled ?? false} disabled={!snapshot || toggling}
          onClick={async () => {
            setToggling(true);
            await context.setEnabled(!snapshot?.enabled);
            setToggling(false);
          }}
        ><span /></button>
      </div>
      <div className="pr-section__foot">
        <span className="pr-section__status"><span className={snapshot?.enabled && snapshot.observationState === "running" ? "pr-status-dot pr-status-dot--on" : "pr-status-dot"} />{t(status)}</span>
        <button className="pr-link" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t("proactive.suggestions", { count: pending.length })}{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </div>
      {error || snapshot?.error ? <p className="pr-error" role="status">{error ?? snapshot?.error}</p> : null}
      {expanded ? (
        <div className="pr-section__records">
          <div className="pr-tabs" role="group" aria-label={t("proactive.records")}>
            <button type="button" aria-pressed={!showSaved} onClick={() => setShowSaved(false)}>{t("proactive.pending")} {pending.length}</button>
            <button type="button" aria-pressed={showSaved} onClick={() => setShowSaved(true)}>{t("proactive.saved")} {saved.length}</button>
          </div>
          {visible.length ? visible.map((item) => (
            <button className="pr-record" type="button" key={item.id} onClick={() => context.open(item.id)}>
              {item.status === "added" ? <Check size={16} /> : <ListTodo size={16} />}
              <span><strong>{item.title}</strong><small>{item.application} · {item.status === "snoozed" ? t("proactive.snoozed") : formatTime(item.detectedAt)}</small></span>
              <ChevronRight size={14} />
            </button>
          )) : <p className="pr-section__empty">{t(showSaved ? "proactive.noSaved" : "proactive.noPending")}</p>}
        </div>
      ) : null}
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function ProactiveReminderCard(props: {
  suggestion: ProactiveSuggestion;
  onAction(input: ProactiveReminderAction): Promise<void>;
  onClose(): void;
  autoHide?: boolean;
  hidden?: boolean;
}) {
  const { t } = useTranslation();
  const suggestion = props.suggestion;
  const [title, setTitle] = useState(suggestion.title);
  const [due, setDue] = useState(() => toLocalDateTime(suggestion.dueAt));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string; listName: string; dueAt: string | null } | null>(null);
  const [saved, setSaved] = useState(suggestion.status === "added");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const nativeAvailable = window.memmy?.platform === "darwin" && typeof window.memmy.createMacReminder === "function";
  const stale = !created && !saved && !["pending", "snoozed"].includes(suggestion.status);
  useEffect(() => {
    if (!props.autoHide || hovered || focused || editing || busy || created || saved || error) return;
    const timer = window.setTimeout(props.onClose, 30_000);
    return () => window.clearTimeout(timer);
  }, [props.autoHide, props.onClose, hovered, focused, editing, busy, created, saved, error]);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await operation(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const add = () => run(async () => {
    const bridge = window.memmy;
    if (!nativeAvailable || !bridge) throw new Error(t("proactive.desktopRequired"));
    if (!title.trim()) { setEditing(true); throw new Error(t("proactive.titleRequired")); }
    const dueAt = due ? new Date(due).toISOString() : null;
    if (dueAt && new Date(dueAt).getTime() <= Date.now() && !created) {
      setEditing(true);
      throw new Error(t("proactive.futureDate"));
    }
    let result = created;
    if (!result) {
      const reminder = await bridge.createMacReminder({
        requestId: suggestion.id,
        title: title.trim(),
        notes: `${t("proactive.source")}: ${suggestion.application}\n${formatTime(suggestion.detectedAt)}\n\n${suggestion.evidence}`,
        ...(dueAt ? { dueAt } : {})
      });
      result = { ...reminder, dueAt };
      setCreated(result);
      setEditing(false);
    }
    await props.onAction({ id: suggestion.id, action: "added", reminder_id: result.id, title: result.title, due_at: result.dueAt });
    setSaved(true);
  });

  return (
    <aside className="pr-card" role="region" hidden={props.hidden} aria-label={t("proactive.title")}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) props.onClose(); }}
    >
      <div className="pr-card__head">
        <span className="pr-card__eyebrow">{saved ? <Check size={15} /> : <Sparkles size={15} />}{t(saved ? "proactive.added" : "proactive.cardEyebrow")}</span>
        <button className="pr-icon-button" type="button" aria-label={t("proactive.close")} disabled={busy} onClick={props.onClose}><X size={16} /></button>
      </div>
      <div aria-live="polite">
        <h3>{created?.title ?? title}</h3>
        {saved ? <p className="pr-card__reason">{created ? t("proactive.savedTo", { list: created.listName }) : t("proactive.savedHint")}</p>
          : <p className="pr-card__reason">{suggestion.reason}</p>}
      </div>
      {!saved ? <>
        <details className="pr-card__source"><summary>{t("proactive.source")} · {suggestion.application}<ChevronDown size={12} /></summary><blockquote>{suggestion.evidence}</blockquote></details>
        {editing ? <div className="pr-card__editor">
          <label>{t("proactive.itemTitle")}<input autoFocus value={title} maxLength={300} disabled={busy || !!created} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>{t("proactive.remindAt")}<input type="datetime-local" value={due} disabled={busy || !!created} onChange={(event) => setDue(event.target.value)} /></label>
          <small>{t("proactive.optionalTime")}</small>
        </div> : <div className="pr-card__destination"><ListTodo size={14} /><span>{t("proactive.destination")}</span>{due ? <span className="pr-card__due"><Bell size={12} />{formatTime(new Date(due).toISOString())}</span> : null}</div>}
        {!nativeAvailable ? <p className="pr-card__hint">{t("proactive.desktopRequired")}</p> : null}
        {stale ? <p className="pr-card__hint">{t("proactive.expired")}</p> : null}
      </> : null}
      {error ? <p className="pr-error" role="alert">{created && !saved ? `${t("proactive.syncFailed")} ` : ""}{error}</p> : null}
      {saved ? <div className="pr-card__actions">
        <button type="button" className="pr-primary" disabled={!window.memmy?.openMacReminders || busy} onClick={() => void run(async () => { await window.memmy?.openMacReminders(); })}>{t("proactive.openReminders")}</button>
        <button type="button" className="pr-secondary" onClick={props.onClose}>{t("proactive.done")}</button>
      </div> : <>
        <div className="pr-card__actions">
          <button type="button" className="pr-primary" disabled={busy || !nativeAvailable || stale} onClick={() => void add()}>{t(busy ? "proactive.adding" : created ? "proactive.retrySync" : "proactive.add")}</button>
          {!created ? <button type="button" className="pr-secondary" disabled={busy || stale} onClick={() => setEditing(!editing)}><Pencil size={13} />{t(editing ? "proactive.collapse" : "proactive.edit")}</button> : null}
        </div>
        {!created && !stale ? <div className="pr-card__secondary-actions">
          <button type="button" disabled={busy} onClick={() => void run(async () => { await props.onAction({ id: suggestion.id, action: "snooze" }); props.onClose(); })}>{t("proactive.snooze")}</button>
          <button type="button" disabled={busy} onClick={() => void run(async () => { await props.onAction({ id: suggestion.id, action: "dismiss" }); props.onClose(); })}>{t("proactive.dismiss")}</button>
        </div> : null}
      </>}
    </aside>
  );
}
