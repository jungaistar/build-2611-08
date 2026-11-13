/* 구매 절감 실적 자동 집계(예산단가 방식, v1.1) — 화면
 * 판정·계산은 하지 않는다. 전부 budget.js(Budget) 를 부르고 그린다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(x) { return x == null || x === '' || (typeof x === 'number' && isNaN(x)) ? '' : (typeof x === 'number' ? (Math.round(x * 10000) / 10000).toLocaleString('ko-KR') : esc(x)); }
  function won(x) { return x == null ? '—' : Math.round(x).toLocaleString('ko-KR') + '원'; }

  var KEY_MANUAL = 'build-2611-08.budget.manual', KEY_FX = 'build-2611-08.budget.fx';
  var KINDS = ['orders', 'vendors', 'budget'];
  var state = { files: {}, fx: loadJson(KEY_FX, null) || Budget.DEFAULT_FX.map(function (f) { return { cur: f.cur, rate: f.rate }; }), manual: loadJson(KEY_MANUAL, {}) || {}, res: null };
  function loadJson(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 화면은 돈다 */ } }

  /* ---------- 읽기 ---------- */
  // 시트 → { sheet, headers, rows(머리글 이름 키), count, kind, map, missing }
  function sheetFromAoa(name, aoa) {
    var head = aoa[0] || [], headers = [], seen = {};
    head.forEach(function (h, i) {
      var s = String(h == null ? '' : h).trim() || '(열 ' + colName(i) + ')';
      if (seen[s]) s += ' (' + (++seen[s]) + ')'; else seen[s] = 1;
      headers.push(s);
    });
    var rows = [];
    aoa.slice(1).forEach(function (arr, i) {
      if (!arr || !arr.some(function (v) { return v !== '' && v != null; })) return;
      var o = { __row: i + 2 }; headers.forEach(function (h, j) { o[h] = arr[j] == null ? '' : arr[j]; });
      rows.push(o);
    });
    return setKind({ sheet: name, headers: headers, rows: rows, count: rows.length }, Budget.detectKind(headers));
  }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function setKind(sh, kind) {
    sh.kind = kind; var m = kind ? Budget.mapColumns(sh.headers, kind) : { map: {}, missing: [] };
    sh.map = m.map; sh.missing = m.missing; return sh;
  }
  function sheetFromRows(name, rows) {                  // 예제: 머리글 이름 키 객체 배열
    var headers = []; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (headers.indexOf(k) < 0) headers.push(k); }); });
    var aoa = [headers].concat(rows.map(function (r) { return headers.map(function (h) { return r[h] == null ? '' : r[h]; }); }));
    return sheetFromAoa(name, aoa);
  }
  function readFiles(list) {
    var files = Array.prototype.slice.call(list), left = files.length;
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function (e) {
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          state.files[f.name] = { sheets: wb.SheetNames.map(function (sn) {
            return sheetFromAoa(sn, XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true, blankrows: true }));
          }) };
        } catch (err) { state.files[f.name] = { error: err.message, sheets: [] }; }
        if (--left === 0) { renderFiles(); rerun(); }
      };
      rd.readAsArrayBuffer(f);
    });
  }

  /* ---------- 파일·시트·열 미리 보기 ---------- */
  function renderFiles() {
    var names = Object.keys(state.files);
    if (!names.length) { $('b-files').innerHTML = ''; return; }
    var h = '';
    names.forEach(function (fn) {
      var g = state.files[fn];
      h += '<div class="b-file"><div class="b-file-head"><b>' + esc(fn) + '</b>' + (g.error ? '<span class="bad-t">읽지 못했습니다: ' + esc(g.error) + '</span>' : '<span class="sub">시트 ' + g.sheets.length + '장</span>') + '</div>';
      g.sheets.forEach(function (sh, si) {
        h += '<div class="b-sheet" data-f="' + esc(fn) + '" data-s="' + si + '">';
        h += '<div class="b-sheet-head"><span>시트 <b>' + esc(sh.sheet) + '</b> · 열 ' + sh.headers.length + '개 · 데이터 ' + sh.count.toLocaleString('ko-KR') + '건</span>' +
          '<label>이 시트는 <select class="b-kind" data-f="' + esc(fn) + '" data-s="' + si + '"><option value="">쓰지 않음</option>' +
          KINDS.map(function (k) { return '<option value="' + k + '"' + (sh.kind === k ? ' selected' : '') + '>' + Budget.KIND_LABEL[k] + '</option>'; }).join('') + '</select></label></div>';
        h += '<div class="chips">' + sh.headers.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div>';
        if (sh.rows.length) {
          var cols = sh.headers.slice(0, 14);
          h += '<div class="tablewrap small"><table class="preview"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + (sh.headers.length > 14 ? '<th>…</th>' : '') + '</tr></thead><tbody>' +
            sh.rows.slice(0, 3).map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c]) + '</td>'; }).join('') + (sh.headers.length > 14 ? '<td>…</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>';
        }
        if (sh.kind) {
          h += '<div class="tablewrap small"><table class="map"><thead><tr><th>항목</th><th>이 시트의 열</th></tr></thead><tbody>' +
            Budget.FIELDS[sh.kind].map(function (f) {
              var cur = sh.map[f.key], miss = f.req && cur == null;
              return '<tr' + (miss ? ' class="flag"' : '') + '><td>' + esc(f.label) + (f.req ? ' <span class="req">필수</span>' : '') + '</td><td>' +
                '<select class="b-map" data-f="' + esc(fn) + '" data-s="' + si + '" data-k="' + f.key + '"><option value="">' + (miss ? '열을 골라 주세요' : '(없음)') + '</option>' +
                sh.headers.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
                (cur != null ? ' <span class="src s-file">자동</span>' : '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
          if (sh.missing.length) h += '<div class="warn">필수 항목 ' + sh.missing.map(function (k) { return Budget.FIELDS[sh.kind].filter(function (f) { return f.key === k; })[0].label; }).join(' · ') + ' 의 열을 찾지 못했습니다. 위에서 골라 주세요. 고를 때까지 이 시트는 계산에 넣지 않습니다.</div>';
        } else h += '<p class="sub">어느 표인지 알아보지 못했습니다. 쓰려면 위에서 골라 주세요.</p>';
        h += '</div>';
      });
      h += '</div>';
    });
    $('b-files').innerHTML = h;
  }
  function collect() {
    var input = { orders: [], vendors: [], budget: [] }, has = {};
    Object.keys(state.files).forEach(function (fn) {
      (state.files[fn].sheets || []).forEach(function (sh) {
        if (!sh.kind || sh.missing.length) return;
        has[sh.kind] = 1;
        input[sh.kind] = input[sh.kind].concat(Budget.readRows(sh.rows, sh.map, fn + ' · ' + sh.sheet));
      });
    });
    return { input: input, has: has };
  }
  function rerun() {
    var c = collect(), h = '';
    if (!Object.keys(state.files).length) { $('b-status').innerHTML = ''; $('s-bresult').hidden = true; return; }
    KINDS.forEach(function (k) { if (!c.has[k]) h += '<div class="warn">' + Budget.KIND_LABEL[k] + ' 표가 없습니다. ' + (k === 'orders' ? '머리글에 구매오더·발주유형·협력사 코드·자재품번·통화·발주수량·품목범주가 있는 시트를 올려 주세요.' : k === 'vendors' ? '없으면 모든 행이 담당자 미매칭이 됩니다.' : '없으면 모든 행이 예산단가 미매칭이 됩니다.') + '</div>'; });
    if (!c.has.orders) { $('b-status').innerHTML = h; $('s-bresult').hidden = true; return; }
    state.res = Budget.run(c.input, { fx: state.fx, manual: state.manual });
    $('b-status').innerHTML = h + '<div class="ok">발주 실적 ' + c.input.orders.length.toLocaleString('ko-KR') + '행 · 협력업체 담당자 ' + c.input.vendors.length + '행 · 예산 단가 ' + c.input.budget.length + '행을 읽어 계산했습니다.</div>';
    $('s-bresult').hidden = false;
    renderResult();
  }

  /* ---------- 환율 ---------- */
  function renderFx() {
    $('b-fx-table').innerHTML = '<div class="tablewrap small"><table class="fx"><thead><tr><th>통화</th><th>환율(원)</th><th></th></tr></thead><tbody>' +
      state.fx.map(function (f, i) {
        return '<tr><td><input class="fx-cur" data-i="' + i + '" value="' + esc(f.cur) + '" maxlength="5" placeholder="예: USD"></td>' +
          '<td><input class="fx-rate" data-i="' + i + '" inputmode="decimal" value="' + esc(f.rate) + '"></td><td><button class="x" data-del="' + i + '">지우기</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function applyFx() {
    var list = [];
    document.querySelectorAll('#b-fx-table tbody tr').forEach(function (tr) { list.push({ cur: tr.querySelector('.fx-cur').value, rate: tr.querySelector('.fx-rate').value }); });
    state.fx = list; save(KEY_FX, list);
    var n = Budget.normFx(list);
    $('b-fx-msg').innerHTML = n.issues.length ? '<div class="warn">' + n.issues.map(esc).join('<br>') + '</div>' : '<div class="ok">환율 ' + n.list.map(function (f) { return f.cur + ' ' + f.rate.toLocaleString('ko-KR'); }).join(' · ') + ' 로 계산합니다.</div>';
    if (state.res) rerun();
  }

  /* ---------- (v1.2) 매칭 진단 ---------- */
  function partHeaders(kind) {
    var out = [];
    Object.keys(state.files).forEach(function (fn) { (state.files[fn].sheets || []).forEach(function (sh) { if (sh.kind === kind) out.push(fn + ' · ' + sh.sheet + ' → ' + (sh.map.part || '(자재품번 열 없음)')); }); });
    return out;
  }
  function diagHtml(d, s) {
    if (!d || !s.budgetUnmatched) return '';
    var sh = function (x) { return x.n ? x.n + '건 · 숫자만 ' + x.digit + ' · 0 으로 시작 ' + x.lead0 + ' · 점/하이픈 포함 ' + x.sym + (x.lens.length ? ' · ' + x.lens.join(', ') : '') : '없음'; };
    return '<div class="note" id="b-diag-box"><b>예산단가 매칭 진단</b> — 미매칭 ' + s.budgetUnmatched + '건의 이유를 찾습니다.' +
      '<table class="diag" style="margin-top:8px"><tbody>' +
      '<tr><th>발주 실적 품번</th><td class="mono">' + esc(d.ordersSample.join(' · ') || '(없음)') + '</td><td>' + esc(sh(d.ordersShape)) + '</td></tr>' +
      '<tr><th>예산 단가 품번</th><td class="mono">' + esc(d.budgetSample.join(' · ') || '(없음)') + '</td><td>' + esc(sh(d.budgetShape)) + '</td></tr>' +
      '<tr><th>자재품번으로 쓴 열</th><td colspan="2">발주: ' + esc(partHeaders('orders').join(' / ') || '-') + '<br>예산: ' + esc(partHeaders('budget').join(' / ') || '-') + '</td></tr>' +
      '<tr><th>서로 다른 품번 기준</th><td colspan="2">정확 일치 ' + d.exact + ' · 공백·기호 무시로 더 맞음 ' + d.loose + ' · 앞의 0 무시로 더 맞음 ' + d.digit + ' · 어떤 방법으로도 안 맞음 ' + d.none + '</td></tr>' +
      '</tbody></table>' +
      (d.hints.length ? '<ul style="margin:8px 0 0 18px">' + d.hints.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="sub" style="margin:8px 0 0">느슨한 비교로 맞춘 행은 상세표 비고에 「…로 맞춤(확인)」으로 표시됩니다. 같은 느슨한 키에 품번이 여럿이면 맞추지 않습니다.</p></div>';
  }

  /* ---------- 결과 ---------- */
  function stat(k, v, cls) { return '<div class="stat ' + (cls || '') + '"><b>' + v + '</b>' + k + '</div>'; }
  function renderResult() {
    var r = state.res, s = r.summary;
    $('b-stats').innerHTML = '<div class="stats">' +
      stat('전체 발주', s.total + '건') + stat('ZNB', s.znb + '건') + stat('ZNB 외 제외', s.nonZnb + '건') +
      stat('담당자 매칭 / 미매칭(제외)', s.ownerMatched + ' / ' + s.ownerUnmatched, s.ownerUnmatched ? 'bad' : '') + stat('최종 산출 대상', s.final + '건') +
      stat('예산단가 매칭 / 미매칭', s.budgetMatched + ' / ' + s.budgetUnmatched + (s.budgetLoose || s.budgetDigit ? ' (느슨한 매칭 ' + (s.budgetLoose + s.budgetDigit) + ')' : '') + (s.manualFilled ? ' (화면 입력 ' + s.manualFilled + ')' : ''), s.manualNeeded ? 'bad' : '') +
      stat('수작업 입력 필요', s.manualNeeded + '건', s.manualNeeded ? 'bad' : '') + '</div><div class="stats">' +
      stat('인하 ' + s.down + '건 · Impact <span class="calc-t">계산</span>', won(s.downImpact), 'good') + stat('인상 ' + s.up + '건 · Impact', won(s.upImpact), 'bad') + stat('동결', s.flat + '건') +
      stat('전체 Impact(원화)', won(s.impactTotal), s.impactTotal < 0 ? 'bad' : 'good') + stat('Impact 미산출', s.noImpact + '건') +
      stat('구매단가 확인 / 환율 확인 / 기타', s.priceCheck + ' / ' + s.fxCheck + ' / ' + s.otherErr, (s.priceCheck + s.fxCheck + s.otherErr) ? 'bad' : '') + '</div>';
    $('b-diag').innerHTML = diagHtml(r.diagnosis, s);
    $('b-verify').innerHTML = r.verify.map(function (v) { return '<li class="' + (v.ok ? 'v-ok' : 'v-bad') + '">' + (v.ok ? '일치' : '불일치') + ' — ' + esc(v.name) + ' <span class="sub">(' + esc(v.detail) + ')</span></li>'; }).join('');
    $('b-issues').innerHTML = r.issues.length ? '<div class="warn"><b>입력 경고 ' + r.issues.length + '건</b><ul>' + r.issues.slice(0, 50).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '';
    $('b-owner').innerHTML = groupTable(r.byOwner, '담당자');
    $('b-vendor').innerHTML = groupTable(r.byVendor, '협력사');
    var sel = $('b-filter-note'), cur = sel.value;
    sel.innerHTML = '<option value="">전체</option><option value="clean">정상(비고 없음)</option>' + Object.keys(Budget.NOTES).filter(function (k) { return k !== 'owner'; }).map(function (k) { return '<option value="' + k + '">' + Budget.NOTES[k] + '</option>'; }).join('');
    sel.value = cur || '';
    renderTable(); renderManual(); renderExcluded(); renderErrors();
  }
  function groupTable(gs, head) {
    if (!gs.length) return '<p class="sub">집계할 행이 없습니다.</p>';
    return '<div class="tablewrap small"><table><thead><tr><th>' + head + '</th><th>건수</th><th>인하</th><th>인상</th><th>동결</th><th>보류</th><th>Impact 합(원)</th></tr></thead><tbody>' +
      gs.map(function (g) { return '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.lines + '</td><td class="num">' + g.down + '</td><td class="num">' + g.up + '</td><td class="num">' + g.flat + '</td><td class="num">' + g.pending + '</td><td class="num ' + (g.impact < 0 ? 'neg' : '') + '"><b>' + n0(g.impact) + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function renderTable() {
    var fr = $('b-filter-result').value, fn = $('b-filter-note').value, q = $('b-q').value.trim().toLowerCase();
    var rows = state.res.rows.filter(function (r) {
      if (fr === 'pending' ? r.result !== '' : fr && r.result !== fr) return false;
      if (fn === 'clean' ? r.notes.length : fn && r.notes.indexOf(fn) < 0) return false;
      return !q || (r.po + ' ' + r.vcode + ' ' + r.vname + ' ' + r.part + ' ' + r.pname + ' ' + r.owner).toLowerCase().indexOf(q) >= 0;
    });
    $('b-count').textContent = rows.length + '행 / ' + state.res.rows.length + '행';
    $('b-table').innerHTML = '<table><thead><tr>' + Budget.COLS.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '<th>원본 위치</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var pr = r.price == null ? '<span class="bad-t">—</span>' : n0(r.price) + ' <span class="src s-file">' + (r.priceSrc === 'price' ? '구매단가' : '조립비') + '</span>' + (r.priceDiffers ? ' <span class="sub">원본 ' + n0(r.origPrice) + '</span>' : '');
        var bp = r.bprice != null ? n0(r.bprice) + ' <span class="src ' + (r.bpriceSrc === 'manual' ? 's-manual">화면 입력' : 's-file">예산 파일') + '</span>'
          : '<span class="b-in"><input class="b-manual" data-key="' + esc(r.partKey) + '" data-part="' + esc(r.part) + '" inputmode="decimal" placeholder="예산단가 입력"><button class="btn sm b-manual-add" data-key="' + esc(r.partKey) + '">반영</button></span>';
        return '<tr class="' + (r.notes.length ? 'flag' : r.result === '인상' ? 'inc' : '') + '"><td class="mono">' + esc(r.po) + '</td><td>' + esc(r.type) + '</td><td class="mono">' + esc(r.vcode) + '</td><td>' + esc(r.vname) +
          '</td><td class="mono">' + esc(r.part) + '</td><td>' + esc(r.pname) + '</td><td>' + esc(r.cur) + '</td><td class="num">' + pr + '</td><td class="num">' + n0(isNaN(r.qty) ? r.qtyRaw : r.qty) + '</td><td>' + esc(r.cat) +
          '</td><td class="num">' + n0(isNaN(r.asm) ? r.asmRaw : r.asm) + '</td><td class="num">' + n0(isNaN(r.mat) ? r.matRaw : r.mat) + '</td><td>' + esc(r.owner) + '</td><td class="num">' + bp +
          '</td><td class="num ' + (r.diff < 0 ? 'neg' : '') + '">' + n0(r.diff) + '</td><td class="num ' + (r.impact < 0 ? 'neg' : '') + '"><b>' + n0(r.impact) + '</b>' + (r.impact == null ? '' : '<span class="calc">계산</span>') +
          '</td><td>' + esc(r.result) + '</td><td>' + esc(r.lever) + '</td><td class="rev">' + esc(r.note) + '</td><td class="sub">' + esc(r.sheet + ' ' + r.row + '행') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function addManual(key, part, val) {
    var p = Budget.num(val);
    if (!(p >= 0)) { window.alert('예산단가는 0 이상의 숫자로 넣어 주세요.'); return; }
    state.manual[key] = { part: part, price: p, at: new Date().toISOString().slice(0, 10) };
    save(KEY_MANUAL, state.manual); rerun();
  }
  function renderManual() {
    var keys = Object.keys(state.manual);
    $('b-manual-list').innerHTML = keys.length ? keys.map(function (k) {
      var m = state.manual[k];
      return '<li><b class="mono">' + esc(m.part || k) + '</b> 예산단가 ' + n0(m.price) + ' <span class="src s-manual">화면 입력</span> <span class="sub">' + esc(m.at || '') + '</span> <button class="x" data-mdel="' + esc(k) + '">지우기</button></li>';
    }).join('') : '<li class="sub">아직 없습니다.</li>';
  }
  function renderExcluded() {
    var ex = state.res.excluded;
    $('b-excluded').innerHTML = !ex.length ? '<p class="sub" style="padding:10px">제외된 행이 없습니다.</p>' :
      '<table><thead><tr><th>구매오더</th><th>발주유형</th><th>협력사</th><th>협력사 이름</th><th>자재품번</th><th>자재품명</th><th>통화</th><th>발주수량</th><th>제외 사유</th><th>원본 위치</th></tr></thead><tbody>' +
      ex.map(function (r) { return '<tr><td class="mono">' + esc(r.po) + '</td><td>' + esc(r.type) + '</td><td class="mono">' + esc(r.vcode) + '</td><td>' + esc(r.vname) + '</td><td class="mono">' + esc(r.part) + '</td><td>' + esc(r.pname) + '</td><td>' + esc(r.cur) + '</td><td class="num">' + n0(isNaN(r.qty) ? r.qtyRaw : r.qty) + '</td><td>' + esc(r.reason) + '</td><td class="sub">' + esc(r.sheet + ' ' + r.row + '행') + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function renderErrors() {
    var er = state.res.errors;
    $('b-errors').innerHTML = !er.length ? '<p class="sub" style="padding:10px">오류가 없습니다.</p>' :
      '<table><thead><tr><th>구분</th><th>구매오더</th><th>협력사</th><th>자재품번</th><th>통화</th><th>품목범주</th><th>상세</th><th>실적 시트</th><th>원본 위치</th></tr></thead><tbody>' +
      er.map(function (e) { return '<tr class="flag"><td>' + esc(e.kind) + '</td><td class="mono">' + esc(e.po) + '</td><td class="mono">' + esc(e.vcode) + '</td><td class="mono">' + esc(e.part) + '</td><td>' + esc(e.cur) + '</td><td>' + esc(e.cat) + '</td><td class="rev">' + esc(e.detail) + '</td><td>' + (e.inSheet ? '포함' : '제외') + '</td><td class="sub">' + esc(e.where) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  /* ---------- 엑셀·예제 ---------- */
  function exportXlsx() {
    var wb = Budget.buildWorkbook(state.res, XLSX, { date: new Date().toISOString().slice(0, 10) });
    XLSX.writeFile(wb, '구매절감실적_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  function downloadSample(kind) {
    var s = Budget.sample(), wb = XLSX.utils.book_new(), f = Budget.SAMPLE_FILES[kind];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s[kind]), f[1]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['예제 데이터는 실제 사내 데이터가 아닙니다.'], ['구매오더·협력사·품번·단가 전부 지어낸 값입니다.']]), '안내');
    XLSX.writeFile(wb, f[0]);
  }
  function runSample() {
    var s = Budget.sample();
    state.files = {};
    state.files['예제(가짜 데이터)'] = { sheets: [sheetFromRows('발주실적', s.orders), sheetFromRows('담당자', s.vendors), sheetFromRows('예산단가', s.budget)] };
    renderFiles(); rerun();
    $('s-bresult').scrollIntoView({ block: 'start' });
  }

  /* ---------- 연결 ---------- */
  $('b-file').addEventListener('change', function (e) { if (e.target.files.length) readFiles(e.target.files); e.target.value = ''; });
  var drop = $('b-drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
  $('b-sample').addEventListener('click', runSample);
  $('b-reset').addEventListener('click', function () { state.files = {}; state.res = null; renderFiles(); rerun(); });
  $('b-dl-orders').addEventListener('click', function () { downloadSample('orders'); });
  $('b-dl-vendors').addEventListener('click', function () { downloadSample('vendors'); });
  $('b-dl-budget').addEventListener('click', function () { downloadSample('budget'); });
  $('b-files').addEventListener('change', function (e) {
    var t = e.target, sh = state.files[t.dataset.f] && state.files[t.dataset.f].sheets[+t.dataset.s];
    if (!sh) return;
    if (t.classList.contains('b-kind')) { setKind(sh, t.value || null); renderFiles(); rerun(); }
    else if (t.classList.contains('b-map')) {
      sh.map[t.dataset.k] = t.value || null;
      sh.missing = Budget.FIELDS[sh.kind].filter(function (f) { return f.req && sh.map[f.key] == null; }).map(function (f) { return f.key; });
      renderFiles(); rerun();
    }
  });
  $('b-fx-table').addEventListener('change', applyFx);
  $('b-fx-table').addEventListener('click', function (e) { if (e.target.dataset.del != null) { state.fx.splice(+e.target.dataset.del, 1); renderFx(); applyFx(); } });
  $('b-fx-add').addEventListener('click', function () { state.fx.push({ cur: '', rate: '' }); renderFx(); });
  $('b-fx-reset').addEventListener('click', function () { state.fx = Budget.DEFAULT_FX.map(function (f) { return { cur: f.cur, rate: f.rate }; }); renderFx(); applyFx(); });
  ['b-filter-result', 'b-filter-note'].forEach(function (id) { $(id).addEventListener('change', renderTable); });
  $('b-q').addEventListener('input', renderTable);
  $('b-table').addEventListener('click', function (e) {
    var b = e.target.closest('.b-manual-add'); if (!b) return;
    var inp = b.parentNode.querySelector('.b-manual'); addManual(b.dataset.key, inp.dataset.part, inp.value);
  });
  $('b-table').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('b-manual')) { e.preventDefault(); addManual(e.target.dataset.key, e.target.dataset.part, e.target.value); }
  });
  $('b-manual-list').addEventListener('click', function (e) { if (e.target.dataset.mdel != null) { delete state.manual[e.target.dataset.mdel]; save(KEY_MANUAL, state.manual); rerun(); } });
  $('b-export').addEventListener('click', exportXlsx);
  renderFx(); renderManual();
  window.__budget = { state: state };                  // 연기 테스트용
  // index.html 의 「예제로 바로 보기」(budget.html#example)로 오면 예제를 바로 돌린다
  if (location.hash === '#example') runSample();
})();
