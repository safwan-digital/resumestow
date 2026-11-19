/* End-to-end parse QA in Node: real pdf.js + mammoth (the site's own vendored
   builds) + the site's column heuristic + engine, on real sample files. */
const fs = require('fs');
const path = require('path');
const pdfjsLib = require('../vendor/pdf.min.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(__dirname, '../vendor/pdf.worker.min.js');
const mammoth = require('../vendor/mammoth.browser.min.js');
const E = require('../engine.js');

const JD = "We are hiring a Digital Marketing Manager. The role requires SEO, Google Ads, Meta Ads, analytics and content strategy. You will manage SEO campaigns, run Google Ads and Meta Ads, read analytics dashboards, improve conversion rate, and own content strategy across channels. Experience with SEO tools, Google Ads budgets, analytics reporting and conversion optimisation is essential.";

async function parsePdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts = []; let columns = false, images = false; const firstLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str.trim().length);
    pageTexts.push(items.map(it => it.str).join('\n'));
    if (items.length) firstLines.push(items[0].str.trim());
    if (items.length >= 16) {
      let left = 0, right = 0;
      items.forEach(it => { const x = it.transform[4]; if (x < vp.width * 0.42) left++; else if (x > vp.width * 0.52) right++; });
      if (left >= 8 && right >= 8) columns = true;
    }
    const ops = await page.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject || ops.fnArray[i] === pdfjsLib.OPS.paintJpegXObject) images = true;
    }
  }
  let headerFooter = false;
  if (firstLines.length > 1) { const c = {}; firstLines.forEach(l => c[l] = (c[l] || 0) + 1); headerFooter = Object.keys(c).some(k => c[k] > 1 && k.length > 2); }
  return { text: pageTexts.join('\n'), pageCount: pdf.numPages, fileType: 'pdf', fileSizeBytes: fs.statSync(file).size, columnsDetected: columns, tablesDetected: false, imagesDetected: images, headerFooterText: headerFooter };
}

(async () => {
  let pass = 0, fail = 0;
  const t = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra || ''); } };
  const S = n => path.join(__dirname, 'samples', n);

  let r = E.analyze(await parsePdf(S('clean.pdf')), JD);
  console.log('clean.pdf score', r.score, 'parse', r.parseScore, 'missing', r.missing.length);
  t('clean.pdf high score >=80', r.score >= 80, 'score=' + r.score);
  t('clean.pdf no fix-first', !r.checks.some(c => c.status === 'fail'));

  const two = await parsePdf(S('twocol.pdf'));
  r = E.analyze(two, JD);
  console.log('twocol.pdf score', r.score, 'columns', two.columnsDetected, 'parse', r.parseScore);
  t('twocol.pdf columns detected', two.columnsDetected === true);
  t('twocol.pdf columns check fails', r.checks.some(c => c.id === 'columns' && c.status === 'fail'));

  const scan = await parsePdf(S('scanned.pdf'));
  r = E.analyze(scan, JD);
  console.log('scanned.pdf score', r.score, 'textLen', scan.text.trim().length, 'images', scan.imagesDetected);
  t('scanned.pdf image detected', scan.imagesDetected === true);
  t('scanned.pdf score <=12', r.score <= 12, 'score=' + r.score);
  t('scanned.pdf selectable-text fail', r.checks.some(c => c.id === 'selectable-text' && c.status === 'fail'));

  const buf = fs.readFileSync(S('table.docx'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const raw = await mammoth.extractRawText({ arrayBuffer: ab });
  const html = await mammoth.convertToHtml({ arrayBuffer: ab });
  const docxResume = { text: raw.value || '', pageCount: 0, fileType: 'docx', fileSizeBytes: buf.length, columnsDetected: false, tablesDetected: /<table[\s>]/i.test(html.value || ''), imagesDetected: /<img[\s>]/i.test(html.value || ''), headerFooterText: false };
  r = E.analyze(docxResume, JD);
  console.log('table.docx score', r.score, 'tables', docxResume.tablesDetected, 'textLen', docxResume.text.length);
  t('table.docx table detected', docxResume.tablesDetected === true);
  t('table.docx tables warn', r.checks.some(c => c.id === 'tables' && c.status === 'warn'));
  t('table.docx text extracted', docxResume.text.length > 200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
