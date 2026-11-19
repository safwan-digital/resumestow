# ResumeStow — Free ATS Resume Checker

Free, no-login, 100% in-browser ATS resume checker. Upload a PDF/DOCX resume,
optionally paste a job description, and get an ATS Readiness Score with a
plain-language fix list. Files never leave the device.

Live: https://resumestow.safwan.digital/ (pending DNS)
Sibling tools: PDFStow (pdfstow.safwan.digital), ImageStow (imagestow.safwan.digital)

## How it works
- `engine.js` — pure analysis logic (keyword extraction/matching, format,
  section and content checks, scoring). Runs in browser and Node.
- `app.js` — parsing with vendored pdf.js (PDF text + layout signals) and
  mammoth.js (DOCX text + table/image detection), plus report rendering.
- No server, no API, no analytics in v1. Scoring model is documented on the
  About page and is deliberately labelled an estimate.

## QA
- Engine battery: `node tests/engine.test.js` (20 checks)
- Sample files in `tests/samples/` (clean, two-column, scanned, table DOCX)
  for manual/browser end-to-end runs.

## Dev notes
- Bump `?v=` on CSS/JS references with every change (Stow family rule).
- Vendored libraries live in `vendor/` — do not hotlink CDNs.
