/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
function rowsOf(pg, sel) { return pg.$$eval(sel, function (t) { return t.length; }); }
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var pg = await br.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  try {
    await pg.goto(base);
    await pg.click('#btn-sample');
    await pg.waitForSelector('#totals .stat', { timeout: 5000 });
    ok(await pg.isVisible('#s-sum'), '집계 영역이 열린다');
    ok(/순절감/.test(await pg.textContent('#totals')), '순절감 숫자가 나온다');
    ok(await rowsOf(pg, '#chart-month rect.b-save') === 3, '월별 막대 3개월', await rowsOf(pg, '#chart-month rect.b-save'));
    ok(await rowsOf(pg, '#chart-lever rect') >= 5, 'Lever 막대가 그려진다');
    ok(/국산화/.test(await pg.textContent('#tbl-lever')), 'Lever 표에 국산화');
    ok(await rowsOf(pg, '#detail tbody tr') > 150, '발주 상세 줄', await rowsOf(pg, '#detail tbody tr'));
    var before = await rowsOf(pg, '#checks tbody tr');
    ok(before >= 3, '확인 필요 목록이 있다', before);
    ok(/비슷한 품번 BK1061/.test(await pg.textContent('#checks')), '비슷한 품번 제안');
    // 비슷한 품번 품의로 연결 → 한 줄 줄어든다
    await pg.click('#checks button[data-link]');
    ok(await rowsOf(pg, '#checks tbody tr') === before - 1, '제안으로 연결하면 확인 필요가 줄어든다');
    // 화면 입력으로 신규 품번 매칭
    var netBefore = await pg.textContent('#totals .stat:first-child b');
    await pg.click('#checks button[data-fill][data-reason="no-ref"]');
    var part = await pg.inputValue('#m-part');
    ok(/^BK-10/.test(part), '입력 버튼이 품번을 채운다', part);
    await pg.fill('#m-base', '99000'); await pg.selectOption('#m-lever', '국산화'); await pg.fill('#m-doc', 'PU-TEST-1');
    await pg.click('#m-add');
    ok(await rowsOf(pg, '#checks tbody tr') === before - 2, '화면 입력으로 매칭되면 목록에서 빠진다');
    ok((await pg.textContent('#totals .stat:first-child b')) !== netBefore, '순절감이 다시 계산된다');
    ok(/화면 입력/.test(await pg.textContent('#m-list')), '입력한 품의가 목록에 남는다');
    // 기간 거르기
    await pg.selectOption('#month', '2026-09');
    ok(await rowsOf(pg, '#chart-month rect.b-save') === 1, '월 선택 시 그 달만');
    await pg.selectOption('#kind', '인상');
    var kinds = await pg.$$eval('#detail tbody tr td:nth-child(10)', function (t) { return t.map(function (x) { return x.textContent; }); });
    ok(kinds.length > 0 && kinds.every(function (k) { return k === '인상'; }), '상세 구분 거르기');
    // 엑셀 내보내기
    var dl = pg.waitForEvent('download', { timeout: 5000 });
    await pg.click('#btn-export');
    var f = await dl;
    ok(/^구매가절감실적_.*\.xlsx$/.test(f.suggestedFilename()), '엑셀 보고서 내려받기', f.suggestedFilename());
    // 좁은 화면 가로 넘침
    await pg.setViewportSize({ width: 360, height: 800 });
    var over = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(over <= 0, '360px 에서 가로 넘침 없음', over);
    await pg.goto(base + 'guide.html');
    ok(/표 세 가지/.test(await pg.textContent('main')), '사용법 페이지');

    /* ===== v1.1 예산단가 방식(budget.html) ===== */
    errs.length = 0;
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto(base + 'budget.html');
    await pg.evaluate(function () { localStorage.removeItem('build-2611-08.budget.manual'); localStorage.removeItem('build-2611-08.budget.fx'); });
    await pg.goto(base + 'budget.html');
    ok(await rowsOf(pg, '#b-fx-table tbody tr') === 5, '환율표 기본 5종');
    await pg.click('#b-sample');
    await pg.waitForSelector('#b-table tbody tr', { timeout: 5000 });
    var bs = function () { return pg.evaluate(function () { return window.__budget.state.res.summary; }); };
    var S0 = await bs();
    ok(await pg.isVisible('#s-bresult'), '결과 영역이 열린다');
    ok(await rowsOf(pg, '#b-files .b-sheet') === 3, '예제 시트 3장 미리 보기', await rowsOf(pg, '#b-files .b-sheet'));
    ok(await rowsOf(pg, '#b-files .b-sheet[data-s="0"] select.b-map') === 12, '발주 실적 항목 12개 짝짓기 표');
    ok(/데이터 48건/.test(await pg.textContent('#b-files')), '시트 건수 미리 보기');
    ok(await rowsOf(pg, '#b-table tbody tr') === S0.final && S0.final === 43, '상세표 행 수 = 최종 산출 대상(43)', S0.final);
    ok(await rowsOf(pg, '#b-verify li.v-ok') === 6 && await rowsOf(pg, '#b-verify li.v-bad') === 0, '정합성 검증 6항목 일치');
    var tt = await pg.textContent('#b-table');
    ok(['예산단가 미매칭 - 수작업 입력 필요', '구매단가 확인 필요', '환율 확인 필요', '기타 데이터 오류'].every(function (n) { return tt.indexOf(n) >= 0; }), '비고 네 가지가 상세표에 보인다');
    ok(!/미매칭(?! -)/.test(tt.replace(/예산단가 미매칭 - 수작업 입력 필요/g, '')), '담당자 미매칭 행은 상세표에 없다');
    ok(/1001/.test(await pg.textContent('#b-errors')) && /담당자 미매칭/.test(await pg.textContent('#b-errors')), '오류 내역에 담당자 미매칭(선행 0 없는 코드)');
    ok(await rowsOf(pg, '#b-excluded tbody tr') === 3, '제외(비ZNB) 3행');
    ok(/김민수/.test(await pg.textContent('#b-owner')) && /가람정밀/.test(await pg.textContent('#b-vendor')), '담당자별·협력사별 표');
    ok(/전체 Impact/.test(await pg.textContent('#b-stats')), '전체 Impact 카드');
    // 예산단가 직접 입력 → 바로 계산, 브라우저에 남는다
    ok(await rowsOf(pg, '#b-table input.b-manual') === S0.manualNeeded && S0.manualNeeded === 2, '예산단가 입력 칸 2개');
    var partKey = await pg.getAttribute('#b-table input.b-manual', 'data-key');
    await pg.fill('#b-table input.b-manual', '1000'); await pg.click('#b-table .b-manual-add');
    await pg.waitForFunction(function () { return window.__budget.state.res.summary.manualFilled === 1; }, null, { timeout: 3000 });
    var S1 = await bs();
    ok(S1.manualNeeded === 1 && S1.manualFilled === 1 && S1.final === S0.final, '입력하면 수작업 필요가 1 줄고 행 수는 그대로');
    ok((await pg.textContent('#b-manual-list')).indexOf(partKey) >= 0, '입력한 예산단가 목록', partKey);
    ok(await rowsOf(pg, '#b-table input.b-manual') === 1, '입력 칸이 하나 남는다');
    // 다시 열어도 입력값이 남아 쓰인다
    await pg.goto(base + 'budget.html'); await pg.click('#b-sample'); await pg.waitForSelector('#b-table tbody tr', { timeout: 5000 });
    var S2 = await bs();
    ok(S2.manualFilled === 1 && S2.manualNeeded === 1, '다시 열어 예제를 돌려도 화면 입력 예산단가가 유지된다');
    // 환율을 바꾸면 Impact 가 바뀐다 · 되돌리기
    await pg.fill('#b-fx-table tbody tr:nth-child(2) .fx-rate', '1000'); await pg.dispatchEvent('#b-fx-table tbody tr:nth-child(2) .fx-rate', 'change');
    await pg.waitForFunction(function (v) { return window.__budget.state.res.summary.impactTotal !== v; }, S2.impactTotal, { timeout: 3000 });
    ok(/USD 1,000/.test(await pg.textContent('#b-fx-msg')), '환율 USD 1,000 적용 안내');
    await pg.click('#b-fx-reset');
    await pg.waitForFunction(function (v) { return window.__budget.state.res.summary.impactTotal === v; }, S2.impactTotal, { timeout: 3000 });
    ok((await bs()).impactTotal === S2.impactTotal, '기본값으로 되돌리면 Impact 도 돌아온다');
    // 거르기
    await pg.selectOption('#b-filter-result', '인상');
    var res17 = await pg.$$eval('#b-table tbody tr td:nth-child(17)', function (t) { return t.map(function (x) { return x.textContent; }); });
    ok(res17.length > 0 && res17.every(function (k) { return k === '인상'; }), '실적 거르기(인상)');
    await pg.selectOption('#b-filter-result', ''); await pg.selectOption('#b-filter-note', 'fx');
    ok(await rowsOf(pg, '#b-table tbody tr') === S2.fxCheck && S2.fxCheck === 2, '비고 거르기(환율 확인 필요 2행)');
    await pg.selectOption('#b-filter-note', '');
    // 시트 종류를 바꾸면 다시 계산 — 담당자 표를 끄면 전부 미매칭
    await pg.selectOption('#b-files .b-sheet[data-s="1"] select.b-kind', '');
    await pg.waitForFunction(function () { return /협력업체 담당자 표가 없습니다/.test(document.getElementById('b-status').textContent); }, null, { timeout: 3000 });
    ok((await bs()).ownerUnmatched === S2.znb, '담당자 표를 끄면 ZNB 전부 담당자 미매칭');
    await pg.selectOption('#b-files .b-sheet[data-s="1"] select.b-kind', 'vendors');
    await pg.waitForFunction(function (v) { return window.__budget.state.res.summary.ownerUnmatched === v; }, S2.ownerUnmatched, { timeout: 3000 });
    // 엑셀 내보내기
    var dl2 = pg.waitForEvent('download', { timeout: 5000 });
    await pg.click('#b-export');
    var f2 = await dl2;
    ok(/^구매절감실적_.*\.xlsx$/.test(f2.suggestedFilename()), '예산단가 방식 엑셀 내려받기', f2.suggestedFilename());
    // 실제 samples/ 파일 세 개를 올리면 예제와 같은 결과
    await pg.click('#b-reset');
    await pg.setInputFiles('#b-file', ['발주실적_예제(가짜데이터).xlsx', '협력업체담당자_예제(가짜데이터).xlsx', '예산단가_예제(가짜데이터).xlsx'].map(function (n) { return path.join(ROOT, 'samples', n); }));
    await pg.waitForSelector('#b-table tbody tr', { timeout: 8000 });
    var S3 = await bs();
    ok(S3.total === S2.total && S3.final === S2.final && S3.impactTotal === S2.impactTotal, 'samples/ 세 파일을 올려도 예제와 같은 결과', JSON.stringify([S3.total, S3.final, S3.impactTotal]));
    ok(await rowsOf(pg, '#b-files .b-file') === 3 && /쓰지 않음/.test(await pg.textContent('#b-files')), '파일 3개 · 안내 시트는 쓰지 않음');
    // 좁은 화면
    await pg.setViewportSize({ width: 360, height: 800 });
    var over2 = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(over2 <= 0, 'budget.html 360px 에서 가로 넘침 없음', over2);
    await pg.setViewportSize({ width: 1280, height: 900 });
    // 첫 화면의 바로 가기 → 예제가 바로 돈다
    await pg.goto(base); await pg.click('#go-budget-sample');
    await pg.waitForSelector('#b-table tbody tr', { timeout: 5000 });
    ok(/budget\.html#example$/.test(pg.url()) && (await bs()).final === 43, '첫 화면 「예제로 바로 보기」로 예산단가 방식 예제');
    await pg.goto(base + 'guide.html');
    ok(/예산단가 방식\(v1\.1\)/.test(await pg.textContent('main')), '사용법에 v1.1 절');
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  await br.close(); srv.close();
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
