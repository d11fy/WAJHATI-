import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { test } from "node:test";

test("a production build hides signup entry points when registration is disabled at runtime", { timeout: 60_000 }, async (t) => {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], {
    env: { ...process.env, DAR_LOCAL_SIGNUP: "false", PUBLIC_SIGNUP_ENABLED: "false" },
    stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  const exited = once(child, "close");
  t.after(async () => { child.kill(); await exited; });
  const lines = createInterface({ input: child.stdout });
  let origin;
  for await (const line of lines) {
    origin ??= line.match(/Local:\s+(http:\/\/127\.0\.0\.1:[1-9]\d*)/)?.[1];
    if (origin && line.includes("Ready")) break;
  }
  assert.ok(origin, "The isolated production server did not start.");
  for (const locale of ["ar", "en"]) {
    const signup = await fetch(`${origin}/${locale}/sign-up`, { redirect: "manual" });
    assert.equal(signup.status, 404);
    await signup.body?.cancel();
    for (const path of ["", "/sign-in"]) {
      const response = await fetch(`${origin}/${locale}${path}`);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes(`href="/${locale}/sign-up"`));
      if (!path) assert.ok(body.includes(locale === "ar" ? "التسجيل العام غير متاح حاليًا" : "Public registration is currently closed"));
    }
  }
});
