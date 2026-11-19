/* ResumeStow ATS engine — pure analysis logic. No DOM, no network.
   Works in browser (window.ResumeEngine) and Node (module.exports) for QA.
   Input resume object:
   { text, pageCount, fileType: 'pdf'|'docx', fileSizeBytes,
     columnsDetected: bool, tablesDetected: bool, imagesDetected: bool,
     headerFooterText: bool }
   Job description: plain string or ''.
   Output: { score, mode, keywordScore, parseScore, sectionScore, contentScore,
             matched: [{term, jdCount}], missing: [{term, jdCount}],
             checks: [{id, status: 'pass'|'warn'|'fail', impact: 1-3, title, detail}] }
*/
(function (root) {
  'use strict';

  var STOPWORDS = new Set(('a,an,the,and,or,of,to,in,for,on,with,at,by,from,as,is,are,was,were,be,been,being,will,would,can,could,should,may,might,must,shall,have,has,had,do,does,did,this,that,these,those,it,its,you,your,yours,we,our,ours,they,their,them,he,she,his,her,who,whom,which,what,when,where,why,how,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,just,about,above,after,again,against,below,between,into,through,during,before,under,over,out,up,down,if,then,once,here,there,am,per,via,etc,including,include,includes,required,requirements,responsibilities,responsible,work,working,team,teams,company,business,experience,experienced,skills,skill,ability,abilities,strong,excellent,good,great,new,day,days,year,years,role,roles,job,position,candidate,candidates,looking,join,help,using,use,used,across,within,ensure,ensuring,drive,driving,support,supporting,develop,developing,related,plus,preferred,ideal,knowledge,understanding,environment,environments,opportunity,growth,fast-paced,etc.,e.g,i.e').split(','));

  var ACTION_VERBS = new Set(('led,built,launched,delivered,improved,increased,reduced,designed,developed,created,managed,automated,achieved,grew,saved,boosted,shipped,owned,drove,implemented,optimised,optimized,streamlined,negotiated,mentored,trained,launched,scaled,generated,converted,analysed,analyzed,tested,deployed,maintained,resolved,coordinated,presented,wrote,planned,executed,researched,migrated,integrated,monitored,configured,debugged,documented,reviewed,identified,proposed,won,closed,signed,onboarded,audited,forecast,forecasted,budgeted').split(','));

  var SECTION_PATTERNS = [
    { key: 'experience', label: 'Work Experience', re: /\b(work experience|professional experience|employment history|experience)\b/i },
    { key: 'education', label: 'Education', re: /\b(education|academic background|qualifications)\b/i },
    { key: 'skills', label: 'Skills', re: /\b(technical skills|core skills|skills|technologies|tech stack)\b/i },
    { key: 'summary', label: 'Summary / Objective', re: /\b(professional summary|summary|objective|profile)\b/i },
    { key: 'projects', label: 'Projects', re: /\b(projects|personal projects|key projects)\b/i },
    { key: 'certifications', label: 'Certifications', re: /\b(certifications|certificates|certified)\b/i }
  ];

  function stem(w) {
    w = w.toLowerCase();
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z][a-z0-9+#./-]{1,30}/g) || []);
  }

  /* Extract candidate keywords from a job description.
     Returns [{term, display, count}] sorted by count desc, capped. */
  function extractKeywords(jd, cap) {
    cap = cap || 40;
    var tokens = tokenize(jd);
    var counts = new Map();
    function add(term, display) {
      var s = stem(term);
      if (s.length < 3) return;
      var cur = counts.get(s) || { stem: s, display: display, count: 0 };
      cur.count++; counts.set(s, cur);
    }
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].replace(/[./-]+$/, '');
      if (t.length < 3 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
      add(t, t);
      if (i + 1 < tokens.length) {
        var t2 = tokens[i + 1].replace(/[./-]+$/, '');
        if (t2.length >= 3 && !STOPWORDS.has(t2) && !/^\d+$/.test(t2)) {
          add(t + ' ' + t2, t + ' ' + t2);
        }
      }
    }
    var list = Array.from(counts.values()).filter(function (k) { return k.count >= 2 || k.display.indexOf(' ') > 0 && k.count >= 1 && k.display.length > 8; });
    // Single words need repetition to count as JD keywords; phrases pass at 1 if reasonably specific.
    list = list.filter(function (k) { return k.count >= 2; });
    list.sort(function (a, b) { return b.count - a.count || b.display.length - a.display.length; });
    // Drop phrases fully contained in a higher-ranked phrase with same count.
    var kept = [];
    for (var j = 0; j < list.length && kept.length < cap; j++) {
      var k = list[j];
      var dup = kept.some(function (o) { return o.display.indexOf(k.display) >= 0 && o.count === k.count; });
      if (!dup) kept.push(k);
    }
    return kept.map(function (k) { return { term: k.stem, display: k.display, jdCount: k.count }; });
  }

  function analyze(resume, jdText) {
    var checks = [];
    function check(id, status, impact, title, detail) {
      checks.push({ id: id, status: status, impact: impact, title: title, detail: detail });
    }
    var text = resume.text || '';
    var lower = text.toLowerCase();
    var words = tokenize(text);
    var wordCount = words.length;
    var hasJD = !!(jdText && jdText.trim().length >= 80);

    /* ---------- Parseability / format (30) ---------- */
    var parse = 30;
    var selectable = text.trim().length >= 200;
    if (!selectable) {
      parse = 2;
      check('selectable-text', 'fail', 3, 'No readable text found in your resume',
        'ATS software reads text, not pictures. This file looks like a scanned image or a flattened design export, so an ATS would see a blank page. Re-export it from Word/Google Docs as a real text PDF, or upload the DOCX.');
    } else {
      check('selectable-text', 'pass', 3, 'Your resume has readable text', 'An ATS can extract the words from this file.');
    }
    if (resume.columnsDetected) {
      parse -= 10;
      check('columns', 'fail', 3, 'Two-column layout detected',
        'Most ATS software reads straight down the page, so side-by-side columns get shuffled into nonsense — your newest job can end up mixed into your education. Use a single column.');
    } else {
      check('columns', 'pass', 2, 'Single-column layout', 'Your text flows in one column, the order ATS software expects.');
    }
    if (resume.tablesDetected) {
      parse -= 8;
      check('tables', 'warn', 2, 'Tables detected in your resume',
        'Many ATS parsers skip or scramble table content. If your experience or skills sit inside tables, move them into normal paragraphs and bullet lists.');
    }
    if (resume.imagesDetected) {
      parse -= 4;
      check('images', 'warn', 1, 'Images or icons detected',
        'ATS software cannot read text inside images, charts or skill bars. Keep every important word as real text; remove skill-bar graphics and photo elements.');
    }
    if (resume.headerFooterText) {
      parse -= 3;
      check('header-footer', 'warn', 1, 'Important text may be in the header or footer',
        'Some ATS parsers ignore page headers and footers completely. Keep your name and contact details in the main body of the first page.');
    }
    if (resume.pageCount > 2) {
      parse -= 4;
      check('pages', 'warn', 2, 'Resume is ' + resume.pageCount + ' pages',
        'Recruiters and ATS ranking both favour 1–2 pages. Cut older or irrelevant roles first; keep the last 10 years in detail.');
    } else if (resume.pageCount >= 1) {
      check('pages', 'pass', 1, resume.pageCount + (resume.pageCount === 1 ? ' page' : ' pages'), 'Length is in the range ATS and recruiters expect.');
    }
    if (resume.fileSizeBytes > 2 * 1024 * 1024) {
      parse -= 2;
      check('file-size', 'warn', 1, 'File is larger than 2 MB', 'Some application portals reject or truncate large files. Compress images or re-export to bring it under 2 MB.');
    }
    parse = Math.max(0, Math.min(30, parse));

    /* ---------- Sections & contact (15) ---------- */
    var sectionScore = 0;
    var hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
    var hasPhone = /(\+?\d[\d\s()-]{7,}\d)/.test(text);
    var hasLinkedIn = /linkedin\.com\//i.test(text);
    if (hasEmail) { sectionScore += 3; check('email', 'pass', 2, 'Email address found', 'Recruiters and ATS can contact you from the parsed data.'); }
    else check('email', 'fail', 3, 'No email address found', 'Add a professional email address in the main body of page 1 — without it, many ATS forms cannot create your profile.');
    if (hasPhone) sectionScore += 2; else check('phone', 'warn', 2, 'No phone number found', 'Add a phone number with country code so the parsed profile is complete.');
    if (hasLinkedIn) sectionScore += 1;
    var foundSections = [];
    SECTION_PATTERNS.forEach(function (s) { if (s.re.test(text)) foundSections.push(s); });
    var core = foundSections.filter(function (s) { return s.key === 'experience' || s.key === 'education' || s.key === 'skills'; });
    sectionScore += Math.min(9, core.length * 3 + (foundSections.length - core.length) * 1);
    if (core.length === 3) check('sections', 'pass', 2, 'Standard section headings found', 'Experience, Education and Skills use the headings ATS software looks for.');
    else {
      var missingCore = ['experience', 'education', 'skills'].filter(function (k) { return !core.some(function (s) { return s.key === k; }); });
      check('sections', missingCore.length >= 2 ? 'fail' : 'warn', 3,
        'Missing standard heading: ' + missingCore.map(function (k) { return k[0].toUpperCase() + k.slice(1); }).join(', '),
        'ATS software files your information under standard headings. Rename creative headings ("My journey", "Superpowers") to Experience, Education and Skills.');
    }
    sectionScore = Math.min(15, sectionScore);

    /* ---------- Content quality (15) ---------- */
    var content = 0;
    var verbHits = new Set();
    words.forEach(function (w) { if (ACTION_VERBS.has(w)) verbHits.add(w); });
    if (verbHits.size >= 8) { content += 5; check('verbs', 'pass', 1, 'Strong action verbs (' + verbHits.size + ' different)', 'Your bullets start with verbs ATS and recruiters scan for.'); }
    else if (verbHits.size >= 4) { content += 3; check('verbs', 'warn', 1, 'Few action verbs', 'Start bullets with verbs like built, led, improved, delivered — not "responsible for".'); }
    else check('verbs', 'warn', 2, 'Bullets lack action verbs', 'Most ATS ranking rewards achievement language. Rewrite duties as actions: "Built…", "Reduced…", "Launched…".');
    var numbers = (text.match(/\d+([.,]\d+)?\s*(%|percent|\+|k\b|m\b|crore|lakh|million|users|customers|clients|projects|sales|revenue)/gi) || []).length;
    var anyNumbers = (text.match(/\b\d[\d,]*\b/g) || []).length;
    if (numbers >= 3 || anyNumbers >= 10) { content += 5; check('numbers', 'pass', 1, 'Achievements are quantified', 'Numbers in your bullets help both ATS keyword matching and recruiter trust.'); }
    else if (anyNumbers >= 4) { content += 3; check('numbers', 'warn', 1, 'Add numbers to your achievements', 'Turn "improved sales" into "improved sales 32% in 6 months". Quantified bullets rank and read better.'); }
    else check('numbers', 'fail', 2, 'No measurable results found', 'Your resume lists duties but no results. Add numbers — %, money, time saved, people, projects — to at least your recent roles.');
    if (wordCount >= 250 && wordCount <= 1000) content += 3;
    else if (wordCount > 0 && wordCount < 250) { content += 1; check('length', 'warn', 1, 'Resume text is short (' + wordCount + ' words)', 'Very short resumes give ATS little to match. Add detail to recent roles: tools used, scope, results.'); }
    else if (wordCount > 1000) { content += 1; check('length', 'warn', 1, 'Resume text is long (' + wordCount + ' words)', 'Long resumes dilute your best keywords. Trim older roles to one line each.'); }
    var dateHits = (text.match(/\b(19|20)\d{2}\b/g) || []).length;
    if (dateHits >= 2) content += 2; else check('dates', 'warn', 1, 'Few or no dates found', 'Add month/year dates to jobs and education — ATS uses them to calculate your experience.');
    content = Math.min(15, content);

    /* ---------- Keywords (40, JD mode only) ---------- */
    var keywordScore = null, matched = [], missing = [];
    if (hasJD) {
      var kws = extractKeywords(jdText);
      var resumeStems = new Map();
      tokenize(text).forEach(function (w) { var s = stem(w); resumeStems.set(s, (resumeStems.get(s) || 0) + 1); });
      // Build phrase stems for bigram matching
      var resumeTextStemmed = tokenize(text).map(stem).join(' ');
      var totalWeight = 0, hitWeight = 0;
      kws.forEach(function (k) {
        var wgt = Math.min(k.jdCount, 5);
        totalWeight += wgt;
        var hit;
        if (k.display.indexOf(' ') > 0) {
          var phraseStem = k.display.split(' ').map(stem).join(' ');
          hit = resumeTextStemmed.indexOf(phraseStem) >= 0;
        } else {
          hit = resumeStems.has(k.term);
        }
        if (hit) { hitWeight += wgt; matched.push({ term: k.display, jdCount: k.jdCount }); }
        else missing.push({ term: k.display, jdCount: k.jdCount });
      });
      keywordScore = totalWeight ? Math.round(40 * hitWeight / totalWeight) : 20;
      if (missing.length === 0 && kws.length) check('keywords', 'pass', 3, 'All key job-description keywords matched', 'Your resume covers the language this job asks for.');
      else if (missing.length) check('keywords', keywordScore >= 26 ? 'warn' : 'fail', 3,
        missing.length + ' job keywords missing from your resume',
        'The job description repeats these words and your resume never uses them: ' + missing.slice(0, 8).map(function (m) { return m.term; }).join(', ') + '. Add the ones that honestly describe your experience — never add skills you do not have.');
    }

    /* ---------- Final score ---------- */
    var score;
    if (hasJD) score = Math.round(parse + sectionScore + content + (keywordScore || 0));
    else score = Math.round((parse + sectionScore + content) / 60 * 100);
    score = Math.max(1, Math.min(100, score));
    if (!selectable) score = Math.min(score, 12);

    checks.sort(function (a, b) {
      var rank = { fail: 0, warn: 1, pass: 2 };
      return rank[a.status] - rank[b.status] || b.impact - a.impact;
    });

    return {
      score: score, mode: hasJD ? 'jd' : 'health',
      parseScore: parse, sectionScore: sectionScore, contentScore: content,
      keywordScore: keywordScore, matched: matched, missing: missing,
      wordCount: wordCount, checks: checks
    };
  }

  var api = { analyze: analyze, extractKeywords: extractKeywords, stem: stem, tokenize: tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ResumeEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
