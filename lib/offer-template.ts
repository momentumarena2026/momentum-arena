// Letter of Appointment / Offer Letter — template text.
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR THE OFFER-LETTER WORDING. Editing
// the prose here changes every future PDF generated from /admin/offer-letter.
// Placeholders are filled from the selected employee's record (designation,
// monthly salary, date of joining) at generation time.
//
// Bump OFFER_VERSION on material wording changes (OfferLetterRecord.offerVersion
// records which text each employee was issued).
//
// NOTE: this is a template, not legal advice — have it reviewed by a lawyer.

import type { LetterBlock } from "@/lib/letter-pdf";
import { rupeesInWords } from "@/lib/rupees-in-words";
import { SIGNATORY } from "@/lib/nda-template";

export const OFFER_VERSION = "v1-2026-07";

export type OfferFields = {
  name: string;
  address: string;
  designation: string;
  salaryMonthly: number; // ₹ per month (gross)
  dateOfJoining: string; // human-readable, e.g. "1 August 2026"
  date: string; // letter date, e.g. "26 July 2026"
};

export function buildOfferBlocks(f: OfferFields): LetterBlock[] {
  const firstName = f.name.trim().split(/\s+/)[0] || f.name;
  const monthly = Math.round(f.salaryMonthly);
  const annual = monthly * 12;
  const inr = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;

  return [
    { type: "lines", lines: [`Date: ${f.date}`] },
    { type: "gap", mm: 1 },
    { type: "lines", lines: ["To,", f.name] },
    { type: "paragraph", text: f.address },
    { type: "title", text: "LETTER OF APPOINTMENT" },
    { type: "paragraph", text: `Dear ${firstName},` },
    {
      type: "paragraph",
      text: 'We are pleased to offer you employment with Sportive Ventures, operating under the brand "Momentum Arena", on the terms and conditions set out below.',
    },
    { type: "heading", text: "1. Position" },
    {
      type: "paragraph",
      text: `You are appointed to the position of ${f.designation} at our Mathura facility. You will perform the duties consistent with your role and such other duties as may reasonably be assigned to you by the Company from time to time.`,
    },
    { type: "heading", text: "2. Date of Joining" },
    {
      type: "paragraph",
      text: `Your employment shall commence on ${f.dateOfJoining}. This offer is contingent upon your joining on or before this date and completing the Company's onboarding formalities.`,
    },
    { type: "heading", text: "3. Compensation" },
    {
      type: "paragraph",
      text: `You will be paid a gross monthly salary of ${inr(monthly)} (${rupeesInWords(monthly)}), i.e. approximately ${inr(annual)} per annum, subject to applicable statutory deductions (including TDS, and PF/ESI where applicable). Compensation is confidential between you and the Company.`,
    },
    { type: "heading", text: "4. Probation" },
    {
      type: "paragraph",
      text: "You will be on probation for a period of three (3) months from your date of joining, extendable at the Company's discretion. Confirmation of employment is subject to satisfactory performance during this period.",
    },
    { type: "heading", text: "5. Confidentiality" },
    {
      type: "paragraph",
      text: "This offer is conditional upon your signing the Company's Non-Disclosure & Confidentiality Agreement. You shall at all times protect the Company's and its customers' confidential and personal data, in compliance with the Digital Personal Data Protection Act, 2023.",
    },
    { type: "heading", text: "6. Notice Period" },
    {
      type: "paragraph",
      text: "After confirmation, either party may terminate this employment by giving one (1) month's written notice, or salary in lieu thereof. During probation, fifteen (15) days' notice shall apply.",
    },
    { type: "heading", text: "7. Company Policies" },
    {
      type: "paragraph",
      text: "You agree to abide by the Company's policies as amended from time to time, including its information-security, acceptable-use, leave and privacy policies.",
    },
    {
      type: "paragraph",
      text: "We are delighted to welcome you and look forward to a long and mutually rewarding association. Please sign and return the acceptance below to confirm your acceptance of this offer.",
    },
    { type: "gap", mm: 2 },
    { type: "lines", lines: ["Warm regards,", "For Sportive Ventures (Momentum Arena)"] },
    { type: "signoff", name: SIGNATORY.name, title: SIGNATORY.title },
    { type: "gap", mm: 3 },
    { type: "rule" },
    {
      type: "lines",
      lines: [
        "Acceptance",
        "I have read, understood and accept the terms of this appointment.",
        "",
        "Signature: ____________________",
        `Name: ${f.name}`,
        "Date: ____________________",
      ],
    },
  ];
}
