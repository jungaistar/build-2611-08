/* 구매가 절감 실적 집계 — 계산 엔진
 *
 * 화면(app.js)은 판정하지 않는다. 품번 매칭·절감액·Lever 분류·확인 필요 목록·집계는 전부 여기서 하고
 * test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다.
 *
 * 데이터 세 가지
 *   orders    : 월별 발주 실적   [{ part, name, vendor, qty, price, month }]
 *   base      : 연초 확정 단가표 [{ part, price }]
 *   approvals : 품의서 정보 표   [{ part, basePrice, newPrice, lever, docNo, note, src }]
 *               src 는 'table'(올린 표) 또는 'manual'(화면 입력). 같은 품번이면 화면 입력이 이긴다.
 *
 * 절감액 규칙
 *   기존 품번(연초 확정 단가 있음) : (연초 확정 단가 − 실 발주 단가) × 발주 수량
 *   신규 품번(확정 단가 없음)      : (품의서 기준 단가 − 실 발주 단가) × 발주 수량
 *   둘 다 없으면 집계에 넣지 않고 「확인 필요」로 따로 보낸다 — 0 으로 세면 실적이 조용히 줄어든다.
 *   양수 = 절감, 음수 = 인상.
 */
(function (root) {
  'use strict';

  var LEVERS = ['원자재 연동', '가공비 현실화', 'VA/VE', 'BCC', '국산화', '기타'];
  var UNCLASSIFIED = '미분류';
  var NO_CHANGE = '변동 없음';

  /* ---------- 입력 정리 ---------- */
  // 열 이름이 조금 달라도 읽는다. 늘릴 때는 코드가 아니라 이 표를 늘린다.
  var ALIASES = {
    part: ['품번', '부품번호', '품목코드', '품목번호', '자재코드', '자재번호', 'part', 'partno', 'part no', 'item'],
    name: ['품명', '부품명', '품목명', '자재명', 'name', 'description'],
    vendor: ['공급업체', '업체', '업체명', '협력사', '거래처', 'vendor', 'supplier'],
    qty: ['발주수량', '수량', '발주량', 'qty', 'quantity'],
    price: ['발주단가', '실발주단가', '실 발주 단가', '단가', 'price', 'unitprice', 'unit price'],
    month: ['발주월', '월', '발주일', '발주일자', '발주년월', 'month', 'date'],
    basePrice: ['확정단가', '연초확정단가', '연초단가', '연초 확정 단가', '전년단가', 'baseprice'],
    apBase: ['기준단가', '품의기준단가', '품의서기준단가', '변경전단가', '적용전단가', 'before'],
    apNew: ['변경후단가', '변경 후 단가', '적용후단가', '변경단가', 'after'],
    lever: ['사유lever', '사유 lever', 'lever', '레버', '변동사유', '변동 사유', '사유구분', '사유'],
    docNo: ['품의번호', '품의서번호', '품의 번호', '문서번호', 'docno'],
    note: ['비고', '내용', '메모', '상세사유', 'note']
  };
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function has(row, key) {
    var names = ALIASES[key].map(norm);
    for (var k in row) if (names.indexOf(norm(k)) >= 0) return true;
    return false;
  }
  function pick(row, key) {
    var names = ALIASES[key].map(norm);
    for (var k in row) if (names.indexOf(norm(k)) >= 0) return row[k];
    return undefined;
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v == null ? '' : v).replace(/[,\s원₩]/g, '');
    if (s === '') return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function str(v) { return String(v == null ? '' : v).trim(); }

  // 품번 비교 키: 대소문자·앞뒤·안쪽 공백만 무시한다. 하이픈은 남긴다(다른 품번일 수 있다).
  // 엑셀이 숫자로 읽은 품번(10023)도 문자 '10023' 과 같게 본다.
  function partKey(v) { return str(v).replace(/\s+/g, '').toUpperCase(); }
  // 비슷한 품번 제안용: 영문·숫자만 남긴다.
  function compact(v) { return partKey(v).replace(/[^0-9A-Z가-힣]/g, ''); }

  // 발주월: 'YYYY-MM' 으로 맞춘다. '2026-08' · '2026.8' · '2026년 8월' · 202608 · '2026-08-17' · 엑셀 날짜 · Date
  function toMonth(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : mk(v.getFullYear(), v.getMonth() + 1);
    if (typeof v === 'number' && isFinite(v)) {
      if (v >= 190001 && v <= 209912 && Math.floor(v) === v) return mk(Math.floor(v / 100), v % 100);
      if (v >= 20000 && v <= 80000) {                     // 엑셀 일련번호
        var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
        return mk(d.getUTCFullYear(), d.getUTCMonth() + 1);
      }
      return null;
    }
    var s = String(v).trim(), m = s.match(/^(\d{4})(\d{2})$/) || s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})/);
    return m ? mk(+m[1], +m[2]) : null;
  }
  function mk(y, m) { return m >= 1 && m <= 12 ? y + '-' + (m < 10 ? '0' : '') + m : null; }

  // Lever 표기를 6가지로 맞춘다. 비어 있으면 ''. 알아볼 수 없으면 '기타' + unknown 표시.
  function normLever(v) {
    var s = norm(v).replace(/[\/·\-_.()]/g, '');
    if (!s) return { lever: '', unknown: false };
    if (/원자재|원재료|소재|연동|시황/.test(s)) return { lever: '원자재 연동', unknown: false };
    if (/가공비|임가공|가공/.test(s)) return { lever: '가공비 현실화', unknown: false };
    if (/vave|^va$|^ve$|가치공학|가치분석/.test(s)) return { lever: 'VA/VE', unknown: false };
    if (/bcc|베스트코스트|bestcost/.test(s)) return { lever: 'BCC', unknown: false };
    if (/국산/.test(s)) return { lever: '국산화', unknown: false };
    if (/기타|etc/.test(s)) return { lever: '기타', unknown: false };
    return { lever: '기타', unknown: true };
  }

  // 시트의 머리글을 보고 어느 표인지 고른다. 시트 이름이 사내마다 달라도 읽기 위해서다.
  function detectKind(rows) {
    if (!rows || !rows.length) return null;
    var head = {}; rows.slice(0, 5).forEach(function (r) { for (var k in r) head[k] = 1; });
    if (!has(head, 'part')) return null;
    if (has(head, 'apBase') || has(head, 'apNew') || has(head, 'docNo')) return 'approvals';
    if (has(head, 'qty') && (has(head, 'price') || has(head, 'month'))) return 'orders';
    if (has(head, 'basePrice') || has(head, 'price')) return 'base';
    return null;
  }

  // 틀린 줄은 버리지 않고 issues 에 남긴다.
  function normalize(raw) {
    var issues = [], orders = [], base = [], approvals = [];
    (raw.orders || []).forEach(function (r, i) {
      var row = r.__row || i + 2, sheet = r.__sheet || '발주실적';
      var o = { row: row, sheet: sheet, part: str(pick(r, 'part')), name: str(pick(r, 'name')), vendor: str(pick(r, 'vendor')),
        qty: num(pick(r, 'qty')), price: num(pick(r, 'price')), month: toMonth(pick(r, 'month')) };
      if (!o.part && !o.name && isNaN(o.qty)) return;                     // 빈 줄
      var where = sheet + ' ' + row + '행' + (o.part ? '(' + o.part + ')' : '');
      if (!o.part) { issues.push(where + ': 품번이 비어 있습니다'); return; }
      if (!(o.qty > 0)) { issues.push(where + ': 발주수량이 숫자가 아니거나 0 이하입니다'); return; }
      if (!(o.price >= 0)) { issues.push(where + ': 발주단가를 읽지 못했습니다'); return; }
      if (!o.month) { issues.push(where + ': 발주월을 읽지 못했습니다(예: 2026-08)'); return; }
      o.key = partKey(o.part); if (!o.vendor) o.vendor = '(업체 미기재)';
      orders.push(o);
    });
    var seenBase = {};
    (raw.base || []).forEach(function (r, i) {
      var row = r.__row || i + 2, sheet = r.__sheet || '확정단가';
      var p = str(pick(r, 'part')), v = pick(r, 'basePrice'); if (v === undefined) v = pick(r, 'price');
      var price = num(v);
      if (!p && isNaN(price)) return;
      if (!p) { issues.push(sheet + ' ' + row + '행: 품번이 비어 있습니다'); return; }
      if (!(price >= 0)) { issues.push(sheet + ' ' + row + '행(' + p + '): 확정단가를 읽지 못했습니다'); return; }
      var k = partKey(p);
      if (seenBase[k] != null) {
        if (seenBase[k] !== price) issues.push(sheet + ' ' + row + '행(' + p + '): 같은 품번이 다른 단가로 두 번 있습니다 — 먼저 나온 ' + seenBase[k] + '원을 씁니다');
        return;
      }
      seenBase[k] = price; base.push({ part: p, key: k, price: price });
    });
    (raw.approvals || []).forEach(function (r, i) {
      var a = approvalFrom(r, 'table', r.__sheet || '품의서', r.__row || i + 2, issues);
      if (a) approvals.push(a);
    });
    return { orders: orders, base: base, approvals: approvals, issues: issues };
  }

  function approvalFrom(r, src, sheet, row, issues) {
    var p = str(r.part != null ? r.part : pick(r, 'part'));
    var bp = num(r.basePrice != null ? r.basePrice : pick(r, 'apBase'));
    var np = num(r.newPrice != null ? r.newPrice : pick(r, 'apNew'));
    var lv = normLever(r.lever != null ? r.lever : pick(r, 'lever'));
    var doc = str(r.docNo != null ? r.docNo : pick(r, 'docNo'));
    var note = str(r.note != null ? r.note : pick(r, 'note'));
    if (!p && isNaN(bp) && !doc) return null;
    var where = sheet + ' ' + row + '행' + (p ? '(' + p + ')' : '');
    if (!p) { issues.push(where + ': 품번이 비어 있습니다'); return null; }
    if (!(bp >= 0)) { issues.push(where + ': 기준단가를 읽지 못했습니다'); return null; }
    if (lv.unknown) issues.push(where + ': 사유 Lever 「' + str(r.lever != null ? r.lever : pick(r, 'lever')) + '」를 알아보지 못해 기타로 분류합니다');
    return { part: p, key: partKey(p), basePrice: bp, newPrice: isNaN(np) ? null : np, lever: lv.lever, docNo: doc, note: note, src: src };
  }

  // 화면에서 입력한 품의 정보를 검증해 돌려준다. 틀리면 { error }.
  function manualApproval(input) {
    var issues = [], a = approvalFrom(input || {}, 'manual', '화면 입력', 1, issues);
    if (!a) return { error: '품번과 기준단가를 입력해 주세요' };
    if (issues.length && !/기타로 분류/.test(issues[0])) return { error: issues[0].replace(/^화면 입력 1행/, '') };
    return { approval: a };
  }

  /* ---------- 매칭·절감액 ---------- */
  // 같은 품번 품의가 여럿이면: 화면 입력 > 표 안에서 나중 줄
  function approvalMap(list) {
    var m = {};
    list.forEach(function (a) { if (!m[a.key] || a.src === 'manual' || m[a.key].src !== 'manual') m[a.key] = a; });
    return m;
  }

  // 비슷한 품번 찾기 — 기호·공백만 다른 품번(BK-1058 / BK1058 / bk 1058).
  // 한 글자 차이까지 넓히면 연번 품번(BK-1010 / BK-1060)이 전부 걸려 제안이 쓸모없어진다.
  function similar(key, keys) {
    var c = compact(key), out = [];
    keys.forEach(function (k) {
      if (k === key) return;
      if (compact(k) === c) out.push(k);
    });
    return out.slice(0, 3);
  }

  function compute(data, manual) {
    var baseMap = {}; data.base.forEach(function (b) { baseMap[b.key] = b; });
    var apAll = data.approvals.concat(manual || []), apMap = approvalMap(apAll);
    var apKeys = Object.keys(apMap);
    var rows = data.orders.map(function (o) {
      var b = baseMap[o.key], a = apMap[o.key], r = {};
      for (var k in o) r[k] = o[k];
      r.amount = round2(o.qty * o.price);
      if (b) { r.status = 'existing'; r.ref = b.price; r.refSrc = 'base'; }
      else if (a) { r.status = 'new'; r.ref = a.basePrice; r.refSrc = a.src === 'manual' ? 'manual' : 'approval'; }
      else { r.status = 'unmatched'; r.ref = null; r.refSrc = null; }
      r.docNo = a ? a.docNo : ''; r.apNew = a ? a.newPrice : null; r.apSrc = a ? a.src : null;
      if (r.ref == null) { r.saving = null; r.kind = '확인 필요'; r.lever = ''; return r; }
      r.refAmount = round2(o.qty * r.ref);
      r.saving = round2((r.ref - o.price) * o.qty);
      r.kind = r.saving > 0 ? '절감' : r.saving < 0 ? '인상' : NO_CHANGE;
      r.unitDiff = round2(r.ref - o.price);
      if (r.kind === NO_CHANGE) r.lever = NO_CHANGE;
      else r.lever = (a && a.lever) || UNCLASSIFIED;
      // 품의서 변경후단가와 실제 발주단가가 다르면 계산은 하되 확인 필요로 알린다
      r.mismatch = !!(a && a.newPrice != null && r.status === 'new' && Math.abs(a.newPrice - o.price) > 1e-9);
      return r;
    });

    // 확인 필요: 품번 × 사유 로 묶는다
    var groups = {}, order = [];
    function add(r, reason) {
      var g = groups[r.key + '|' + reason];
      if (!g) {
        g = groups[r.key + '|' + reason] = { part: r.part, key: r.key, name: r.name, reason: reason, vendors: [], months: [], qty: 0, amount: 0, lines: 0 };
        order.push(g);
      }
      if (g.vendors.indexOf(r.vendor) < 0) g.vendors.push(r.vendor);
      if (g.months.indexOf(r.month) < 0) g.months.push(r.month);
      g.qty += r.qty; g.amount = round2(g.amount + r.amount); g.lines++;
      if (reason === 'ap-mismatch') { g.apNew = r.apNew; g.price = r.price; g.docNo = r.docNo; }
    }
    rows.forEach(function (r) {
      if (r.status === 'unmatched') add(r, 'no-ref');
      else if (r.mismatch) add(r, 'ap-mismatch');
      else if (r.lever === UNCLASSIFIED) add(r, 'no-lever');
    });
    var checks = order.map(function (g) {
      g.months.sort();
      g.reasonText = REASON[g.reason];
      if (g.reason === 'no-ref') g.suggest = similar(g.key, apKeys).map(function (k) { return apMap[k]; });
      return g;
    });
    return { rows: rows, checks: checks, months: uniq(rows.map(function (r) { return r.month; })).sort() };
  }
  var REASON = {
    'no-ref': '신규 품번 — 연초 확정 단가도 품의서 정보도 없습니다. 집계에서 뺐습니다.',
    'ap-mismatch': '품의서 변경후단가와 실제 발주단가가 다릅니다. 품의 기준단가로 계산했습니다.',
    'no-lever': '단가가 바뀌었는데 사유 Lever 가 없습니다. 「미분류」로 집계했습니다.'
  };
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* ---------- 집계 ---------- */
  function inMonth(r, month) { return !month || month === 'all' || r.month === month; }

  function totals(res, month) {
    var t = { saving: 0, increase: 0, net: 0, refAmount: 0, amount: 0, lines: 0, savingLines: 0, increaseLines: 0,
      unmatchedLines: 0, unmatchedAmount: 0, parts: 0, checks: 0 };
    var parts = {};
    res.rows.forEach(function (r) {
      if (!inMonth(r, month)) return;
      if (r.saving == null) { t.unmatchedLines++; t.unmatchedAmount = round2(t.unmatchedAmount + r.amount); return; }
      t.lines++; parts[r.key] = 1;
      t.amount = round2(t.amount + r.amount); t.refAmount = round2(t.refAmount + r.refAmount);
      if (r.saving > 0) { t.saving = round2(t.saving + r.saving); t.savingLines++; }
      else if (r.saving < 0) { t.increase = round2(t.increase - r.saving); t.increaseLines++; }
    });
    t.net = round2(t.saving - t.increase);
    t.rate = t.refAmount ? round2(t.net / t.refAmount * 100) : 0;     // 절감률(%) = 순절감 ÷ 기준 금액
    t.parts = Object.keys(parts).length;
    t.checks = res.checks.filter(function (c) { return !month || month === 'all' || c.months.indexOf(month) >= 0; }).length;
    return t;
  }

  // by: 'month' | 'vendor' | 'lever' | 'part'. 확인 필요(기준 없음) 줄은 들어가지 않는다.
  function aggregate(res, by, month) {
    var m = {}, keys = [];
    res.rows.forEach(function (r) {
      if (r.saving == null || !inMonth(r, month)) return;
      var k = by === 'part' ? r.key : r[by];
      var g = m[k];
      if (!g) { g = m[k] = { key: k, label: by === 'part' ? r.part + (r.name ? ' ' + r.name : '') : k, saving: 0, increase: 0, net: 0, refAmount: 0, amount: 0, lines: 0 }; keys.push(k); }
      g.lines++; g.amount = round2(g.amount + r.amount); g.refAmount = round2(g.refAmount + r.refAmount);
      if (r.saving > 0) g.saving = round2(g.saving + r.saving); else if (r.saving < 0) g.increase = round2(g.increase - r.saving);
    });
    var out = keys.map(function (k) { var g = m[k]; g.net = round2(g.saving - g.increase); g.rate = g.refAmount ? round2(g.net / g.refAmount * 100) : 0; return g; });
    if (by === 'month') out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    else if (by === 'lever') {
      var ord = LEVERS.concat([UNCLASSIFIED, NO_CHANGE]);
      out.sort(function (a, b) { return ord.indexOf(a.key) - ord.indexOf(b.key); });
    } else out.sort(function (a, b) { return b.net - a.net || (a.key < b.key ? -1 : 1); });
    return out;
  }

  // 키 없이도 나오는 규칙 기반 요약 문장 — AI 는 이것을 다듬는 보조다.
  function narrative(res, month) {
    var t = totals(res, month), lv = aggregate(res, 'lever', month).filter(function (g) { return g.key !== NO_CHANGE; });
    var vd = aggregate(res, 'vendor', month);
    var when = !month || month === 'all' ? (res.months.length ? res.months[0] + ' ~ ' + res.months[res.months.length - 1] : '') : month;
    var s = [];
    s.push(when + ' 구매가 순절감은 ' + won(t.net) + '입니다(절감 ' + won(t.saving) + ', 인상 ' + won(t.increase) + ', 절감률 ' + t.rate + '%).');
    var topS = lv.slice().sort(function (a, b) { return b.saving - a.saving; })[0];
    if (topS && topS.saving > 0) s.push('절감이 가장 큰 Lever 는 ' + topS.key + '(' + won(topS.saving) + ')입니다.');
    var topI = lv.slice().sort(function (a, b) { return b.increase - a.increase; })[0];
    if (topI && topI.increase > 0) s.push('인상이 가장 큰 Lever 는 ' + topI.key + '(' + won(topI.increase) + ')입니다.');
    if (vd.length) s.push('업체별 순절감 1위는 ' + vd[0].key + '(' + won(vd[0].net) + ')입니다.');
    if (t.unmatchedLines) s.push('기준 단가를 찾지 못한 발주 ' + t.unmatchedLines + '줄(발주금액 ' + won(t.unmatchedAmount) + ')은 확인 필요 목록에 따로 두었고 실적에 넣지 않았습니다.');
    return s;
  }
  function won(x) {
    var n = Math.round(x), a = Math.abs(n);
    return (n < 0 ? '-' : '') + String(a).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
  }

  // AI 에 보낼 글 — 합계만 보낸다(품번별 상세·업체 단가는 보내지 않는다).
  function aiPrompt(res, month) {
    var t = totals(res, month);
    var lv = aggregate(res, 'lever', month).map(function (g) { return '- ' + g.key + ': 절감 ' + won(g.saving) + ', 인상 ' + won(g.increase) + ', 순 ' + won(g.net); });
    var mo = aggregate(res, 'month', month).map(function (g) { return '- ' + g.key + ': 순 ' + won(g.net) + ' (절감률 ' + g.rate + '%)'; });
    return ['아래는 구매가 절감 실적 집계 결과야. 팀장 보고용 요약을 다섯 문장 안으로 써 줘.',
      '숫자는 바꾸지 말고 그대로 써 줘. 없는 원인은 지어내지 말고, 확인이 필요한 부분은 그렇다고 적어 줘.', '',
      '[전체] 순절감 ' + won(t.net) + ', 절감 ' + won(t.saving) + ', 인상 ' + won(t.increase) + ', 절감률 ' + t.rate + '%, 집계 품번 ' + t.parts + '개',
      '[확인 필요] 기준 단가 없는 발주 ' + t.unmatchedLines + '줄, 확인 항목 ' + t.checks + '건',
      '[월별]'].concat(mo, ['[Lever별]'], lv).join('\n');
  }

  /* ---------- 예제(가짜 데이터) ---------- */
  // 실제 사내 데이터가 아니다. 품번·업체·단가 모두 지어낸 값이다.
  function sample() {
    var seed = 20261102;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
    var NAMES = ['브래킷', '유압호스', '실린더 로드', '연결 핀', '부싱', '구동 기어', '베어링 하우징', '사이드 커버', '와이어 하네스', '오일 필터',
      '체결 볼트 세트', '패킹', '플레이트', '샤프트', '스프링', '커플링', '고무 마운트', '센서 브래킷', '밸브 블록', '라디에이터 호스'];
    var VENDORS = ['가람정밀', '누리금속', '다온유압', '라온전장', '마루고무', '바른주조', '새솔기공', '아라소재'];
    var MONTHS = ['2026-08', '2026-09', '2026-10'];
    var DEC = ['원자재 연동', '가공비 현실화', 'VA/VE', 'BCC', '국산화'];
    var orders = [], base = [], approvals = [], doc = 300;
    function nextDoc() { doc += ri(1, 7); return 'PU-2026-0' + doc; }
    for (var i = 1; i <= 62; i++) {
      var part = 'BK-' + (1000 + i), name = NAMES[(i * 7) % NAMES.length], vendor = VENDORS[(i * 3) % VENDORS.length];
      var p0 = ri(12, 900) * 100, isNew = i > 52;
      var p1 = p0, from = 0, lever = '', withAp = true;
      var roll = rnd();
      if (isNew) {                                    // 신규 품번: 설계·업체 변경으로 새로 생긴 번호
        p1 = Math.round(p0 * (1 - ri(2, 12) / 100) / 10) * 10; from = ri(0, 1);
        lever = ['국산화', 'VA/VE', 'BCC', '원자재 연동', '가공비 현실화'][i % 5];
      } else if (roll < 0.25) { p1 = Math.round(p0 * (1 - ri(1, 8) / 100) / 10) * 10; from = ri(0, 2); lever = DEC[ri(0, 4)]; }
      else if (roll < 0.36) { p1 = Math.round(p0 * (1 + ri(2, 6) / 100) / 10) * 10; from = ri(0, 2); lever = rnd() < 0.6 ? '원자재 연동' : '가공비 현실화'; }
      else if (roll < 0.40) { p1 = Math.round(p0 * (1 - ri(1, 4) / 100) / 10) * 10; from = ri(0, 2); withAp = false; }
      if (!isNew) base.push({ 품번: part, 품명: name, 확정단가: p0 });
      if (lever && withAp) {
        var ap = { 품번: part, 기준단가: p0, 변경후단가: p1, '사유 Lever': lever, 품의번호: nextDoc(), 비고: isNew ? '설계변경 신규 품번' : '단가 변경' };
        if (i === 58) ap['사유 Lever'] = 'VAVE';                     // 표기가 달라도 VA/VE 로 읽는지 보여 준다
        if (i === 61) ap.품번 = 'BK1061';                             // 품번 표기가 달라 매칭되지 않는 예 → 비슷한 품번 제안
        if (i === 62 || i === 60) ap = null;                           // 품의서를 아직 못 찾은 신규 품번
        if (ap) approvals.push(ap);
      }
      MONTHS.forEach(function (m, mi) {
        if (isNew && mi < from) return;                               // 신규 품번은 중간부터 발주
        if (!isNew && rnd() < 0.15) return;                           // 그 달 발주가 없는 품번
        var price = mi >= from ? p1 : p0;
        if (i === 55 && mi === 2) price = p1 + 200;                   // 품의 단가와 다르게 발주된 예
        orders.push({ 품번: part, 품명: name, 공급업체: vendor, 발주수량: ri(2, 80) * 10, 발주단가: price, 발주월: m });
      });
    }
    return { orders: orders, base: base, approvals: approvals };
  }

  var api = { LEVERS: LEVERS, UNCLASSIFIED: UNCLASSIFIED, NO_CHANGE: NO_CHANGE, ALIASES: ALIASES, REASON: REASON,
    num: num, partKey: partKey, compact: compact, toMonth: toMonth, normLever: normLever, detectKind: detectKind,
    normalize: normalize, manualApproval: manualApproval, similar: similar, compute: compute,
    totals: totals, aggregate: aggregate, narrative: narrative, aiPrompt: aiPrompt, won: won, sample: sample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Saving = api;
})(this);
