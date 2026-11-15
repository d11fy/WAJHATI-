import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { base32 } from "../../src/lib/platform";
import { openProof, sealProof } from "../../src/server/billing/proof-archive";
import { ProofProcessorBusy, readPaymentProof } from "../../src/server/billing/proof";
import { base32Bytes, otp } from "../fixtures/platform.mjs";
import { receiptPdf } from "../fixtures/receipt.mjs";

test("authenticator seed encoding and RFC 6238 test vector",()=>{
  const seed=Buffer.from("12345678901234567890");
  assert.equal(base32(seed),"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Bytes(base32(seed)),seed);
  assert.equal(otp(seed,1),"287082");
});

test("encrypted originals are authenticated and scoped to a payment",()=>{
  process.env.PAYMENT_PROOF_KEY=randomBytes(32).toString("hex");
  const id=randomUUID();
  const input=receiptPdf(["page one","page two"]);
  const archive=sealProof(id,input,"application/pdf");
  assert.deepEqual(openProof(id,archive),input);
  assert.throws(()=>openProof(randomUUID(),archive));
  const altered=Buffer.from(archive.cipher);
  altered[altered.length-1]^=1;
  assert.throws(()=>openProof(id,{...archive,cipher:altered}));
});

test("PDF rendering fails closed outside local development and preserves every accepted page",async()=>{
  const pdf=receiptPdf(["first transaction page","second transaction page"]);
  const request=(bytes:Buffer)=>new Request("http://localhost",{method:"POST",body:new Uint8Array(bytes),headers:{"Content-Type":"application/pdf"}});
  delete process.env.PAYMENT_RENDERER_URL;
  process.env.APP_ORIGIN="https://market.example";
  process.env.DAR_LOCAL_PDF="true";
  await assert.rejects(readPaymentProof(request(pdf)),ProofProcessorBusy);
  process.env.APP_ORIGIN="http://localhost:3000";
  const proof=await readPaymentProof(request(pdf));
  assert.deepEqual(proof.original,pdf);
  const image=sharp(proof.content);
  assert.equal((await image.metadata()).height,960);
  for (const top of [0,480]) {
    const section=await sharp(await image.clone().extract({top,left:0,width:900,height:480}).toBuffer()).greyscale().stats();
    assert.ok(section.channels[0].min<200);
  }
  await assert.rejects(readPaymentProof(request(receiptPdf(["1","2","3","4"]))),{status:415});
});
