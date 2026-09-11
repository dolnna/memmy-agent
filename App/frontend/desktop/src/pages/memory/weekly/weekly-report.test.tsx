import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/i18n-provider.js";
import {
  buildWeeklyConversationDraft,
  WeeklyReportPage,
} from "./weekly-report-page.js";
import { previewWeeklyReports } from "./weekly-preview-data.js";

describe("weekly insight conversation handoff", () => {
  const report = previewWeeklyReports[0]!;

  it("carries only the selected insight and its supporting records into an unsent draft", () => {
    const insight = report.insights![1]!;
    const draft = buildWeeklyConversationDraft(report, insight);
    expect(draft.prompt).toBe(insight.prompt);
    expect(draft.title).toBe(insight.title);
    expect(draft.context).toContain(insight.body);
    expect(draft.sourceIds).toEqual(
      report.sources
        .filter((item) => insight.sourceIds.includes(item.id))
        .map((item) => item.id),
    );
    for (const source of report.sources) {
      if (insight.sourceIds.includes(source.id))
        expect(draft.context).toContain(source.excerpt);
      else expect(draft.context).not.toContain(source.excerpt);
    }
  });

  it("deduplicates source records for a conversation about the whole week", () => {
    const draft = buildWeeklyConversationDraft(report);
    expect(new Set(draft.sourceIds).size).toBe(draft.sourceIds.length);
    for (const insight of report.insights!)
      expect(draft.context).toContain(insight.title);
  });

  it("keeps the production entry empty until real insights are provided", () => {
    const html = renderToString(
      <I18nProvider language="zh-CN">
        <WeeklyReportPage />
      </I18nProvider>,
    );
    expect(html).toContain("还没有可查看的洞察");
    expect(html).not.toContain(report.insights![0]!.title);
    expect(html).not.toContain("示例预览");
  });
});
