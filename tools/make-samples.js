/* samples/ 의 예제 엑셀 세 가지를 다시 만든다 — node tools/make-samples.js
 * 전부 엔진 budget.js 의 sample() 이 만든 가짜 데이터다. 실제 사내 데이터를 여기에 넣지 않는다. */
'use strict';
var fs = require('fs'), path = require('path');
var XLSX = require('../lib/xlsx.full.min.js');
var B = require('../js/budget.js');
var OUT = path.join(__dirname, '..', 'samples');
fs.mkdirSync(OUT, { recursive: true });
var s = B.sample();
Object.keys(B.SAMPLE_FILES).forEach(function (kind) {
  var f = B.SAMPLE_FILES[kind], wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s[kind]), f[1]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['예제 데이터는 실제 사내 데이터가 아닙니다.'], ['구매오더·협력사·품번·단가 전부 지어낸 값입니다.']]), '안내');
  fs.writeFileSync(path.join(OUT, f[0]), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log('  ' + f[0] + ' — ' + s[kind].length + '행');
});
