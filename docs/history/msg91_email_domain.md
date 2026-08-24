---
name: msg91-email-domain
description: MSG91 email sending domain = mail.momentumarena.com subdomain (apex impossible — MSG91 hard-requires MX, apex MX is org email); DNS layout + EMAIL_DOMAIN env
metadata:
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
---

**MSG91 email sends from the SUBDOMAIN `mail.momentumarena.com`, never the apex** (main `5c514bb`, 2026-07-02). `lib/email.ts` exports `EMAIL_DOMAIN` (env `MSG91_EMAIL_DOMAIN`, default `mail.momentumarena.com`) + `EMAIL_FROM` (`noreply@<domain>`); used by all senders incl. `lib/generator-notifications.ts`.

**Why:** MSG91 refuses to send until the domain is FULLY verified, and verification hard-requires the sending domain's **MX → mx1/mx2.mailer91.com** (422 in Failed Requests: "spf, dkim and mx values must be set"). The apex CANNOT do this — apex MX (`0 smtp.secureserver.net`, `10 mailstore1.secureserver.net`) routes the organisation's inbound mail (GoDaddy/Microsoft); swapping it hijacks all org email. A subdomain has no mailboxes → MSG91's MX is safe there. DMARC is relaxed alignment (`adkim=r`), so `d=mail.momentumarena.com` DKIM aligns with @momentumarena.com org domain.

**DNS state (GoDaddy zone, momentumarena.com):**
- Apex SPF TXT: `v=spf1 include:secureserver.net include:mailer91.com -all` — VALID for both (5/10 lookups, verified by full expansion). "Order matters" was a myth; the real MSG91 blocker was the missing MX.
- Apex MX: secureserver (org email) — **NEVER change**.
- `spaceship._domainkey` TXT = MSG91's apex DKIM (verified but apex can't complete verification anyway).
- `_dmarc` TXT: `p=quarantine; adkim=r; aspf=r` (GoDaddy-managed). MSG91's "hosted DMARC" CNAME offer (delete TXT → CNAME to hosted-dmarc.mailer91.com) was deliberately DECLINED — keep own record.
- Subdomain records for mail.momentumarena.com (SPF TXT / DKIM / MX→mailer91 / tracking CNAME) come from MSG91's Add-Domain wizard; GoDaddy gotcha: enter Name WITHOUT the domain suffix (e.g. `mail`, `<sel>._domainkey.mail`).

**Live-API findings (2026-07-02, tested with real authkey from repo-root .env):**
1. **MX is HARD-required** — apex at 3/4 (SPF+DKIM+CNAME all Verified, only MX missing) still 422s: "spf, dkim and mx values must be set". Apex is a permanent dead end; subdomain is the only path.
2. **v5 body-format bug found+fixed (main `72fae85`):** without template_id, `body` must be `{type:"text/html", data}` — plain string 422s ("body.data field is required"). Generic sendEmail was broken since inception; template senders (recipients+template_id) were fine.
3. **✅ VERIFIED + DELIVERY PROVEN (2026-07-02):** mail.momentumarena.com hit 4/4 in MSG91 (SPF `spaceship._domainkey.mail` DKIM, MX→mailer91, CNAME `mailer91.mail`); template send (admin_password_3, recipients+variables shape) via the subdomain returned **200 queued** (unique_id a2290867-c483-4e80-b3e1-12a04d312b89).
4. **⚠️ ACCOUNT REQUIRES template_id ON EVERY SEND** — even with correct {type,data} body, non-template sends 422 "The template id field is required". FIXED + FULLY VERIFIED (main `a4b5763`): `sendAdminPasswordResetEmail` → template **`admin_password_reset_5`** (MSG91 auto-suffixed the slug on creation! vars USERNAME, RESET_LINK); `sendSuperadminPasswordNotification` → **`superadmin_password_alert`** (var CHANGED_AT, fans out to all recovery emails in one request). Both live-tested → 200 queued. Full template list on account: admin_password_3 (invite), admin_password_reset_5, superadmin_password_alert, generator_pin_change, generator_monthly_summary, oil_change_reminder_2, login_otp_45, global_otp. Generic `sendEmail()` kept but documented UNUSABLE. **Gotcha: MSG91 slugs template names with auto-suffix** — always check the real slug via GET /api/v5/email/templates. Apex-domain deletion via API = 409 "Can't delete verified or used domain" — support-only; left in place (harmless). EMAIL IS NOW FULLY OPERATIONAL end-to-end.
**Post-verify cleanup (optional):** delete apex momentumarena.com row in MSG91; GoDaddy: drop `include:mailer91.com` from apex SPF, delete apex `spaceship._domainkey` + apex `mailer91` CNAME.

**Verify test:** send → Gmail → Show original → SPF/DKIM/DMARC all PASS with d=mail.momentumarena.com.

Related: [[project-booking-system]], [[deployment-runbook]].
