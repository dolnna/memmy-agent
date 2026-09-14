import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBus } from "../../../src/core/runtime-messages/index.js";
import { WebSocketChannel } from "../../../src/integrations/channels/websocket.js";
import { ComputerHistoryDemoService } from "../../../src/entrypoints/frontend-bridge/computer-history-api.js";
import { ProactiveReminders } from "../../../src/core/agent-runtime/computer-history/proactive-reminders.js";
import { buildProactiveEvidence } from "../../../src/core/agent-runtime/computer-history/proactive-evidence.js";

// Keep the real dispatcher and service. Only redirect the constructor's
// singleton lookup, so even constructing a channel cannot read user history.
const isolatedHistory = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../src/entrypoints/frontend-bridge/computer-history-api.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/entrypoints/frontend-bridge/computer-history-api.js")>(),
  getComputerHistoryDemoService: isolatedHistory.get,
}));

const roots: string[] = [];
const ROUTE = "/api/computer-history/proactive";
const TOKEN = "proactive-route-test-token";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

afterEach(() => {
  isolatedHistory.get.mockReset();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(seedSuggestion = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-proactive-routes-"));
  roots.push(root);
  const proactiveSettingsFile = path.join(root, "proactive.json");
  if (seedSuggestion) {
    const quote = "我明天下午把修改后的方案发给你";
    const now = Date.now();
    const evidence = buildProactiveEvidence([JSON.stringify({
      recordType: "human_event", sequence: 1, timestamp: new Date(now).toISOString(),
      eventType: "mouse_click", application: { name: "Fixture Chat", bundleId: "test.chat" },
      details: { accessibility: { role: "AXStaticText", title: quote } },
    })], { now });
    new ProactiveReminders(proactiveSettingsFile).accept({
      decision: "now", title: "明天下午发送修改后的方案", reason: "你刚才答应发送方案。",
      confidence: 0.95, evidenceQuote: quote, sourceEventIds: evidence.eventIds, dueAt: null,
    }, evidence);
  }
  const service = new ComputerHistoryDemoService({
    historyDirectory: path.join(root, "histories"),
    recordingDirectory: path.join(root, "recordings"),
    workflowDirectory: path.join(root, "workflows"),
    observationSettingsFile: path.join(root, "observation-settings.json"),
    proactiveSettingsFile,
  });
  isolatedHistory.get.mockReturnValue(service);
  const channel = new WebSocketChannel({ enabled: true, allowFrom: ["*"] }, new MessageBus(), {
    workspacePath: root,
  });
  Object.defineProperty(channel, "computerHistory", { value: service });
  channel.apiTokens.set(TOKEN, Date.now() / 1_000 + 60);
  const dispatch = async (route: string, method = "GET", body?: string, headers: Record<string, string> = AUTH) => {
    const response = await channel.dispatchHttp({}, { path: route, method, body, headers });
    if (!response) throw new Error(`Route was not dispatched: ${route}`);
    return response;
  };
  return { service, channel, proactiveSettingsFile, dispatch };
}

function responseJson(response: { body: Buffer | string }) {
  return JSON.parse(String(response.body));
}

describe("Computer History proactive HTTP routes", () => {
  it.each([
    { route: ROUTE, method: "GET", body: undefined },
    { route: `${ROUTE}/settings`, method: "POST", body: '{"enabled":false}' },
    { route: `${ROUTE}/action`, method: "POST", body: '{"id":"unknown","action":"dismiss"}' },
  ])("requires a valid API token for $method $route", async ({ route, method, body }) => {
    const { service, channel, dispatch } = fixture();
    const invalidHeaders: Record<string, string>[] = [{}, { Authorization: "Bearer wrong-token" }];
    for (const headers of invalidHeaders) {
      expect((await dispatch(route, method, body, headers)).status).toBe(401);
    }
    channel.apiTokens.set(TOKEN, Date.now() / 1_000 - 1);
    expect((await dispatch(route, method, body)).status).toBe(401);
    expect(service.proactiveSnapshot()).toMatchObject({ enabled: true, suggestions: [] });
  });

  it("dispatches authenticated GET to the actual service snapshot", async () => {
    const { service, dispatch } = fixture(true);
    const response = await dispatch(ROUTE);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(responseJson(response)).toEqual(service.proactiveSnapshot());
    expect(responseJson(response).suggestions).toHaveLength(1);
  });

  it.each([
    { route: ROUTE, method: "POST" },
    { route: ROUTE, method: "DELETE" },
    { route: `${ROUTE}/settings`, method: "GET" },
    { route: `${ROUTE}/settings`, method: "PUT" },
    { route: `${ROUTE}/action`, method: "GET" },
    { route: `${ROUTE}/action`, method: "DELETE" },
  ])("rejects unsupported method $method on $route", async ({ route, method }) => {
    const { service, dispatch } = fixture();
    expect((await dispatch(route, method, '{"enabled":false}')).status).toBe(405);
    expect(service.proactiveSnapshot().enabled).toBe(true);
  });

  it.each([`${ROUTE}/settings`, `${ROUTE}/action`])("rejects invalid JSON and non-object bodies on %s", async (route) => {
    const { dispatch } = fixture();
    for (const body of ["{", "null", "[]", '"text"', "12", "false"]) {
      const response = await dispatch(route, "POST", body);
      expect(response.status, body).toBe(400);
      expect(String(response.body)).toMatch(/body must be (JSON|an object)/u);
    }
  });

  it("persists explicit disabled/enabled booleans and refuses truthy coercion", async () => {
    const { service, proactiveSettingsFile, dispatch } = fixture();
    for (const body of [{}, { enabled: "false" }, { enabled: "true" }, { enabled: 0 }, { enabled: 1 }, { enabled: null }]) {
      const response = await dispatch(`${ROUTE}/settings`, "POST", JSON.stringify(body));
      expect(response.status).toBe(400);
      expect(service.proactiveSnapshot().enabled).toBe(true);
    }
    const disabled = await dispatch(`${ROUTE}/settings`, "POST", '{"enabled":false}');
    expect(disabled.status).toBe(200);
    expect(responseJson(disabled).enabled).toBe(false);
    expect(new ProactiveReminders(proactiveSettingsFile).snapshot("stopped").enabled).toBe(false);
    const enabled = await dispatch(`${ROUTE}/settings`, "POST", '{"enabled":true}');
    expect(enabled.status).toBe(200);
    expect(responseJson(enabled).enabled).toBe(true);
  });

  it("claims shown once through the real action route and returns 409 for a duplicate", async () => {
    const { service, dispatch } = fixture(true);
    // Model only the observation state. No recorder or desktop process starts.
    Object.defineProperty(service, "observationState", { value: "running", writable: true });
    const id = service.proactiveSnapshot().suggestions[0].id;
    const body = JSON.stringify({ id, action: "shown" });
    const first = await dispatch(`${ROUTE}/action`, "POST", body);
    expect(first.status).toBe(200);
    expect(responseJson(first).suggestions[0].notifiedAt).toEqual(expect.any(String));
    const duplicate = await dispatch(`${ROUTE}/action`, "POST", body);
    expect(duplicate.status).toBe(409);
    expect(service.proactiveSnapshot().suggestions).toHaveLength(1);
  });

  it("refuses shown while observation is stopped and supports dismiss without starting capture", async () => {
    const { service, dispatch } = fixture(true);
    const id = service.proactiveSnapshot().suggestions[0].id;
    expect((await dispatch(`${ROUTE}/action`, "POST", JSON.stringify({ id, action: "shown" }))).status).toBe(409);
    const dismissed = await dispatch(`${ROUTE}/action`, "POST", JSON.stringify({ id, action: "dismiss" }));
    expect(dismissed.status).toBe(200);
    expect(responseJson(dismissed).suggestions[0]).toMatchObject({ id, status: "dismissed", notifiedAt: null });
  });

  it("maps unknown suggestions and unsupported actions to HTTP errors", async () => {
    const { service, dispatch } = fixture(true);
    expect((await dispatch(`${ROUTE}/action`, "POST", '{"id":"missing","action":"dismiss"}')).status).toBe(404);
    const id = service.proactiveSnapshot().suggestions[0].id;
    expect((await dispatch(`${ROUTE}/action`, "POST", JSON.stringify({ id, action: "unsupported" }))).status).toBe(400);
    expect(service.proactiveSnapshot().suggestions[0].status).toBe("pending");
  });
});
