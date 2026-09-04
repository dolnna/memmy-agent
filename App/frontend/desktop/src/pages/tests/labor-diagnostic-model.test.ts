import { describe, expect, it } from "vitest";
import {
  LEGAL_DIAGNOSIS_COMMAND,
  formatSourceSize,
  isLegalDiagSourceName,
  isLegalDiagnosisCommand,
  legalDiagConversationAction,
  stripLegalDiagnosisCommand
} from "../labor-diagnostic-model.js";

describe("labor diagnostic model", () => {
  it("detects the capability command in a composer draft", () => {
    expect(isLegalDiagnosisCommand("/legal-diagnosis")).toBe(true);
    expect(isLegalDiagnosisCommand("/legal-diagnosis  上海某制造企业")).toBe(true);
    expect(isLegalDiagnosisCommand("请做 /legal-diagnosis 诊断")).toBe(true);
    expect(isLegalDiagnosisCommand("/legal-diagnostic")).toBe(false);
    expect(stripLegalDiagnosisCommand("/legal-diagnosis  上海某制造企业")).toBe("上海某制造企业");
    expect(LEGAL_DIAGNOSIS_COMMAND).toBe("/legal-diagnosis");
  });

  it("accepts interview recordings and survey notes", () => {
    expect(isLegalDiagSourceName("访谈.m4a")).toBe(true);
    expect(isLegalDiagSourceName("现场录音.webm")).toBe(true);
    expect(isLegalDiagSourceName("记录.docx")).toBe(true);
    expect(isLegalDiagSourceName("营业执照.png")).toBe(true);
    expect(isLegalDiagSourceName("营业执照.jpg")).toBe(true);
    expect(isLegalDiagSourceName("未知程序.exe")).toBe(false);
    expect(formatSourceSize(1536)).toBe("1.5 KB");
  });

  it.each([
    ["我要模板", "templates"],
    ["给我企业预填信息模版", "templates"],
    ["帮我下载访谈诊断表模板", "templates"],
    ["我要录音", "recording"],
    ["请帮我打开录音卡片", "recording"],
    ["我已完成现场调研", "materials"],
    ["我要补充资料", "materials"],
    ["我要上传录音", "materials"],
    ["打开待核实问题", "questions"],
    ["不回答待核实问题", null],
    ["先跳过", "dismiss"],
    ["生成 AI 诊断报告", "generate"],
    ["暂时不要生成报告", null],
    ["我不要录音", null],
    ["公司没有保存录音", null],
    ["我要补充一些信息，公司有三个主体", null],
    ["我已经上传材料，先不要生成报告", null],
    ["模板里记录了三个经营主体", null]
  ])("routes %s without treating factual mentions as commands", (text, action) => {
    expect(legalDiagConversationAction(text)).toBe(action);
  });

});
