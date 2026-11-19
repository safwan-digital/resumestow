/* ResumeStow engine QA battery — node tests/engine.test.js */
const E = require('../engine.js');
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra || ''); }
}
const JD = `We are hiring a Digital Marketing Manager. The role requires SEO, Google Ads, Meta Ads, analytics and content strategy. You will manage SEO campaigns, run Google Ads and Meta Ads, read analytics dashboards, improve conversion rate, and own content strategy across channels. Experience with SEO tools, Google Ads budgets, analytics reporting and conversion optimisation is essential. Marketing, marketing, marketing.`;

const clean = {
  text: `Abu Safwan — Digital Marketing Manager
Email: mail@example.com Phone: +971 52 000 0000 linkedin.com/in/example
Professional Summary
Digital marketing manager with 6 years of experience in SEO, Google Ads and Meta Ads.
Work Experience
Marketing Manager, Example Co, 2021 - 2025
Built SEO strategy that increased organic traffic 64% in 12 months.
Launched Google Ads campaigns and improved conversion rate by 32%.
Managed Meta Ads budgets of AED 108,000 and generated 125,000 clicks.
Delivered analytics reporting weekly and automated dashboards, saving 6 hours per week.
Developed content strategy across 4 channels and grew followers 210%.
Education
BBA Marketing, Example University, 2015 - 2019
Skills
SEO, Google Ads, Meta Ads, Analytics, Content Strategy, Conversion Optimisation, WordPress`,
  pageCount: 2, fileType: 'pdf', fileSizeBytes: 180000,
  columnsDetected: false, tablesDetected: false, imagesDetected: false, headerFooterText: false
};

let r = E.analyze(clean, JD);
t('clean+JD scores high (>=80)', r.score >= 80, 'score=' + r.score);
t('clean+JD mode is jd', r.mode === 'jd');
t('clean+JD matches seo keyword', r.matched.some(m => m.term.includes('seo')));
t('clean+JD few missing', r.missing.length <= 4, JSON.stringify(r.missing));

r = E.analyze(clean, '');
t('clean no-JD scores high (>=80)', r.score >= 80, 'score=' + r.score);
t('no-JD keywordScore null', r.keywordScore === null);

const scanned = { ...clean, text: '   ' };
r = E.analyze(scanned, JD);
t('scanned scores <=12', r.score <= 12, 'score=' + r.score);
t('scanned flags selectable-text fail', r.checks.some(c => c.id === 'selectable-text' && c.status === 'fail'));

const twoCol = { ...clean, columnsDetected: true };
r = E.analyze(twoCol, '');
t('two-column penalised', r.parseScore <= 20, 'parse=' + r.parseScore);
t('two-column check fails', r.checks.some(c => c.id === 'columns' && c.status === 'fail'));

const tabled = { ...clean, tablesDetected: true };
r = E.analyze(tabled, '');
t('table warns', r.checks.some(c => c.id === 'tables' && c.status === 'warn'));

const noContact = { ...clean, text: clean.text.replace('mail@example.com', '').replace('+971 52 000 0000', '').replace('linkedin.com/in/example', '') };
r = E.analyze(noContact, '');
t('no email fails email check', r.checks.some(c => c.id === 'email' && c.status === 'fail'));
t('no-contact scores lower than clean', r.score < E.analyze(clean, '').score);

const dutiesOnly = {
  text: `John Doe
Experience
Responsible for marketing work. Did various tasks for the team. Helped with projects and other things as needed by the manager.
Education
Some College`,
  pageCount: 1, fileType: 'docx', fileSizeBytes: 40000,
  columnsDetected: false, tablesDetected: false, imagesDetected: false, headerFooterText: false
};
r = E.analyze(dutiesOnly, JD);
t('duties-only scores low (<55)', r.score < 55, 'score=' + r.score);
t('duties-only misses most keywords', r.missing.length >= 5, 'missing=' + r.missing.length);
t('duties-only numbers fail/warn', r.checks.some(c => c.id === 'numbers' && c.status !== 'pass'));

const longResume = { ...clean, pageCount: 5 };
r = E.analyze(longResume, '');
t('5-page warns on pages', r.checks.some(c => c.id === 'pages' && c.status === 'warn'));

const kws = E.extractKeywords(JD);
t('JD keyword extraction finds seo/google ads', kws.some(k => k.display.includes('seo')) && kws.some(k => k.display.includes('google')));
t('JD keywords capped at 40', kws.length <= 40, 'n=' + kws.length);
t('stopwords not keywords', !kws.some(k => ['the', 'and', 'you', 'will'].includes(k.display)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
