/* ResumeStow app — file parsing (pdf.js / mammoth) + report rendering.
   Everything runs locally. Files are never uploaded. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var drop = $('drop'), fileInput = $('file'), fileName = $('file-name'),
      jd = $('jd'), runBtn = $('run'), errBox = $('err'), report = $('report');
  var chosen = null;

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js?v=1';

  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', function () { if (fileInput.files.length) setFile(fileInput.files[0]); });

  function setFile(f) {
    var ok = /\.pdf$/i.test(f.name) || /\.docx$/i.test(f.name);
    if (!ok) { showErr('Please choose a PDF or DOCX resume. Other formats cannot be read by ATS software either — export as PDF or DOCX first.'); return; }
    if (f.size > 10 * 1024 * 1024) { showErr('That file is over 10 MB. Compress it or re-export it before checking.'); return; }
    chosen = f; hideErr();
    fileName.textContent = f.name + ' (' + (f.size / 1024).toFixed(0) + ' KB) — ready';
    runBtn.disabled = false;
  }
  function showErr(m) { errBox.textContent = m; errBox.style.display = 'block'; }
  function hideErr() { errBox.style.display = 'none'; }

  runBtn.addEventListener('click', function () {
    if (!chosen) { showErr('Choose your resume file first.'); return; }
    runBtn.disabled = true; runBtn.textContent = 'Reading your resume…';
    parseFile(chosen).then(function (resume) {
      var result = ResumeEngine.analyze(resume, jd.value || '');
      render(result, resume);
      runBtn.disabled = false; runBtn.textContent = 'Check my resume';
    }).catch(function (e) {
      console.error(e);
      showErr('We could not read that file. It may be password-protected or damaged. Try re-exporting it as a fresh PDF from Word or Google Docs.');
      runBtn.disabled = false; runBtn.textContent = 'Check my resume';
    });
  });

  function parseFile(f) {
    return f.arrayBuffer().then(function (buf) {
      if (/\.docx$/i.test(f.name)) return parseDocx(f, buf);
      return parsePdf(f, buf);
    });
  }

  function parsePdf(f, buf) {
    return pdfjsLib.getDocument({ data: buf }).promise.then(function (pdf) {
      var pageTexts = [], columns = false, images = false, firstLines = [];
      var chain = Promise.resolve();
      var pages = [];
      for (var p = 1; p <= pdf.numPages; p++) pages.push(p);
      return pages.reduce(function (acc, pno) {
        return acc.then(function () {
          return pdf.getPage(pno).then(function (page) {
            var vp = page.getViewport({ scale: 1 });
            return page.getTextContent().then(function (tc) {
              var items = tc.items.filter(function (it) { return it.str.trim().length; });
              pageTexts.push(items.map(function (it) { return it.str; }).join('\n'));
              if (items.length) firstLines.push(items[0].str.trim());
              // Column detection: substantial text starting in both left and right bands.
              if (items.length >= 16) {
                var left = 0, right = 0;
                items.forEach(function (it) {
                  var x = it.transform[4];
                  if (x < vp.width * 0.42) left++; else if (x > vp.width * 0.52) right++;
                });
                if (left >= 8 && right >= 8) columns = true;
              }
              if (pdfjsLib.OPS) {
                return page.getOperatorList().then(function (ops) {
                  for (var i = 0; i < ops.fnArray.length; i++) {
                    if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject || ops.fnArray[i] === pdfjsLib.OPS.paintJpegXObject) { images = true; break; }
                  }
                }).catch(function () {});
              }
            });
          });
        });
      }, Promise.resolve()).then(function () {
        var headerFooter = false;
        if (firstLines.length > 1) {
          var counts = {};
          firstLines.forEach(function (l) { counts[l] = (counts[l] || 0) + 1; });
          headerFooter = Object.keys(counts).some(function (k) { return counts[k] > 1 && k.length > 2; });
        }
        return {
          text: pageTexts.join('\n'), pageCount: pdf.numPages, fileType: 'pdf',
          fileSizeBytes: f.size, columnsDetected: columns, tablesDetected: false,
          imagesDetected: images, headerFooterText: headerFooter
        };
      });
    });
  }

  function parseDocx(f, buf) {
    var raw = mammoth.extractRawText({ arrayBuffer: buf });
    var html = mammoth.convertToHtml({ arrayBuffer: buf });
    return Promise.all([raw, html]).then(function (r) {
      return {
        text: r[0].value || '', pageCount: 0, fileType: 'docx',
        fileSizeBytes: f.size, columnsDetected: false,
        tablesDetected: /<table[\s>]/i.test(r[1].value || ''),
        imagesDetected: /<img[\s>]/i.test(r[1].value || ''), headerFooterText: false
      };
    });
  }

  /* ---------- Sample report ---------- */
  $('sample').addEventListener('click', function (e) {
    e.preventDefault();
    var sampleResume = {
      text: 'Priya Sharma\nMarketing Executive\nEmail: priya.sharma@example.com\nWork Experience\nMarketing Executive, BrightKart, 2022 - 2025\nResponsible for social media and marketing tasks. Helped the team with campaigns and other work. Did posting on Instagram and Facebook.\nJunior Executive, BrightKart, 2020 - 2022\nAssisted senior staff. Made reports in Excel.\nEducation\nB.Com, Delhi University, 2020\nSkills\nSocial Media, Excel, Communication',
      pageCount: 3, fileType: 'pdf', fileSizeBytes: 240000,
      columnsDetected: true, tablesDetected: false, imagesDetected: true, headerFooterText: false
    };
    var sampleJD = 'We are hiring a Digital Marketing Manager skilled in SEO, Google Ads, Meta Ads, analytics and content strategy. You will run SEO campaigns, manage Google Ads and Meta Ads budgets, build analytics dashboards, improve conversion rate and own content strategy. SEO, analytics and conversion experience required.';
    jd.value = sampleJD;
    render(ResumeEngine.analyze(sampleResume, sampleJD), sampleResume);
  });

  /* ---------- Rendering ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function bar(label, val, max) {
    var pct = Math.round(val / max * 100);
    return '<div class="bar-row"><span>' + esc(label) + '</span><div class="meter"><i style="width:' + pct + '%"></i></div><b>' + val + '/' + max + '</b></div>';
  }
  function render(r, resume) {
    var colour = r.score >= 75 ? 'var(--good)' : r.score >= 50 ? 'var(--gold)' : 'var(--bad)';
    var C = 2 * Math.PI * 62;
    var verdict = r.score >= 75 ? 'Strong — this resume should survive most ATS filters.' :
                  r.score >= 50 ? 'Middle of the road — fix the red items below before applying.' :
                  'At risk — an ATS is likely filtering this resume out. Work through the fixes below.';
    var html = '';
    html += '<div class="score-head"><svg class="ring" viewBox="0 0 148 148" role="img" aria-label="ATS readiness score ' + r.score + ' out of 100">' +
      '<circle cx="74" cy="74" r="62" fill="none" stroke="var(--line)" stroke-width="11"/>' +
      '<circle cx="74" cy="74" r="62" fill="none" stroke="' + colour + '" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + (C * r.score / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 74 74)"/>' +
      '<text x="74" y="76" text-anchor="middle" class="num">' + r.score + '</text><text x="74" y="96" text-anchor="middle" class="of">out of 100</text></svg>' +
      '<div class="bars"><h2 style="margin:0 0 4px">Your ATS Readiness Score</h2><p style="margin:0 0 10px;color:var(--muted)">' + verdict + '</p>' +
      bar('Format & parsing', r.parseScore, 30) + bar('Sections & contact', r.sectionScore, 15) + bar('Content quality', r.contentScore, 15) +
      (r.mode === 'jd' ? bar('Job keywords', r.keywordScore, 40) : '<p class="hint">Tip: paste the job description next time to unlock keyword matching (40 points of the score).</p>') +
      '</div></div>';

    if (r.mode === 'jd') {
      html += '<h3 style="margin:22px 0 4px">Keywords from the job description</h3>';
      html += '<p class="hint" style="margin:0">Found in your resume (' + r.matched.length + ')</p><div class="chips">' +
        (r.matched.map(function (m) { return '<span class="chip ok">' + esc(m.term) + '</span>'; }).join('') || '<span class="hint">None matched.</span>') + '</div>';
      html += '<p class="hint" style="margin:10px 0 0">Missing — add only the ones that honestly fit your experience (' + r.missing.length + ')</p><div class="chips">' +
        (r.missing.map(function (m) { return '<span class="chip no">' + esc(m.term) + '</span>'; }).join('') || '<span class="hint">Nothing missing.</span>') + '</div>';
    }

    html += '<h3 style="margin:22px 0 4px">What to fix, in order</h3><ul class="checks">';
    r.checks.forEach(function (c) {
      html += '<li class="' + c.status + '"><span class="st">' + (c.status === 'pass' ? 'Good' : c.status === 'warn' ? 'Improve' : 'Fix first') + '</span><h4>' + esc(c.title) + '</h4><p>' + esc(c.detail) + '</p></li>';
    });
    html += '</ul>';
    html += '<p class="note">How this works: your file was read on this device only — nothing was uploaded. The score is an <b>ATS readiness estimate</b> based on how common ATS software (Workday, Greenhouse, Lever, Taleo and similar) generally parses resumes. Each company\'s system differs, so no checker can promise an exact result. Fix the red items, re-check, then apply.</p>';
    html += '<div class="no-print"><button class="btn gold" onclick="window.print()">Save report as PDF</button> <button class="btn ghost" id="again">Check another resume</button></div>';
    report.innerHTML = html;
    report.style.display = 'block';
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('again').addEventListener('click', function () {
      report.style.display = 'none'; chosen = null; fileInput.value = ''; fileName.textContent = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
})();
