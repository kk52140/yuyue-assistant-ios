/* iOS 界面交互闭环自测：把真实的 core.js + index.html 内联 JS 放进 vm 跑，
 * mock DOM 与原生桥，验证「5/10 条分页 + 多角色查询/代做 + 账号下拉」真的点得通。
 * 运行：node verify/selftest_ui_flow.js      全程不联网、不写真机配置。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder, TextDecoder } = require('util');

const WWW = path.join(__dirname, '..', 'YuyueAssistant', 'Resources', 'www');
const CORE = fs.readFileSync(path.join(WWW, 'core.js'), 'utf8');
const HTML = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const mm = /<script>([\s\S]*?)<\/script>/.exec(HTML);
if (!mm) throw new Error('未找到 index.html 内联脚本');
const UI = mm[1];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b),
  'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)); }

function mockEl(id) {
  return { id: id, value: '', checked: false, textContent: '', innerHTML: '',
    className: '', disabled: false, style: {}, files: [],
    classList: { add() {}, remove() {} }, addEventListener() {},
    appendChild() {}, click() {} };
}

function today() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function build() {
  const els = {}, httpCalls = [], cfgWrites = [];
  const doc = {
    getElementById(id) { if (!els[id]) els[id] = mockEl(id); return els[id]; },
    createElement() { return mockEl('created'); },
    querySelectorAll() { return []; }
  };
  const rows = [];
  for (let i = 0; i < 23; i++) {
    rows.push({ taskId: 'T' + i, eiTaskName: '巡检任务' + i,
      taskPTimeStart: today() + ' 08:00:00', eiTaskUser: '张三', calDays: '3天' });
  }
  const cfg = {
    username: 'fantj', password: 'pw123', remember: true,
    page_size: 50,                 // 旧配置，应被收敛到 10
    // loadCfg() 在启动后异步写回这些下拉；必须给「单次即时 + 节奏 0」，
    // 否则界面会走 setInterval 倒计时，而测试桩里 setInterval 是空实现。
    task_mode: 'single', pace_sec: 0, time_mode: 'now', submit_as: 'owner',
    accounts: [{ label: '安保', username: 'sec', password: 'p2' }],
    templates: {}
  };
  let YY;
  const guard = { ok: true, dl: '/app/equipment/appTask/downloadTodoTasks.jhtml',
                  up: '/app/equipment/appTask/uploadTask.jhtml', reason: '' };

  function httpObj(url) {
    if (url.indexOf('taskList.jhtml') >= 0 || url.indexOf('getTaskList.jhtml') >= 0) {
      return { code: 0, data: { content: rows, totals: rows.length, totalPages: 1,
        list: [{ data: [] }], counts: [] } };
    }
    if (url.indexOf('/sys/user/appUser') >= 0) {
      return { code: 0, data: { list: [
        { id: 'U2', trueName: '张三', department: '安保部' },
        { userId: 'U3', userName: '李四', orgName: '工程部' }] } };
    }
    if (url.indexOf('/sys/sysorg/list') >= 0) {
      return { code: 0, data: [{ name: '安保部' }, { name: '工程部' }] };
    }
    if (url.indexOf('downloadTodoTasks') >= 0) {
      return { code: 0, data: { checkDeatilList: [{ id: 'O1', checkItemList: [
        { standardDetailList: [{ detail: { id: 'D1' } }] }] }] } };
    }
    if (url.indexOf('uploadTask') >= 0) return { code: 100 };
    return { code: -1, msg: '未知路径 ' + url };
  }

  function handle(msg) {
    const { id, action, payload } = msg;
    let out;
    if (action === 'http') {
      const body = payload.bodyB64
        ? YY.bytesToUtf8(YY.b64ToBytes(payload.bodyB64)) : null;
      httpCalls.push({ url: payload.url, method: payload.method, body: body });
      out = { ok: true, status: 200, error: '',
        bodyB64: YY.bytesToB64(YY.utf8Bytes(JSON.stringify(httpObj(payload.url)))) };
    } else if (action === 'guard') out = guard;
    else if (action === 'configGet') out = { value: JSON.stringify(cfg) };
    else if (action === 'configSet') {
      cfgWrites.push(payload.value);
      out = { ok: true };
    } else if (action === 'galleryList') out = { ok: true, items: [], hiddenCount: 0 };
    else if (action === 'galleryRead') out = { ok: false };
    else if (action === 'galleryAdd' || action === 'galleryDelete' ||
             action === 'galleryRestore') out = { ok: true };
    else out = { ok: false, error: '未 mock 的动作 ' + action };
    YY.nativeDone(id, YY.bytesToB64(YY.utf8Bytes(JSON.stringify(out))));
  }

  const sandbox = {
    document: doc, console: console,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder, Buffer: Buffer,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout() { return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    parseInt: parseInt, isNaN: isNaN, escape: escape, unescape: unescape
  };
  sandbox.window = sandbox;
  sandbox.webkit = { messageHandlers: { yy: { postMessage: handle } } };
  vm.createContext(sandbox);
  vm.runInContext(CORE, sandbox, { filename: 'core.js' });
  YY = sandbox.YY;
  vm.runInContext(UI, sandbox, { filename: 'index.html:inline' });

  // 任务页下拉的初始值（真页面由 <select> 的 option 提供，vm 里补上）
  doc.getElementById('typ_today').value = 'inspect';
  doc.getElementById('typ_overdue').value = 'inspect';
  doc.getElementById('tmode').value = 'single';
  doc.getElementById('submitAs').value = 'owner';
  return { ctx: sandbox, els: els, YY: YY, httpCalls: httpCalls, cfgWrites: cfgWrites };
}

async function settle(n) {
  for (let i = 0; i < (n || 10); i++) await new Promise(r => setImmediate(r));
}
function taskCount(html) {
  return (String(html).match(/class="task"/g) || []).length;
}
function uploads(b) { return b.httpCalls.filter(c => c.url.indexOf('uploadTask') >= 0); }
function lists(b) { return b.httpCalls.filter(c => c.url.indexOf('taskList.jhtml') >= 0); }

(async function () {
  console.log('\n[1] 启动：旧配置每页 50 条收敛到 10，账号下拉就绪');
  const b = build();
  await settle();
  const S = b.ctx.S;
  eq('每页默认 10 条', S.pageSize.today, 10);
  eq('逾期页同为 10 条', S.pageSize.overdue, 10);
  eq('设置页下拉显示 10', b.els.pageSize.value, '10');
  eq('任务模式为单次即时（避免测试桩的倒计时）', b.els.tmode.value, 'single');
  ok('账号下拉渲染已存账号', b.els.acctSel.innerHTML.indexOf('安保') >= 0);
  eq('启动时停在登录页', b.els.loginScreen.style.display, 'flex');
  S.session = { token: 'T', trueName: '我', userId: 'U1', resCode: 'R',
                username: 'fantj', orgName: '' };

  console.log('\n[2] 责任人「张三」：两页输入框同步、扫描带姓名、缓存按人隔离');
  b.ctx.setPerson('today', '张三', false);
  await settle();
  eq('S.person', S.person, '张三');
  eq('今日页输入框同步', b.els.person_today.value, '张三');
  eq('逾期页输入框同步', b.els.person_overdue.value, '张三');
  ok('责任人写入本机配置', b.cfgWrites.some(v => v && v.indexOf('"person":"张三"') >= 0));
  const key1 = b.ctx.cacheKey('today');
  ok('缓存键带责任人', key1.indexOf('|张三|') >= 0, key1);
  b.ctx.doRefresh('today');
  await settle(16);
  const l1 = lists(b);
  ok('扫描请求带 eiTaskUserName=张三',
    l1.length > 0 && l1[0].url.indexOf('eiTaskUserName=') >= 0 &&
    decodeURIComponent(l1[0].url).indexOf('张三') >= 0, l1[0] && l1[0].url);
  eq('扫描到 23 条', S.cache[key1].rows.length, 23);
  eq('首页只渲染 10 条', taskCount(b.els.list_today.innerHTML), 10);
  eq('pageOf 首页 10 条', b.ctx.pageOf('today').rows.length, 10);
  eq('共 3 页', b.ctx.pageOf('today').pages, 3);
  ok('分页器显示 1 / 3', b.els.pager_today.innerHTML.indexOf('1 / 3') >= 0);
  ok('任务行显示责任人', b.els.list_today.innerHTML.indexOf('责任人 张三') >= 0);
  ok('列表条显示当前责任人', b.els.bar_today.innerHTML.indexOf('责任人：张三') >= 0);

  console.log('\n[3] 切每页 5 条');
  b.els.pageSize.value = '5';
  b.ctx.setAllPageSize('5');
  await settle();
  eq('S.pageSize 变为 5', S.pageSize.today, 5);
  eq('首页只渲染 5 条', taskCount(b.els.list_today.innerHTML), 5);
  eq('共 5 页', b.ctx.pageOf('today').pages, 5);

  console.log('\n[4] 完成选中任务：确认框写明代做对象，提交写被代做人');
  b.ctx.selectPage('today');
  await settle();
  eq('本页选中 5 条', Object.keys(S.selected).length, 5);
  b.ctx.doRun('today');
  ok('确认框含代做责任人',
    b.els.confirmMsg.textContent.indexOf('代做责任人：张三') >= 0,
    b.els.confirmMsg.textContent);
  ok('确认框含提交身份',
    b.els.confirmMsg.textContent.indexOf('提交身份：责任人本人') >= 0);
  b.ctx.confirmOK();
  await settle(40);
  const up1 = uploads(b);
  eq('本页 5 条全部提交', up1.length, 5);
  ok('上传包写被代做人 checkUserName',
    up1[0] && up1[0].body.indexOf('"checkUserName":"张三"') >= 0);
  ok('上传包 checkUser 用责任人 userId 或本人 id',
    up1[0] && up1[0].body.indexOf('"checkUser":"U1"') >= 0);
  eq('批次正常结束', S.running, false);

  console.log('\n[5] 切「按当前登录账号」后不再写被代做人');
  b.els.submitAs.value = 'self';
  b.ctx.selectPage('today');
  await settle();
  b.ctx.doRun('today');
  b.ctx.confirmOK();
  await settle(40);
  const up2 = uploads(b);
  eq('第二批 5 条全部提交', up2.length - up1.length, 5);
  ok('不再出现被代做人姓名',
    up2[up2.length - 1].body.indexOf('"checkUserName":"张三"') < 0);
  ok('改回当前登录账号姓名',
    up2[up2.length - 1].body.indexOf('"checkUserName":"我"') >= 0);

  console.log('\n[6] 「全部责任人」：不带姓名过滤，缓存键独立');
  b.ctx.setPerson('overdue', '*', false);
  await settle();
  eq('S.person 为 *', S.person, '*');
  ok('全部责任人缓存键独立', b.ctx.cacheKey('overdue').indexOf('|*|') >= 0);
  b.httpCalls.length = 0;
  b.ctx.doRefresh('overdue');
  await settle(16);
  const l2 = lists(b);
  ok('* 模式请求不带 eiTaskUserName',
    l2.length > 0 && l2[0].url.indexOf('eiTaskUserName') < 0, l2[0] && l2[0].url);

  console.log('\n[7] 查人员浮层 → 选人自动带出 userId 并拉取');
  b.ctx.findPeople('today');
  await settle(16);
  ok('人员列表渲染', b.els.peopleList.innerHTML.indexOf('张三') >= 0);
  ok('带出组织信息', b.els.peopleInfo.textContent.indexOf('安保部') >= 0);
  b.ctx.pickPerson(0);
  await settle();
  eq('选人后 S.person', S.person, '张三');
  eq('带出 userId', S.personId, 'U2');
  eq('人员浮层关闭', b.els.peopleMask.style.display, 'none');

  console.log('\n[8] 常用账号下拉一键填入');
  b.els.acctSel.value = '0';
  b.ctx.pickAcct();
  eq('用户名填入', b.els.user.value, 'sec');
  eq('密码填入', b.els.pwd.value, 'p2');

  console.log('\n==============================');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('==============================');
  if (fail) process.exit(1);
})().catch(e => { console.error('自测异常：', e); process.exit(1); });
