/* 구매가 절감 실적 집계 — 화면
 * 판정·계산은 하지 않는다. 전부 engine.js(Saving) 를 부르고 그린다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(x) { return x == null ? '' : (Math.round(x * 100) / 100).toLocaleString('ko-KR'); }
  var W = Saving.won;

  var state = { files: {}, data: null, manual: [], res: null };
  var KIND_LABEL = { orders: '발주실적', base: '확정단가', approvals: '품의서' };

  /* ---------- 읽기 ---------- */
  function readFiles(list) {
    var files = Array.prototype.slice.call(list), left = files.length;
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function (e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          var got = { orders: [], base: [], approvals: [], sheets: [] };
          wb.SheetNames.forEach(function (sn) {
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '', raw: true });
            var kind = Saving.detectKind(rows);
            got.sheets.push({ sheet: sn, kind: kind, rows: rows.length });
            if (!kind) return;
            rows.forEach(function (r, i) { r.__sheet = f.name + ' · ' + sn; r.__row = i + 2; got[kind].push(r); });
          });
          state.files[f.name] = got;                 // 같은 이름 파일을 다시 올리면 바꿔 끼운다(두 번 세지 않는다)
        } catch (err) { state.files[f.name] = { error: err.message, sheets: [] }; }
        if (--left === 0) rebuild();
      };
      rd.readAsArrayBuffer(f);
    });
  }
  function rebuild() {
    var raw = { orders: [], base: [], approvals: [] };
    Object.keys(state.files).forEach(function (n) {
      var g = state.files[n]; if (g.error) return;
      raw.orders = raw.orders.concat(g.orders); raw.base = raw.base.concat(g.base); raw.approvals = raw.approvals.concat(g.approvals);
    });
    load(raw);
  }
  function load(raw) {
    state.data = Saving.normalize(raw);
    var d = state.data, h = '<ul class="filelist">';
    Object.keys(state.files).forEach(function (n) {
      var g = state.files[n];
      if (g.error) { h += '<li><span>' + esc(n) + '</span><span class="bad-t">읽지 못했습니다: ' + esc(g.error) + '</span></li>'; return; }
      g.sheets.forEach(function (s) {
        h += '<li><span>' + esc(n) + ' · ' + esc(s.sheet) + '</span><span>' + (s.kind ? KIND_LABEL[s.kind] + ' ' + s.rows + '줄' : '<span class="bad-t">어느 표인지 알 수 없어 건너뜀</span>') + '</span></li>';
      });
    });
    h += '</ul><div class="stats">' + stat('발주 줄', d.orders.length) + stat('확정 단가 품번', d.base.length) + stat('품의서 정보', d.approvals.length) + '</div>';
    if (!d.orders.length) h += '<div class="warn">발주 실적 표가 없습니다. 품번·발주수량·발주단가·발주월 머리글이 있는 시트를 올려 주세요.</div>';
    if (!d.base.length && d.orders.length) h += '<div class="warn">확정 단가표가 없어 모든 품번이 신규 품번으로 처리됩니다.</div>';
    if (d.issues.length) h += '<div class="warn"><b>입력 경고 ' + d.issues.length + '건</b> — 이 줄들은 계산에서 빠졌거나 대체 값을 썼습니다.<ul>' + d.issues.slice(0, 50).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + (d.issues.length > 50 ? '<li>…외 ' + (d.issues.length - 50) + '건(엑셀 보고서에 전부 있습니다)</li>' : '') + '</ul></div>';
    else if (d.orders.length) h += '<div class="ok">입력 경고 없이 읽었습니다.</div>';
    $('data-status').innerHTML = h;
    var show = d.orders.length > 0;
    ['s-sum', 's-check', 's-detail'].forEach(function (id) { $(id).hidden = !show; });
    if (show) renderAll();
  }
  function stat(k, v, cls) { return '<div class="stat ' + (cls || '') + '"><b>' + v + '</b>' + k + '</div>'; }

  /* ---------- 그리기 ---------- */
  function renderAll() {
    state.res = Saving.compute(state.data, state.manual);
    var res = state.res, cur = $('month').value || 'all';
    $('month').innerHTML = '<option value="all">전체 기간</option>' + res.months.map(function (m) { return '<option>' + m + '</option>'; }).join('');
    $('month').value = res.months.indexOf(cur) >= 0 ? cur : 'all';
    renderSum(); renderChecks(); renderManual(); renderDetail();
  }
  function month() { return $('month').value || 'all'; }

  function renderSum() {
    var res = state.res, m = month(), t = Saving.totals(res, m);
    $('totals').innerHTML = '<div class="stats">' +
      stat('순절감 <span class="calc-t">계산</span>', W(t.net), t.net < 0 ? 'bad' : 'good') +
      stat('절감 (' + t.savingLines + '줄)', W(t.saving)) + stat('인상 (' + t.increaseLines + '줄)', W(t.increase)) +
      stat('절감률(순절감 ÷ 기준금액)', t.rate + '%') + stat('집계 품번', t.parts + '개 · ' + t.lines + '줄') +
      stat('확인 필요', t.checks + '건 · 미집계 ' + t.unmatchedLines + '줄', t.checks ? 'bad' : '') + '</div>';
    $('narr').innerHTML = '<b>요약(규칙 기반)</b><br>' + Saving.narrative(res, m).map(esc).join('<br>');
    $('chart-month').innerHTML = vbars(Saving.aggregate(res, 'month', m));
    var lv = Saving.aggregate(res, 'lever', m).filter(function (g) { return g.key !== Saving.NO_CHANGE; });
    $('chart-lever').innerHTML = hbars(lv, 'Lever별 절감·인상');
    $('tbl-lever').innerHTML = groupTable(lv, 'Lever');
    var vd = Saving.aggregate(res, 'vendor', m);
    $('chart-vendor').innerHTML = hbars(vd.slice(0, 10), '업체별 절감·인상');
    $('tbl-vendor').innerHTML = groupTable(vd, '업체');
  }
  function groupTable(gs, head) {
    return '<div class="tablewrap small"><table><thead><tr><th>' + head + '</th><th>절감</th><th>인상</th><th>순절감</th><th>절감률</th><th>줄</th></tr></thead><tbody>' +
      gs.map(function (g) {
        return '<tr><td>' + esc(g.label) + '</td><td class="num">' + n0(g.saving) + '</td><td class="num">' + n0(g.increase) + '</td><td class="num ' + (g.net < 0 ? 'neg' : '') + '"><b>' + n0(g.net) + '</b></td><td class="num">' + g.rate + '%</td><td class="num">' + g.lines + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function short(x) { var a = Math.abs(x); return (x < 0 ? '-' : '') + (a >= 1e8 ? (a / 1e8).toFixed(1) + '억' : a >= 1e4 ? Math.round(a / 1e4).toLocaleString('ko-KR') + '만' : Math.round(a)); }

  // 월별: 절감은 위로, 인상은 아래로. 순절감은 막대 위 숫자.
  function vbars(gs) {
    if (!gs.length) return '<p class="sub">집계할 줄이 없습니다.</p>';
    var Wd = 760, H = 280, L = 56, R = 16, T = 26, B = 34;
    var max = Math.max.apply(null, gs.map(function (g) { return g.saving; }).concat([1]));
    var min = Math.max.apply(null, gs.map(function (g) { return g.increase; }).concat([0]));
    var span = max + min, y0 = T + (H - T - B) * max / span, sc = (H - T - B) / span;
    var slot = (Wd - L - R) / gs.length, bw = Math.min(46, slot / 3);
    var g = '<svg viewBox="0 0 ' + Wd + ' ' + H + '" role="img" aria-label="월별 절감·인상 막대그래프">';
    [max, max / 2, 0, -min].forEach(function (v) {
      var y = y0 - v * sc; g += '<line class="grid" x1="' + L + '" x2="' + (Wd - R) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + short(v) + '</text>';
    });
    g += '<line class="zero" x1="' + L + '" x2="' + (Wd - R) + '" y1="' + y0 + '" y2="' + y0 + '"/>';
    gs.forEach(function (d, i) {
      var cx = L + slot * i + slot / 2;
      g += '<rect class="b-save" x="' + (cx - bw - 2) + '" y="' + (y0 - d.saving * sc) + '" width="' + bw + '" height="' + Math.max(0, d.saving * sc) + '"><title>' + d.key + ' 절감 ' + W(d.saving) + '</title></rect>';
      g += '<rect class="b-inc" x="' + (cx + 2) + '" y="' + y0 + '" width="' + bw + '" height="' + Math.max(0, d.increase * sc) + '"><title>' + d.key + ' 인상 ' + W(d.increase) + '</title></rect>';
      g += '<text class="vl" x="' + cx + '" y="' + (T - 8) + '" text-anchor="middle">순 ' + short(d.net) + '</text>';
      g += '<text class="ax" x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(d.key) + '</text>';
    });
    return g + '</svg>';
  }
  // Lever·업체: 가운데 축에서 절감은 오른쪽, 인상은 왼쪽
  function hbars(gs, title) {
    if (!gs.length) return '<p class="sub">집계할 줄이 없습니다.</p>';
    var Wd = 560, rowH = 28, T = 8, H = T + gs.length * rowH + 8, LBL = 120, mid = LBL + (Wd - LBL) * 0.4;
    var mx = Math.max.apply(null, gs.map(function (g) { return Math.max(g.saving, g.increase); }).concat([1]));
    var sR = (Wd - mid - 70) / mx, sL = (mid - LBL - 10) / mx;
    var g = '<svg viewBox="0 0 ' + Wd + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
    g += '<line class="zero" x1="' + mid + '" x2="' + mid + '" y1="' + T + '" y2="' + (H - 6) + '"/>';
    gs.forEach(function (d, i) {
      var y = T + i * rowH;
      g += '<text class="gl" x="' + (LBL - 8) + '" y="' + (y + 18) + '" text-anchor="end">' + esc(d.label.length > 12 ? d.label.slice(0, 12) + '…' : d.label) + '</text>';
      if (d.increase) g += '<rect class="b-inc" x="' + (mid - d.increase * sL) + '" y="' + (y + 5) + '" width="' + d.increase * sL + '" height="' + (rowH - 10) + '"><title>' + esc(d.label) + ' 인상 ' + W(d.increase) + '</title></rect>';
      if (d.saving) g += '<rect class="b-save" x="' + mid + '" y="' + (y + 5) + '" width="' + d.saving * sR + '" height="' + (rowH - 10) + '"><title>' + esc(d.label) + ' 절감 ' + W(d.saving) + '</title></rect>';
      g += '<text class="vl" x="' + (mid + d.saving * sR + 6) + '" y="' + (y + 18) + '">' + short(d.net) + '</text>';
    });
    return g + '</svg>';
  }

  function renderChecks() {
    var cs = state.res.checks;
    if (!cs.length) { $('checks').innerHTML = '<div class="ok">확인할 품번이 없습니다. 모든 발주 줄이 기준 단가와 사유를 찾았습니다.</div>'; return; }
    $('checks').innerHTML = '<div class="tablewrap"><table><thead><tr><th>품번</th><th>품명</th><th>업체</th><th>발주월</th><th>수량</th><th>발주금액</th><th>확인할 것</th><th>할 일</th></tr></thead><tbody>' +
      cs.map(function (c, i) {
        var act = '';
        if (c.reason === 'no-ref') {
          act = '<button class="btn sm" data-fill="' + i + '" data-reason="no-ref">품의 정보 입력</button>';
          (c.suggest || []).forEach(function (a, j) {
            act += ' <button class="btn sm" data-link="' + i + '" data-j="' + j + '">비슷한 품번 ' + esc(a.part) + ' 품의로 연결</button>';
          });
        } else if (c.reason === 'no-lever') act = '<button class="btn sm" data-fill="' + i + '" data-reason="no-lever">사유 Lever 입력</button>';
        else act = '<span class="sub">품의 ' + esc(c.docNo || '') + ' 변경후 ' + n0(c.apNew) + '원 · 발주 ' + n0(c.price) + '원</span>';
        return '<tr class="flag"><td class="mono">' + esc(c.part) + '</td><td>' + esc(c.name) + '</td><td>' + esc(c.vendors.join(', ')) + '</td><td>' + esc(c.months.join(', ')) +
          '</td><td class="num">' + n0(c.qty) + '</td><td class="num">' + n0(c.amount) + '</td><td class="rev">' + esc(c.reasonText) + '</td><td class="act">' + act + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function fillForm(c) {
    $('m-part').value = c.part; $('m-base').value = ''; $('m-new').value = ''; $('m-doc').value = ''; $('m-note').value = '';
    if (c.reason === 'no-lever') {                      // 기존 품번: 기준은 연초 단가 그대로, 사유만 붙인다
      var b = state.data.base.filter(function (x) { return x.key === c.key; })[0]; if (b) $('m-base').value = b.price;
    }
    $('m-msg').innerHTML = '';
    $('m-form').scrollIntoView({ block: 'center' }); $('m-base').focus();
  }
  function addManual(input) {
    var r = Saving.manualApproval(input);
    if (r.error) { $('m-msg').innerHTML = '<div class="warn">' + esc(r.error) + '</div>'; return false; }
    state.manual = state.manual.filter(function (a) { return a.key !== r.approval.key; }).concat([r.approval]);
    $('m-msg').innerHTML = '<div class="ok">' + esc(r.approval.part) + ' 품의 정보를 반영했습니다.</div>';
    renderAll(); return true;
  }
  function renderManual() {
    $('m-list').innerHTML = state.manual.map(function (a, i) {
      return '<li><b class="mono">' + esc(a.part) + '</b> 기준 ' + n0(a.basePrice) + '원' + (a.newPrice != null ? ' → 변경후 ' + n0(a.newPrice) + '원' : '') +
        ' · ' + esc(a.lever || '사유 없음') + (a.docNo ? ' · ' + esc(a.docNo) : '') + (a.note ? ' — <span class="note-t">' + esc(a.note) + '</span>' : '') +
        ' <span class="src s-manual">화면 입력</span> <button class="x" data-i="' + i + '">지우기</button></li>';
    }).join('');
  }

  var SRC = { base: ['s-base', '연초 단가표'], approval: ['s-approval', '품의서 표'], manual: ['s-manual', '화면 입력'] };
  function renderDetail() {
    var k = $('kind').value, q = $('q').value.trim().toLowerCase(), m = month();
    var rows = state.res.rows.filter(function (r) {
      return (m === 'all' || r.month === m) && (!k || r.kind === k) &&
        (!q || (r.part + ' ' + r.name + ' ' + r.vendor).toLowerCase().indexOf(q) >= 0);
    });
    $('detail-count').textContent = rows.length + '줄';
    $('detail').innerHTML = '<table><thead><tr><th>발주월</th><th>품번</th><th>품명</th><th>업체</th><th>수량</th><th>발주단가</th><th>기준단가</th><th>단가차</th><th>절감액</th><th>구분</th><th>Lever</th><th>품의번호</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var s = SRC[r.refSrc];
        return '<tr class="' + (r.saving == null ? 'flag' : r.saving < 0 ? 'inc' : '') + '"><td>' + r.month + '</td><td class="mono">' + esc(r.part) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.vendor) +
          '</td><td class="num">' + n0(r.qty) + '</td><td class="num">' + n0(r.price) + '</td><td class="num">' + (r.ref == null ? '—' : n0(r.ref) + ' <span class="src ' + s[0] + '">' + s[1] + '</span>') +
          '</td><td class="num">' + (r.ref == null ? '' : n0(r.unitDiff)) + '</td><td class="num"><b>' + (r.saving == null ? '' : n0(r.saving)) + '</b>' + (r.saving == null ? '' : '<span class="calc">계산</span>') +
          '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.lever) + '</td><td class="mono">' + esc(r.docNo) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- 엑셀 ---------- */
  function groupRows(gs, head) {
    return gs.map(function (g) { var o = {}; o[head] = g.label; o['절감(원)'] = g.saving; o['인상(원)'] = g.increase; o['순절감(원)'] = g.net; o['기준금액(원)'] = g.refAmount; o['절감률(%)'] = g.rate; o['발주 줄'] = g.lines; return o; });
  }
  function exportXlsx() {
    var res = state.res, t = Saving.totals(res, 'all'), wb = XLSX.utils.book_new(), U = XLSX.utils;
    var sum = [['구매가 절감 실적 집계 보고서'], ['만든 날', new Date().toISOString().slice(0, 10)], ['기간', res.months.join(', ')], [],
      ['순절감(원)', t.net], ['절감(원)', t.saving], ['인상(원)', t.increase], ['기준금액(원)', t.refAmount], ['절감률(%)', t.rate],
      ['집계 품번', t.parts], ['집계 발주 줄', t.lines], ['미집계(확인 필요) 줄', t.unmatchedLines], ['미집계 발주금액(원)', t.unmatchedAmount], [],
      ['요약']].concat(Saving.narrative(res, 'all').map(function (s) { return [s]; })).concat([[],
      ['계산 규칙', '기존 품번 = (연초 확정 단가 − 실 발주 단가) × 발주 수량 / 신규 품번 = (품의서 기준 단가 − 실 발주 단가) × 발주 수량'],
      ['주의', '절감액은 이 도구가 계산한 값입니다. 기준 단가 출처(연초 단가표·품의서 표·화면 입력)는 발주상세 시트에 있습니다.']]);
    U.book_append_sheet(wb, U.aoa_to_sheet(sum), '요약');
    U.book_append_sheet(wb, U.json_to_sheet(groupRows(Saving.aggregate(res, 'month'), '발주월')), '월별');
    U.book_append_sheet(wb, U.json_to_sheet(groupRows(Saving.aggregate(res, 'lever'), '사유 Lever')), 'Lever별');
    U.book_append_sheet(wb, U.json_to_sheet(groupRows(Saving.aggregate(res, 'vendor'), '공급업체')), '업체별');
    U.book_append_sheet(wb, U.json_to_sheet(groupRows(Saving.aggregate(res, 'part'), '품번')), '품번별');
    U.book_append_sheet(wb, U.json_to_sheet(res.rows.map(function (r) {
      return { 발주월: r.month, 품번: r.part, 품명: r.name, 공급업체: r.vendor, 발주수량: r.qty, 발주단가: r.price, '기준단가': r.ref == null ? '' : r.ref,
        '기준단가 출처': r.refSrc ? SRC[r.refSrc][1] : '없음', '절감액(계산)': r.saving == null ? '' : r.saving, 구분: r.kind, '사유 Lever': r.lever, 품의번호: r.docNo, '원본 위치': r.sheet + ' ' + r.row + '행' };
    })), '발주상세');
    U.book_append_sheet(wb, U.json_to_sheet(res.checks.length ? res.checks.map(function (c) {
      return { 품번: c.part, 품명: c.name, 공급업체: c.vendors.join(', '), 발주월: c.months.join(', '), 발주수량: c.qty, '발주금액(원)': c.amount, '확인할 것': c.reasonText,
        '비슷한 품번': (c.suggest || []).map(function (a) { return a.part; }).join(', ') };
    }) : [{ 결과: '확인할 품번 없음' }]), '확인필요');
    var aps = state.data.approvals.concat(state.manual).map(function (a) {
      return { 품번: a.part, 기준단가: a.basePrice, 변경후단가: a.newPrice == null ? '' : a.newPrice, '사유 Lever': a.lever, 품의번호: a.docNo, 비고: a.note, 출처: a.src === 'manual' ? '화면 입력' : '품의서 표' };
    });
    U.book_append_sheet(wb, U.json_to_sheet(aps.length ? aps : [{ 결과: '품의서 정보 없음' }]), '품의서정보');
    if (state.data.issues.length) U.book_append_sheet(wb, U.aoa_to_sheet([['입력 경고']].concat(state.data.issues.map(function (s) { return [s]; }))), '입력경고');
    XLSX.writeFile(wb, '구매가절감실적_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  function template(withSample) {
    var s = withSample ? Saving.sample() : {
      orders: [{ 품번: '', 품명: '', 공급업체: '', 발주수량: '', 발주단가: '', 발주월: '2026-08' }],
      base: [{ 품번: '', 품명: '', 확정단가: '' }],
      approvals: [{ 품번: '', 기준단가: '', 변경후단가: '', '사유 Lever': '', 품의번호: '', 비고: '' }]
    };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.orders), '발주실적');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.base), '확정단가');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.approvals), '품의서');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['시트', '열', '뜻'],
      ['발주실적', '품번 · 품명 · 공급업체 · 발주수량 · 발주단가 · 발주월', '월별 발주 실적. 발주월은 2026-08 형식이나 발주일(그 달로 셉니다)'],
      ['확정단가', '품번 · 확정단가', '연초(또는 전년) 확정 단가. 여기 있는 품번이 기존 품번입니다'],
      ['품의서', '품번 · 기준단가 · 변경후단가 · 사유 Lever · 품의번호 · 비고', '신규 품번의 기준 단가와 단가 변경 사유. 사유 Lever: ' + Saving.LEVERS.join(' / ')],
      [], ['예제 데이터는 실제 사내 데이터가 아닙니다.']]), '작성법');
    XLSX.writeFile(wb, withSample ? '구매가절감_예제.xlsx' : '구매가절감_양식.xlsx');
  }

  /* ---------- AI (선택) ---------- */
  var AI_KEY = 'build-2611-08.ai';
  function aiConf() { try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch (e) { return {}; } }
  function aiRun() {
    var c = { provider: $('ai-provider').value, key: $('ai-key').value.trim() };
    if (!c.key) { $('ai-out').innerHTML = '<div class="warn">API 키를 넣어 주세요. 키가 없어도 위의 규칙 기반 요약은 그대로 쓸 수 있습니다.</div>'; return; }
    var prompt = Saving.aiPrompt(state.res, month());
    if (!window.confirm('사내 집계 숫자(월별·Lever별 합계)를 외부 AI(' + (c.provider === 'openai' ? 'OpenAI' : 'Anthropic') + ')로 보냅니다.\n품번·업체 단가는 보내지 않습니다.\n회사 보안 규정상 보내도 되는 자료인지 확인하셨나요?')) return;
    $('ai-out').innerHTML = '<p class="sub">AI 에 묻는 중입니다…</p>';
    var req = c.provider === 'openai'
      ? fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.2 }) })
          .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message); return j.choices[0].message.content; })
      : fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }) })
          .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message); return j.content.map(function (b) { return b.text || ''; }).join(''); });
    req.then(function (txt) {
      $('ai-out').innerHTML = '<div class="ai-draft"><b>AI 초안 — 검토 필요</b><p>' + esc(txt).replace(/\n/g, '<br>') + '</p><p class="sub">숫자는 위 집계표와 대조해 확인해 주세요.</p></div>';
    }).catch(function (e) { $('ai-out').innerHTML = '<div class="warn">AI 호출에 실패했습니다: ' + esc(e.message) + '</div>'; });
  }

  /* ---------- 연결 ---------- */
  $('m-lever').innerHTML = '<option value="">(선택)</option>' + Saving.LEVERS.map(function (l) { return '<option>' + l + '</option>'; }).join('');
  $('file').addEventListener('change', function (e) { if (e.target.files.length) readFiles(e.target.files); e.target.value = ''; });
  var drop = $('drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
  $('btn-sample').addEventListener('click', function () {
    state.files = {}; state.manual = [];
    var s = Saving.sample();
    state.files['예제(가짜 데이터)'] = { orders: s.orders, base: s.base, approvals: s.approvals, sheets: [
      { sheet: '발주실적', kind: 'orders', rows: s.orders.length }, { sheet: '확정단가', kind: 'base', rows: s.base.length }, { sheet: '품의서', kind: 'approvals', rows: s.approvals.length }] };
    rebuild();
  });
  $('btn-reset').addEventListener('click', function () { state.files = {}; state.manual = []; $('data-status').innerHTML = ''; ['s-sum', 's-check', 's-detail'].forEach(function (id) { $(id).hidden = true; }); });
  $('btn-template').addEventListener('click', function () { template(false); });
  $('btn-sample-file').addEventListener('click', function () { template(true); });
  $('month').addEventListener('change', function () { renderSum(); renderDetail(); });
  $('kind').addEventListener('change', renderDetail); $('q').addEventListener('input', renderDetail);
  $('checks').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var c = state.res.checks[+(b.dataset.fill || b.dataset.link)];
    if (b.dataset.fill != null) fillForm(c);
    else if (b.dataset.link != null) {
      var a = c.suggest[+b.dataset.j];
      addManual({ part: c.part, basePrice: a.basePrice, newPrice: a.newPrice, lever: a.lever, docNo: a.docNo, note: a.part + ' 품의로 연결(품번 표기 차이)' });
    }
  });
  $('m-add').addEventListener('click', function () {
    if (addManual({ part: $('m-part').value, basePrice: $('m-base').value, newPrice: $('m-new').value, lever: $('m-lever').value, docNo: $('m-doc').value, note: $('m-note').value })) {
      ['m-part', 'm-base', 'm-new', 'm-doc', 'm-note'].forEach(function (id) { $(id).value = ''; }); $('m-lever').value = '';
    }
  });
  $('m-list').addEventListener('click', function (e) { if (e.target.classList.contains('x')) { state.manual.splice(+e.target.dataset.i, 1); renderAll(); } });
  $('btn-export').addEventListener('click', exportXlsx);
  var conf = aiConf(); if (conf.provider) $('ai-provider').value = conf.provider; if (conf.key) $('ai-key').value = conf.key;
  $('ai-save').addEventListener('click', function () {
    localStorage.setItem(AI_KEY, JSON.stringify({ provider: $('ai-provider').value, key: $('ai-key').value.trim() }));
    $('ai-out').innerHTML = '<div class="ok">키를 이 브라우저에 저장했습니다.</div>';
  });
  $('ai-run').addEventListener('click', aiRun);
  window.__app = { state: state, template: template };       // 연기 테스트용
})();
