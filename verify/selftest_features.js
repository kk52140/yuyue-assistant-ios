/* 本轮 5 项新增能力的离线自测：任务模板 key / 分页 / 排序组合 / 模板命中
 * 运行： node verify/selftest_features.js
 */
const YY = require('../YuyueAssistant/Resources/www/core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b),
  'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)); }

console.log('=== 任务模板 key（对齐配图工具 app.py task_key）===');
const N1 = '沈阳禹洲广场4季度排烟风机巡检A4_每日_2026-11-06 08:00:00';
const N2 = '沈阳禹洲广场4季度排烟风机巡检A4_每日_2026-11-07 08:00:00';
const K1 = '沈阳禹洲广场4季度排烟风机巡检A4_每日';
eq('真实任务名归一化', YY.taskKey(N1), K1);
eq('跨天同 key', YY.taskKey(N2), YY.taskKey(N1));
eq('与 Python 版期望值一致', YY.taskKey(N1), K1);
eq('去空白', YY.taskKey('  消防水泵 A1 _每日_2026-11-06 08:00  '), '消防水泵A1_每日');
eq('无日期名字保持不变', YY.taskKey('报警主机巡检_每日'), '报警主机巡检_每日');
eq('空名字', YY.taskKey(''), '');
eq('null', YY.taskKey(null), '');
eq('斜杠日期', YY.taskKey('巡检A1_每日_2026/11/6'), '巡检A1_每日');

console.log('=== 分页（1000+ 条不再一次铺一页）===');
const rows = [];
for (let i = 0; i < 1037; i++) {
  rows.push({ taskId: 'T' + i, name: '任务' + i, category: 'today',
    planStart: '2026-11-06 08:00:00' });
}
let p = YY.paginate(rows, 1, 50);
eq('总数 1037', p.total, 1037);
eq('页数 = ceil(1037/50)', p.pages, 21);
eq('首页只给 50 条', p.rows.length, 50);
eq('首页首条', p.rows[0].taskId, 'T0');
eq('首页末条', p.rows[49].taskId, 'T49');
eq('首页 start/end', [p.start, p.end], [0, 50]);
p = YY.paginate(rows, 21, 50);
eq('末页 37 条', p.rows.length, 37);
eq('末页首条', p.rows[0].taskId, 'T1000');
p = YY.paginate(rows, 999, 50);
eq('越界页码钳到末页', p.page, 21);
p = YY.paginate(rows, -5, 50);
eq('负数页码钳到首页', p.page, 1);
p = YY.paginate(rows, 1, 200);
eq('每页 200 → 6 页', p.pages, 6);
p = YY.paginate(rows, 1, 99999);
eq('每页上限钳到 500', p.size, 500);
p = YY.paginate([], 1, 50);
eq('空结果也有 1 页', [p.pages, p.total, p.rows.length], [1, 0, 0]);
ok('分页不改动原数组', rows.length === 1037);

console.log('=== 排序（近期 / 早期切换）===');
const sr = [
  { taskId: 'old', planStart: '2026-10-01 08:00:00' },
  { taskId: 'new', planStart: '2026-11-10 08:00:00' },
  { taskId: 'mid', planStart: '2026-11-01 08:00:00' },
  { taskId: 'nodate', planStart: '' }
];
eq('近期超时优先（日期降序）', YY.sortRows(sr, 'recent').map(x => x.taskId),
  ['new', 'mid', 'old', 'nodate']);
eq('早期超时优先（日期升序）', YY.sortRows(sr, 'oldest').map(x => x.taskId),
  ['old', 'mid', 'new', 'nodate']);
ok('无日期沉底', YY.sortRows(sr, 'recent').slice(-1)[0].taskId === 'nodate');
const mixed = sr.map(x => Object.assign({ category: 'today', name: 'n' }, x));
const filtered = YY.filterRows(mixed, 'today', '');
const sorted = YY.sortRows(filtered, 'recent');
eq('过滤+排序+分页组合：首页 2 条', YY.paginate(sorted, 1, 2).rows.length, 2);
eq('组合后首页是最新两条',
  YY.paginate(sorted, 1, 2).rows.map(x => x.taskId), ['new', 'mid']);

console.log('=== 任务模板命中 ===');
const tpl = {};
tpl[K1] = { name: N1, imgs: ['a.jpg', 'b.jpg'], ts: '2026-11-13 10:00:00' };
eq('按任务名命中（去掉日期）', YY.templateImgs(tpl, N1), ['a.jpg', 'b.jpg']);
eq('隔天同任务名仍命中', YY.templateImgs(tpl, N2), ['a.jpg', 'b.jpg']);
eq('未绑定返回空数组', YY.templateImgs(tpl, '别的任务_每日'), []);
eq('templates 为空不报错', YY.templateImgs({}, N1), []);
eq('templates 为 null 不报错', YY.templateImgs(null, N1), []);
const copy = YY.templateImgs(tpl, N1);
copy.push('c.jpg');
eq('返回副本，不污染源数据', tpl[K1].imgs.length, 2);
eq('imgs 非数组时安全', YY.templateImgs({ [K1]: { imgs: 'bad' } }, N1), []);
ok('模板优先：命中时非空', YY.templateImgs(tpl, N1).length > 0);

console.log('=== 今日 / 逾期严格互斥（回归）===');
const today = '2026-11-13';
eq('今日', YY.categoryOf('2026-11-13 08:00:00', today), 'today');
eq('逾期', YY.categoryOf('2026-11-01 08:00:00', today), 'overdue');
eq('未来', YY.categoryOf('2026-11-20 08:00:00', today), 'future');
const catRows = [
  { taskId: 't', category: YY.categoryOf('2026-11-13 08:00:00', today), name: 'a', planStart: '2026-11-13 08:00:00' },
  { taskId: 'o', category: YY.categoryOf('2026-11-01 08:00:00', today), name: 'b', planStart: '2026-11-01 08:00:00' }
];
eq('今日页不含逾期', YY.filterRows(catRows, 'today', '').map(x => x.taskId), ['t']);
eq('逾期页不含今日', YY.filterRows(catRows, 'overdue', '').map(x => x.taskId), ['o']);

console.log('\n==============================');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('==============================');
if (fail) process.exit(1);
