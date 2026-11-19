import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// The SMTP settings form once posted `fromEmail`, `fromName` and `enabled` while the server action read `from`, `name` and
// `smtpEnabled`, so saving always failed validation. Every field the action reads must be a field the form posts.
test("the SMTP save action reads exactly the fields the settings form posts", () => {
  const action = read("src/server/platform/actions.ts");
  const body = action.slice(action.indexOf("export async function smtpSaveAction"), action.indexOf("export async function smtpTestAction"));
  const form = read("src/components/platform-forms.tsx");
  const formStart = form.indexOf("export function SmtpSettingsForm");
  const saveForm = form.slice(form.indexOf("<form action={saveFormAction}", formStart), form.indexOf("<form action={testFormAction}", formStart));
  const posted = new Set([...saveForm.matchAll(/\bname="([A-Za-z]+)"/g)].map((match) => match[1]));
  const read_ = [...body.matchAll(/(?:input|enabled)\(form, "([A-Za-z]+)"\)/g)].map((match) => match[1]);
  assert.ok(read_.length >= 9, "the action reads its fields");
  for (const field of read_) assert.ok(posted.has(field), `the form must post "${field}"`);
});
