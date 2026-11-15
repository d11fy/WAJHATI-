import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir,readdir,readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { chromium, devices } from "playwright-core";
import { base32Bytes, makeEnrollment, markPlatform, otp } from "../fixtures/platform.mjs";

const password="a long phase six browser password";
function endpoint() {
  assert.ok(process.env.TEST_BASE_URL);
  return new URL(process.env.TEST_BASE_URL).origin;
}
async function browserFor(t) {
  const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser=await chromium.launch(executablePath?{executablePath}:{channel:"chrome"});
  t.after(()=>browser.close());
  return browser;
}
async function signup(page,base,email,name) {
  await page.goto(`${base}/en/sign-up`);
  await page.locator('[name="name"]').fill(name);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await page.waitForURL(`${base}/en/dashboard`);
}

test("platform owner enrolls MFA and uses the bilingual desktop and mobile dashboard; merchants are denied", {timeout:120000}, async(t)=>{
  assert.ok(process.env.TEST_MIGRATION_DATABASE_URL);
  const base=endpoint(), browser=await browserFor(t);
  const owners=await browser.newContext({viewport:{width:1440,height:1000}});
  const desktop=await owners.newPage();
  const merchant=await browser.newPage();
  const email=`owner-${randomUUID()}@example.test`;
  await signup(merchant,base,`merchant-${randomUUID()}@example.test`,"Ordinary merchant fixture");
  assert.equal((await merchant.goto(`${base}/en/platform/overview`))?.status(),404);
  assert.equal((await merchant.goto(`${base}/ar/platform/mfa`))?.status(),404);
  await signup(desktop,base,email,"Platform Owner");
  const db=new Pool({connectionString:process.env.TEST_MIGRATION_DATABASE_URL});
  t.after(()=>db.end());
  const {rows:[user]}=await db.query("select id from public.users where email=$1",[email]);
  const key=makeEnrollment();
  await markPlatform(db,user.id,"owner",key);
  await desktop.goto(`${base}/en/platform/overview`);
  await desktop.waitForURL(`${base}/en/platform/mfa`);
  await desktop.getByLabel("Current password").fill(password);
  await desktop.getByLabel("One-time enrollment key").fill(key);
  await desktop.getByRole("button",{name:"Enroll authenticator"}).click();
  const seed=base32Bytes(await desktop.locator("code").innerText());
  await desktop.getByLabel("Authenticator code").fill(otp(seed));
  await desktop.getByRole("button",{name:"Verify code"}).click();
  await desktop.getByText("Verification complete",{exact:true}).waitFor();
  await desktop.getByRole("link",{name:"Continue to administration"}).click();
  await desktop.getByRole("heading",{name:"Wajhati platform console",exact:true}).waitFor();
  await desktop.locator('aside nav a[aria-current="page"]').getByText("Overview",{exact:true}).waitFor();
  const screenshots=process.env.DAR_SCREENSHOTS_DIR;
  if(screenshots){
    await mkdir(screenshots,{recursive:true});
    await desktop.screenshot({path:join(screenshots,"platform-overview-desktop.png"),fullPage:true,animations:"disabled"});
  }
  await desktop.getByRole("link",{name:"Platform settings",exact:true}).click();
  await desktop.getByRole("heading",{name:"Platform settings",exact:true}).waitFor();
  await desktop.getByLabel(/Dual approval thresholds by currency/).fill('{"KMF":1000000}');
  await desktop.getByLabel("Confirm this change").check();
  await desktop.getByRole("button",{name:"Save rules",exact:true}).click();
  await desktop.getByText("Saved.",{exact:true}).waitFor();
  const {rows:[settings]}=await db.query("select dual_thresholds from public.platform_policy where id=1");
  assert.deepEqual(settings.dual_thresholds,{KMF:1000000});
  const phone=await browser.newContext({ ...devices["iPhone 13"], storageState: await owners.storageState() });
  const mobile=await phone.newPage();
  await mobile.goto(`${base}/ar/platform/overview`);
  await mobile.getByRole("heading",{name:"مركز إدارة منصة واجهتي",exact:true}).waitFor();
  if(screenshots) await mobile.screenshot({path:join(screenshots,"platform-overview-rtl-mobile.png"),fullPage:true,animations:"disabled"});
  await mobile.locator(".wajhati-workspace-menu summary").click();
  await mobile.getByRole("link",{name:"المتاجر",exact:true}).click();
  await mobile.getByRole("heading",{name:"المتاجر",exact:true}).waitFor();
  assert.equal(await mobile.locator("html").getAttribute("dir"),"rtl");
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  if(screenshots) await mobile.screenshot({path:join(screenshots,"platform-stores-rtl-mobile.png"),animations:"disabled"});
  await mobile.goto(`${base}/ar/platform/payments`);
  await mobile.getByRole("heading", { name: "الدفعات", exact: true }).waitFor();
  const table = mobile.locator(".wajhati-admin-table");
  await table.getByRole("table").waitFor();
  assert.ok(await table.locator("tbody tr").count());
  await table.focus();
  assert.ok(await table.evaluate((node) => {
    node.scrollLeft = -node.scrollWidth;
    return node === document.activeElement && node.scrollLeft < 0 && document.documentElement.scrollWidth <= innerWidth;
  }));
  await table.evaluate((node) => { node.scrollLeft = 0; });
  if (screenshots) {
    const folder = join(screenshots, "polish-after");
    await mkdir(folder, { recursive: true });
    await mobile.screenshot({ path: join(folder, "admin-payments-ar-mobile.png"), animations: "disabled" });
  }
  assert.equal((await mobile.request.get(`${base}/api/health`)).status(),200);
  assert.equal((await mobile.request.get(`${base}/api/ready`)).status(),200);
});

async function awaitMail(email,purpose) {
  assert.ok(process.env.DAR_MAIL_DIR);
  for(let attempt=0;attempt<120;attempt++){
    const files=await readdir(process.env.DAR_MAIL_DIR).catch(()=>[]);
    for(const file of files){
      if(!file.endsWith(".json")) continue;
      const row=await readFile(join(process.env.DAR_MAIL_DIR,file),"utf8").then(JSON.parse).catch(()=>null);
      if(row?.to===email&&row.purpose===purpose)return row;
    }
    await new Promise((resolve)=>setTimeout(resolve,150));
  }
  assert.fail("No matching local mail appeared.");
}

test("email verification and recovery use local delivery and invalidate the original browser session", {timeout:120000}, async(t)=>{
  const base=endpoint(), browser=await browserFor(t);
  const page=await browser.newPage();
  const email=`identity-${randomUUID()}@example.test`;
  await signup(page,base,email,"Verified merchant fixture");
  await page.goto(`${base}/en/account`);
  const verify=page.locator("section").filter({hasText:"Verify email"});
  await verify.getByRole("button",{name:"Send a link"}).click();
  const verification=await awaitMail(email,"verify");
  assert.match(verification.url,/#token=/);
  await page.goto(verification.url);
  await page.getByRole("button",{name:"Confirm",exact:true}).click();
  await page.getByText("Confirmed. Sign in again if your credentials changed.",{exact:true}).waitFor();

  const recovery=await browser.newPage();
  await recovery.goto(`${base}/en/forgot-password`);
  await recovery.getByLabel("Email address").fill(email);
  await recovery.getByRole("button",{name:"Send a link"}).click();
  const reset=await awaitMail(email,"reset");
  await recovery.goto(reset.url);
  await recovery.getByLabel("New password").fill("a distinct new password for this browser");
  await recovery.getByRole("button",{name:"Confirm",exact:true}).click();
  await recovery.getByText("Confirmed. Sign in again if your credentials changed.",{exact:true}).waitFor();
  await page.goto(`${base}/en/account`);
  await page.waitForURL(`${base}/en/sign-in`);
  await recovery.reload();
  await recovery.getByLabel("New password").fill("another non-reusable password");
  await recovery.getByRole("button",{name:"Confirm",exact:true}).click();
  await recovery.getByRole("alert").getByText("This request or link is invalid, expired or already used.").waitFor();
});
