/* 愉悦助手 iOS 版核心逻辑离线自测
 * 运行：node selftest_core.js
 * 用 mock 原生桥模拟服务端响应，验证登录/分类/点位组装/multipart/提交全链路。
 */
const YY = require('../YuyueAssistant/Resources/www/core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, JSON.stringify(a) + ' != ' + JSON.stringify(b)); }

// ---------------- mock 原生桥 ----------------
const C = { requests: [], guardOK: true, listPages: {}, userinfo: null, uploadResp: null, dlResp: null };
YY.setBridge(function (action, payload, id) {
  let out = {};
  if (action === 'http') {
    const url = payload.url;
    C.requests.push({ url: url, method: payload.method, headers: payload.headers,
      body: payload.bodyB64 ? YY.bytesToUtf8(YY.b64ToBytes(payload.bodyB64)) : null });
    let obj;
    if (url.indexOf('/sys/login') >= 0) {
      const body = JSON.parse(payload.bodyB64 ? YY.bytesToUtf8(YY.b64ToBytes(payload.bodyB64)) : '{}');
      C.loginBody = body;
      obj = { code: 0, token: 'TOKEN123' };
    } else if (url.indexOf('/sys/user/info') >= 0) {
      obj = C.userinfo || { user: { id: 'U1', trueName: '张师傅', resCode: 'RES1', resAreaName: '沈阳禹洲广场' } };
    } else if (url.indexOf('taskList.jhtml') >= 0 || url.indexOf('getTaskList.jhtml') >= 0) {
      const m = /pageNumber=(\d+)/.exec(url);
      obj = (C.listPages && C.listPages[m ? m[1] : '1']) || { code: 0, data: { content: [], totals: 0, totalPages: 1 } };
    } else if (url.indexOf('downloadTodoTasks') >= 0) {
      obj = C.dlResp || { code: 0, data: { checkDeatilList: [] } };
    } else if (url.indexOf('uploadTask') >= 0) {
      obj = C.uploadResp || { code: 100 };
    } else {
      obj = { code: -1, msg: '未知路径 ' + url };
    }
    const bytes = YY.utf8Bytes(JSON.stringify(obj));
    out = { ok: true, status: 200, bodyB64: YY.bytesToB64(bytes), error: '' };
  } else if (action === 'guard') {
    out = C.guardOK
      ? { ok: true, dl: '/app/equipment/appTask/downloadTodoTasks.jhtml',
          up: '/app/equipment/appTask/uploadTask.jhtml', reason: '' }
      : { ok: false, dl: '/x', up: '/x', reason: '校验密钥不匹配' };
  } else {
    out = { ok: false, error: '未 mock 的动作 ' + action };
  }
  const reply = YY.bytesToB64(YY.utf8Bytes(JSON.stringify(out)));
  setTimeout(() => YY.nativeDone(id, reply), 0);
});

// ---------------- 1. 字节/base64 ----------------
console.log('\n[1] 字节与编码（须与 Python b64()=base64(utf8(s)) 一致）');
eq('b64("admin")', YY.b64('admin'), 'YWRtaW4=');
eq('b64(中文)', YY.b64('张师傅'), '5byg5biI5YKF');
eq('b64(时间戳+密码)', YY.b64('202611130008pw123'), Buffer.from('202611130008pw123', 'utf8').toString('base64'));
eq('bytesToUtf8 中文往返', YY.bytesToUtf8(YY.utf8Bytes('沈阳禹洲广场·巡检')), '沈阳禹洲广场·巡检');

// ---------------- 2. 分类严格互斥 ----------------
console.log('\n[2] 今日/逾期严格分类（修掉「今日混入逾期」）');
eq('今天', YY.categoryOf('2026-11-13 08:00:00', '2026-11-13'), 'today');
eq('昨天=逾期', YY.categoryOf('2026-11-12 08:00:00', '2026-11-13'), 'overdue');
eq('去年=逾期', YY.categoryOf('2025-01-01 08:00:00', '2026-11-13'), 'overdue');
eq('明天=未来', YY.categoryOf('2026-11-14 08:00:00', '2026-11-13'), 'future');
eq('空=unknown', YY.categoryOf('', '2026-11-13'), 'unknown');
// 相对今天生成，避免把日期写死后跨天全变「逾期」（2026-11-14 曾因此误报 2 条）
function dayOff(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + YY.pad2(d.getMonth() + 1) + '-' + YY.pad2(d.getDate());
}
const mixed = [
  { taskId: 'T1', taskPTimeStart: dayOff(0) + ' 08:00:00', eiTaskName: '今日A' },
  { taskId: 'T2', taskPTimeStart: dayOff(-3) + ' 08:00:00', eiTaskName: '逾期B' },
  { taskId: 'T3', taskPTimeStart: dayOff(0) + ' 09:00:00', eiTaskName: '今日C' }
];
const nr = mixed.map(r => YY.normalize(r, 'inspect'));
const todayRows = YY.filterRows(nr, 'today', '');
const overdueRows = YY.filterRows(nr, 'overdue', '');
eq('今日只有 2 条', todayRows.length, 2);
eq('逾期只有 1 条', overdueRows.length, 1);
ok('今日集合无逾期', todayRows.every(r => r.category === 'today'));
ok('逾期集合无今日', overdueRows.every(r => r.category === 'overdue'));
ok('两集合交集为空', !todayRows.some(a => overdueRows.some(b => a.taskId === b.taskId)));
eq('normalize 取 taskId', nr[0].taskId, 'T1');
eq('normalize 取名称', nr[1].name, '逾期B');

// ---------------- 3. 分页拉取 ----------------
console.log('\n[3] 全量分页拉取 + 去重');
C.listPages = {
  '1': { code: 0, data: { content: mixed.concat([{ taskId: 'T1', taskPTimeStart: '2026-11-13 08:00:00' }]),
    totals: 4, totalPages: 1 } }
};
const session = { token: 'TOKEN123', trueName: '张师傅', userId: 'U1', resCode: 'RES1' };
YY.fetchAll(session, 'inspect').then(c => {
  eq('去重后 3 条', c.rows.length, 3);
  ok('请求带 token', C.requests.some(r => r.headers.token === 'TOKEN123'));
  ok('请求带 taskState=2', C.requests.some(r => r.url.indexOf('taskState=2') >= 0));

  // ---------------- 4. 登录 ----------------
  console.log('\n[4] 登录流程');
  return YY.login('张师傅', 'pw123');
}).then(s => {
  eq('token', s.token, 'TOKEN123');
  eq('trueName', s.trueName, '张师傅');
  eq('resCode', s.resCode, 'RES1');
  ok('password = b64(时间戳+密码)', /^[A-Za-z0-9+/=]+$/.test(C.loginBody.password));
  ok('username = b64(中文账号)', C.loginBody.username === '5byg5biI5YKF');
  eq('isApp', C.loginBody.isApp, 1);

  // ---------------- 5. 点位组装 ----------------
  console.log('\n[5] buildCheckDetail（全部正常口径）');
  const dl = { code: 0, data: { checkDeatilList: [{
    id: 'O1', checkItemList: [{ standardDetailList: [
      { detail: { id: 'D1', checkTime: 'x' } }, { detail: { id: 'D2' } }
    ] }] }, {
    id: 'O2', checkItemList: [{ standardDetailList: [{ detail: { id: 'D3' } }] }]
  }] } };
  C.dlResp = dl;
  const cdl = YY.buildCheckDetail(dl.data, s, '2026-11-13 10:00:00');
  eq('点位 2 个', cdl.length, 2);
  eq('objectState', cdl[0].objectState, '0');
  eq('checkState=1', cdl[0].checkState, 1);
  eq('checkUserName', cdl[0].checkUserName, '张师傅');
  eq('detail.checkState 字符串 0', cdl[0].checkItemList[0].standardDetailList[0].detail.checkState, '0');
  ok('删除 checkTime（避免 UTC -8h）', cdl[0].checkItemList[0].standardDetailList[0].detail.checkTime === undefined);
  ok('detailPhotoList=null', cdl[0].checkItemList[0].standardDetailList[0].detailPhotoList === null);
  eq('finishTime 按点位错开 37 秒', cdl[1].finishTime, '2026-11-13 10:00:37');
  eq('collectDetailIds', YY.collectDetailIds(cdl).join(','), 'D1,D2,D3');

  // ---------------- 6. multipart ----------------
  console.log('\n[6] multipart 组装');
  const photo = { name: 'a.jpg', data: YY.utf8Bytes('JPEGDATA'), mime: 'image/jpeg' };
  const pp = YY.buildPhotoPayload(cdl, [photo], 1);
  eq('每个检查项 1 张 = 3 个文件', pp.files.length, 3);
  eq('file 字段逗号串', pp.fileField, 'D1_0,D2_0,D3_0');
  eq('hasFile', pp.hasFile, '1');
  const mp = multipartForTest(pp);
  const bodyStr = YY.bytesToUtf8(mp.body);
  ok('含 boundary 起始', bodyStr.indexOf('--' + mp.b) >= 0);
  ok('含 boundary 结束', bodyStr.indexOf('--' + mp.b + '--') > 0);
  ok('含 JPEGDATA 二进制', bodyStr.indexOf('JPEGDATA') > 0);
  ok('Content-Type 正确', /multipart\/form-data; boundary=/.test(mp.ctype));
  eq('无照片时 hasFile=0', YY.buildPhotoPayload(cdl, [], 1).hasFile, '0');

  // ---------------- 7. 提交全链路 ----------------
  console.log('\n[7] 提交全链路（guard → 下载点位 → multipart 上传）');
  C.requests.length = 0;
  const photos = [{ name: 'wm.jpg', data: YY.utf8Bytes('WATERMARKED'), mime: 'image/jpeg' }];
  return YY.submitOne(s, 'inspect', 'TASK001', '2026-11-13 10:00:00', photos, 1);
}).then(res => {
  eq('提交成功', res.ok, true);
  eq('点位数', res.points, 2);
  eq('文件数', res.files, 3);
  const up = C.requests.find(r => r.url.indexOf('uploadTask') >= 0);
  ok('上传路径来自 guard', !!up);
  ok('上传带 token', up.headers.token === 'TOKEN123');
  ok('上传 Content-Type 为 multipart', /multipart\/form-data/.test(up.headers['Content-Type']));
  ok('上传带 hasFile=1', up.body.indexOf('name="hasFile"') >= 0 && up.body.indexOf('1\r\n') >= 0);
  ok('上传带 taskId', up.body.indexOf('name="taskId"') >= 0 && up.body.indexOf('TASK001') >= 0);
  ok('上传带水印图数据', up.body.indexOf('WATERMARKED') >= 0);
  ok('下载点位路径来自 guard', C.requests.some(r => r.url.indexOf('downloadTodoTasks') >= 0));

  // ---------------- 8. 校验失败 ----------------
  console.log('\n[8] 校验未通过时拒绝提交');
  C.guardOK = false;
  return YY.submitOne(session, 'inspect', 'X', YY.nowStr(), [], 1)
    .then(() => ok('应被拒绝', false))
    .catch(e => { ok('拒绝并给出原因', e.message.indexOf('校验未通过') >= 0, e.message); C.guardOK = true; });
}).then(() => {
  // ---------------- 9. 时间与水印 ----------------
  console.log('\n[9] 时间工具');
  eq('addSeconds', YY.addSeconds('2026-11-13 10:00:00', 37), '2026-11-13 10:00:37');
  eq('wmDate 只取日期', YY.wmDate('2026-11-13 10:00:00'), '2026-11-13');
  eq('pad2', YY.pad2(3), '03');
  ok('nowStamp 12 位', /^\d{12}$/.test(YY.nowStamp()));

  // ---------------- 10. 排序 ----------------
  console.log('\n[10] 排序');
  const arr = [
    { planStart: '2026-11-01 08:00:00', taskId: 'A' },
    { planStart: '2026-11-10 08:00:00', taskId: 'B' },
    { planStart: '', taskId: 'C' }
  ];
  eq('近期优先（原实现：planStart 倒序）', YY.sortRows(arr, 'recent')[0].planStart, '2026-11-10 08:00:00');
  eq('早期优先', YY.sortRows(arr, 'oldest')[0].planStart, '2026-11-01 08:00:00');
  eq('缺时间沉底', YY.sortRows(arr, 'recent')[2].taskId, 'C');

  console.log('\n==============================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('==============================');
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.error('自测异常：', e);
  process.exit(1);
});

// 用固定 boundary 复刻 multipart 以便断言
function multipartForTest(pp) {
  const b = '----YYTEST';
  const fields = { resCode: 'RES1', type: 'inspect', checkDeatilList: '[]',
    taskId: 'TASK001', orderList: '[]', file: pp.fileField, hasFile: pp.hasFile, url: 'https://uyo.yuzhousy.com/' };
  const parts = [];
  Object.keys(fields).forEach(k => parts.push(YY.utf8Bytes(
    '--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n')));
  pp.files.forEach(f => {
    parts.push(YY.utf8Bytes('--' + b + '\r\nContent-Disposition: form-data; name="' + f.name +
      '"; filename="' + f.filename + '"\r\nContent-Type: ' + f.mime + '\r\n\r\n'));
    parts.push(f.data); parts.push(YY.utf8Bytes('\r\n'));
  });
  parts.push(YY.utf8Bytes('--' + b + '--\r\n'));
  return { body: YY.concatBytes(parts), ctype: 'multipart/form-data; boundary=' + b, b: b };
}
