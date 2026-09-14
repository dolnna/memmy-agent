import { z } from "zod";

export const ProactiveSuggestionSchema = z.object({
  id: z.string(),
  kind: z.literal("reminder"),
  title: z.string(),
  reason: z.string(),
  evidence: z.string(),
  application: z.string(),
  detectedAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(["pending", "snoozed", "dismissed", "added", "expired"]),
  dueAt: z.string().nullable(),
  reminderId: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  notifiedAt: z.string().nullable()
});

export const ProactiveRemindersSnapshotSchema = z.object({
  enabled: z.boolean(),
  observationState: z.string(),
  analyzing: z.boolean(),
  lastAnalyzedAt: z.string().nullable(),
  error: z.string().nullable(),
  suggestions: z.array(ProactiveSuggestionSchema)
});

export type ProactiveSuggestion = z.infer<typeof ProactiveSuggestionSchema>;
export type ProactiveRemindersSnapshot = z.infer<typeof ProactiveRemindersSnapshotSchema>;
export type ProactiveReminderAction = {
  id: string;
  action: "shown" | "snooze" | "dismiss" | "added";
  reminder_id?: string;
  title?: string;
  due_at?: string | null;
};
