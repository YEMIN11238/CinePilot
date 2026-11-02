import { z } from "zod";

const briefFieldSchema = z.strictObject({
  extracted: z.string().trim().max(4000),
  suggestion: z.string().trim().max(4000),
  question: z.string().trim().max(400),
});

export const directorBriefDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(4000),
  characters: briefFieldSchema,
  invariants: briefFieldSchema,
});

export type CreativeBriefDraft = z.infer<typeof directorBriefDraftSchema>;
export type CreativeBriefInput = {
  requestId: string;
  brief: string;
  style: string;
  ratio: "16:9" | "9:16" | "1:1";
  targetDuration: 20 | 30 | 60;
  providerId?: string;
  modelId?: string;
  hasReference?: boolean;
};
