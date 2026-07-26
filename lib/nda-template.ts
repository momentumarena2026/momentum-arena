// Employee Non-Disclosure & Confidentiality Agreement — template text.
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR THE NDA WORDING. Editing the
// prose here changes every future PDF generated from /admin/nda. Placeholders
// are filled from the selected employee's record at generation time.
//
// Bump NDA_VERSION whenever the wording changes materially — the audit log
// (NdaRecord.ndaVersion) records which text each employee was issued.
//
// NOTE: this is a template, not legal advice. Have it reviewed by a lawyer
// (familiar with Indian employment law + the DPDP Act, 2023) before use.

import type { LetterBlock } from "@/lib/letter-pdf";

export const NDA_VERSION = "v1-2026-07";

export const SIGNATORY = { name: "Nakul Varshney", title: "Authorised Signatory" };

export type NdaFields = {
  name: string;
  phone: string;
  email: string;
  aadhaar: string; // full, formatted "1234 5678 9012" — for the PDF ONLY
  address: string;
  date: string; // human-readable, e.g. "26 July 2026"
};

/** 12 digits → "1234 5678 9012" (spaced groups), for the printed PDF. */
export function formatAadhaar(digits: string): string {
  const d = digits.replace(/\D/g, "");
  return d.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
}

const CLAUSES: { heading: string; body: string }[] = [
  {
    heading: "1. Purpose",
    body: "In the course of the Employee's employment or engagement with the Company, the Employee will have access to confidential and proprietary information belonging to the Company and its customers. This Agreement governs the protection, use and return of that information.",
  },
  {
    heading: "2. Confidential Information",
    body: '"Confidential Information" means all non-public information disclosed to or accessed by the Employee, in any form, including without limitation: (a) customer personal data — names, phone numbers, email addresses, postal addresses, booking history and payment records; (b) business information — pricing, revenue, financials, strategy, and vendor or partner terms; (c) technical information — source code, databases, credentials, API keys, system architecture and security measures; (d) operational information — internal policies, processes and communications; and (e) any information marked confidential or that a reasonable person would understand to be confidential.',
  },
  {
    heading: "3. Obligations of the Employee",
    body: "The Employee shall: (a) hold all Confidential Information in strict confidence; (b) use it solely to perform authorised duties for the Company; (c) not disclose, copy, transmit or remove it except as required for work and authorised by the Company; (d) protect it with at least reasonable care and comply with the Company's security policies; and (e) immediately report any suspected loss, unauthorised access or breach.",
  },
  {
    heading: "4. Data Protection and Privacy",
    body: "The Employee acknowledges that the Company handles the personal and financial data of its customers, and shall: (a) process such data only as instructed and only to the extent necessary for the Employee's role; (b) comply with all applicable data-protection law, including the Digital Personal Data Protection Act, 2023, and the Company's privacy policy; (c) never access, use, share or sell customer data for personal purposes; and (d) not retain or transfer any customer data upon cessation of employment.",
  },
  {
    heading: "5. Company Policies",
    body: "The Employee agrees to read, understand and comply with the Company's information-security, acceptable-use and privacy policies, as amended from time to time.",
  },
  {
    heading: "6. Intellectual Property",
    body: "All work product, inventions, designs and materials created by the Employee in the course of employment shall be the sole and exclusive property of the Company.",
  },
  {
    heading: "7. Return of Materials",
    body: "Upon termination of employment or upon the Company's request, the Employee shall promptly return or destroy all Confidential Information and Company property in the Employee's possession, including devices, documents and access credentials.",
  },
  {
    heading: "8. Term and Survival",
    body: "This Agreement is effective from the date of signing. The confidentiality obligations survive the termination of employment and continue indefinitely with respect to trade secrets, and for a period of three (3) years with respect to other Confidential Information.",
  },
  {
    heading: "9. Consequences of Breach",
    body: "The Employee acknowledges that any breach of this Agreement may cause irreparable harm to the Company and its customers. The Company shall be entitled to seek injunctive relief and to recover damages, in addition to any other remedies available under law, including under the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023.",
  },
  {
    heading: "10. Governing Law and Jurisdiction",
    body: "This Agreement shall be governed by and construed in accordance with the laws of India. The courts at Mathura, Uttar Pradesh shall have exclusive jurisdiction over any dispute arising out of or in connection with this Agreement.",
  },
];

export function buildNdaBlocks(f: NdaFields): LetterBlock[] {
  return [
    { type: "title", text: "NON-DISCLOSURE AND CONFIDENTIALITY AGREEMENT" },
    {
      type: "paragraph",
      text: `This Non-Disclosure and Confidentiality Agreement ("Agreement") is made on ${f.date} at Mathura, Uttar Pradesh, by and between:`,
    },
    {
      type: "paragraph",
      text: `Sportive Ventures, operating under the brand "Momentum Arena", having its principal place of business at Khasra no. 293/5, Mouja Ganeshra, Radhapuram Road, Mathura, Uttar Pradesh 281004 (the "Company"); and`,
    },
    {
      type: "paragraph",
      text: `${f.name}, holding Aadhaar No. ${f.aadhaar}, residing at ${f.address}, contactable at ${f.phone} and ${f.email} (the "Employee").`,
    },
    ...CLAUSES.flatMap(
      (c): LetterBlock[] => [
        { type: "heading", text: c.heading },
        { type: "paragraph", text: c.body },
      ]
    ),
    {
      type: "paragraph",
      text: "The Employee confirms that they have read and understood this Agreement and sign it voluntarily. IN WITNESS WHEREOF, the parties have executed this Agreement on the date first written above.",
    },
    { type: "gap", mm: 2 },
    { type: "rule" },
    { type: "lines", lines: ["For the Company (Sportive Ventures):"], bold: true },
    { type: "signoff", name: SIGNATORY.name, title: SIGNATORY.title },
    { type: "gap", mm: 3 },
    {
      type: "lines",
      lines: [
        "Employee:",
        `Name: ${f.name}`,
        "Signature: ____________________",
        `Place: Mathura          Date: ${f.date}`,
      ],
    },
  ];
}
