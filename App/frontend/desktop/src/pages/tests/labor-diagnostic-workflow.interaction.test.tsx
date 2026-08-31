// @vitest-environment happy-dom

import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { LEGAL_DIAG_QUESTIONS, type LegalDiagPhase } from "../labor-diagnostic-model.js";
import {
  LEGAL_DIAG_TODO_INTERVAL_MS,
  LaborDiagnosticWorkflow
} from "../labor-diagnostic-workflow.js";
import { LEGAL_DIAG_TODO_ITEMS } from "../labor-diagnostic-demo-data.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function WorkflowHarness(props: { onPhase: (phase: LegalDiagPhase) => void }) {
  const [phase, setPhase] = useState<LegalDiagPhase>({ kind: "setup" });
  const [draft, setDraft] = useState("");
  return (
    <LaborDiagnosticWorkflow
      prompt="上海某制造企业"
      phase={phase}
      onPhaseChange={(next) => {
        props.onPhase(next);
        setPhase(next);
      }}
      composerDraft={draft}
      onComposerDraftChange={setDraft}
      onComposerSubmit={() => undefined}
    />
  );
}

describe("LaborDiagnosticWorkflow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let phase: LegalDiagPhase = { kind: "setup" };

  beforeEach(async () => {
    vi.useFakeTimers();
    phase = { kind: "setup" };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <WorkflowHarness onPhase={(next) => { phase = next; }} />
        </I18nProvider>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("walks variables, sources, generation, and exception edits", async () => {
    expect(container.querySelector(".litrev-question-card h2")?.textContent).toBe("企业变量表");

    const companyInput = container.querySelector<HTMLInputElement>('input[aria-label^="公司全称"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(companyInput, "上海某制造有限公司");
      companyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      companyInput.closest("form")!.requestSubmit();
    });

    for (const question of LEGAL_DIAG_QUESTIONS) {
      if (question.freeText || !question.options[0]) continue;
      const option = [...container.querySelectorAll<HTMLButtonElement>(".litrev-question-option")]
        .find((button) => button.textContent?.includes(question.options[0]!));
      expect(option, question.id).toBeTruthy();
      await act(async () => {
        option!.click();
      });
    }

    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent === "确认");
    await act(async () => {
      confirm!.click();
    });
    expect(phase.kind).toBe("sources");
    expect(container.querySelector(".litrev-source-card")?.textContent).toContain("资料采集");

    const generate = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("跳过，按已有内容继续"));
    await act(async () => {
      generate!.click();
    });
    expect(phase.kind).toBe("thinking");

    const steps = 12 + LEGAL_DIAG_TODO_ITEMS.length;
    for (let index = 0; index < steps && phase.kind !== "review"; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LEGAL_DIAG_TODO_INTERVAL_MS);
      });
    }
    expect(phase.kind).toBe("review");
    expect(container.textContent).toContain("诊断报告已经生成");
    expect(container.textContent).toContain("以下信息在录音和资料中未提及");
    expect(container.querySelector(".litrev-missing-info ol")?.children.length).toBeGreaterThan(0);
  });

  it("lets the user confirm the variable card without filling every item", async () => {
    const confirm = [...container.querySelectorAll<HTMLButtonElement>(".litrev-question-card__foot button")]
      .find((button) => button.textContent === "确认");
    expect(confirm?.disabled).toBe(false);
    await act(async () => {
      confirm!.click();
    });
    expect(phase.kind).toBe("sources");
  });

  it("skips the variable card when the user closes it", async () => {
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="关闭并跳过"]')!;
    await act(async () => {
      close.click();
    });
    expect(phase.kind).toBe("sources");
    expect(container.textContent).toContain("未填写");
  });
});
