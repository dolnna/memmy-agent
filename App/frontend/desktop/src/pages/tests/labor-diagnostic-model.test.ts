import { describe, expect, it } from "vitest";
import {
  LEGAL_DIAGNOSIS_COMMAND,
  formatSourceSize,
  isLegalDiagSourceName,
  isLegalDiagnosisCommand,
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

});
