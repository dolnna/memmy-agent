import { useSyncExternalStore } from "react";
import type { LegalRecordingViewItem } from "./labor-recording-preview-pane.js";

export interface InterviewRecordingOwner {
  kind: "agent" | "legal";
  scopeKey: string;
}

export interface ActiveInterviewRecording {
  owner: InterviewRecordingOwner;
  item: LegalRecordingViewItem;
}

export interface InterviewRecordingControls {
  pause(): void;
  resume(): void;
  finish(): void | Promise<void>;
  rename?(name: string): void;
}

/** One live microphone session for the desktop renderer, independent of the selected chat. */
export class InterviewRecordingSessionStore {
  private active: ActiveInterviewRecording | null = null;
  private controls: InterviewRecordingControls | null = null;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = () => this.active;

  claim(owner: InterviewRecordingOwner, item: LegalRecordingViewItem, controls: InterviewRecordingControls): boolean {
    if (this.active) return false;
    this.active = { owner, item };
    this.controls = controls;
    this.emit();
    return true;
  }

  publish(id: string, item: LegalRecordingViewItem): void {
    if (this.active?.item.id !== id) return;
    this.active = { ...this.active, item };
    this.emit();
  }

  release(id: string): void {
    if (this.active?.item.id !== id) return;
    this.active = null;
    this.controls = null;
    this.emit();
  }

  pause(): void { this.controls?.pause(); }
  resume(): void { this.controls?.resume(); }
  finish(): void { void this.controls?.finish(); }
  rename(name: string): void { this.controls?.rename?.(name); }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const interviewRecordingSession = new InterviewRecordingSessionStore();

export function withActiveInterviewRecording(
  items: LegalRecordingViewItem[],
  active: ActiveInterviewRecording | null
): LegalRecordingViewItem[] {
  if (!active) return items;
  return [...items.filter((item) => item.id !== active.item.id), active.item];
}

export function useActiveInterviewRecording(): ActiveInterviewRecording | null {
  return useSyncExternalStore(interviewRecordingSession.subscribe, interviewRecordingSession.getSnapshot, () => null);
}
