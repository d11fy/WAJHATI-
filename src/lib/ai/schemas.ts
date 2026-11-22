import { z } from "zod";
import { aiCommands, aiField, aiTones, themeTextFields, type AiLanguage, type ThemeTextField } from "./fields";
import { themeIds } from "../theme-config";

/** Strips control characters and angle brackets so a value can never carry markup or smuggle a delimiter into a prompt or a field. */
export function cleanText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/g, "").replace(/[<>]/g, "").replace(/\s+\n/g, "\n").trim();
}

const free = (max: number) => z.string().max(max).transform(cleanText);

export const assistRequest = z.strictObject({
  fieldId: z.string().refine((id) => aiField(id) !== null),
  command: z.enum(aiCommands),
  tone: z.enum(aiTones).optional(),
  /** The text currently in the field, or for "translate" the text of the other-language field. */
  text: free(2000),
  /** Merchant facts the writer may use: nothing else is available to state as fact. */
  context: z.strictObject({ productName: free(200).optional(), category: free(120).optional(), notes: free(600).optional() }).optional(),
  key: z.uuid(),
}).superRefine((value, context) => {
  const needsText = value.command !== "write";
  if (needsText && value.text.length === 0) context.addIssue({ code: "custom", message: "text", path: ["text"] });
  if (value.command === "tone" && !value.tone) context.addIssue({ code: "custom", message: "tone", path: ["tone"] });
});
export type AssistRequest = z.output<typeof assistRequest>;

export const assistOutput = z.strictObject({ options: z.array(z.string()).min(1).max(3) });

export const fillRequest = z.strictObject({
  theme: z.enum(themeIds),
  idea: free(600),
  businessType: free(80),
  audience: free(120),
  tone: z.enum(aiTones),
  languages: z.enum(["ar", "en", "both"]),
  useStoreData: z.boolean(),
  key: z.uuid(),
});
export type FillRequest = z.output<typeof fillRequest>;

export function fillLanguages(value: FillRequest["languages"]): AiLanguage[] {
  return value === "both" ? ["ar", "en"] : [value];
}

/** Builds the strict output schema for exactly the fields this theme and language choice allow. Unknown keys are rejected, never ignored. */
export function fillOutputSchema(fields: readonly ThemeTextField[]) {
  const shape = Object.fromEntries(fields.map((field) => [field.path, z.string().transform(cleanText).pipe(z.string().min(1).max(field.max))]));
  return z.strictObject(shape);
}

export type AssistFailure = "denied" | "disabled" | "suspended" | "rate_limited" | "no_plan" | "insufficient" | "invalid" | "duplicate" | "unavailable" | "bad_output" | "not_configured";
export type AssistSuccess = { ok: true; options: string[]; cost: number; balance: number; extra: number };
export type FillSuccess = { ok: true; values: Record<string, string>; cost: number; balance: number; extra: number };
export type Failure = { ok: false; error: AssistFailure };

export function themeFieldsFor(request: Pick<FillRequest, "theme" | "languages">) {
  return themeTextFields(request.theme, fillLanguages(request.languages));
}
