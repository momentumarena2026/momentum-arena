/**
 * Friendly URL for the live cafe menu PDF — momentumarena.com/menu.pdf.
 * Pure alias: re-exports the generator route so both URLs serve the
 * identical always-fresh document (live CafeItem rows, compressed
 * product thumbnails, <100KB budget). Keep printables / QR codes
 * pointed at this path; the /api/cafe-menu-pdf form stays for any
 * existing links.
 */
export { GET } from "../api/cafe-menu-pdf/route";
