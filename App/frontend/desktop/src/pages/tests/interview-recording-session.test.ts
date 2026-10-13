import { describe, expect, it, vi } from "vitest";
import { InterviewRecordingSessionStore, withActiveInterviewRecording } from "../interview-recording-session.js";

const startingItem = {
  id: "recording-a",
  label: "访谈录音",
  createdAt: "2026-10-13T00:00:00.000Z",
  state: { mode: "starting" as const, elapsedSeconds: 0, transcript: "", transcriptSource: null }
};

describe("InterviewRecordingSessionStore", () => {
  it("shows the same live item in another conversation without duplicating it", () => {
    const active = {
      owner: { kind: "legal" as const, scopeKey: "case-a" },
      item: { ...startingItem, state: { ...startingItem.state, mode: "recording" as const, elapsedSeconds: 42 } }
    };
    const stale = { ...startingItem, state: { ...startingItem.state, elapsedSeconds: 1 } };
    expect(withActiveInterviewRecording([stale], active)).toEqual([active.item]);
    expect(withActiveInterviewRecording([], active)).toEqual([active.item]);
  });

  it("allows one live recording across conversations and delegates controls to its owner", () => {
    const store = new InterviewRecordingSessionStore();
    const pause = vi.fn();
    const resume = vi.fn();
    const finish = vi.fn();
    const rename = vi.fn();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.claim({ kind: "legal", scopeKey: "case-a" }, startingItem, { pause, resume, finish, rename })).toBe(true);
    expect(store.claim({ kind: "agent", scopeKey: "chat-b" }, { ...startingItem, id: "recording-b" }, { pause, resume, finish })).toBe(false);
    store.publish("recording-b", { ...startingItem, id: "recording-b" });
    expect(store.getSnapshot()?.item.id).toBe("recording-a");

    store.publish("recording-a", {
      ...startingItem,
      state: { mode: "recording", elapsedSeconds: 12, transcript: "", transcriptSource: null }
    });
    expect(store.getSnapshot()?.item.state.elapsedSeconds).toBe(12);
    store.pause();
    store.resume();
    store.finish();
    store.rename("劳动访谈");
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith("劳动访谈");
    store.release("recording-b");
    expect(store.getSnapshot()?.item.id).toBe("recording-a");
    store.release("recording-a");
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.claim({ kind: "agent", scopeKey: "chat-b" }, { ...startingItem, id: "recording-b" }, { pause, resume, finish })).toBe(true);
  });
});
