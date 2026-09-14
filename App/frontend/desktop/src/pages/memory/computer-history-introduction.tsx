import { ArrowRight, Bell, BrainCircuit, Check, History, ListTodo, Monitor, ShieldCheck, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ComputerHistorySnapshot, MemmyAgentClient } from "../../api/memmy-agent-client.js";
import { useTranslation } from "../../i18n/use-translation.js";
import "./computer-history-introduction.css";

export const HISTORY_INTRO_SEEN_KEY = "memmy.computerHistoryIntroduction.v1";

export function shouldIntroduceComputerHistory(): boolean {
  try { return window.localStorage.getItem(HISTORY_INTRO_SEEN_KEY) !== "seen"; } catch { return false; }
}

export function markComputerHistoryIntroduced(): void {
  try { window.localStorage.setItem(HISTORY_INTRO_SEEN_KEY, "seen"); } catch { /* The feature remains usable without storage. */ }
}

type IntroductionChoices = { recording: boolean; proactive: boolean };
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function formatHistoryIntroductionError(cause: unknown, unavailableMessage: string): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const status = cause && typeof cause === "object" && "status" in cause ? cause.status : null;
  const connectionUnavailable = status === 401 || status === 403
    || (cause instanceof Error && cause.name === "AgentGatewayUnavailableError")
    || /(?:request failed with status (?:401|403)\b|failed to fetch|fetch failed|load failed|network(?:error| request failed)|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket hang up|gateway is not ready)/i.test(detail);
  return connectionUnavailable ? unavailableMessage : detail;
}

/** Read before every attempt so retries resume from real, possibly partial success. */
export async function applyHistoryIntroductionSettings(
  client: MemmyAgentClient,
  choices: Partial<IntroductionChoices>,
  pause: (ms: number) => Promise<void> = wait
): Promise<ComputerHistorySnapshot> {
  let history = await client.getComputerHistory();
  const proactive = await client.getProactiveReminders();
  // Stop recording first when requested; configure the reminder preference
  // before starting recording so no unwanted analysis starts in between.
  if (choices.recording === false && history.observation.state !== "stopped") {
    try { history = await client.stopComputerHistoryObservation(); }
    catch (cause) {
      history = await client.getComputerHistory();
      if (history.observation.state !== "stopped") throw cause;
    }
    if (history.observation.state !== "stopped") throw new Error(history.observation.error || "活动记录尚未停止，请稍后重试。");
  }
  if (choices.proactive !== undefined && choices.proactive !== proactive.enabled) {
    await client.updateProactiveRemindersSettings(choices.proactive);
  }

  if (choices.recording && history.observation.state !== "running") {
    try {
      history = history.observation.state === "paused"
        ? await client.resumeComputerHistoryObservation()
        : await client.startComputerHistoryObservation();
    } catch (cause) {
      history = await client.getComputerHistory();
      if (history.observation.state !== "running") throw cause;
    }
  }
  if (choices.recording) {
    // Running means the process was spawned; only recorderReady confirms that
    // helper compilation and system permission checks actually completed.
    for (let attempt = 0; history.observation.recorderReady !== true; attempt += 1) {
      if (history.observation.state !== "running") throw new Error(history.observation.error || "活动记录尚未成功启动，请检查系统权限后重试。");
      if (attempt >= 60) throw new Error("活动记录尚未就绪，请检查系统权限后重试。当前设置已保留。");
      await pause(500);
      history = await client.getComputerHistory();
    }
  }

  const confirmed = await client.getProactiveReminders();
  if (choices.proactive !== undefined && confirmed.enabled !== choices.proactive) throw new Error("主动提醒设置尚未生效，请重试。");
  history = await client.getComputerHistory();
  if (choices.recording && (history.observation.state !== "running" || history.observation.recorderReady !== true)) {
    throw new Error(history.observation.error || "活动记录尚未成功启动，请检查系统权限后重试。");
  }
  if (choices.recording === false && history.observation.state !== "stopped") throw new Error(history.observation.error || "活动记录尚未停止，请稍后重试。");
  return history;
}

export function ComputerHistoryIntroduction(props: {
  client: MemmyAgentClient;
  onClose(): void;
  onApplied(snapshot: ComputerHistorySnapshot): void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [choices, setChoices] = useState<IntroductionChoices>({ recording: false, proactive: false });
  const [initial, setInitial] = useState<IntroductionChoices | null>(null);
  const [observationState, setObservationState] = useState<string | null>(null);
  const [recorderReady, setRecorderReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const close = useCallback(() => { if (!busyRef.current) closeRef.current(); }, []);

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      alive.current = false;
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [close]);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError(null);
    void Promise.all([props.client.getComputerHistory(), props.client.getProactiveReminders()]).then(([history, proactive]) => {
      if (!active) return;
      const current = { recording: history.observation.state === "running", proactive: proactive.enabled };
      setChoices(current);
      setInitial(current);
      setObservationState(history.observation.state);
      setRecorderReady(history.observation.recorderReady === true);
      setLoaded(true);
      if (history.observation.state === "failed") setError(history.observation.error || t("historyIntro.recordingFailed"));
    }).catch((cause: unknown) => { if (active) setError(formatHistoryIntroductionError(cause, t("historyIntro.connectionUnavailable"))); });
    return () => { active = false; };
  }, [props.client, reload, t]);

  const apply = async () => {
    if (!loaded || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const changes: Partial<IntroductionChoices> = {};
      if (initial?.recording !== choices.recording || (choices.recording && !recorderReady)) changes.recording = choices.recording;
      if (initial?.proactive !== choices.proactive) changes.proactive = choices.proactive;
      const next = await applyHistoryIntroductionSettings(props.client, changes);
      if (alive.current) props.onApplied(next);
    } catch (cause) {
      if (alive.current) setError(formatHistoryIntroductionError(cause, t("historyIntro.connectionUnavailable")));
      // A prior step may have succeeded. Keep the user's draft, but base the
      // next attempt on what actually took effect, including changed choices.
      try {
        const [history, proactive] = await Promise.all([props.client.getComputerHistory(), props.client.getProactiveReminders()]);
        if (alive.current) {
          setInitial({ recording: history.observation.state === "running", proactive: proactive.enabled });
          setObservationState(history.observation.state);
          setRecorderReady(history.observation.recorderReady === true);
        }
      } catch { /* Keep the original, actionable failure visible. */ }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const changed = initial && (initial.recording !== choices.recording || initial.proactive !== choices.proactive);
  const cta = busy ? "historyIntro.applying" : !loaded ? error ? "historyIntro.unavailable" : "historyIntro.loading"
    : !changed ? choices.recording && !recorderReady ? "historyIntro.checkReady" : "historyIntro.understood"
      : choices.recording && !initial?.recording ? "historyIntro.begin" : "historyIntro.save";

  return createPortal(
    <div className="chi-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} className="chi-dialog" role="dialog" aria-modal="true" aria-labelledby="chi-title" aria-describedby="chi-description" tabIndex={-1} onKeyDown={trapFocus}>
        <button className="chi-close" type="button" aria-label={t("historyIntro.close")} disabled={busy} onClick={close}><X size={21} /></button>
        <div className="chi-copy">
          <p className="chi-eyebrow">{t("historyIntro.eyebrow")}</p>
          <h2 id="chi-title">{t("historyIntro.titleFirst")}<br />{t("historyIntro.titleSecond")}</h2>
          <p id="chi-description" className="chi-description">{t("historyIntro.description")}</p>
          <div className="chi-controls">
            <div className="chi-control">
              <span className="chi-control__icon chi-control__icon--history"><History size={18} /></span>
              <span><strong>{t("historyIntro.record")}</strong><small>{t(observationState === "paused" ? "historyIntro.recordPaused" : observationState === "running" && !recorderReady ? "historyIntro.recordPreparing" : "historyIntro.recordDetail")}</small></span>
              <button className="chi-switch" role="switch" type="button" aria-checked={choices.recording} aria-label={t("historyIntro.record")} disabled={!loaded || busy}
                onClick={() => setChoices((value) => ({ ...value, recording: !value.recording }))}><span /></button>
            </div>
            <div className="chi-control">
              <span className="chi-control__icon chi-control__icon--proactive"><Sparkles size={18} /></span>
              <span><strong>{t("historyIntro.proactive")}</strong><small>{t("historyIntro.proactiveDetail")}</small></span>
              <button className="chi-switch" role="switch" type="button" aria-checked={choices.proactive} aria-label={t("historyIntro.proactive")} disabled={!loaded || busy}
                onClick={() => setChoices((value) => ({ ...value, proactive: !value.proactive }))}><span /></button>
            </div>
          </div>
          <p className="chi-dependency">{t(!choices.recording && choices.proactive ? "historyIntro.dependsOnRecording" : "historyIntro.controlHint")}</p>
          <p className="chi-privacy"><ShieldCheck size={15} /><span>{t("historyIntro.privacy")}</span></p>
          {error ? <p className="chi-error" role="alert">{error}{!loaded ? <button type="button" onClick={() => setReload((value) => value + 1)}>{t("historyIntro.retryLoad")}</button> : null}</p> : null}
          <button className="chi-primary" type="button" disabled={!loaded || busy} onClick={() => void apply()}>{t(cta)}</button>
        </div>
        <div className="chi-visual" aria-label={t("historyIntro.diagramLabel")}>
          <div className="chi-orb chi-orb--one" /><div className="chi-orb chi-orb--two" />
          <div className="chi-flow" aria-hidden>
            <span><Monitor size={35} strokeWidth={1.6} /></span><i /><span className="chi-flow__brain"><BrainCircuit size={39} strokeWidth={1.5} /></span><i /><span><Bell size={33} strokeWidth={1.6} /></span>
          </div>
          <div className="chi-explainer">
            <div className="chi-explainer__label">{t("historyIntro.howItWorks")}</div>
            <div className="chi-step"><span className="chi-step__symbol"><Monitor size={20} /></span><div><h3>{t("historyIntro.stepObserve")}</h3><p>{t("historyIntro.stepObserveDetail")}</p></div><ArrowRight size={16} /></div>
            <div className="chi-step"><span className="chi-step__symbol chi-step__symbol--brain"><Sparkles size={20} /></span><div><h3>{t("historyIntro.stepUnderstand")}</h3><p>{t("historyIntro.stepUnderstandDetail")}</p></div><ArrowRight size={16} /></div>
            <div className="chi-step"><span className="chi-step__symbol chi-step__symbol--reminder"><ListTodo size={20} /></span><div><h3>{t("historyIntro.stepAsk")}</h3><p>{t("historyIntro.stepAskDetail")}</p></div><Check size={16} /></div>
          </div>
          <p className="chi-visual__caption">{t("historyIntro.caption")}</p>
        </div>
      </section>
    </div>, document.body
  );
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'));
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === event.currentTarget)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || active === event.currentTarget)) { event.preventDefault(); first.focus(); }
}
