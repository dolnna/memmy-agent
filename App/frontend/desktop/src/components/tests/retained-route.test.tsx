// @vitest-environment happy-dom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedRoute } from "../retained-route.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function DraftPage(props: { onSetup: () => void; onCleanup: () => void }) {
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState(0);
  useEffect(() => {
    props.onSetup();
    const onEvent = () => setEvents((count) => count + 1);
    window.addEventListener("retained-route-test", onEvent);
    return () => {
      window.removeEventListener("retained-route-test", onEvent);
      props.onCleanup();
    };
  }, [props.onSetup, props.onCleanup]);
  return <section><input aria-label="草稿" value={draft} onInput={(event) => setDraft(event.currentTarget.value)} /><output>{events}</output></section>;
}

describe("RetainedRoute", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSetup = vi.fn();
  const onCleanup = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onSetup.mockClear();
    onCleanup.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(active: boolean, key = "account-a") {
    await act(async () => root.render(<RetainedRoute key={key} active={active}><DraftPage onSetup={onSetup} onCleanup={onCleanup} /></RetainedRoute>));
  }

  async function typeDraft(value: string) {
    const input = container.querySelector("input")!;
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("does not mount a route that has never been visited", async () => {
    await render(false);
    expect(container.querySelector("input")).toBeNull();
    expect(onSetup).not.toHaveBeenCalled();
    expect(onCleanup).not.toHaveBeenCalled();
    await render(true);
    expect(container.querySelector("input")).not.toBeNull();
    expect(onSetup).toHaveBeenCalledOnce();
  });

  it("preserves the input while hidden and suspends and resumes its effects", async () => {
    await render(true);
    await typeDraft("原来的诊断输入和材料");
    await act(async () => { window.dispatchEvent(new Event("retained-route-test")); });
    expect(container.querySelector("output")!.textContent).toBe("1");
    await render(false);
    expect(onCleanup).toHaveBeenCalledOnce();
    expect(container.querySelector("section")!.style.display).toBe("none");
    await act(async () => { window.dispatchEvent(new Event("retained-route-test")); });
    await render(true);
    expect(container.querySelector("input")!.value).toBe("原来的诊断输入和材料");
    expect(container.querySelector("output")!.textContent).toBe("1");
    expect(onSetup).toHaveBeenCalledTimes(2);
    expect(container.querySelector("section")!.style.display).not.toBe("none");
    await act(async () => { window.dispatchEvent(new Event("retained-route-test")); });
    expect(container.querySelector("output")!.textContent).toBe("2");
  });

  it("clears retained state and visited status when the account or route instance key changes", async () => {
    await render(true);
    await typeDraft("上一个账号的内容");
    await render(false);
    await render(false, "account-b");
    expect(container.querySelector("input")).toBeNull();
    await render(true, "account-b");
    expect(container.querySelector("input")!.value).toBe("");
    expect(container.querySelector("output")!.textContent).toBe("0");
    expect(onSetup).toHaveBeenCalledTimes(2);
  });
});
