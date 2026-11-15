import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import nodemailer from "nodemailer";
import { smtpInput, type SmtpConfig } from "@/lib/platform-contact";

function key() {
  const value = process.env.SMTP_CONFIG_KEY;
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error("SMTP configuration key is unavailable.");
  return Buffer.from(value, "hex");
}
export function smtpKeyReady() { return /^[a-f0-9]{64}$/.test(process.env.SMTP_CONFIG_KEY ?? ""); }
export function sealSmtpPassword(password: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("wajhati/smtp/v1"));
  return Buffer.concat([iv, cipher.update(password, "utf8"), cipher.final(), cipher.getAuthTag()]);
}
export function openSmtpPassword(value: Buffer) {
  if (value.length < 29) throw new Error("Invalid SMTP configuration.");
  const decipher = createDecipheriv("aes-256-gcm", key(), value.subarray(0,12));
  decipher.setAAD(Buffer.from("wajhati/smtp/v1")); decipher.setAuthTag(value.subarray(-16));
  return Buffer.concat([decipher.update(value.subarray(12,-16)),decipher.final()]).toString("utf8");
}
const denied = new BlockList();
for (const [ip, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) denied.addSubnet(ip,prefix,"ipv4");
const globalV6 = new BlockList(); globalV6.addSubnet("2000::",3,"ipv6");
denied.addSubnet("2001::",23,"ipv6"); denied.addSubnet("2001:db8::",32,"ipv6"); denied.addSubnet("2002::",16,"ipv6");
export function publicSmtpAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !denied.check(address,"ipv4") : family === 6 && globalV6.check(address,"ipv6") && !denied.check(address,"ipv6");
}
export async function smtpTransport(config: SmtpConfig, password: string) {
  const valid = smtpInput.parse(config);
  const addresses = await lookup(valid.host,{ all:true,verbatim:true });
  if (!addresses.length || addresses.some(({address})=>!publicSmtpAddress(address))) throw new Error("SMTP host is not public.");
  // Pin the validated IP: Nodemailer must not perform a second DNS lookup.
  return nodemailer.createTransport({ host: addresses[0].address, port: valid.port, secure: valid.port===465, requireTLS:true,
    tls:{servername:valid.host,minVersion:"TLSv1.2",rejectUnauthorized:true}, auth:{user:valid.user,pass:password},
    connectionTimeout:8000,greetingTimeout:8000,socketTimeout:12000,logger:false,debug:false,
    disableFileAccess:true,disableUrlAccess:true,
  });
}
export function smtpOutcome(error: unknown): "terminal" | "retry" {
  const code = typeof error === "object" && error && "responseCode" in error ? Number(error.responseCode) : 0;
  return code>=500 && code<600 ? "terminal" : "retry";
}
