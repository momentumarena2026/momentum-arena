// Responsibility Letter (Roles & Responsibilities) — template text.
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR THE WORDING. The responsibility
// list is chosen per-employee at generation time from the catalogue managed at
// /admin/responsibilities. Placeholders come from the selected employee record.
//
// Bump RESP_LETTER_VERSION on material wording changes
// (ResponsibilityLetterRecord.letterVersion records which text was issued).
//
// NOTE: template, not legal advice — have it reviewed before use.

import type { LetterBlock } from "@/lib/letter-pdf";
import { SIGNATORY } from "@/lib/nda-template";

export const RESP_LETTER_VERSION = "v1-2026-07";

export type ResponsibilityFields = {
  name: string;
  designation: string | null;
  responsibilities: string[]; // the chosen item texts
  date: string; // letter date, e.g. "26 July 2026"
};

export function buildResponsibilityBlocks(f: ResponsibilityFields): LetterBlock[] {
  const firstName = f.name.trim().split(/\s+/)[0] || f.name;
  const roleClause = f.designation
    ? `in your capacity as ${f.designation} at Momentum Arena`
    : "as part of your role at Momentum Arena";

  return [
    { type: "lines", lines: [`Date: ${f.date}`] },
    { type: "gap", mm: 1 },
    { type: "lines", lines: ["To,", f.name] },
    { type: "title", text: "ROLES & RESPONSIBILITIES" },
    { type: "paragraph", text: `Dear ${firstName},` },
    {
      type: "paragraph",
      text: `This letter sets out the key roles and responsibilities assigned to you ${roleClause}, on behalf of Sportive Ventures (operating under the brand "Momentum Arena"). You are expected to carry out the following duties diligently and in accordance with the Company's policies:`,
    },
    { type: "list", items: f.responsibilities, ordered: true },
    {
      type: "paragraph",
      text: "This list is illustrative and not exhaustive. You may be assigned such other duties as the Company reasonably requires from time to time. You are expected to perform your responsibilities honestly, professionally and in the best interests of the Company and its customers, and to comply with all applicable Company policies, including its information-security and privacy policies.",
    },
    {
      type: "paragraph",
      text: "Please sign the acknowledgement below to confirm that you have read and understood your responsibilities.",
    },
    { type: "gap", mm: 2 },
    { type: "lines", lines: ["Warm regards,", "For Sportive Ventures (Momentum Arena)"] },
    { type: "signoff", name: SIGNATORY.name, title: SIGNATORY.title },
    { type: "gap", mm: 3 },
    { type: "rule" },
    {
      type: "lines",
      lines: [
        "Acknowledgement",
        "I have read and understood the responsibilities assigned to me.",
        "",
        "Signature: ____________________",
        `Name: ${f.name}`,
        "Date: ____________________",
      ],
    },
  ];
}
