/* 계산 규칙 고정 — node test/logic.test.js
 * 화면이 아니라 절감액이 틀리면 안 되는 도구다. 매칭·절감액·Lever·확인 필요·집계를 손으로 센 값과 대조한다. */
'use strict';
var S = require('../js/engine.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }

// 발주월 읽기
eq(S.toMonth('2026-08'), '2026-08', 'YYYY-MM');
eq(S.toMonth('2026.8'), '2026-08', '점 구분');
eq(S.toMonth('2026년 8월'), '2026-08', '한글 표기');
eq(S.toMonth(202608), '2026-08', '숫자 202608');
eq(S.toMonth('2026-08-17'), '2026-08', '발주일이면 월만');
eq(S.toMonth(46251), '2026-08', '엑셀 날짜 일련번호');
eq(S.toMonth('2026-13'), null, '없는 달은 거른다');
eq(S.toMonth('8월'), null, '연도 없는 달은 거른다(연도를 지어내지 않는다)');

// 숫자·품번
eq(S.num('12,500원'), 12500, '쉼표·원 표기 단가');
ok(isNaN(S.num('')), '빈 칸은 숫자가 아니다');
eq(S.partKey(' bk-1001 '), 'BK-1001', '품번은 대소문자·공백 무시');
eq(S.partKey(10023), '10023', '숫자로 읽힌 품번도 문자와 같다');
ok(S.partKey('BK-1001') !== S.partKey('BK1001'), '하이픈은 무시하지 않는다(다른 품번일 수 있다)');
eq(S.similar('BK-1061', ['BK1061', 'BK-1062', 'BK-1001']), ['BK1061'], '기호만 다른 품번은 제안한다 · 연번은 제안하지 않는다');

// Lever 표기
eq(S.normLever('VAVE').lever, 'VA/VE', 'VAVE → VA/VE');
eq(S.normLever('va/ve').lever, 'VA/VE', '소문자 va/ve');
eq(S.normLever('원자재').lever, '원자재 연동', '원자재 → 원자재 연동');
eq(S.normLever('임가공비').lever, '가공비 현실화', '임가공비 → 가공비 현실화');
eq(S.normLever('BCC').lever, 'BCC', 'BCC');
eq(S.normLever('국산화(수입대체)').lever, '국산화', '국산화');
eq(S.normLever('물류 통합'), { lever: '기타', unknown: true }, '모르는 표기는 기타 + 알림 표시');
eq(S.normLever('').lever, '', '빈 칸은 빈 값');

// 표 종류 알아보기
eq(S.detectKind([{ 품번: 'A', 품명: 'x', 공급업체: 'y', 발주수량: 1, 발주단가: 2, 발주월: '2026-08' }]), 'orders', '발주 실적 표');
eq(S.detectKind([{ 품번: 'A', 확정단가: 100 }]), 'base', '확정 단가표');
eq(S.detectKind([{ 품번: 'A', 기준단가: 100, 변경후단가: 90, 품의번호: 'P1' }]), 'approvals', '품의서 정보 표');
eq(S.detectKind([{ 이름: '홍길동' }]), null, '품번 없는 표는 고르지 않는다');

// 손으로 센 사례
var raw = {
  orders: [
    { 품번: 'A-1', 품명: '핀', 공급업체: '갑', 발주수량: 100, 발주단가: 900, 발주월: '2026-08' },   // 기존: (1000-900)*100 = 10,000 절감
    { 품번: 'A-1', 품명: '핀', 공급업체: '갑', 발주수량: 50, 발주단가: 1000, 발주월: '2026-09' },   // 기존: 변동 없음
    { 품번: 'A-2', 품명: '판', 공급업체: '을', 발주수량: 10, 발주단가: 2200, 발주월: '2026-08' },   // 기존: (2000-2200)*10 = -2,000 인상
    { 품번: 'N-1', 품명: '새 핀', 공급업체: '갑', 발주수량: 20, 발주단가: 450, 발주월: '2026-09' }, // 신규: 품의 (500-450)*20 = 1,000
    { 품번: 'N-2', 품명: '새 판', 공급업체: '병', 발주수량: 5, 발주단가: 3000, 발주월: '2026-09' },  // 신규·품의 없음 → 확인 필요
    { 품번: 'A-3', 품명: '링', 공급업체: '을', 발주수량: 4, 발주단가: 95, 발주월: '2026-09' },      // 기존·사유 없음: (100-95)*4 = 20 → 미분류
    { 품번: '', 품명: '', 공급업체: '', 발주수량: '', 발주단가: '', 발주월: '' }                     // 빈 줄 — 조용히 넘긴다
  ],
  base: [{ 품번: 'A-1', 확정단가: 1000 }, { 품번: 'A-2', 확정단가: 2000 }, { 품번: 'A-3', 확정단가: 100 }],
  approvals: [
    { 품번: 'A-1', 기준단가: 1000, 변경후단가: 900, '사유 Lever': 'VA/VE', 품의번호: 'P-01' },
    { 품번: 'A-2', 기준단가: 2000, 변경후단가: 2200, '사유 Lever': '원자재 연동', 품의번호: 'P-02' },
    { 품번: 'N-1', 기준단가: 500, 변경후단가: 450, '사유 Lever': '국산화', 품의번호: 'P-03' }
  ]
};
var d = S.normalize(raw);
eq(d.issues, [], '깨끗한 입력은 경고가 없다');
eq(d.orders.length, 6, '빈 줄은 세지 않는다');
var r = S.compute(d);
eq(r.rows.map(function (x) { return x.saving; }), [10000, 0, -2000, 1000, null, 20], '줄별 절감액(손 계산)');
eq(r.rows.map(function (x) { return x.status; }), ['existing', 'existing', 'existing', 'new', 'unmatched', 'existing'], '기존·신규·매칭 안 됨 구분');
eq(r.rows.map(function (x) { return x.kind; }), ['절감', '변동 없음', '인상', '절감', '확인 필요', '절감'], '절감/인상 구분');
eq(r.rows[0].refSrc, 'base', '기존 품번은 연초 단가표 기준');
eq(r.rows[3].refSrc, 'approval', '신규 품번은 품의서 기준');
eq(r.rows.map(function (x) { return x.lever; }), ['VA/VE', '변동 없음', '원자재 연동', '국산화', '', '미분류'], 'Lever 는 품의서에서 가져온다');
var t = S.totals(r);
eq([t.saving, t.increase, t.net], [11020, 2000, 9020], '전체 절감 11,020 · 인상 2,000 · 순 9,020');
eq(t.refAmount, 100000 + 50000 + 20000 + 10000 + 400, '기준 금액 = 기준단가 × 수량 합');
eq(t.rate, Math.round(9020 / 180400 * 10000) / 100, '절감률 = 순절감 ÷ 기준 금액');
eq([t.unmatchedLines, t.unmatchedAmount], [1, 15000], '매칭 안 된 줄은 집계에서 빼고 따로 센다');
eq(r.checks.map(function (c) { return c.part + ':' + c.reason; }), ['N-2:no-ref', 'A-3:no-lever'], '확인 필요 목록');
var bm = S.aggregate(r, 'month');
eq(bm.map(function (g) { return [g.key, g.net]; }), [['2026-08', 8000], ['2026-09', 1020]], '월별 순절감');
var bl = S.aggregate(r, 'lever');
eq(bl.map(function (g) { return g.key; }), ['원자재 연동', 'VA/VE', '국산화', '미분류', '변동 없음'], 'Lever 순서는 정해진 순서');
eq(bl[0].increase, 2000, '원자재 연동 인상 2,000');
var bv = S.aggregate(r, 'vendor');
eq(bv.map(function (g) { return [g.key, g.net]; }), [['갑', 11000], ['을', -1980]], '업체별 순절감(큰 순)');
eq(S.totals(r, '2026-09').net, 1020, '월 거르기');
eq(S.aggregate(r, 'part')[0].label, 'A-1 핀', '품번별 묶음 이름');

// 화면 입력으로 신규 품번 매칭 — 확인 필요가 풀리고 실적에 들어간다
var m = S.manualApproval({ part: 'n-2', basePrice: '3,200', newPrice: 3000, lever: 'BCC', docNo: 'P-09' });
ok(m.approval && m.approval.src === 'manual', '화면 입력 검증 통과');
var r2 = S.compute(d, [m.approval]);
eq(r2.rows[4].saving, 1000, '화면 입력 기준단가로 (3200-3000)*5 = 1,000');
eq(r2.rows[4].refSrc, 'manual', '기준 출처가 화면 입력으로 남는다');
eq(r2.checks.map(function (c) { return c.part; }), ['A-3'], '매칭되면 확인 필요에서 빠진다');
ok(!!S.manualApproval({ part: 'X', basePrice: '' }).error, '기준단가 없는 입력은 막는다');
// 같은 품번이면 화면 입력이 표보다 이긴다
var over = S.compute(d, [S.manualApproval({ part: 'N-1', basePrice: 480, lever: '국산화' }).approval]);
eq(over.rows[3].saving, 600, '화면 입력이 표의 품의보다 우선 (480-450)*20');

// 품의 변경후단가와 실제 발주단가가 다르면 계산은 하되 확인 필요
var mis = S.compute(S.normalize({ orders: [{ 품번: 'N-1', 발주수량: 10, 발주단가: 470, 발주월: '2026-10' }], base: [],
  approvals: [{ 품번: 'N-1', 기준단가: 500, 변경후단가: 450, 사유: '국산화' }] }));
eq([mis.rows[0].saving, mis.checks[0].reason], [300, 'ap-mismatch'], '품의 단가 불일치 알림');

// 틀린 입력은 버리지 않고 알린다
var bad = S.normalize({
  orders: [{ 품번: 'A', 발주수량: 'x', 발주단가: 10, 발주월: '2026-08' }, { 품번: 'B', 발주수량: 3, 발주단가: 10, 발주월: '8월' }],
  base: [{ 품번: 'A', 확정단가: 10 }, { 품번: 'A', 확정단가: 12 }],
  approvals: [{ 품번: 'C', 기준단가: 5, 사유: '물류 통합' }]
});
eq(bad.issues.length, 4, '수량·발주월·중복 단가·모르는 Lever 4건');
ok(/먼저 나온 10원/.test(bad.issues.join('|')), '중복 단가는 먼저 나온 값을 쓴다고 알린다');
// 열 이름이 달라도 읽는다
var alt = S.normalize({ orders: [{ 자재코드: 'Z', 업체: 'q', 수량: '1,000', 단가: '5', 발주일: '2026-08-03' }], base: [{ 자재코드: 'Z', 연초단가: 6 }] });
eq(S.compute(alt).rows[0].saving, 1000, '별칭 열 이름으로도 (6-5)*1000');

// 요약 문장과 AI 글에는 숫자가 계산값 그대로 들어간다
ok(/9,020원/.test(S.narrative(r).join(' ')), '요약 문장에 순절감');
ok(/순절감 9,020원/.test(S.aiPrompt(r)) && !/A-1/.test(S.aiPrompt(r)), 'AI 글은 합계만 — 품번은 보내지 않는다');
eq(S.won(-1234567), '-1,234,567원', '원 표기');

// 예제 데이터: 60여 품번 3개월, 경고 없음, 확인 필요 세 종류가 다 있어야 시연이 된다
var raw0 = S.sample(), smp = S.normalize(raw0), rs = S.compute(smp);
var parts = {}; raw0.orders.forEach(function (o) { parts[o.품번] = 1; });
ok(Object.keys(parts).length >= 60, '예제 품번 60개 이상', Object.keys(parts).length);
eq(rs.months, ['2026-08', '2026-09', '2026-10'], '예제 3개월');
eq(smp.issues, [], '예제 경고 없음');
var reasons = {}; rs.checks.forEach(function (c) { reasons[c.reason] = 1; });
eq(Object.keys(reasons).sort(), ['ap-mismatch', 'no-lever', 'no-ref'], '예제에 확인 필요 세 종류');
ok(rs.checks.some(function (c) { return c.suggest && c.suggest.length; }), '예제에 비슷한 품번 제안이 있다');
var st = S.totals(rs);
ok(st.saving > 0 && st.increase > 0, '예제에 절감과 인상이 함께 있다');
eq(st.net, S.aggregate(rs, 'month').reduce(function (a, g) { return Math.round((a + g.net) * 100) / 100; }, 0), '월별 합 = 전체 순절감');
eq(st.net, S.aggregate(rs, 'lever').reduce(function (a, g) { return Math.round((a + g.net) * 100) / 100; }, 0), 'Lever별 합 = 전체 순절감');


/* ===================== v1.1 — 상세 기획안 방식(js/budget.js) ===================== */
var B = require('../js/budget.js');
var XLSX = require('../lib/xlsx.full.min.js');

// 코드·품번·통화 정규화
eq(B.codeKey(' 001001 '), '001001', '협력사 코드: 앞뒤 공백 제거, 선행 0 유지');
eq(B.codeKey(1003), '1003', '숫자로 읽힌 코드도 글자 코드와 같다');
eq(B.codeKey('１００３'), '1003', '전각 숫자는 반각으로');
ok(B.codeKey('001001') !== B.codeKey('1001'), '선행 0 을 지우지 않는다 — 001001 ≠ 1001');
eq(B.codeKey('v2001'), 'V2001', '코드 대소문자 통일');
eq(B.partKey(' BK-2003 '), 'BK-2003', '품번: 공백만 지운다');
ok(B.partKey('BK-2003') !== B.partKey('BK2003'), '품번의 하이픈은 손대지 않는다');
eq(B.partKey(10023), '10023', '숫자로 읽힌 품번도 글자와 같다');
ok(B.isZnb('znb ') && !B.isZnb('ZNB2') && !B.isZnb(''), '발주유형 ZNB 판정(공백·소문자 허용, 다른 유형·빈 칸 제외)');
eq(B.roundInt(0.5), 1, '반올림 0.5 → 1'); eq(B.roundInt(-0.5), -1, '반올림 -0.5 → -1(엑셀 ROUND 와 같게)'); eq(B.roundInt(2.4999), 2, '2.4999 → 2'); eq(B.roundInt(-0.2), 0, '-0 은 0');

// 열 짝짓기
var mo = B.mapColumns(['PO No', 'Order Type', 'Vendor', 'Vendor Name', 'Material', 'Description', 'Curr', 'Net Price', 'Qty', 'Item Cat', 'Assembly', 'Material Cost'], 'orders');
eq(mo.missing, [], '영문 머리글도 전부 짝짓는다');
eq([mo.map.vcode, mo.map.vname, mo.map.mat], ['Vendor', 'Vendor Name', 'Material Cost'], '협력사 코드·이름·자재비가 제 짝으로');
var mk = B.mapColumns(['구매오더', '발주유형', '협력사 코드', '협력사 이름', '자재품번', '자재품명', '통화', '구매단가', '발주수량', '품목범주', '조립비', '자재비'], 'orders');
eq(mk.missing, [], '기획안 열 이름 12개 전부');
eq(B.mapColumns(['자재품번', '수량', '이상한열'], 'orders').missing, ['po', 'type', 'vcode', 'cur', 'cat'], '못 찾은 필수 열을 알려 준다(화면에서 고른다)');
eq(B.mapColumns(['협력업체 코드', '협력업체명', '담당자'], 'vendors').missing, [], '담당자 표');
eq(B.mapColumns(['자재품번', '예산단가', 'NOTE'], 'budget').map.note, 'NOTE', '예산 단가 표의 NOTE');
eq(B.detectKind(['구매오더', '발주유형', '협력사 코드', '자재품번', '통화', '발주수량', '품목범주']), 'orders', '머리글로 발주 실적 판별');
eq(B.detectKind(['협력업체 코드', '협력업체명', '담당자']), 'vendors', '협력업체 담당자 판별');
eq(B.detectKind(['자재품번', '예산단가', 'NOTE']), 'budget', '예산 단가 판별');
eq(B.detectKind(['이름', '전화']), null, '모르는 표');

// 구매단가 결정·환율
eq(B.decidePrice({ cat: '0', price: '1,200', mat: 7, asm: 5 }).price, 1200, '품목범주 0 → 구매단가 열 그대로(자재비는 쓰지 않는다)');
eq(B.decidePrice({ cat: 0, origPrice: 300, price: 1, mat: 7, asm: 5 }).price, 300, '행으로 읽은 뒤에는 원본 구매단가(origPrice)');
eq(B.decidePrice({ cat: 3, price: 99, mat: 1200, asm: 5 }).price, 5, '품목범주 3 → 조립비(구매단가 열과 달라도)');
eq(B.decidePrice({ cat: 1, mat: 1200, asm: 5 }).price, null, '그 밖 범주는 정하지 않는다');
eq([B.decidePrice({ cat: 0, price: '', mat: 900, asm: 5 }).src, B.decidePrice({ cat: 0, price: '', mat: 900, asm: 5 }).price], ['price', null], '품목범주 0 인데 구매단가가 비면 보류 — 자재비로 채우지 않는다');
var fx = B.normFx(B.DEFAULT_FX), fxm = {}; fx.list.forEach(function (f) { fxm[f.cur] = f.rate; });
eq(fx.list.length, 5, '기본 환율 5종');
eq(B.fxFor('JYP', fxm), { rate: 9.4, status: 'ok' }, 'JYP 는 9.4');
eq(B.fxFor('JPY', fxm).status, 'similar', 'JPY 는 바꾸지 않고 확인 대상');
eq(B.fxFor('GBP', fxm).status, 'undefined', '정의 없는 통화');
eq(B.fxFor('usd ', fxm).rate, 1350, '통화 대소문자·공백');
ok(B.normFx([{ cur: 'KRW', rate: 1 }, { cur: 'USD', rate: 'x' }]).issues.length === 1, '숫자 아닌 환율은 버리고 알린다');

// 손으로 센 사례
var hv = B.readByAlias([
  { '협력업체 코드': '001001', '협력업체명': '가람정밀', '담당자': '김민수' },
  { '협력업체 코드': '1002', '협력업체명': '누리금속', '담당자': '이서연' },
  { '협력업체 코드': 'V9', '협력업체명': '빈담당', '담당자': '' }
], 'vendors');
var hb = B.readByAlias([
  { 자재품번: 'A-1', 예산단가: 1000, NOTE: 'VA/VE' }, { 자재품번: 'A-2', 예산단가: 10.2, NOTE: '' },
  { 자재품번: 'A-3', 예산단가: 100, NOTE: '원자재' }, { 자재품번: 'A-1', 예산단가: 1100, NOTE: '중복' }
], 'budget');
function O(po, type, vcode, part, cur, qty, cat, asm, mat, price) {
  return { 구매오더: po, 발주유형: type, '협력사 코드': vcode, '협력사 이름': '', 자재품번: part, 자재품명: '품', 통화: cur, 구매단가: price == null ? (cat === 0 ? mat : '') : price, 발주수량: qty, 품목범주: cat, 조립비: asm, 자재비: mat };
}
var ho = B.readByAlias([
  O('P1', 'ZNB', '001001', 'A-1', 'KRW', 10, 0, 100, 900, 900),      // 900-1000 = -100 → 인상, -1,000
  O('P2', 'znb ', 1002, ' A-2 ', 'USD', 3, 3, 10.5, 1, 10.5),       // 조립비 10.5-10.2 = 0.3 → 인하, 0.3×3×1350 = 1,215
  O('P3', 'ZNB', '1001', 'A-1', 'KRW', 1, 0, 0, 900),              // 선행 0 없는 코드 → 담당자 미매칭 → 제외
  O('P4', 'ZNB', '001001', 'N-9', 'KRW', 5, 0, 0, 500),            // 예산단가 없음 → 공란 + 비고
  O('P5', 'ZNB', '001001', 'A-1', 'KRW', 1, 1, 0, 900),            // 품목범주 1 → 구매단가 확인 필요
  O('P6', 'ZNB', '001001', 'A-1', 'KRW', 1, 3, '', 900),           // 조립비 공란 → 구매단가 확인 필요
  O('P7', 'ZNB', '1002', 'A-3', 'JPY', 7, 0, 0, 100.01),           // 0.01 인하지만 JPY → Impact 없음
  O('P8', 'ZNB', '1002', 'A-3', 'GBP', 1, 0, 0, 100),              // 동결, 환율 없음
  O('P9', 'ZNB', '001001', 'A-1', 'KRW', '', 0, 0, 1000),          // 수량 없음 → 기타 오류, 동결
  O('P10', 'ZST', '001001', 'A-1', 'KRW', 1, 0, 0, 1000),          // 제외
  O('P11', '', '001001', 'A-1', 'KRW', 1, 0, 0, 1000),             // 유형 없음 → 제외
  O('P12', 'ZNB', '001001', 'A-3', 'JYP', 7, 0, 0, 100.01),        // 0.01×7×9.4 = 0.658 → 1
  O('P13', 'ZNB', '001001', 'A-1', 'KRW', 10, 0, 0, 1000),         // 동결, Impact 0, 비고 없음
  O('P14', 'ZNB', '001001', 'A-1', 'KRW', 1, 0, 0, 999.5),         // -0.5 → Impact -1
  O('P15', 'ZNB', '001001', 'A-1', 'KRW', 1, 0, 0, 1000.4),        // 0.4 → Impact 0 이지만 실적은 인하(부호는 차이금액)
  { 구매오더: '', 발주유형: '', '협력사 코드': '', 자재품번: '', 발주수량: '' }                      // 빈 줄
], 'orders');
var R = B.run({ orders: ho, vendors: hv, budget: hb }, {});
eq(R.summary.total, 15, '빈 줄은 세지 않는다 — 전체 15건');
eq([R.summary.znb, R.summary.nonZnb], [13, 2], 'ZNB 13 · 제외 2');
eq(R.excluded.map(function (r) { return r.po; }), ['P10', 'P11'], 'ZNB 아닌 행(유형 없음 포함)은 제외 시트');
eq(R.ownerUnmatched.map(function (r) { return r.po; }), ['P3'], '선행 0 없는 코드는 담당자 미매칭');
eq(R.rows.length + R.ownerUnmatched.length, R.summary.znb, 'ZNB 행 수 = 실적 시트 + 오류(담당자 미매칭) — 누락·중복 없음');
eq(R.rows.map(function (r) { return r.po; }), ['P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P12', 'P13', 'P14', 'P15'], '구매오더 단위 순서 유지');
eq(R.rows[1].owner, '이서연', '숫자로 읽힌 코드 1002 도 담당자를 찾는다');
eq(R.rows[1].vname, '누리금속', '협력사 이름이 비면 담당자 표의 이름을 쓴다');
eq(R.rows.map(function (r) { return r.diff; }), [-100, 0.3, null, null, null, 0.01, 0, 0, 0.01, 0, -0.5, 0.4], '차이금액 = 구매단가 − 예산단가');
eq(R.rows.map(function (r) { return r.result; }), ['인상', '인하', '', '', '', '인하', '동결', '동결', '인하', '동결', '인상', '인하'], '실적은 차이금액 부호로(양수 인하 · 음수 인상 · 0 동결)');
eq(R.rows.map(function (r) { return r.impact; }), [-1000, 1215, null, null, null, null, null, null, 1, 0, -1, 0], 'Impact = 차이금액 × 수량 × 환율, 정수 반올림');
eq([R.rows[0].price, R.rows[0].priceSrc], [900, 'price'], '품목범주 0 → 구매단가 열 그대로');
eq(R.rows[1].price, 10.5, '품목범주 3 → 조립비가 구매단가');
eq(R.rows.map(function (r) { return r.note; }), ['', '', '예산단가 미매칭 - 수작업 입력 필요', '구매단가 확인 필요', '구매단가 확인 필요', '환율 확인 필요', '환율 확인 필요', '기타 데이터 오류', '', '', '', ''], '비고는 정해진 문구만, 정상은 공란');
ok(/JYP 와 글자가 비슷/.test(R.rows[5].details[0]), 'JPY 는 확인 대상이라고 상세에 적는다');
eq(R.rows.map(function (r) { return r.lever; }), ['VA/VE', '', '', 'VA/VE', 'VA/VE', '원자재', '원자재', 'VA/VE', '원자재', 'VA/VE', 'VA/VE', 'VA/VE'], 'Lever = 예산 단가 NOTE 그대로');
var S1 = R.summary;
eq([S1.down, S1.up, S1.flat], [4, 2, 3], '인하 4 · 인상 2 · 동결 3');
eq([S1.downImpact, S1.upImpact, S1.impactTotal], [1216, -1001, 215], 'Impact 합계');
eq([S1.budgetMatched, S1.budgetUnmatched, S1.manualNeeded], [11, 1, 1], '예산단가 매칭 11 · 미매칭 1');
eq([S1.priceCheck, S1.fxCheck, S1.otherErr, S1.noImpact], [2, 2, 1, 6], '구매단가 확인 2 · 환율 확인 2 · 기타 1 · Impact 없음 6');
eq(R.verify.map(function (v) { return v.ok; }), [true, true, true, true, true, true], '정합성 검증 6항목 일치');
eq(R.errors.length, 7, '오류 내역 7건(담당자 1 · 예산 1 · 구매단가 2 · 환율 2 · 기타 1)');
eq(R.errors[0].inSheet, false, '담당자 미매칭은 실적 시트에서 제외라고 표시');
ok(R.issues.length === 2 && /먼저 나온 1000/.test(R.issues[1]) && /담당자가 비어/.test(R.issues[0]), '중복 예산단가·빈 담당자 경고');
var bo = B.groupBy(R.rows, 'owner');
eq(bo.map(function (g) { return [g.label, g.lines, g.impact]; }), [['이서연', 3, 1215], ['김민수', 9, -1000]], '담당자별 집계');
eq(B.groupBy(R.rows, 'vendor')[0].label, '누리금속 (1002)', '협력사별 묶음 이름');

// 화면에서 넣은 예산단가 — 파일에 없을 때만 쓰고, 파일 값을 덮지 않으며, 재처리해도 남는다
var manual = { 'N-9': { part: 'N-9', price: '400' }, 'A-1': { part: 'A-1', price: 5 } };
var snap = JSON.stringify(manual);
var R2 = B.run({ orders: ho, vendors: hv, budget: hb }, { manual: manual });
eq([R2.rows[2].bprice, R2.rows[2].bpriceSrc, R2.rows[2].diff, R2.rows[2].result, R2.rows[2].impact, R2.rows[2].note], [400, 'manual', 100, '인하', 500, ''], '화면 입력 예산단가로 계산 (500-400)×5');
eq(R2.rows[0].bprice, 1000, '파일에 있는 품번은 화면 입력으로 덮지 않는다');
eq([R2.summary.manualFilled, R2.summary.manualNeeded, R2.summary.budgetUnmatched], [1, 0, 1], '수작업 입력으로 채운 1 · 남은 0');
eq(JSON.stringify(manual), snap, '재처리가 화면 입력값을 지우거나 바꾸지 않는다');
var R3 = B.run({ orders: ho, vendors: hv, budget: [] }, { manual: manual });
eq(R3.rows[0].bprice, 5, '예산 파일을 바꿔 올려도 화면 입력값은 그대로 쓰인다');

// 환율을 바꾸면 Impact 가 따라온다
var R4 = B.run({ orders: ho, vendors: hv, budget: hb }, { fx: [{ cur: 'KRW', rate: 1 }, { cur: 'USD', rate: 1000 }, { cur: 'JYP', rate: 9.4 }] });
eq(R4.rows[1].impact, 900, '환율 1,000 으로 바꾸면 0.3×3×1000');
eq(R4.rows[0].impact, -1000, 'KRW 는 그대로');

// 엑셀 — 열 순서·이름 고정, 수식, 제외·포함, 숫자 형식
var wb = B.buildWorkbook(R, XLSX, { date: '2026-11-03' }), ws = wb.Sheets['구매절감 실적'];
eq(wb.SheetNames, ['구매절감 실적', '집계 및 검증', '제외(비ZNB)', '오류 내역', '환율', '안내'], '시트 구성');
eq(XLSX.utils.sheet_to_json(ws, { header: 1 })[0], B.COLS, '실적 시트 머리글 = 기획안 열 순서');
eq(B.COLS, ['구매오더', '발주유형', '협력사', '협력사 이름', '자재품번', '자재품명', '통화', '구매단가', '발주수량', '품목범주', '조립비', '자재비', '담당자', '예산단가', '차이금액', 'Impact', '실적', 'Lever', '비고'], '열 19개 이름·순서');
var col = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1).map(function (r) { return r[0]; });
eq(col, ['P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P12', 'P13', 'P14', 'P15'], '실적 시트: 담당자 미매칭 빠지고 예산단가 미매칭은 들어간다');
ok(ws.O2 && /H2-N2/.test(ws.O2.f), '차이금액 수식 = 구매단가 − 예산단가');
ok(ws.P2 && /VLOOKUP\(G2,환율!/.test(ws.P2.f) && /ROUND\(/.test(ws.P2.f), 'Impact 수식은 환율 시트를 찾고 반올림한다');
ok(ws.Q2 && /"인하"/.test(ws.Q2.f) && /"인상"/.test(ws.Q2.f) && /"동결"/.test(ws.Q2.f), '실적 수식');
eq([ws.N4 ? ws.N4.v : '', ws.O4.v, ws.O4.f ? ws.O4.f.slice(0, 2) : '(수식 없음)'], ['', '', 'IF'], '예산단가 미매칭 행(P4)은 예산단가 공란 · 차이금액 수식만(값 공란)');
eq([ws.H2.t, ws.I2.t, ws.N2.t, ws.P2.t, ws.P2.v], ['n', 'n', 'n', 'n', -1000], '금액·수량은 숫자 형식, Impact 캐시값');
ok(ws['!autofilter'] && ws['!autofilter'].ref === 'A1:S13', '필터 범위 머리글+12행');
eq(XLSX.utils.sheet_to_json(wb.Sheets['환율'], { header: 1 }).slice(1).map(function (r) { return r[0]; }), ['KRW', 'USD', 'EUR', 'CNY', 'JYP'], '환율 시트');
eq(XLSX.utils.sheet_to_json(wb.Sheets['제외(비ZNB)']).length, 2, '제외 시트 2행');
eq(XLSX.utils.sheet_to_json(wb.Sheets['오류 내역']).length, 7, '오류 내역 7행');
var sumRows = XLSX.utils.sheet_to_json(wb.Sheets['집계 및 검증'], { header: 1 });
ok(sumRows.some(function (r) { return r[0] === '전체 Impact 합계(원)' && r[1] === 215; }), '집계 시트의 전체 Impact');
ok(sumRows.some(function (r) { return r[0] === '담당자별'; }) && sumRows.some(function (r) { return r[0] === '협력사별'; }), '담당자별·협력사별 표');
// 통장을 실제로 써서 다시 읽어도 수식·값이 남는다
var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), re = XLSX.read(buf, { type: 'buffer' });
ok(re.Sheets['구매절감 실적'].P2.f && re.Sheets['구매절감 실적'].P2.v === -1000, '다시 읽은 파일에도 Impact 수식·값');

// 예제(가짜 데이터): 비고 다섯 가지·제외·세 통화 사례가 다 있어야 시연이 된다
var sm = B.sample();
var si = { orders: B.readByAlias(sm.orders, 'orders'), vendors: B.readByAlias(sm.vendors, 'vendors'), budget: B.readByAlias(sm.budget, 'budget') };
var SR = B.run(si, {});
ok(sm.orders.length >= 40, '예제 발주 40행 이상', sm.orders.length);
var kinds = {}; SR.errors.forEach(function (e) { kinds[e.key] = 1; });
eq(Object.keys(kinds).sort(), ['budget', 'fx', 'other', 'owner', 'price'], '예제에 비고 다섯 가지가 다 나온다');
ok(SR.excluded.length >= 3, '예제에 ZNB 외 유형', SR.excluded.length);
ok(SR.rows.some(function (r) { return r.curKey === 'JPY'; }) && SR.rows.some(function (r) { return r.curKey === 'GBP'; }) && SR.rows.some(function (r) { return r.curKey === 'JYP' && r.impact != null; }), '예제에 JYP(계산)·JPY(확인)·정의 없는 통화');
ok(SR.rows.some(function (r) { return r.type === 'znb'; }), '예제의 「znb 」도 ZNB 로 읽는다(원본 표기는 그대로 남긴다)');
ok(SR.summary.down > 0 && SR.summary.up > 0 && SR.summary.flat > 0, '예제에 인하·인상·동결');
eq(SR.verify.filter(function (v) { return !v.ok; }), [], '예제 정합성 검증 전부 일치');
eq(SR.rows.length + SR.ownerUnmatched.length + SR.excluded.length, SR.summary.total, '예제 행 보존');
ok(SR.rows.some(function (r) { return r.priceDiffers; }), '예제에 구매단가 열과 적용 단가가 다른 행(품목범주 3 — 조립비 우선)');


/* ===================== v1.2 — 품번 느슨한 매칭 · 진단 ===================== */
var B2 = require('../js/budget.js');
eq(B2.looseKey(' 65.27103-7008 '), '65271037008', '느슨한 키: 점·하이픈·공백 무시'); eq(B2.looseKey('abc_12/３'), 'ABC123', '느슨한 키: 밑줄·슬래시·전각·대문자');
eq(B2.digitKey('0501.219.677'), '501219677', '숫자 키: 앞의 0 과 기호 제거'); eq(B2.digitKey(501219677), '501219677', '숫자 키: 숫자 값'); eq(B2.digitKey('AB-12'), '', '숫자 키: 4자리 미만은 없음');
function ord(part, vcode) { return { po: 'PO' + part, type: 'ZNB', vcode: vcode || 'V1', part: part, cur: 'KRW', price: 100, qty: 2, cat: 0, mat: 100 }; }
var vend = [{ vcode: 'V1', vname: '가상', owner: '홍' }];
var bud = [{ part: '65.27103-7008', bprice: 90 }, { part: '0501219677', bprice: 80 }, { part: 'DUP-1', bprice: 70 }, { part: 'DUP1', bprice: 60 }, { part: '77', bprice: 1 }];
var R = B2.run({ orders: [ord('65.27103-7008'), ord('65271037008'), ord(501219677), ord('dup1'), ord('NOPE-9'), ord('77')], vendors: vend, budget: bud }, { fx: [{ cur: 'KRW', rate: 1 }] });
var by = {}; R.rows.forEach(function (r) { by[r.part] = r; });
eq([by['65.27103-7008'].bpriceHow, by['65.27103-7008'].bprice], ['exact', 90], '정확 일치가 먼저');
eq([by['65271037008'].bpriceHow, by['65271037008'].bprice], ['loose', 90], '기호 무시로 맞춤'); ok(/공백·기호 무시로 맞춤/.test(by['65271037008'].details.join(' ')), '느슨한 매칭은 상세에 남긴다');
eq([by['501219677'].bpriceHow, by['501219677'].bprice], ['digit', 80], '앞의 0 무시로 맞춤(숫자로 읽힌 품번)');
eq(by['dup1'].bprice, null, '같은 느슨한 키에 품번이 둘이면 맞추지 않는다'); eq(by['NOPE-9'].bprice, null, '아무 방법으로도 안 맞으면 미매칭');
eq(by['77'].bpriceHow, 'exact', '짧은 품번은 정확 일치만');
eq([R.summary.budgetMatched, R.summary.budgetLoose, R.summary.budgetDigit, R.summary.budgetUnmatched], [4, 1, 1, 2], '집계: 매칭 4(느슨 1 · 숫자 1) · 미매칭 2');
var D = R.diagnosis;
eq([D.exact, D.loose, D.digit, D.none], [2, 1, 1, 2], '진단: 서로 다른 품번 기준 정확 2 · 기호 1 · 0 무시 1 · 안 맞음 2');
eq(D.ordersSample.length, 5, '진단: 발주 품번 예시 5개'); ok(D.ordersShape.n === 6 && D.budgetShape.sym === 2, '진단: 품번 모양(점·하이픈 포함 2)');
var D0 = B2.diagnose([ord('0001234'), ord('0005678')], [{ part: 1234, bprice: 1 }, { part: 5678, bprice: 1 }], null);
eq([D0.exact, D0.digit], [0, 2], '진단: 한쪽만 0 으로 시작'); ok(D0.hints.some(function (h) { return /앞의 0/.test(h); }), '진단 힌트: 앞의 0');
ok(B2.diagnose([ord('A-1')], [], null).hints[0].indexOf('예산 단가 표를 읽지 못했습니다') === 0, '진단 힌트: 예산 표 없음');
ok(B2.diagnose([ord('A-1')], [{ part: 'ZZZ', bprice: 1 }], null).hints.some(function (h) { return /다른 체계/.test(h); }), '진단 힌트: 어떤 방법으로도 안 맞음');
// 예제는 느슨한 매칭 없이 그대로
var S2 = B2.sample(), RS = B2.run(B2.readByAlias ? { orders: B2.readByAlias(S2.orders, 'orders'), vendors: B2.readByAlias(S2.vendors, 'vendors'), budget: B2.readByAlias(S2.budget, 'budget') } : S2, { fx: B2.DEFAULT_FX });
eq([RS.summary.budgetLoose, RS.summary.budgetDigit], [0, 0], '예제 데이터는 느슨한 매칭이 생기지 않는다');

// (v1.2) 실제 파일 머리글(2026-11-04, 값은 없음) — 예산 단가 표에 「발주수량」 열이 있어도 예산 표로 판별
var HB = ['이원화 여부', '정보 레코드', '구매조직', 'Plnt', '구매그룹명', '구매정보범주', '자재품번', '자재내역', '코드', '이름 1', '최종통화', '예산단가', '발주수량', 'NOTE', '구분', '담당자 추가 확인', '이전단가', '비고'];
var HO = ['상태', '구매오더번호', '품목', '자재품번', '자재품명', '발주수량', '협력사', '협력사 이름', '발주 유형', '품목 범주', '통화', '품목범주', '조립비', '자재비', '구매단가'];
var HV = ['업체명', '업체코드', '담당자'];
eq([B2.detectKind(HB), B2.detectKind(HO), B2.detectKind(HV)], ['budget', 'orders', 'vendors'], '실제 파일 머리글 3종 판별(예산 표에 발주수량이 있어도 예산)');
eq(B2.mapColumns(HB, 'budget').missing, [], '실제 예산 파일: 자재품번 · 예산단가 찾음'); eq(B2.mapColumns(HO, 'orders').missing, [], '실제 발주 파일: 필수 열 모두 찾음');
eq(B2.detectKind(['자재품번', '예산단가', '발주수량', '구매오더번호', '발주유형']), 'orders', '오더번호 · 발주유형이 있으면 발주 실적');

console.log('\n통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
