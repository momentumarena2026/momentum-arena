---
name: nda-generator-2026-07-26
description: "Admin HR/Legal module: Employee dashboard (encrypted Aadhaar + monthly salary) + NDA & Offer-Letter generators (select-an-employee, letterhead PDFs, sign-over-stamp). NDA v1 on main; full expansion on development 6b27207."
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-26T14:56:24.371Z
---

**Admin HR / Legal module (web admin, MANAGE_HR permission).** Screens under the "HR / Legal" nav group: `/admin/employees`, `/admin/nda`, `/admin/offer-letter`, `/admin/responsibilities` (catalog), `/admin/responsibility-letter`.

**Responsibility Letter** (LIVE on main+prod, merge `1408de2`): `ResponsibilityItem` catalog (add/edit/enable-disable at /admin/responsibilities) → generator ticks a subset of ACTIVE items per employee → "Roles & Responsibilities" letter. `ResponsibilityLetterRecord` snapshots chosen texts (`responsibilities String[]`). Wording in `lib/responsibility-template.ts`. The shared `lib/letter-pdf.ts` gained a numbered/bulleted **`list` block** (hanging indent).

**Employee master** (`Employee` model) is the source of truth the letter generators select from. Aadhaar stored **encrypted at rest** (`aadhaarEnc`, AES-256-GCM via `lib/hr-crypto.ts`; key = HKDF-SHA256 of `AUTH_SECRET`, so NO new env var; optional `HR_ENCRYPTION_KEY` override) + `aadhaarLast4` in clear for display. Salary = **monthly** gross (`salaryMonthly`, whole ₹; dashboard shows derived ₹/yr). CRUD in `actions/admin-employees.ts` + `employee-manager.tsx`; soft active/inactive.

**NDA + Offer Letter generators** now take an `employeeId` (select dropdown) instead of typed fields. Offer letter = "Letter of Appointment" (position, joining date, monthly compensation in words via `lib/rupees-in-words.ts`, probation, notice, confidentiality→NDA). Wording lives in `lib/nda-template.ts` (`buildNdaBlocks`) and `lib/offer-template.ts` (`buildOfferBlocks`) — single editable source; `NDA_VERSION`/`OFFER_VERSION` recorded per audit row (`NdaRecord`, `OfferLetterRecord`, both link to Employee).

**Shared PDF engine `lib/letter-pdf.ts`** (`renderLetter(LetterBlock[])`): letterhead full-page bg (`public/letterhead.png`) + safe band y70→215 + auto-pagination + keep-together for `lines` blocks. **Authorised-signatory block: signature drawn OVERLAPPING on top of the company stamp** (stamp underneath, sign centred over it), above "Nakul Varshney — Authorised Signatory". Images sized to their TRUE aspect ratio (PNG IHDR read in `loadImage`) so the wide stamp isn't squashed.

**Sign/stamp security:** `signature.png` + `stamp.png` live under **`/assets/letter-assets/` (NOT /public)** so they are never publicly downloadable (forgery protection); traced into the two generate routes via `next.config.ts` `outputFileTracingIncludes`. Read server-side at render time; graceful fallback (signature line + name) if absent. The real images ARE committed to the (private) repo.

**Status:** full expansion **LIVE on main + prod DB** (merge `0edb861`, 2026-07-26; seed-production success created Employee/OfferLetterRecord/NdaRecord.employeeId). Supersedes the earlier NDA-only v1. Letter wording (NDA + offer) still DRAFT pending user's legal review — edit `lib/nda-template.ts` / `lib/offer-template.ts`, no schema change needed.

Related: [[deployment_runbook]], [[mobile_admin_authz_audit]], [[store_launch_2026_07_24]]
