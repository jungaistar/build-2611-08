/* 구매 절감 실적 자동 집계 — v1.1 「상세 기획안 방식」 계산 엔진
 *
 * 기획자가 다시 올린 상세 기획안(패들릿 4129353795, CLAUDE.md 부록 B)을 그대로 옮긴 것이다.
 * v1.0 의 연초 단가표·품의서 흐름(engine.js)은 손대지 않고, 이 파일이 별도 흐름을 맡는다.
 * 화면(budget-app.js)은 판정하지 않는다. 짝짓기·거르기·매칭·단가 결정·계산·집계·엑셀 구성은 전부 여기서 하고
 * test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다.
 *
 * 입력 세 가지(열 이름은 ALIASES 로 짝짓고, 못 찾은 열은 화면에서 고른다)
 *   orders  : 발주 실적   구매오더·발주유형·협력사 코드·협력사 이름·자재품번·자재품명·통화·구매단가·발주수량·품목범주·조립비·자재비
 *   vendors : 협력업체 담당자  협력업체 코드·협력업체명·담당자
 *   budget  : 예산 단가   자재품번·예산단가·NOTE
 *
 * 규칙(기획안 3~7절)
 *   발주유형 ZNB 만 분석, 나머지는 「제외」.
 *   담당자: 협력사 코드 정확 일치(공백·숫자/글자 형식만 맞춤, 선행 0 은 지우지 않음). 미매칭은 실적에서 빼고 「오류 내역」.
 *   예산단가: 자재품번 정확 일치(공백만 맞춤). 미매칭 행은 실적 시트에 남기고 예산단가·차이금액·Impact·실적은 공란.
 *   구매단가: 품목범주 0 → 구매단가 열 그대로, 3 → 조립비(자재비 열은 쓰지 않는다). 그 밖·공란·숫자 아님 → 「구매단가 확인 필요」.
 *   차이금액 = 구매단가 − 예산단가 (양수 인하 · 음수 인상 · 0 동결 — 기획자 정의 그대로).
 *   Impact = 차이금액 × 발주수량 × 환율, 원화 정수 반올림. 환율 없으면 Impact 없음.
 *   Lever = 예산 단가 NOTE 그대로. 비고는 정해진 다섯 가지만, 정상은 공란.
 */
(function (root) {
  'use strict';

  /* ---------- 상수 ---------- */
  var COLS = ['구매오더', '발주유형', '협력사', '협력사 이름', '자재품번', '자재품명', '통화', '구매단가', '발주수량', '품목범주', '조립비', '자재비',
    '담당자', '예산단가', '차이금액', 'Impact', '실적', 'Lever', '비고'];
  var NOTES = { owner: '담당자 미매칭', budget: '예산단가 미매칭 - 수작업 입력 필요', price: '구매단가 확인 필요', fx: '환율 확인 필요', other: '기타 데이터 오류' };
  var NOTE_ORDER = ['owner', 'budget', 'price', 'fx', 'other'];
  var RESULTS = ['인하', '인상', '동결'];
  var TARGET_TYPE = 'ZNB';
  var UNMATCHED = '미매칭';
  var DEFAULT_FX = [{ cur: 'KRW', rate: 1 }, { cur: 'USD', rate: 1350 }, { cur: 'EUR', rate: 1572 }, { cur: 'CNY', rate: 190 }, { cur: 'JYP', rate: 9.4 }];

  // 표 세 가지의 항목. req 가 true 인 항목이 없으면 그 시트는 쓰지 못한다.
  var FIELDS = {
    orders: [
      { key: 'po', label: '구매오더', req: true }, { key: 'type', label: '발주유형', req: true },
      { key: 'vcode', label: '협력사 코드', req: true }, { key: 'vname', label: '협력사 이름' },
      { key: 'part', label: '자재품번', req: true }, { key: 'pname', label: '자재품명' },
      { key: 'cur', label: '통화', req: true }, { key: 'price', label: '구매단가' },
      { key: 'qty', label: '발주수량', req: true }, { key: 'cat', label: '품목범주', req: true },
      { key: 'asm', label: '조립비' }, { key: 'mat', label: '자재비' }
    ],
    vendors: [
      { key: 'vcode', label: '협력업체 코드', req: true }, { key: 'vname', label: '협력업체명' }, { key: 'owner', label: '담당자', req: true }
    ],
    budget: [
      { key: 'part', label: '자재품번', req: true }, { key: 'bprice', label: '예산단가', req: true }, { key: 'note', label: 'NOTE' }
    ]
  };
  var KIND_LABEL = { orders: '발주 실적', vendors: '협력업체 담당자', budget: '예산 단가' };

  // 열 이름 별칭 — 사내 양식이 다르면 코드가 아니라 이 표를 늘린다. 비교는 공백 제거·소문자.
  var ALIASES = {
    po: ['구매오더', '구매오더번호', '오더', '오더번호', '발주번호', '발주서번호', '구매문서', '구매문서번호', 'po', 'pono', 'po no', 'po number', 'purchasing document', 'ebeln'],
    type: ['발주유형', '발주타입', '오더유형', '구매오더유형', '문서유형', '구매문서유형', 'type', 'order type', 'po type', 'doc type', 'document type', 'bsart'],
    vcode: ['협력사코드', '협력사', '협력업체코드', '협력업체', '업체코드', '공급업체코드', '공급업체', '거래처코드', '거래처', 'vendor', 'vendor code', 'vendor no', 'supplier', 'supplier code', 'lifnr'],
    vname: ['협력사이름', '협력사명', '협력업체명', '협력업체이름', '업체명', '업체이름', '공급업체명', '공급업체이름', '거래처명', '거래처이름', 'vendor name', 'supplier name', 'name1', 'name'],
    part: ['자재품번', '자재번호', '자재코드', '자재', '품번', '품목코드', '품목번호', '부품번호', 'material', 'material no', 'material number', 'matnr', 'part', 'part no', 'partno', 'item', 'item no'],
    pname: ['자재품명', '자재명', '자재내역', '품명', '품목명', '부품명', 'material description', 'description', 'maktx', 'part name', 'item name'],
    cur: ['통화', '통화키', '통화단위', '화폐', 'currency', 'curr', 'cur', 'waers'],
    price: ['구매단가', '발주단가', '단가', '순단가', '순가격', 'price', 'unit price', 'net price', 'netpr'],
    qty: ['발주수량', '수량', '오더수량', '구매수량', '주문수량', 'qty', 'quantity', 'order qty', 'po qty', 'menge'],
    cat: ['품목범주', '품목유형', '품목구분', '범주', 'item category', 'item cat', 'category', 'pstyp'],
    asm: ['조립비', '조립단가', '조립비용', '가공비', 'assembly', 'assembly cost', 'assy'],
    mat: ['자재비', '자재단가', '자재비용', '재료비', 'material cost', 'mat cost'],
    owner: ['담당자', '담당', '담당자명', '구매담당자', '구매담당', '책임자', 'owner', 'buyer', 'person in charge', 'pic'],
    bprice: ['예산단가', '예산', '예산가', '예산가격', '목표단가', '표준단가', '계획단가', 'budget', 'budget price', 'target price', 'std price'],
    note: ['note', 'notes', '노트', '비고', '메모', '사유', 'lever', 'remark', 'remarks', 'comment']
  };

  /* ---------- 글자·숫자 정리 ---------- */
  function str(v) { return String(v == null ? '' : v).trim(); }
  function normHead(s) { return str(s).replace(/\s+/g, '').toLowerCase(); }
  // 전각 영숫자 → 반각 (「숫자/문자 형식 차이」 중 하나)
  function halfWidth(s) { return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  function numStr(v) {                                   // 엑셀이 숫자로 읽은 코드(1003, 1003.0) → '1003'
    if (typeof v === 'number') return isFinite(v) ? (Math.floor(v) === v ? String(v) : String(v)) : '';
    return str(v);
  }
  // 협력사 코드 비교 키: 앞뒤·안쪽 공백 제거, 전각→반각, 대소문자 통일. 선행 0 은 지우지 않는다(「001001」≠「1001」).
  function codeKey(v) { return halfWidth(numStr(v)).replace(/\s+/g, '').toUpperCase(); }
  // 자재품번 비교 키: 공백만 지운다. 하이픈·점·글자는 손대지 않는다(품번 자체를 바꾸지 않는다).
  function partKey(v) { return numStr(v).replace(/\s+/g, ''); }
  // (v1.2) 느슨한 키 — 정확 일치가 0건일 때 두 번째·세 번째로 써 본다. 품번 자체는 바꾸지 않고 비교에만 쓴다.
  //   loose: 전각→반각, 대소문자, 공백·하이픈·점·밑줄·슬래시 무시   (「65.27103-7008」 = 「65271037008」 = 「65 27103 7008」)
  //   digit: 숫자만 남기고 앞의 0 을 지운다 — 한쪽 파일이 품번을 숫자로 읽어 앞의 0 이 떨어진 경우 (「0501219677」 = 501219677)
  function looseKey(v) { return halfWidth(numStr(v)).replace(/[\s\-_.\/·]/g, '').toUpperCase(); }
  function digitKey(v) { var d = halfWidth(numStr(v)).replace(/\D/g, '').replace(/^0+/, ''); return d.length >= 4 ? d : ''; }
  var MATCH_LABEL = { exact: '정확 일치', loose: '공백·기호 무시', digit: '숫자만(앞의 0 무시)' };
  function curKey(v) { return halfWidth(str(v)).replace(/\s+/g, '').toUpperCase(); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = halfWidth(str(v)).replace(/[,\s원₩$€¥]/g, '');
    if (s === '' || s === '-') return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function round6(x) { return Math.round(x * 1e6) / 1e6; }
  // 원화 Impact: 소수 없이 반올림. 0.5 는 0 에서 먼 쪽으로(엑셀 ROUND 와 같게), -0 은 0 으로.
  function roundInt(x) { var r = x < 0 ? -Math.round(-x) : Math.round(x); return r === 0 ? 0 : r; }
  function isZnb(v) { return curKey(v) === TARGET_TYPE; }

  /* ---------- 열 짝짓기 ---------- */
  // headers: 시트 첫 줄. kind 의 항목마다 별칭이 맞는 머리글을 고른다. 한 머리글은 한 항목에만 간다.
  function mapColumns(headers, kind) {
    var used = {}, map = {}, missing = [], hs = (headers || []).map(function (h) { return { raw: h, n: normHead(h) }; });
    FIELDS[kind].forEach(function (f) {
      var names = ALIASES[f.key].map(normHead), found = null;
      // 별칭 목록 앞쪽(정확한 이름)부터 찾는다 — 「협력사 이름」이 「협력사」보다 먼저 제 짝을 만나게 이름을 겹치지 않게 뒀다
      for (var i = 0; i < names.length && found == null; i++)
        for (var j = 0; j < hs.length; j++) if (!used[hs[j].raw] && hs[j].n && hs[j].n === names[i]) { found = hs[j].raw; break; }
      map[f.key] = found; if (found != null) used[found] = 1;
      if (f.req && found == null) missing.push(f.key);
    });
    return { map: map, missing: missing };
  }
  // 머리글만 보고 어느 표인지 고른다. 담당자가 있으면 협력업체 담당자, 예산단가가 있으면 예산 단가, 품번+수량/오더면 발주 실적.
  // (v1.2) 예산 단가 표에 「발주수량」 열이 함께 있는 실제 파일(SAP 정보 레코드 내려받기)이 발주 실적으로 잘못 잡혀 통째로 버려졌다.
  // 발주 실적의 표지는 「구매오더번호」와 「발주유형」이다 — 둘이 다 있어야 발주 실적이고, 예산단가+자재품번이 있는데 둘이 없으면 예산 단가 표다.
  function detectKind(headers) {
    var v = mapColumns(headers, 'vendors').map, b = mapColumns(headers, 'budget').map, o = mapColumns(headers, 'orders').map;
    var isOrders = !!(o.part && o.po && o.type);
    if (v.owner && v.vcode && !isOrders && !b.bprice) return 'vendors';
    if (b.bprice && b.part && !isOrders) return 'budget';
    if (o.part && (o.qty || o.po || o.type)) return 'orders';
    if (v.owner && v.vcode) return 'vendors';
    if (b.bprice && b.part) return 'budget';
    return null;
  }
  // 시트 줄(머리글 이름 키) → 항목 키 객체. __row·__sheet 는 그대로 둔다.
  function readRows(rows, map, sheet) {
    return (rows || []).map(function (r, i) {
      var o = { __row: r.__row || i + 2, __sheet: r.__sheet || sheet || '' };
      for (var k in map) o[k] = map[k] != null && map[k] in r ? r[map[k]] : '';
      return o;
    });
  }
  // 머리글이 기획안 그대로인 줄(예제·테스트)을 바로 읽는다
  function readByAlias(rows, kind, sheet) {
    if (!rows || !rows.length) return [];
    var heads = {}; rows.forEach(function (r) { for (var k in r) if (k.slice(0, 2) !== '__') heads[k] = 1; });
    return readRows(rows, mapColumns(Object.keys(heads), kind).map, sheet);
  }

  /* ---------- 환율 ---------- */
  function normFx(list) {
    var out = [], seen = {}, issues = [];
    (list && list.length ? list : DEFAULT_FX).forEach(function (f) {
      var c = curKey(f.cur), r = num(f.rate);
      if (!c) return;
      if (!(r > 0)) { issues.push('환율 ' + c + ': 숫자가 아니거나 0 이하라 쓰지 않습니다'); return; }
      if (seen[c]) { issues.push('환율 ' + c + ': 두 번 있어 먼저 것을 씁니다'); return; }
      seen[c] = 1; out.push({ cur: c, rate: r });
    });
    return { list: out, issues: issues };
  }
  function fxMap(list) { var m = {}; list.forEach(function (f) { m[f.cur] = f.rate; }); return m; }
  // 통화 → { rate, status }  status: ok · blank · similar(글자만 뒤바뀐 비슷한 코드, 확인 대상) · undefined
  function fxFor(cur, map) {
    var c = curKey(cur);
    if (!c) return { rate: null, status: 'blank' };
    if (map[c] != null) return { rate: map[c], status: 'ok' };
    var sorted = c.split('').sort().join('');
    for (var k in map) if (k.length === c.length && k.split('').sort().join('') === sorted) return { rate: null, status: 'similar', like: k };
    return { rate: null, status: 'undefined' };
  }

  /* ---------- 구매단가 결정 ---------- */
  // 품목범주 0 → 구매단가 열 그대로, 3 → 조립비. 자재비 열은 쓰지 않는다(2026-11-12 기획자 정정 — 처음 프롬프트의 「0 이면 자재비」는 오타였다).
  // 그 밖은 정하지 않는다. { price, src('price'|'asm'|null), detail }
  function decidePrice(o) {
    var cat = num(o.cat), src = null, v = NaN;
    if (cat === 0) { src = 'price'; v = num(o.origPrice !== undefined ? o.origPrice : o.price); }
    else if (cat === 3) { src = 'asm'; v = num(o.asm); }
    if (!src) return { price: null, src: null, detail: '품목범주 「' + str(o.cat) + '」 — 0(구매단가 그대로)·3(조립비) 외의 범주' };
    if (isNaN(v)) return { price: null, src: src, detail: (src === 'price' ? '구매단가' : '조립비') + ' 칸이 비었거나 숫자가 아닙니다' };
    return { price: v, src: src, detail: '' };
  }

  /* ---------- 본 처리 ---------- */
  // input: { orders, vendors, budget } — readRows 를 거친 항목 키 객체 배열
  // opt:   { fx: [{cur, rate}], manual: { 품번키: { part, price } } }  manual 은 화면에서 넣은 예산단가(파일에 없을 때만 쓴다)
  function run(input, opt) {
    opt = opt || {};
    var fxN = normFx(opt.fx), fx = fxMap(fxN.list), manual = opt.manual || {};
    var issues = fxN.issues.slice();

    // 협력업체 담당자 표 → 코드 키별. 같은 코드가 다른 담당자로 두 번 있으면 먼저 것을 쓰고 알린다.
    var vendorMap = {};
    (input.vendors || []).forEach(function (v) {
      var k = codeKey(v.vcode), owner = str(v.owner);
      if (!k && !owner) return;
      var where = (v.__sheet || '협력업체 담당자') + ' ' + v.__row + '행';
      if (!k) { issues.push(where + ': 협력업체 코드가 비어 있습니다'); return; }
      if (!owner) { issues.push(where + '(' + str(v.vcode) + '): 담당자가 비어 있어 미매칭으로 봅니다'); return; }
      if (vendorMap[k]) { if (vendorMap[k].owner !== owner) issues.push(where + '(' + str(v.vcode) + '): 같은 코드가 다른 담당자로 두 번 있습니다 — 먼저 나온 「' + vendorMap[k].owner + '」를 씁니다'); return; }
      vendorMap[k] = { code: str(v.vcode), name: str(v.vname), owner: owner };
    });
    // 예산 단가 표 → 품번 키별. 같은 품번이 다른 단가로 두 번 있으면 먼저 것을 쓰고 알린다.
    var budgetMap = {};
    (input.budget || []).forEach(function (b) {
      var k = partKey(b.part), p = num(b.bprice);
      if (!k && isNaN(p) && !str(b.note)) return;
      var where = (b.__sheet || '예산 단가') + ' ' + b.__row + '행';
      if (!k) { issues.push(where + ': 자재품번이 비어 있습니다'); return; }
      if (isNaN(p)) { issues.push(where + '(' + str(b.part) + '): 예산단가가 숫자가 아니라 미매칭으로 봅니다'); return; }
      if (budgetMap[k]) { if (budgetMap[k].price !== p) issues.push(where + '(' + str(b.part) + '): 같은 품번이 다른 예산단가로 두 번 있습니다 — 먼저 나온 ' + budgetMap[k].price + ' 을 씁니다'); return; }
      budgetMap[k] = { part: str(b.part), price: p, note: str(b.note) };
    });
    // (v1.2) 느슨한 키 표 — 같은 느슨한 키에 다른 품번이 여럿이면 쓰지 않는다(엉뚱한 단가가 붙는 것보다 미매칭이 낫다)
    var looseMap = {}, digitMap = {};
    Object.keys(budgetMap).forEach(function (k) {
      var b = budgetMap[k], lk = looseKey(b.part), dk = digitKey(b.part);
      if (lk) { if (looseMap[lk] && looseMap[lk].key !== k) looseMap[lk].dup = true; else looseMap[lk] = looseMap[lk] || { key: k, dup: false }; }
      if (dk) { if (digitMap[dk] && digitMap[dk].key !== k) digitMap[dk].dup = true; else digitMap[dk] = digitMap[dk] || { key: k, dup: false }; }
    });
    function findBudget(part) {
      var k = partKey(part); if (budgetMap[k]) return { b: budgetMap[k], how: 'exact' };
      var l = looseMap[looseKey(part)]; if (l && !l.dup) return { b: budgetMap[l.key], how: 'loose' };
      var d = digitMap[digitKey(part)]; if (d && !d.dup) return { b: budgetMap[d.key], how: 'digit' };
      return null;
    }

    var rows = [], excluded = [], ownerUnmatched = [], errors = [], total = 0;
    (input.orders || []).forEach(function (o, i) {
      var r = {
        row: o.__row || i + 2, sheet: o.__sheet || '발주 실적',
        po: numStr(o.po), type: str(o.type), vcode: numStr(o.vcode), vname: str(o.vname), part: numStr(o.part), pname: str(o.pname),
        cur: str(o.cur), origPrice: num(o.price), qtyRaw: o.qty, qty: num(o.qty), cat: o.cat, asm: num(o.asm), mat: num(o.mat),
        asmRaw: o.asm, matRaw: o.mat
      };
      if (!r.po && !r.part && !r.vcode && isNaN(r.qty)) return;        // 빈 줄
      total++;
      r.vcodeKey = codeKey(r.vcode); r.partKey = partKey(r.part); r.curKey = curKey(r.cur);
      r.notes = []; r.details = [];
      // 1) 발주유형 ZNB 만
      if (!isZnb(r.type)) { r.reason = '발주유형 ' + (r.type ? '「' + r.type + '」' : '없음') + ' — ' + TARGET_TYPE + ' 아님'; excluded.push(r); return; }
      // 2) 담당자
      var v = vendorMap[r.vcodeKey];
      if (!v) {
        r.owner = UNMATCHED; r.notes.push('owner'); r.details.push('협력사 코드 「' + (r.vcode || '(없음)') + '」가 협력업체 담당자 표에 없습니다');
        ownerUnmatched.push(r);
        errors.push(errEntry('owner', r, r.details[0], false));
        return;
      }
      r.owner = v.owner; if (!r.vname) r.vname = v.name;
      // 3) 구매단가
      var d = decidePrice(r); r.price = d.price; r.priceSrc = d.src;
      if (d.price == null) { r.notes.push('price'); r.details.push(d.detail); }
      r.priceDiffers = d.price != null && !isNaN(r.origPrice) && Math.abs(r.origPrice - d.price) > 1e-9;
      // 4) 예산단가 — 파일 > 화면 입력. 둘 다 없으면 공란 + 비고
      var fb = findBudget(r.part), b = fb && fb.b, m = manual[r.partKey];
      if (b) {
        r.bprice = b.price; r.bpriceSrc = 'file'; r.lever = b.note; r.bpriceHow = fb.how;
        if (fb.how !== 'exact') r.details.push('자재품번 「' + r.part + '」 ↔ 예산 단가 표 「' + b.part + '」 — ' + MATCH_LABEL[fb.how] + '로 맞춤(확인)');
      }
      else if (m && !isNaN(num(m.price))) { r.bprice = num(m.price); r.bpriceSrc = 'manual'; r.lever = ''; r.fileUnmatched = true; }
      else { r.bprice = null; r.bpriceSrc = null; r.lever = ''; r.fileUnmatched = true; r.notes.push('budget'); r.details.push('자재품번 「' + (r.part || '(없음)') + '」가 예산 단가 표에 없습니다'); }
      // 5) 수량·환율
      if (isNaN(r.qty)) { r.notes.push('other'); r.details.push('발주수량이 비었거나 숫자가 아닙니다'); }
      var f = fxFor(r.cur, fx); r.fx = f.rate; r.fxStatus = f.status;
      if (f.status !== 'ok') {
        r.notes.push('fx');
        r.details.push(f.status === 'blank' ? '통화가 비어 있습니다' : f.status === 'similar'
          ? '통화 「' + r.cur + '」 — 환율표의 ' + f.like + ' 와 글자가 비슷하지만 다른 코드라 바꾸지 않았습니다(확인 대상)'
          : '통화 「' + r.cur + '」 의 환율이 정의되지 않았습니다');
      }
      // 6) 계산 — 차이금액 = 구매단가 − 예산단가, Impact = 차이금액 × 발주수량 × 환율(정수 반올림)
      r.diff = r.price != null && r.bprice != null ? round6(r.price - r.bprice) : null;
      r.result = r.diff == null ? '' : r.diff > 0 ? '인하' : r.diff < 0 ? '인상' : '동결';
      r.impact = r.diff != null && !isNaN(r.qty) && r.fx != null ? roundInt(r.diff * r.qty * r.fx) : null;
      r.note = noteText(r.notes);
      r.notes.forEach(function (n, j) { errors.push(errEntry(n, r, r.details[j], true)); });
      rows.push(r);
    });

    var summary = summarize(rows, excluded, ownerUnmatched, total);
    return { rows: rows, excluded: excluded, ownerUnmatched: ownerUnmatched, errors: errors, issues: issues, fx: fxN.list,
      summary: summary, diagnosis: diagnose(input.orders || [], input.budget || [], summary), byOwner: groupBy(rows, 'owner'), byVendor: groupBy(rows, 'vendor'), verify: verify(rows, excluded, ownerUnmatched, total, summary) };
  }
  // (v1.2) 매칭 진단 — 「예산단가 매칭 0건」일 때 왜 안 맞는지 보여 준다. 양쪽 품번 예시 · 모양(숫자/글자·길이) · 느슨한 키로 맞는 건수 · 힌트.
  function diagnose(orders, budget, s) {
    function sample(list, key) { var seen = {}, out = []; for (var i = 0; i < list.length && out.length < 5; i++) { var v = numStr(list[i][key]); if (v && !seen[v]) { seen[v] = 1; out.push(v); } } return out; }
    function shape(list, key) {
      var n = 0, digit = 0, lead0 = 0, sym = 0, len = {};
      list.forEach(function (r) { var v = numStr(r[key]); if (!v) return; n++; if (/^\d+$/.test(v)) digit++; if (/^0\d/.test(v)) lead0++; if (/[\-.\/_ ]/.test(v)) sym++; len[v.length] = (len[v.length] || 0) + 1; });
      var lens = Object.keys(len).sort(function (a, b) { return len[b] - len[a]; }).slice(0, 3).map(function (l) { return l + '자리 ' + len[l] + '건'; });
      return { n: n, digit: digit, lead0: lead0, sym: sym, lens: lens };
    }
    var oParts = sample(orders, 'part'), bParts = sample(budget, 'part'), os = shape(orders, 'part'), bs = shape(budget, 'part');
    // run() 과 같은 규칙 — 같은 느슨한 키에 서로 다른 품번이 여럿이면 맞춘 것으로 세지 않는다
    var bExact = {}, bLoose = {}, bDigit = {};
    budget.forEach(function (b) { var k = partKey(b.part); if (!k) return; bExact[k] = 1; var lk = looseKey(b.part), dk = digitKey(b.part); (bLoose[lk] = bLoose[lk] || {})[k] = 1; if (dk) (bDigit[dk] = bDigit[dk] || {})[k] = 1; });
    var one = function (m, k) { return m[k] && Object.keys(m[k]).length === 1; };
    var exact = 0, loose = 0, digit = 0, none = 0, seenO = {};
    orders.forEach(function (o) { var k = partKey(o.part); if (!k || seenO[k]) return; seenO[k] = 1; if (bExact[k]) exact++; else if (one(bLoose, looseKey(o.part))) loose++; else if (one(bDigit, digitKey(o.part))) digit++; else none++; });
    var hints = [];
    if (!budget.length) hints.push('예산 단가 표를 읽지 못했습니다 — 시트에 「자재품번」과 「예산단가」 머리글이 있는지, 열 짝짓기에서 자재품번 열이 비어 있지 않은지 보세요.');
    else if (!bs.n) hints.push('예산 단가 표의 자재품번 칸이 전부 비어 있습니다 — 머리글이 다른 열(예: 「품목코드」)에 품번이 있다면 열 이름을 「자재품번」으로 바꾸거나 별칭 표에 더해야 합니다.');
    if (os.n && bs.n) {
      if (os.digit && bs.sym) hints.push('발주 실적 품번은 숫자뿐인데 예산 단가 품번에는 점·하이픈이 있습니다 — 기호를 무시한 비교로 ' + loose + '건이 더 맞습니다.');
      if (bs.digit && os.sym) hints.push('예산 단가 품번은 숫자뿐인데 발주 실적 품번에는 점·하이픈이 있습니다 — 기호를 무시한 비교로 ' + loose + '건이 더 맞습니다.');
      if ((os.lead0 && !bs.lead0) || (bs.lead0 && !os.lead0)) hints.push('한쪽 품번만 0 으로 시작합니다(엑셀이 숫자로 읽어 앞의 0 이 떨어진 쪽이 있음) — 앞의 0 을 무시한 비교로 ' + digit + '건이 더 맞습니다.');
      if (!exact && !loose && !digit) hints.push('느슨한 비교로도 맞는 품번이 없습니다 — 두 파일의 품번이 서로 다른 체계(예: 자재번호 vs 도면번호)이거나, 예산 단가 표의 자재품번 열이 다른 열로 짝지어졌을 수 있습니다. 아래 예시를 나란히 비교해 보세요.');
    }
    return { ordersSample: oParts, budgetSample: bParts, ordersShape: os, budgetShape: bs, exact: exact, loose: loose, digit: digit, none: none, hints: hints,
      summary: s ? { matched: s.budgetMatched, loose: s.budgetLoose, digit: s.budgetDigit, unmatched: s.budgetUnmatched } : null };
  }
  function noteText(keys) {
    var seen = {}, out = [];
    NOTE_ORDER.forEach(function (k) { if (keys.indexOf(k) >= 0 && !seen[k]) { seen[k] = 1; out.push(NOTES[k]); } });
    return out.join(' / ');
  }
  function errEntry(kind, r, detail, inSheet) {
    return { kind: NOTES[kind], key: kind, po: r.po, type: r.type, vcode: r.vcode, vname: r.vname, part: r.part, pname: r.pname, cur: r.cur, cat: str(r.cat),
      detail: detail || '', where: r.sheet + ' ' + r.row + '행', inSheet: inSheet };
  }

  /* ---------- 집계·검증 ---------- */
  function summarize(rows, excluded, ownerUnmatched, total) {
    var s = { total: total, znb: rows.length + ownerUnmatched.length, nonZnb: excluded.length,
      ownerMatched: rows.length, ownerUnmatched: ownerUnmatched.length, final: rows.length,
      budgetMatched: 0, budgetUnmatched: 0, budgetLoose: 0, budgetDigit: 0, manualFilled: 0, manualNeeded: 0,
      down: 0, downImpact: 0, up: 0, upImpact: 0, flat: 0, impactTotal: 0, noImpact: 0,
      priceCheck: 0, fxCheck: 0, otherErr: 0, clean: 0 };
    rows.forEach(function (r) {
      if (r.bpriceSrc === 'file') { s.budgetMatched++; if (r.bpriceHow === 'loose') s.budgetLoose++; else if (r.bpriceHow === 'digit') s.budgetDigit++; } else { s.budgetUnmatched++; if (r.bpriceSrc === 'manual') s.manualFilled++; else s.manualNeeded++; }
      if (r.result === '인하') { s.down++; s.downImpact += r.impact || 0; }
      else if (r.result === '인상') { s.up++; s.upImpact += r.impact || 0; }
      else if (r.result === '동결') s.flat++;
      if (r.impact == null) s.noImpact++;
      if (r.notes.indexOf('price') >= 0) s.priceCheck++;
      if (r.notes.indexOf('fx') >= 0) s.fxCheck++;
      if (r.notes.indexOf('other') >= 0) s.otherErr++;
      if (!r.notes.length) s.clean++;
    });
    s.impactTotal = s.downImpact + s.upImpact;
    return s;
  }
  // by: 'owner' | 'vendor'
  function groupBy(rows, by) {
    var m = {}, keys = [];
    rows.forEach(function (r) {
      var k = by === 'owner' ? r.owner : r.vcodeKey, label = by === 'owner' ? r.owner : (r.vname ? r.vname + ' (' + r.vcode + ')' : r.vcode);
      var g = m[k];
      if (!g) { g = m[k] = { key: k, label: label, lines: 0, down: 0, up: 0, flat: 0, pending: 0, impact: 0, downImpact: 0, upImpact: 0 }; keys.push(k); }
      g.lines++;
      if (r.result === '인하') g.down++; else if (r.result === '인상') g.up++; else if (r.result === '동결') g.flat++; else g.pending++;
      if (r.impact != null) { g.impact += r.impact; if (r.impact > 0) g.downImpact += r.impact; else g.upImpact += r.impact; }
    });
    return keys.map(function (k) { return m[k]; }).sort(function (a, b) { return b.impact - a.impact || (a.label < b.label ? -1 : 1); });
  }
  // 기획안 8-5 데이터 정합성 — 결과를 만들기 전에 스스로 검사한 항목. 하나라도 false 면 화면이 붉게 알린다.
  function verify(rows, excluded, ownerUnmatched, total, s) {
    var sumRows = rows.reduce(function (a, r) { return a + (r.impact || 0); }, 0);
    var byOwnerSum = groupBy(rows, 'owner').reduce(function (a, g) { return a + g.impact; }, 0);
    return [
      { name: '전체 발주 건수 = ZNB + ZNB 외 제외', ok: total === s.znb + s.nonZnb, detail: total + ' = ' + s.znb + ' + ' + s.nonZnb },
      { name: 'ZNB 건수 = 실적 시트 행 수 + 담당자 미매칭 행 수(누락·중복 없음)', ok: s.znb === rows.length + ownerUnmatched.length, detail: s.znb + ' = ' + rows.length + ' + ' + ownerUnmatched.length },
      { name: '담당자 미매칭 행은 실적 시트에 없다', ok: rows.every(function (r) { return r.owner !== UNMATCHED; }), detail: ownerUnmatched.length + '건 제외' },
      { name: '예산단가 미매칭 행은 실적 시트에 남고 Impact 가 비어 있다', ok: rows.filter(function (r) { return r.bprice == null; }).every(function (r) { return r.impact == null && r.diff == null && r.result === ''; }), detail: s.manualNeeded + '건' },
      { name: '전체 Impact 합 = 개별 행 Impact 합 = 담당자별 합', ok: s.impactTotal === sumRows && sumRows === byOwnerSum, detail: s.impactTotal + ' = ' + sumRows + ' = ' + byOwnerSum },
      { name: '실적 구분은 차이금액 부호를 따른다', ok: rows.every(function (r) { return r.diff == null ? r.result === '' : r.result === (r.diff > 0 ? '인하' : r.diff < 0 ? '인상' : '동결'); }), detail: '인하 ' + s.down + ' · 인상 ' + s.up + ' · 동결 ' + s.flat }
    ];
  }

  /* ---------- 엑셀 ---------- */
  function col(i) { return String.fromCharCode(65 + i); }           // 0..18 → A..S
  var C = {}; COLS.forEach(function (n, i) { C[n] = col(i); });
  function cellNum(ws, addr, v, z) { if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) return; ws[addr] = { t: 'n', v: v, z: z }; }
  function formulas(r) {                                             // r: 엑셀 행 번호
    var H = C['구매단가'] + r, I = C['발주수량'] + r, N = C['예산단가'] + r, O = C['차이금액'] + r, G = C['통화'] + r;
    return {
      diff: 'IF(OR(' + N + '="",' + H + '=""),"",' + H + '-' + N + ')',
      impact: 'IF(OR(' + O + '="",' + I + '=""),"",IFERROR(ROUND(' + O + '*' + I + '*VLOOKUP(' + G + ',환율!$A$2:$B$100,2,FALSE),0),""))',
      result: 'IF(' + O + '="","",IF(' + O + '>0,"인하",IF(' + O + '<0,"인상","동결")))'
    };
  }
  function rawOr(n, raw) { return isNaN(n) ? str(raw) : n; }
  // XLSX(SheetJS) 를 밖에서 받는다 — node 테스트에서도 같은 코드로 통장을 만들어 수식·열 순서를 검사한다.
  function buildWorkbook(res, XLSX, meta) {
    var U = XLSX.utils, wb = U.book_new(), s = res.summary, z4 = '#,##0.####', z0 = '#,##0';
    // 1. 구매절감 실적 — 열 순서·이름 고정, 구매오더 단위 그대로, 담당자 미매칭 제외, 예산단가 미매칭 포함
    var aoa = [COLS.slice()];
    res.rows.forEach(function (r) {
      aoa.push([r.po, r.type, r.vcode, r.vname, r.part, r.pname, r.cur, r.price == null ? '' : r.price, rawOr(r.qty, r.qtyRaw), str(r.cat),
        rawOr(r.asm, r.asmRaw), rawOr(r.mat, r.matRaw), r.owner, r.bprice == null ? '' : r.bprice, r.diff == null ? '' : r.diff, r.impact == null ? '' : r.impact, r.result, r.lever, r.note]);
    });
    var ws = U.aoa_to_sheet(aoa);
    res.rows.forEach(function (r, i) {
      var n = i + 2, f = formulas(n);
      cellNum(ws, C['구매단가'] + n, r.price, z4); cellNum(ws, C['발주수량'] + n, isNaN(r.qty) ? null : r.qty, z0);
      cellNum(ws, C['조립비'] + n, isNaN(r.asm) ? null : r.asm, z4); cellNum(ws, C['자재비'] + n, isNaN(r.mat) ? null : r.mat, z4);
      cellNum(ws, C['예산단가'] + n, r.bprice, z4);
      // 예산단가 칸에 값을 넣으면 차이금액·Impact·실적이 저절로 계산된다(공란이면 공란). 환율은 「환율」 시트에서 찾는다.
      ws[C['차이금액'] + n] = r.diff == null ? { t: 's', v: '', f: f.diff } : { t: 'n', v: r.diff, f: f.diff, z: z4 };
      ws[C['Impact'] + n] = r.impact == null ? { t: 's', v: '', f: f.impact } : { t: 'n', v: r.impact, f: f.impact, z: z0 };
      ws[C['실적'] + n] = { t: 's', v: r.result, f: f.result };
    });
    ws['!cols'] = [12, 9, 11, 16, 14, 22, 6, 12, 10, 8, 11, 11, 10, 12, 12, 14, 6, 18, 34].map(function (w) { return { wch: w }; });
    ws['!autofilter'] = { ref: 'A1:' + col(COLS.length - 1) + Math.max(2, aoa.length) };
    U.book_append_sheet(wb, ws, '구매절감 실적');

    // 2. 집계 및 검증
    var sum = [['구매 절감 실적 — 집계 및 검증'], ['만든 날', (meta && meta.date) || new Date().toISOString().slice(0, 10)], ['금액 단위', '원화(KRW), Impact 는 정수 반올림'], [],
      ['항목', '값'],
      ['전체 발주 데이터 건수', s.total], ['ZNB 발주 건수', s.znb], ['ZNB 이외 제외 건수', s.nonZnb],
      ['담당자 정상 매칭 건수', s.ownerMatched], ['담당자 미매칭 건수', s.ownerUnmatched], ['담당자 미매칭으로 인한 산출 제외 건수', s.ownerUnmatched], ['최종 산출 대상 건수', s.final],
      ['예산단가 정상 매칭 건수', s.budgetMatched], ['예산단가 미매칭 건수(파일 기준)', s.budgetUnmatched], ['그중 화면 입력으로 채운 건수', s.manualFilled], ['수작업 입력 필요 건수(공란)', s.manualNeeded],
      ['인하 건수', s.down], ['인하 Impact 합계(원)', s.downImpact], ['인상 건수', s.up], ['인상 Impact 합계(원)', s.upImpact], ['동결 건수', s.flat],
      ['전체 Impact 합계(원)', s.impactTotal], ['Impact 미산출 건수', s.noImpact],
      ['구매단가 확인 필요 건수', s.priceCheck], ['환율 확인 필요 건수', s.fxCheck], ['기타 데이터 오류 건수', s.otherErr], [],
      ['정합성 검증', '결과', '내용']].concat(res.verify.map(function (v) { return [v.name, v.ok ? '일치' : '불일치', v.detail]; }), [[],
      ['담당자별', '건수', '인하', '인상', '동결', '보류', 'Impact 합계(원)']], res.byOwner.map(function (g) { return [g.label, g.lines, g.down, g.up, g.flat, g.pending, g.impact]; }), [[],
      ['협력사별', '건수', '인하', '인상', '동결', '보류', 'Impact 합계(원)']], res.byVendor.map(function (g) { return [g.label, g.lines, g.down, g.up, g.flat, g.pending, g.impact]; }), [[],
      ['계산 규칙', '차이금액 = 구매단가 − 예산단가 (양수 인하 · 음수 인상 · 0 동결). Impact = 차이금액 × 발주수량 × 환율, 정수 반올림. 구매단가는 품목범주 0 → 구매단가 열 그대로, 3 → 조립비(자재비는 쓰지 않음).'],
      ['주의', '집계 금액은 상세 실적 시트의 개별 행 Impact 를 더한 값입니다. 시트에서 예산단가를 직접 입력하면 상세는 바로 다시 계산되지만 이 집계 시트의 숫자는 고정값이니 다시 집계해 주세요.']]);
    var ws2 = U.aoa_to_sheet(sum); ws2['!cols'] = [{ wch: 44 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }];
    U.book_append_sheet(wb, ws2, '집계 및 검증');

    // 3. 제외(비ZNB)
    var exH = ['구매오더', '발주유형', '협력사', '협력사 이름', '자재품번', '자재품명', '통화', '구매단가', '발주수량', '품목범주', '조립비', '자재비', '제외 사유', '원본 위치'];
    var ex = res.excluded.map(function (r) { return [r.po, r.type, r.vcode, r.vname, r.part, r.pname, r.cur, rawOr(r.origPrice, ''), rawOr(r.qty, r.qtyRaw), str(r.cat), rawOr(r.asm, r.asmRaw), rawOr(r.mat, r.matRaw), r.reason, r.sheet + ' ' + r.row + '행']; });
    var ws3 = U.aoa_to_sheet([exH].concat(ex.length ? ex : [['(제외된 행 없음)']])); ws3['!cols'] = exH.map(function () { return { wch: 13 }; });
    U.book_append_sheet(wb, ws3, '제외(비ZNB)');

    // 4. 오류 내역 — 원인과 원본 식별 정보
    var erH = ['구분', '구매오더', '발주유형', '협력사', '협력사 이름', '자재품번', '자재품명', '통화', '품목범주', '상세', '원본 위치', '실적 시트 포함'];
    var er = res.errors.map(function (e) { return [e.kind, e.po, e.type, e.vcode, e.vname, e.part, e.pname, e.cur, e.cat, e.detail, e.where, e.inSheet ? '포함' : '제외']; });
    var ws4 = U.aoa_to_sheet([erH].concat(er.length ? er : [['(오류 없음)']])); ws4['!cols'] = [28, 12, 9, 11, 14, 14, 18, 6, 8, 60, 20, 12].map(function (w) { return { wch: w }; });
    U.book_append_sheet(wb, ws4, '오류 내역');

    // 5. 환율 — 실적 시트의 Impact 수식이 여기서 찾는다. 통화를 더 적으면 그 통화의 Impact 도 계산된다.
    var ws5 = U.aoa_to_sheet([['통화', '환율(원)']].concat(res.fx.map(function (f) { return [f.cur, f.rate]; })));
    ws5['!cols'] = [{ wch: 8 }, { wch: 12 }];
    U.book_append_sheet(wb, ws5, '환율');

    // 6. 안내
    var ws6 = U.aoa_to_sheet([['안내'],
      ['예산단가가 비어 있는 행(비고 「예산단가 미매칭 - 수작업 입력 필요」)은 「구매절감 실적」 시트의 예산단가 칸에 값을 넣으면 차이금액·Impact·실적이 수식으로 바로 계산됩니다.'],
      ['차이금액 = 구매단가 − 예산단가. 양수 인하, 음수 인상, 0 동결(기획자 정의).'],
      ['Impact = 차이금액 × 발주수량 × 환율(「환율」 시트에서 통화로 찾음), 원화 정수 반올림. 환율표에 없는 통화는 Impact 가 비어 있습니다 — 「환율」 시트에 통화와 환율을 더하면 계산됩니다.'],
      ['구매단가는 품목범주 0 이면 원본 구매단가 그대로, 3 이면 조립비입니다(자재비 열은 쓰지 않습니다). 그 밖의 범주이거나 값이 없으면 구매단가가 비어 있고 비고에 「구매단가 확인 필요」가 있습니다. 구매단가 칸에 값을 넣어도 수식이 계산됩니다.'],
      ['담당자 미매칭 행은 「구매절감 실적」 시트에 없고 「오류 내역」 시트에만 있습니다. 발주유형이 ZNB 가 아닌 행은 「제외(비ZNB)」 시트에 있습니다.'],
      ['「집계 및 검증」 시트의 숫자는 만든 시점의 고정값입니다. 예산단가를 직접 입력한 뒤에는 도구에서 다시 집계하거나 피벗으로 다시 더해 주세요.'],
      ['수작업 입력 칸의 색 구분은 이 도구가 쓰는 무료 엑셀 라이브러리가 셀 서식을 쓰지 못해 넣지 못했습니다. 비고 열로 거르면 입력할 행이 모입니다.'],
      ['예제 데이터는 실제 사내 데이터가 아닙니다.']]);
    ws6['!cols'] = [{ wch: 120 }];
    U.book_append_sheet(wb, ws6, '안내');
    return wb;
  }

  /* ---------- 예제(가짜 데이터) ---------- */
  // 실제 사내 데이터가 아니다. 구매오더·협력사·품번·단가 전부 지어낸 값이다.
  // 비고 다섯 가지와 ZNB 외 유형, 품목범주 0/3/그 밖, KRW·USD·EUR·CNY·JYP·JPY·정의 없는 통화가 한 번씩은 나오게 짰다.
  function sample() {
    var seed = 20261103;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
    var VENDORS = [
      { code: '001001', name: '가람정밀', owner: '김민수' }, { code: '001002', name: '누리금속', owner: '이서연' },
      { code: '1003', name: '다온유압', owner: '박지훈' }, { code: 'V2001', name: '라온전장', owner: '최수아' },
      { code: '001005', name: '마루고무', owner: '정우진' }, { code: '001006', name: '바른주조', owner: '김민수' }
    ];
    var NAMES = ['브래킷', '유압호스', '실린더 로드', '연결 핀', '부싱', '구동 기어', '베어링 하우징', '사이드 커버', '와이어 하네스', '오일 필터', '체결 볼트 세트', '패킹', '플레이트', '샤프트', '스프링', '커플링'];
    var LEVERS = ['VA/VE', '원자재 연동', '', 'BCC 협상', '국산화', '', '가공비 현실화'];
    var CURS = [{ c: 'KRW', s: 1 }, { c: 'USD', s: 1 / 1350 }, { c: 'EUR', s: 1 / 1572 }, { c: 'CNY', s: 1 / 190 }, { c: 'JYP', s: 1 / 9.4 }];
    var budget = [], parts = [];
    for (var i = 1; i <= 26; i++) {
      var p = 'BK-' + (2000 + i), krw = ri(8, 600) * 100, cur = CURS[i % 5];
      var bp = cur.c === 'KRW' ? krw : Math.round(krw * cur.s * 100) / 100;
      parts.push({ part: p, name: NAMES[(i * 5) % NAMES.length], cur: cur.c, bprice: bp });
      if (i <= 24) budget.push({ 자재품번: i === 3 ? ' ' + p + ' ' : p, 예산단가: bp, NOTE: LEVERS[i % LEVERS.length] });
    }
    budget.push({ 자재품번: 'BK-2004', 예산단가: parts[3].bprice + 10, NOTE: '중복 줄(먼저 것을 씀)' });   // 같은 품번 두 번
    var vendors = VENDORS.map(function (v) { return { '협력업체 코드': v.code, '협력업체명': v.name, '담당자': v.owner }; });
    var orders = [], po = 4500001000;
    function line(spec) {
      var pt = parts[spec.pi], v = VENDORS[spec.vi], cat = spec.cat != null ? spec.cat : (rnd() < 0.7 ? 0 : 3);
      var ratio = spec.ratio != null ? spec.ratio : [0.97, 1.05, 1.0, 1.03, 0.92, 1.0, 1.04][ri(0, 6)];
      var applied = Math.round(pt.bprice * ratio * 100) / 100, other = Math.round(applied * 0.35 * 100) / 100;
      var row = { 구매오더: String(po += ri(1, 9)), 발주유형: spec.type || 'ZNB', '협력사 코드': spec.vcode != null ? spec.vcode : v.code, '협력사 이름': v.name,
        자재품번: spec.part || pt.part, 자재품명: pt.name, 통화: spec.cur || pt.cur, 구매단가: spec.price != null ? spec.price : applied,
        발주수량: spec.qty != null ? spec.qty : ri(2, 60) * 10, 품목범주: cat,
        조립비: cat === 3 ? applied : other, 자재비: cat === 0 ? applied : other };
      if (spec.asm !== undefined) row.조립비 = spec.asm;
      if (spec.mat !== undefined) row.자재비 = spec.mat;
      orders.push(row);
    }
    for (var k = 0; k < 30; k++) line({ pi: k % 24, vi: k % 6 });
    line({ pi: 0, vi: 0, ratio: 1.0 });                                 // 동결
    line({ pi: 1, vi: 1, ratio: 1.06 });                                // 인상
    line({ pi: 2, vi: 2, vcode: 1003 });                                // 코드가 숫자로 읽힌 경우 → '1003' 과 같다
    line({ pi: 5, vi: 1, vcode: ' 001002 ' });                          // 앞뒤 공백 → 맞는다
    line({ pi: 6, vi: 0, vcode: '1001' });                              // 선행 0 이 빠진 코드 → 「001001」 과 다르다 → 담당자 미매칭
    line({ pi: 7, vi: 3, vcode: '001009' });                            // 담당자 표에 없는 협력사 → 담당자 미매칭
    line({ pi: 24, vi: 4 });                                            // BK-2025 예산단가 없음 → 수작업 입력 필요
    line({ pi: 25, vi: 5 });                                            // BK-2026 예산단가 없음
    line({ pi: 8, vi: 2, cat: 1 });                                     // 품목범주 1 → 구매단가 확인 필요
    line({ pi: 9, vi: 3, cat: 3, asm: '' });                            // 조립비 공란 → 구매단가 확인 필요
    line({ pi: 10, vi: 4, cur: 'JPY', ratio: 0.95 });                   // JYP 와 비슷한 코드 → 확인 대상(환율 확인 필요)
    line({ pi: 11, vi: 5, cur: 'GBP', ratio: 0.95 });                   // 정의 없는 통화 → 환율 확인 필요
    line({ pi: 12, vi: 0, qty: '' });                                   // 발주수량 없음 → 기타 데이터 오류
    line({ pi: 13, vi: 1, type: 'ZST' });                               // ZNB 아님 → 제외
    line({ pi: 14, vi: 2, type: 'ZRT' });
    line({ pi: 15, vi: 3, type: 'UB' });
    line({ pi: 16, vi: 4, type: 'znb ' });                              // 소문자·공백 → ZNB 로 본다
    line({ pi: 4, vi: 5, cat: 3, price: 1 });                           // 품목범주 3: 구매단가 열과 조립비가 다름 → 조립비를 쓴다
    return { orders: orders, vendors: vendors, budget: budget };
  }
  // 예제를 세 파일로 저장할 때의 파일 이름·시트 이름
  var SAMPLE_FILES = { orders: ['발주실적_예제(가짜데이터).xlsx', '발주실적'], vendors: ['협력업체담당자_예제(가짜데이터).xlsx', '담당자'], budget: ['예산단가_예제(가짜데이터).xlsx', '예산단가'] };

  var api = { COLS: COLS, NOTES: NOTES, RESULTS: RESULTS, FIELDS: FIELDS, KIND_LABEL: KIND_LABEL, ALIASES: ALIASES, DEFAULT_FX: DEFAULT_FX, UNMATCHED: UNMATCHED, SAMPLE_FILES: SAMPLE_FILES,
    num: num, codeKey: codeKey, partKey: partKey, looseKey: looseKey, digitKey: digitKey, MATCH_LABEL: MATCH_LABEL, diagnose: diagnose, curKey: curKey, isZnb: isZnb, roundInt: roundInt,
    mapColumns: mapColumns, detectKind: detectKind, readRows: readRows, readByAlias: readByAlias,
    normFx: normFx, fxFor: fxFor, decidePrice: decidePrice, run: run, groupBy: groupBy, formulas: formulas, buildWorkbook: buildWorkbook, sample: sample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Budget = api;
})(this);
