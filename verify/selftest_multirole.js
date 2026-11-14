/* 本轮新增能力离线自测：每页 5/10 条 + iOS 多角色任务查询 / 代做 + 常用账号
 * 运行：node verify/selftest_multirole.js
 * 不联网：用 mock 原生桥模拟服务端返回。
 */
const fs = require('fs');
const path = require('path');
const YY = require('../YuyueAssistant/Resources/www/core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b),
  'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)); }

const C = { requests: [], peopleResp: null, peopleFailOnce: false, orgResp: null };
YY.setBridge(function (action, payload, id) {
  let out = {};
  if (action === 'http') {
    const url = payload.url;
    C.requests.push({ url: url, method: payload.method, headers: payload.headers,
      body: payload.bodyB64 ? YY.bytesToUtf8(YY.b64ToBytes(payload.bodyB64)) : null });
    let obj;
    if (url.indexOf('/sys/user/appUser') >= 0) {
      if (C.peopleFailOnce) { C.peopleFailOnce = false; obj = { code: -1, msg: '参数不全' }; }
      else obj = C.peopleResp || { code: 0, data: { list: [
        { id: 'U2', trueName: '张三', department: '安保部' },
        { userId: 'U3', userName: '李四', orgName: '工程部' }
      ] } };
    } else if (url.indexOf('/sys/sysorg/list') >= 0) {
      obj = C.orgResp || { code: 0, data: [{ name: '安保部' }, { name: '工程部' }] };
    } else if (url.indexOf('taskList.jhtml') >= 0 || url.indexOf('getTaskList.jhtml') >= 0) {
      obj = { code: 0, data: { content: [], totals: 0, totalPages: 1,
        list: [{ data: [] }], counts: [] } };
    } else if (url.indexOf('downloadTodoTasks') >= 0) {
      obj = { code: 0, data: { checkDeatilList: [{
        id: 'O1', checkItemList: [{ standardDetailList: [{ detail: { id: 'D1' } }] }]
      }] } };
    } else if (url.indexOf('uploadTask') >= 0) {
      obj = { code: 100 };
    } else obj = { code: -1, msg: '未知路径 ' + url };
    out = { ok: true, status: 200,
      bodyB64: YY.bytesToB64(YY.utf8Bytes(JSON.stringify(obj))), error: '' };
  } else if (action === 'guard') {
    out = { ok: true, dl: '/app/equipment/appTask/downloadTodoTasks.jhtml',
            up: '/app/equipment/appTask/uploadTask.jhtml', reason: '' };
  } else out = { ok: false, error: '未 mock 的动作 ' + action };
  setTimeout(() => YY.nativeDone(id, YY.bytesToB64(YY.utf8Bytes(JSON.stringify(out)))), 0);
});

const session = { token: 'TOKEN', trueName: '我', userId: 'U1', resCode: 'R' };
function lastUrl() { return decodeURIComponent(C.requests[C.requests.length - 1].url); }

// ---------------- 1. 每页 5/10 条 ----------------
console.log('\n[1] 分页改成 5 / 10 条');
const rows = [];
for (let i = 0; i < 1037; i++) rows.push({ taskId: 'T' + i, category: 'today' });
let p = YY.paginate(rows, 1, 10);
eq('默认每页 10 条', p.rows.length, 10);
eq('1037 条 / 每页 10 → 104 页', p.pages, 104);
eq('第 2 页首条是 T10', YY.paginate(rows, 2, 10).rows[0].taskId, 'T10');
p = YY.paginate(rows, 1, 5);
eq('每页 5 条', p.rows.length, 5);
eq('1037 条 / 每页 5 → 208 页', p.pages, 208);
const html = fs.readFileSync(path.join(__dirname,
  '../YuyueAssistant/Resources/www/index.html'), 'utf8');
ok('设置页默认选中 10 条', /<option value="10" selected>10 条<\/option>/.test(html));
ok('设置页提供 5 条', /<option value="5">5 条<\/option>/.test(html));
ok('不再有 50/100/200 条选项', !/value="(50|100|200)"/.test(html));
ok('初始 pageSize 为 10', /pageSize:\{today:10,overdue:10\}/.test(html));
ok('旧配置 20/50 收敛到 10', /if\(ps!==5 && ps!==10\) ps=10;/.test(html));
ok('setAllPageSize 默认 10', /var n=Number\(v\)\|\|10;/.test(html));

// ---------------- 2. 责任人参数透传 ----------------
console.log('\n[2] 巡检 / 维保按责任人过滤（对齐 Windows 版）');
(async function () {
  C.requests.length = 0;
  await YY.fetchPage(session, 'inspect', 1);
  ok('留空 = 本人 trueName', lastUrl().indexOf('eiTaskUserName=我') >= 0, lastUrl());
  await YY.fetchPage(session, 'inspect', 1, '张三');
  ok('指定姓名 = 查该责任人', lastUrl().indexOf('eiTaskUserName=张三') >= 0, lastUrl());
  await YY.fetchPage(session, 'inspect', 1, '*');
  ok('* = 不加姓名过滤，取全部', lastUrl().indexOf('eiTaskUserName') < 0, lastUrl());
  await YY.fetchPage(session, 'upkeep', 1, '李四');
  ok('维保走 checkUserName', lastUrl().indexOf('checkUserName=李四') >= 0, lastUrl());
  await YY.fetchPage(session, 'upkeep', 1, '');
  ok('维保留空保持官方口径（不加参数）', lastUrl().indexOf('checkUserName') < 0, lastUrl());
  await YY.fetchPage(session, 'upkeep', 1, '*');
  ok('维保 * 也不加参数', lastUrl().indexOf('checkUserName') < 0, lastUrl());
  C.requests.length = 0;
  await YY.fetchAll(session, 'inspect', null, '张三');
  ok('fetchAll 把 person 透传到每一页', C.requests.every(r =>
    decodeURIComponent(r.url).indexOf('eiTaskUserName=张三') >= 0));
  ok('旧签名 fetchAll(session,typ) 仍可用', !!(await YY.fetchAll(session, 'inspect')));

  // ---------------- 3. 人员检索 ----------------
  console.log('\n[3] 查项目人员（根路径 + 别名归一 + 组织）');
  C.requests.length = 0;
  let pr = await YY.listPeople(session, '张');
  ok('返回 ok', pr.ok === true);
  eq('2 人', pr.people.length, 2);
  eq('trueName/id 归一', [pr.people[0].name, pr.people[0].id, pr.people[0].dept],
    ['张三', 'U2', '安保部']);
  eq('userName/userId 别名', [pr.people[1].name, pr.people[1].id], ['李四', 'U3']);
  ok('组织部门一并返回', pr.depts.indexOf('安保部') >= 0);
  ok('人员接口走主机根路径（非 /yuzhouInterface）',
    C.requests[0].url.indexOf('https://uyo.yuzhousy.com/sys/user/appUser') === 0 &&
    C.requests[0].url.indexOf('/yuzhouInterface') < 0, C.requests[0].url);
  ok('人员接口为 GET', C.requests[0].method === 'GET');
  ok('带关键词 information 与 resCode',
    C.requests[0].url.indexOf('information=%E5%BC%A0') >= 0 &&
    C.requests[0].url.indexOf('resCode=R') >= 0);
  C.requests.length = 0; C.peopleFailOnce = true;
  pr = await YY.listPeople(session, '*');
  ok('第一组参数失败会自动换第二组', pr.ok === true && C.requests.length >= 2);
  ok('* 当作空关键词', C.requests[0].url.indexOf('information=') >= 0);
  C.peopleResp = { code: 0, data: [] };
  pr = await YY.listPeople(session, '不存在');
  ok('查不到时给可读提示而不是抛异常', pr.ok === false && !!pr.error && pr.people.length === 0);
  C.peopleResp = null;

  // ---------------- 4. 代做身份 ----------------
  console.log('\n[4] 代做：点位 / 水印写被代做人');
  const dl = { checkDeatilList: [{ id: 'O1', checkItemList: [
    { standardDetailList: [{ detail: { id: 'D1', checkTime: 'x' } }] }] }] };
  const asUser = { userId: 'U2', trueName: '张三' };
  const own = YY.buildCheckDetail(dl, session, '2026-11-14 09:00:00');
  eq('不传 asUser = 当前登录账号', [own[0].checkUser, own[0].checkUserName], ['U1', '我']);
  const cdl = YY.buildCheckDetail(dl, session, '2026-11-14 09:00:00', asUser);
  eq('点位写被代做人', [cdl[0].checkUser, cdl[0].checkUserName], ['U2', '张三']);
  eq('检查项明细同步',
    cdl[0].checkItemList[0].standardDetailList[0].detail.checkUser, 'U2');
  C.requests.length = 0;
  const res = await YY.submitOne(session, 'inspect', 'TASK1',
    '2026-11-14 09:00:00', [], 1, asUser);
  ok('提交链路正常', res.ok === true);
  const up = C.requests.find(r => r.url.indexOf('uploadTask') >= 0);
  ok('上传的 checkDeatilList 里带被代做人',
    up.body.indexOf('"checkUserName":"张三"') >= 0 && up.body.indexOf('"checkUser":"U2"') >= 0);

  // ---------------- 5. UI 契约 ----------------
  console.log('\n[5] 界面元素与调用契约');
  for (const [re, desc] of [
    [/id="person_'\+scope\+'"/, '任务页有责任人输入框'],
    [/function findPeople\(scope\)/, '有查人员入口'],
    [/function pickPerson\(i\)/, '人员列表可选定'],
    [/id="peopleMask"/, '有责任人选择浮层'],
    [/id="submitAs"/, '设置页有提交身份下拉'],
    [/function setPerson\(scope,v,autoFetch\)/, '有全部 / 本人快捷切换'],
    [/\+'\|'\+S\.person\+'\|'\+YY\.todayStr\(\)/, '缓存键按责任人隔离'],
    [/\},S\.person\)\.then/, '扫描时把责任人传给 fetchAll'],
    [/YY\.submitOne\(S\.session,\$\('typ_'\+scope\)\.value,r\.taskId,when,photos,per,asUser\)/,
      '提交时把代做身份传给 submitOne'],
    [/preparePhotos\(when,r,wmName\)/, '水印姓名跟随代做人'],
    [/id="acctSel"/, '登录页有常用账号下拉'],
    [/function saveAcct\(\)/, '可保存常用账号'],
    [/esc\(personLabel\(\)\)/, '列表显示当前责任人'],
    [/责任人 '\+esc\(r\.liable\)/, '任务行显示实际责任人']
  ]) ok(desc, re.test(html), String(re));

  console.log('\n==============================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('==============================');
  if (fail) process.exit(1);
})().catch(e => { console.error('自测异常：', e); process.exit(1); });
