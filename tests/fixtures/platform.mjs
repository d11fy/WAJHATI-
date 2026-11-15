import { createHmac, createHash, randomBytes } from "node:crypto";

export const makeEnrollment = () => randomBytes(32).toString("base64url");
export const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function markPlatform(pool, user, role, enrollment) {
  await pool.query("insert into public.billing_verified_accounts(user_id,email) select id,email from public.users where id=$1 on conflict do nothing", [user]);
  await pool.query("insert into public.platform_roles(user_id,role) values($1,$2) on conflict do nothing", [user, role]);
  await pool.query("insert into public.platform_mfa(user_id,enrollment_hash,enrollment_expiry) values($1,$2,now()+interval '15 minutes') on conflict do nothing", [user, hash(enrollment)]);
}

export function otp(seed, counter = Math.floor(Date.now() / 30000)) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const signed = createHmac("sha1",seed).update(bytes).digest();
  const offset = signed.at(-1) & 15;
  return String((signed.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6,"0");
}

export function base32Bytes(value) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const output=[];
  let remainder=0, count=0;
  for (const symbol of value.trim()) {
    remainder=(remainder<<5)|alphabet.indexOf(symbol);
    count+=5;
    if(count>=8) {
      count-=8;
      output.push((remainder>>count)&255);
    }
  }
  return Buffer.from(output);
}
