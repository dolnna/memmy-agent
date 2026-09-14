import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComputerHistoryApiError,
  ComputerHistoryDemoService,
  isCodexSkysightCopy,
} from "../../../src/entrypoints/frontend-bridge/computer-history-api.js";
import { ObservationSettingsStore } from "../../../src/core/agent-runtime/computer-history/settings-store.js";

const roots: string[] = [];
const settingsFiles: string[] = [];
const instances: ComputerHistoryDemoService[] = [];
const recorderProcesses = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: recorderProcesses.spawn,
}));

type FakeRecorder = EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: ReturnType<typeof vi.fn> };
const children: FakeRecorder[] = [];

beforeEach(() => {
  recorderProcesses.spawn.mockReset();
  recorderProcesses.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      kill: vi.fn(),
    });
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit("exit", 0, "SIGTERM"));
      return true;
    });
    children.push(child);
    return child;
  });
});

function service(): ComputerHistoryDemoService {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-observation-"));
  roots.push(root);
  const settingsFile = path.join(root, "observation-settings.json");
  settingsFiles.push(settingsFile);
  const instance = new ComputerHistoryDemoService({
    observationSettingsFile: settingsFile,
    historyDirectory: path.join(root, "histories"),
    recordingDirectory: path.join(root, "recordings"),
    workflowDirectory: path.join(root, "workflows"),
  });
  instances.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.shutdown()));
  children.splice(0);
  settingsFiles.splice(0);
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function readySignal(instance: ComputerHistoryDemoService, overrides: Record<string, unknown> = {}): string {
  const snapshot = instance.snapshot();
  return `${JSON.stringify({
    type: "computer_history_recorder_ready", version: 1, recordingId: "human:fixture",
    eventsFile: path.join(snapshot.privacy.eventStreamDirectory, snapshot.observation.segmentId!, "events.jsonl"),
    ...overrides,
  })}\n`;
}

describe("Computer History observation lifecycle", () => {
  it("starts stopped, so a fresh install records nothing", () => {
    expect(service().snapshot().observation).toMatchObject({
      state: "stopped",
      recorderReady: false,
      startedAt: null,
      segmentId: null,
    });
  });

  it("opens a ten-minute-aligned segment when observation starts", async () => {
    const instance = service();
    const snapshot = instance.startObservation();

    expect(snapshot.observation.state).toBe("running");
    expect(snapshot.observation.recorderReady).toBe(false);
    // Segment ids align to the ten-minute grid so they sort and group cleanly.
    expect(snapshot.observation.segmentId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-[0-5]0-00Z$/);
    await instance.stopObservation();
  });

  it("writes segment metadata next to the event stream", async () => {
    const instance = service();
    const snapshot = instance.startObservation();
    const segmentId = snapshot.observation.segmentId!;
    const directory = path.join(
      instance.snapshot().privacy.markdownDirectory.replace(/histories$/, "recordings"),
      "segments",
      segmentId,
    );
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"));

    expect(metadata).toMatchObject({ id: segmentId });
    expect(metadata.eventsPath).toContain("events.jsonl");
    await instance.stopObservation();
  });

  it("keeps the current segment across a pause and resume", async () => {
    const instance = service();
    const started = instance.startObservation();
    const paused = await instance.pauseObservation();

    expect(paused.observation.state).toBe("paused");
    // Pause is not a weaker stop: the segment survives so the arc is unbroken.
    expect(paused.observation.segmentId).toBe(started.observation.segmentId);

    const resumed = instance.resumeObservation();
    expect(resumed.observation.state).toBe("running");
    expect(resumed.observation.segmentId).toBe(started.observation.segmentId);
    await instance.stopObservation();
  });

  it("clears the segment on stop while completed history remains", async () => {
    const instance = service();
    instance.startObservation();
    const stopped = await instance.stopObservation();

    expect(stopped.observation).toMatchObject({ state: "stopped", segmentId: null, startedAt: null });
  });

  it("writes the policy out on first start so it is explicit and editable", () => {
    const instance = service();
    const file = settingsFiles.at(-1)!;
    expect(fs.existsSync(file)).toBe(false);

    instance.startObservation();

    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written.observation.defaultApplicationBehavior).toBe("observe");
    expect(written.observation.rules).toEqual([]);
  });

  it("refuses to start on a settings file that does not parse", () => {
    const instance = service();
    fs.writeFileSync(settingsFiles.at(-1)!, "{ not json", "utf8");

    // An unreadable file is an error state, not a policy to fall back from.
    expect(() => instance.startObservation()).toThrow(/are not valid/);
  });

  it("refuses to start when the policy would record nothing", () => {
    const instance = service();
    new ObservationSettingsStore(settingsFiles.at(-1)!).write({
      observation: { defaultApplicationBehavior: "do_not_observe", defaultURLBehavior: "observe", rules: [] },
    });

    expect(() => instance.startObservation()).toThrow(/observes nothing yet/);
  });

  it("rejects transitions that do not apply to the current state", async () => {
    const instance = service();
    await expect(instance.stopObservation()).rejects.toBeInstanceOf(ComputerHistoryApiError);
    expect(() => instance.resumeObservation()).toThrow(ComputerHistoryApiError);

    instance.startObservation();
    expect(() => instance.startObservation()).toThrow(ComputerHistoryApiError);
    await instance.stopObservation();
  });

  it("stops recording when the app shuts down", async () => {
    const instance = service();
    instance.startObservation();
    await instance.shutdown();

    expect(instance.snapshot().observation.state).toBe("stopped");
    // Shutting down twice must stay quiet rather than throwing on app exit.
    await expect(instance.shutdown()).resolves.toBeUndefined();
  });
});

describe("native recorder readiness", () => {
  it("waits for the current helper acknowledgement, not a progress log or stale event file", () => {
    const instance = service();
    const started = instance.startObservation();
    const child = children.at(-1)!;
    fs.writeFileSync(path.join(started.privacy.eventStreamDirectory, started.observation.segmentId!, "events.jsonl"),
      JSON.stringify({ eventType: "recording_started", timestamp: new Date(Date.now() - 60_000).toISOString() }) + "\n");
    child.stdout.write("[recorder] recording now; keep the final result visible\n");
    child.stderr.write(readySignal(instance));
    child.stdout.write(readySignal(instance, { eventsFile: "/tmp/other-recorder/events.jsonl" }));
    child.stdout.write(readySignal(instance, { version: 2 }));
    child.stdout.write("not json\n");
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    child.stdout.write(readySignal(instance));
    expect(instance.snapshot().observation.recorderReady).toBe(true);
  });

  it("handles acknowledgements split across chunks including UTF-8 boundaries", () => {
    const instance = service();
    instance.startObservation();
    const child = children.at(-1)!;
    const signal = Buffer.from(readySignal(instance, { recordingId: "human:已就绪" }));
    const split = signal.indexOf(Buffer.from("已")) + 1;
    child.stdout.write(signal.subarray(0, split));
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    child.stdout.write(signal.subarray(split, signal.length - 1));
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    child.stdout.write(signal.subarray(signal.length - 1));
    expect(instance.snapshot().observation.recorderReady).toBe(true);
  });

  it("clears readiness immediately on pause/stop and rejects acknowledgements from replaced children", async () => {
    const instance = service();
    instance.startObservation();
    const first = children.at(-1)!;
    const firstSignal = readySignal(instance);
    first.stdout.write(firstSignal);
    expect(instance.snapshot().observation.recorderReady).toBe(true);
    const pausing = instance.pauseObservation();
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    first.stdout.write(firstSignal);
    await pausing;
    const resumed = instance.resumeObservation();
    expect(resumed.observation.recorderReady).toBe(false);
    first.stdout.write(firstSignal);
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    const second = children.at(-1)!;
    second.stdout.write(readySignal(instance));
    expect(instance.snapshot().observation.recorderReady).toBe(true);
    const stopping = instance.stopObservation();
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    second.stdout.write(firstSignal);
    await stopping;
    expect(instance.snapshot().observation).toMatchObject({ state: "stopped", recorderReady: false });
  });

  it("requires a new helper acknowledgement after rotation", async () => {
    const instance = service();
    instance.startObservation();
    const first = children.at(-1)!;
    const firstSignal = readySignal(instance);
    first.stdout.write(firstSignal);
    (instance as any).rotateSegment();
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    first.stdout.write(firstSignal);
    expect(instance.snapshot().observation.recorderReady).toBe(false);
    children.at(-1)!.stdout.write(readySignal(instance));
    expect(instance.snapshot().observation.recorderReady).toBe(true);
  });

  it("reports native startup and later process failures without retaining readiness", async () => {
    const instance = service();
    instance.startObservation();
    const first = children.at(-1)!;
    first.stderr.write("missing macOS permission: Accessibility\n");
    first.emit("exit", 1, null);
    expect(instance.snapshot().observation).toMatchObject({
      state: "failed", recorderReady: false, error: expect.stringContaining("Accessibility"),
    });
    const started = instance.startObservation();
    expect(started.observation.recorderReady).toBe(false);
    const second = children.at(-1)!;
    second.stdout.write(readySignal(instance));
    expect(instance.snapshot().observation.recorderReady).toBe(true);
    second.emit("error", new Error("native helper disconnected"));
    second.stdout.write(readySignal(instance));
    expect(instance.snapshot().observation).toMatchObject({ state: "failed", recorderReady: false });
  });
});

describe("Codex-derived history", () => {
  it("recognizes copies of Codex Skysight summaries by their file name", () => {
    // Codex: <utc>-<4 random chars>-<window>-memory-summary
    expect(isCodexSkysightCopy("2026-08-26T15-00-00-jsSd-10min-memory-summary")).toBe(true);
    expect(isCodexSkysightCopy("2026-08-26T12-00-00-gnKw-6h-memory-summary")).toBe(true);
  });

  it("never mistakes Memmy's own summaries for Codex copies", () => {
    // Memmy: <segment id>-<window>-summary, no random component, no "memory-".
    expect(isCodexSkysightCopy("2026-09-08T03-30-00Z-10min-summary")).toBe(false);
    expect(isCodexSkysightCopy("2026-09-08T00-00-00Z-6h-summary")).toBe(false);
    expect(isCodexSkysightCopy("2026-09-08T02-52-00Z-computer-history-demonstration")).toBe(false);
    expect(isCodexSkysightCopy("my-imported-note")).toBe(false);
  });

  it("keeps Codex copies out of the timeline while leaving them on disk", () => {
    const instance = service();
    const directory = instance.snapshot().privacy.markdownDirectory;
    fs.mkdirSync(directory, { recursive: true });
    const codexCopy = path.join(directory, "2026-08-26T15-00-00-jsSd-10min-memory-summary.md");
    const own = path.join(directory, "2026-09-08T03-30-00Z-10min-summary.md");
    fs.writeFileSync(codexCopy, '---\ntitle: "codex"\nsource_type: imported\n---\n', "utf8");
    fs.writeFileSync(own, '---\ntitle: "memmy"\n---\n', "utf8");

    const ids = instance.snapshot().histories.map((entry) => entry.id);
    expect(ids).toContain("2026-09-08T03-30-00Z-10min-summary");
    expect(ids).not.toContain("2026-08-26T15-00-00-jsSd-10min-memory-summary");
    // Hidden, not deleted.
    expect(fs.existsSync(codexCopy)).toBe(true);
  });
});

describe("snapshot shape", () => {
  // The desktop client parses this snapshot with a strict schema, so an extra
  // key is not a harmless addition — it fails the whole page.
  it("gives workflows exactly the fields a workflow has", () => {
    const instance = service();
    const directory = instance.snapshot().privacy.markdownDirectory.replace(/histories$/, "workflows");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "workflow-1.md"),
      '---\ntitle: "A workflow"\nsource_history_id: "history-1"\n---\n\nbody\n',
      "utf8",
    );

    const [workflow] = instance.snapshot().workflows;
    expect(Object.keys(workflow).sort()).toEqual([
      "createdAt",
      "filePath",
      "id",
      "markdown",
      "sourceHistoryId",
      "title",
    ]);
  });

  it("gives histories the fields the timeline renders from", () => {
    const instance = service();
    const directory = instance.snapshot().privacy.markdownDirectory;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "2026-09-08T03-30-00Z-10min-summary.md"),
      '---\ntitle: "A window"\ndescription: "You did a thing."\napplications: ["com.apple.Notes"]\n---\n\nbody\n',
      "utf8",
    );

    const [history] = instance.snapshot().histories;
    expect(history).toMatchObject({
      title: "A window",
      description: "You did a thing.",
      applications: ["com.apple.Notes"],
      summaryWindow: "10min",
    });
  });
});

describe("raw event retention", () => {
  const RETENTION_MS = 48 * 60 * 60 * 1000;

  function segmentDir(instance: ComputerHistoryDemoService, id: string, ageMs: number): string {
    const root = instance.snapshot().privacy.markdownDirectory.replace(/histories$/, "recordings");
    const directory = path.join(root, "segments", id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "events.jsonl"), "{}\n", "utf8");
    const at = new Date(Date.now() - ageMs);
    fs.utimesSync(directory, at, at);
    return directory;
  }

  it("expires each segment on its own age, not the container's", () => {
    const instance = service();
    const stale = segmentDir(instance, "2026-09-01T00-00-00Z", RETENTION_MS + 60_000);
    const fresh = segmentDir(instance, "2026-09-08T00-00-00Z", 60_000);

    instance.snapshot();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it("never expires the segments container itself", () => {
    const instance = service();
    const fresh = segmentDir(instance, "2026-09-08T00-00-00Z", 60_000);
    const container = path.dirname(fresh);
    const at = new Date(Date.now() - RETENTION_MS - 60_000);
    // A container older than the window used to take every segment with it.
    fs.utimesSync(container, at, at);

    instance.snapshot();

    expect(fs.existsSync(container)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it("leaves the open segment alone while it is still being written", () => {
    const instance = service();
    const snapshot = instance.startObservation();
    const id = snapshot.observation.segmentId!;
    const root = instance.snapshot().privacy.markdownDirectory.replace(/histories$/, "recordings");
    const open = path.join(root, "segments", id);
    const at = new Date(Date.now() - RETENTION_MS - 60_000);
    fs.utimesSync(open, at, at);

    instance.snapshot();

    expect(fs.existsSync(open)).toBe(true);
  });

  it("still expires recordings captured before segments existed", () => {
    const instance = service();
    const root = instance.snapshot().privacy.markdownDirectory.replace(/histories$/, "recordings");
    const legacy = path.join(root, "2026-09-01T00-00-00Z-computer-history-demonstration");
    fs.mkdirSync(legacy, { recursive: true });
    const at = new Date(Date.now() - RETENTION_MS - 60_000);
    fs.utimesSync(legacy, at, at);

    instance.snapshot();

    expect(fs.existsSync(legacy)).toBe(false);
  });
});

describe("pinning raw events", () => {
  const RETENTION_MS = 48 * 60 * 60 * 1000;

  function pinService(root: string): ComputerHistoryDemoService {
    return new ComputerHistoryDemoService({
      historyDirectory: path.join(root, "histories"),
      recordingDirectory: path.join(root, "recordings"),
      workflowDirectory: path.join(root, "workflows"),
      observationSettingsFile: path.join(root, "observation-settings.json"),
    });
  }

  // Builds an already-expired segment plus its summary. Paths are derived
  // without calling snapshot(), because snapshot() runs the cleanup and would
  // remove the segment before the test could pin it.
  function staleSegment(root: string, id: string): string {
    const directory = path.join(root, "recordings", "segments", id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "events.jsonl"), "{}\n", "utf8");
    fs.writeFileSync(
      path.join(directory, "metadata.json"),
      JSON.stringify({ id, startedAt: new Date(Date.now() - RETENTION_MS - 60_000).toISOString() }),
      "utf8",
    );
    const histories = path.join(root, "histories");
    fs.mkdirSync(histories, { recursive: true });
    fs.writeFileSync(
      path.join(histories, `${id}-10min-summary.md`),
      '---\ntitle: "A window"\nsource_type: captured\nsummary_state: ready\n---\n\nbody\n',
      "utf8",
    );
    return directory;
  }

  it("keeps a pinned segment past the retention window", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-pin-"));
    roots.push(root);
    const directory = staleSegment(root, "2026-09-01T00-00-00Z");
    const instance = pinService(root);

    instance.pinSegment("2026-09-01T00-00-00Z-10min-summary", true);
    instance.snapshot();

    expect(fs.existsSync(directory)).toBe(true);
    expect(instance.snapshot().histories[0]).toMatchObject({ pinned: true });
  });

  it("expires it again once unpinned", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-pin-"));
    roots.push(root);
    const directory = staleSegment(root, "2026-09-01T00-00-00Z");
    const instance = pinService(root);
    instance.pinSegment("2026-09-01T00-00-00Z-10min-summary", true);
    instance.snapshot();

    instance.pinSegment("2026-09-01T00-00-00Z-10min-summary", false);
    instance.snapshot();

    expect(fs.existsSync(directory)).toBe(false);
  });

  it("refuses to pin an entry whose events are already gone", () => {
    const instance = service();
    expect(() => instance.pinSegment("2026-09-01T00-00-00Z-10min-summary", true))
      .toThrow(/no longer on disk/);
  });

  it("reports replay as unavailable once the raw events expire", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-pin-"));
    roots.push(root);
    const directory = staleSegment(root, "2026-09-01T00-00-00Z");
    const instance = pinService(root);
    instance.pinSegment("2026-09-01T00-00-00Z-10min-summary", true);
    // Steps are derived from the event stream on demand, so its absence is
    // what makes an entry unreplayable — not anything in the summary text.
    expect(instance.snapshot().histories[0].replayPlan?.status).toBe("ready");

    fs.rmSync(directory, { recursive: true, force: true });

    expect(instance.snapshot().histories[0].replayPlan?.status).toBe("not_replayable");
  });
});

describe("showing a window only once it is written", () => {
  it("keeps a segment out of the timeline until the model has summarized it", () => {
    const instance = service();
    const directory = instance.snapshot().privacy.markdownDirectory;
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "2026-09-08T03-30-00Z-10min-summary.md");

    // What the mechanical pass leaves behind: a placeholder nobody should read.
    fs.writeFileSync(
      file,
      '---\ntitle: "Computer History 2026-09-08T03-30-00Z"\nsource_type: captured\nsummary_state: pending\n---\n\n## Memory summary\n\n（尚未生成）\n',
      "utf8",
    );
    expect(instance.snapshot().histories).toHaveLength(0);

    fs.writeFileSync(
      file,
      '---\ntitle: "A real title"\nsource_type: captured\nsummary_state: ready\n---\n\n## Memory summary\n\nYou did a thing.\n',
      "utf8",
    );
    expect(instance.snapshot().histories.map((entry) => entry.title)).toEqual(["A real title"]);
  });

  it("still shows imported and demo entries, which no model writes", () => {
    const instance = service();
    const directory = instance.snapshot().privacy.markdownDirectory;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "an-import.md"),
      '---\ntitle: "Imported"\nsource_type: imported\n---\n\nbody\n',
      "utf8",
    );

    expect(instance.snapshot().histories.map((entry) => entry.title)).toEqual(["Imported"]);
  });
});
