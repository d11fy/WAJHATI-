# Email and DNS verification — wajhati.store

Checked: 2026-11-18, from a developer machine, read-only. No DNS record was changed, no mailbox credential was used, and no email was sent.

**Bottom line.** The domain's DNS already carries a valid SPF record, a DKIM selector and a monitoring-only DMARC record, all pointing at Hostinger Email. SMTP and TLS compatibility with Hostinger is proven. **Nothing about real delivery, inbound mail or authentication results of a received message is verified**, because that needs the mailbox password and a second inbox, and port 25 is blocked from this network. BLK-01 and BLK-02 stay **BLOCKED**.

## 1. What actually hosts what (discovered, not assumed)

| Function | Provider | Evidence |
| --- | --- | --- |
| Registrar / DNS | **Hostinger** (`aurora.dns-parking.com`, `nebula.dns-parking.com`) | NS records at 8.8.8.8 and from the authoritative server agree |
| Mailbox (inbound) | **Hostinger Email** (`mx1.hostinger.com` pri 5, `mx2.hostinger.com` pri 10) | MX records |
| Outbound SMTP | `smtp.hostinger.com` (Hostinger Email) | Reachable, TLS verified, section 4 |
| Website host for `wajhati.store` | **None yet.** The apex is a **Hostinger parked-domain page** | `https://wajhati.store/` returns "Parked Domain name on Hostinger DNS system"; `/api/health` returns that HTML, not the app. A Let's Encrypt certificate was issued today (15:50 UTC) for the parking host |
| Application host, database, object storage, backups | **Not identified.** Nothing in DNS or the repository names a server | Recent commits mention Dokploy/Traefik, but no Dokploy instance is reachable from this session |

## 2. DNS records found (authoritative server and public resolvers agree)

| Name | Type | Value | Assessment |
| --- | --- | --- | --- |
| `wajhati.store` | TXT | `v=spf1 include:_spf.mail.hostinger.com ~all` | **Single SPF record**, valid. `_spf.mail.hostinger.com` expands to `include:relay.mail.hostinger.com include:relay.mailchannels.net ~all`, so about 3 DNS lookups (limit 10). Softfail (`~all`) is appropriate until real mail has been authenticated |
| `hostingermail-a._domainkey` | CNAME | `hostingermail-a.dkim.mail.hostinger.com` | Target publishes `v=DKIM1;k=rsa;p=MIIBIjANBg…`, a 2048-bit RSA key (TXT length 408). **Active selector** |
| `hostingermail-b._domainkey`, `hostingermail-c._domainkey` | CNAME | `…-b/-c.dkim.mail.hostinger.com` | Targets publish `v=DKIM1;p=` with an empty key. That is how Hostinger holds reserve selectors for rotation. Not a fault, but only selector `a` can sign today |
| `_dmarc.wajhati.store` | TXT | `v=DMARC1; p=none` | Monitoring only. **No `rua`**, so no one receives reports. Alignment tags default to relaxed |
| `wajhati.store` | MX | mx1.hostinger.com (5), mx2.hostinger.com (10) | Inbound mail routed to Hostinger |
| `wajhati.store` | A | `2.57.91.91` (TTL 50) | Parking page. No AAAA record |
| `www.wajhati.store` | CNAME | `wajhati.store` | |
| `autodiscover.wajhati.store` | CNAME | `autodiscover.mail.hostinger.com` | Mail client auto-config |
| `staging.wajhati.store` | none | | **Does not exist** |
| DNSSEC | none | no DS record | Not enabled. Optional |

Not checked: CAA, MTA-STS and TLS-RPT records (none required to launch). Reverse DNS (PTR) for the sending IPs belongs to Hostinger's relay, not to us.

## 3. Gmail sender requirements, read from Google's page

From Google's "Email sender guidelines" ([support.google.com/mail/answer/81126](https://support.google.com/mail/answer/81126)):

- Any sender: SPF **or** DKIM, TLS, valid forward and reverse DNS, low spam-complaint rate.
- 5,000+ messages per day to Gmail: SPF **and** DKIM, DMARC with From-domain alignment.

WAJHATI sends low-volume transactional mail, so the first set applies. The domain already has SPF, DKIM and DMARC, so it should also satisfy the stricter set **if** the live signature aligns with `From: @wajhati.store`. That alignment is the unverified part (section 5).

## 4. SMTP compatibility with the application (measured)

Read-only probe with no authentication and no message (`smtp.hostinger.com`):

| Check | Result |
| --- | --- |
| DNS | resolves to `172.65.255.143`, a public address; the app's own `publicSmtpAddress()` SSRF guard **accepts** it |
| Port 465 (implicit TLS) | TLS 1.3, `TLS_AES_256_GCM_SHA384`, certificate `CN=hostinger.com` from Sectigo, valid to 2027-01-16, **chain and hostname verified** with `rejectUnauthorized: true` |
| Port 587 (STARTTLS) | banner `smtp.hostinger.com ESMTP`, `STARTTLS` advertised, upgrade to TLS 1.3 completed, verified |

Hostinger's own documentation agrees: host `smtp.hostinger.com`, port 465 SSL or 587 TLS/STARTTLS, username is the full mailbox address, password is the mailbox password (an app password if the mailbox uses 2FA); values are shown in hPanel under Emails, Manage, Connect Apps and Devices ([Hostinger support](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/)). Hostinger's port article steers new setups to 587.

The app's SMTP module (`src/server/auth/smtp.ts`) already supports exactly this: ports 465 and 587 only, TLS 1.2+ with certificate verification, no fallback to plain text, sender name, `From` and `Reply-To` (`smtpInput` in `src/lib/platform-contact.ts`). **No code change is needed for Hostinger.**

Settings to enter in `/ar/platform/settings` (owner role, fresh MFA). Nothing here is a secret except the password, which the owner types directly into that form and which is stored AES-256-GCM encrypted:

| Field | Value |
| --- | --- |
| Host | `smtp.hostinger.com` |
| Port | `587` (STARTTLS) or `465` (SSL). Either verified above |
| Username | `support@wajhati.store` (the full address) |
| Password | the mailbox password or app password (owner enters it; never in files or chat) |
| Sender name | `WAJHATI \| واجهتي` |
| From | `support@wajhati.store` |
| Reply-To | `support@wajhati.store` |

## 5. Queued notifications and the owner-managed SMTP (finding, now fixed in code)

The first pass found that the owner-managed SMTP only reached the app process: the notification worker was deliberately denied the identity database login and had no `SMTP_CONFIG_KEY`, so trial, due, activated, expired and review emails could only go through Resend. The Terms-era claim that central SMTP covered "trials, activation, renewal and expiry" was not true for the deployed topology.

**Resolved in the pre-deployment pass** (see `docs/PRE_DEPLOYMENT_FINAL_HANDOFF.md`, section 3):

- A dedicated **mail delivery process** (`mailer`) and database login (`dar_mailer`, group role `storefront_mailer`, migration `0027`) now runs the notification queue. It holds `SMTP_CONFIG_KEY` and nothing else of value: no table access, no storage credentials, no other database login.
- It reads the secret only through `ops_mail_secret()`, which returns nothing unless the owner has enabled central SMTP, and the password stays AES-256-GCM encrypted until the moment of sending.
- Resend is now **optional**. A deployed environment needs the owner-managed SMTP (`SMTP_CONFIG_KEY`) **or** Resend, not both.
- Queue, retry, lease and deduplication logic is unchanged. Identity email behaviour is unchanged.
- It also fixes a latent bug: the worker could not read the platform WhatsApp number from the database, so queued emails always quoted the built-in default number even after the owner changed it. The mailer reads the real value.

Status: verified by PostgreSQL integration tests, unit tests and a local run of the notification job as the new login. **Not yet verified against a real SMTP server**, which stays under BLK-01.

## 6. What could not be verified, and why

| Item | Status | Blocker |
| --- | --- | --- |
| Mailbox `support@wajhati.store` exists | **Unverified** | A recipient check against the MX uses port 25, which is blocked from this network (connection timed out). No message was sent |
| Inbound mail works (send to it and read it) | **BLOCKED** | Needs a human with the mailbox and a second inbox |
| SMTP login with the real password | **BLOCKED** | The password is a secret that only the owner may enter |
| Test send from the owner panel (`verified_at` set) | **BLOCKED** | Same |
| Live delivery of identity and queued emails | **BLOCKED** | Needs a deployed app (none exists) and the above |
| `Authentication-Results: spf=pass; dkim=pass; dmarc=pass` on a received message | **BLOCKED** | Needs a real received message. DNS records existing is not the same as authentication passing |
| DMARC report mailbox | **Not configured** | Needs a decision on which mailbox or service receives reports |
| DNS write access | **None** | The Hostinger hPanel is not accessible from this session |

## 7. Exact steps for the owner

1. **Confirm the mailbox exists.** In hPanel go to Emails, open `wajhati.store`, and confirm `support@wajhati.store` is listed. Send a message to it from a personal Gmail and reply from the mailbox. Record both outcomes.
2. **Enter SMTP settings** in the platform panel as in section 4 after the application is deployed (staging first), then press the test-send button and send the test to a personal inbox you control.
3. **Read the headers.** In Gmail open the received test message, "Show original", and confirm `SPF: PASS`, `DKIM: PASS` with `d=wajhati.store`, and `DMARC: PASS`. Save a redacted copy of the header block as evidence.
4. **Then, and only then, enable DMARC reporting.** Pick a report mailbox (a dedicated alias is cleaner than the support inbox, because aggregate reports are frequent XML attachments). Replace the `_dmarc` TXT record:

```dns
_dmarc.wajhati.store.  TXT  "v=DMARC1; p=none; rua=mailto:<your-report-mailbox>; adkim=r; aspf=r"
```

   Leave `p=none` for at least two weeks of reports, confirm every legitimate source (Hostinger Email, and Resend if used) passes, and only then consider `p=quarantine`, then `p=reject`. Do not publish `rua` to an address that cannot receive mail.
5. **If Resend is chosen (option A or C):** add the SPF include and DKIM records Resend shows for `wajhati.store`, merge the include into the **existing single** SPF record (never create a second `v=spf1` record), and re-run step 3 on a notification email.
6. **When a host is chosen**, point the apex `A` record to its IP and add `staging` (see `STAGING_DEPLOYMENT_REPORT.md`). Changing `A` does not affect mail. Do not touch the MX, SPF, DKIM, `autodiscover` or `www` records.
7. Re-run this document's section 2 checks from an independent resolver after each change and record the output.

Where to enter records: Hostinger hPanel, Domains, `wajhati.store`, DNS / Nameservers (DNS zone). Hostinger's exact menu labels may differ, so use their DNS record editor and follow its field names.

## 8. Verdicts

| Blocker | Status | Evidence |
| --- | --- | --- |
| BLK-01 Real SMTP send and verified connection | **BLOCKED** | TLS and host compatibility proven; no login, no send, no `verified_at` |
| BLK-02 SPF, DKIM, DMARC and external inbox checks | **BLOCKED** | Records exist and are well formed; no message authenticated yet; DMARC has no report address |
| BLK-03 Production `SMTP_CONFIG_KEY` provisioned | **BLOCKED** | Secret store not accessible; no production host. Do **not** rotate a key that already protects stored SMTP credentials: a new key makes the stored ciphertext unreadable and the password must then be re-entered (documented in `docs/smtp-deliverability.md`) |
