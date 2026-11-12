/* 验证 Guard.swift 里移植的常量与算法逐字节等价于 Windows 版 guard.py。
 * 直接从 Guard.swift 源码中抽取常量，独立复刻 HMAC-SHA256 + keystream XOR，
 * 断言解出的两个提交路径与已校验通过的真实值一致。
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../YuyueAssistant/Guard.swift'), 'utf8');
function grab(re, label) {
  const m = re.exec(SRC);
  if (!m) throw new Error('源码里找不到 ' + label);
  return m[1];
}
const EXPECT = grab(/private let expect = "([0-9a-f]{64})"/, 'expect');
const PEPPER_A = grab(/private let pepperA = Data\("([^"]+)"\.utf8\)/, 'pepperA');
const PEPPER_B = grab(/private let pepperB = Data\("([^"]+)"\.utf8\)/, 'pepperB');
const SEALED_B64 = grab(/private let sealedB64 = "([^"]+)"/, 'sealedB64');
const URL_PIECES = JSON.parse('[' + grab(/private let urlPieces = \[([^\]]+)\]/, 'urlPieces')
  .replace(/,\s*$/, '').split(',').map(s => s.trim()).join(',') + ']');

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x ? ' -> ' + x : '')); } }
function eq(n, a, b) { ok(n, a === b, JSON.stringify(a) + ' != ' + JSON.stringify(b)); }

const sha256 = d => crypto.createHash('sha256').update(d).digest();
const hmac = (k, m) => crypto.createHmac('sha256', k).update(m).digest();
const hex = d => d.toString('hex');
const A = Buffer.from(PEPPER_A, 'utf8');
const B = Buffer.from(PEPPER_B, 'utf8');
const URL = URL_PIECES.join('');

console.log('[1] 常量与 Python 版对照');
eq('pepperA', PEPPER_A, 'YUYUE-INSPECT-GUARD-v1-2026');
eq('pepperB', PEPPER_B, 'YUYUE-RUNTIME-SEAL-v1-2026');
eq('EXPECT', EXPECT, '79f48fa78832abb3eb62fad6092e441e54b028c9966c039c66657f9921368760');
eq('URL', URL, 'https://gitee.com/kk52140/yuyue/raw/master/heartbeat.key');
const sealed = Buffer.from(SEALED_B64, 'base64');
eq('SEALED 长度', sealed.length, 86);
eq('fingerprint', hex(sha256(Buffer.concat([A, Buffer.from(EXPECT, 'ascii'),
  Buffer.from(URL, 'utf8'), B]))), 'ef1625ebbcf1714355ce1d2d465946627c89b60c417ca5dc089e772fd314c9af');

console.log('\n[2] 用真实 heartbeat.key 复刻解密');
// 用 Python 侧已通过的远端密钥（同一时刻读一次，避免在脚本里硬编码密钥）
const { execFileSync } = require('child_process');
let remote = '';
try {
  const py = 'C:/Users/kk521/.workbuddy/binaries/python/envs/default/Scripts/python.exe';
  const appDir = path.join(__dirname, '../../清理超时任务工具');
  remote = execFileSync(py, ['-c',
    'import guard;print(guard._probe()[2] or "")'], { cwd: appDir, encoding: 'utf8' }).trim();
} catch (e) { console.log('  (读取远端密钥失败，跳过在线解密：' + e.message.slice(0, 80) + ')'); }

if (remote) {
  eq('HMAC(pepperA, remote) == EXPECT', hex(hmac(A, Buffer.from(remote, 'utf8'))), EXPECT);

  const fp = hex(sha256(Buffer.concat([A, Buffer.from(EXPECT, 'ascii'),
    Buffer.from(URL, 'utf8'), B])));
  const seal = hmac(B, Buffer.concat([Buffer.from(remote, 'utf8'),
    Buffer.from(EXPECT, 'ascii'), Buffer.from(fp, 'ascii')]));
  // keystream: sha256(seed + byte(c)) 逐块拼接
  let ks = Buffer.alloc(0), c = 0;
  while (ks.length < sealed.length) {
    ks = Buffer.concat([ks, sha256(Buffer.concat([seal, Buffer.from([c])]))]);
    c++;
  }
  const plain = Buffer.alloc(sealed.length);
  for (let i = 0; i < sealed.length; i++) plain[i] = sealed[i] ^ ks[i];
  const text = plain.toString('ascii');
  const parts = text.split('|');
  eq('解出 2 段', parts.length, 2);
  eq('下载路径', parts[0], '/app/equipment/appTask/downloadTodoTasks.jhtml');
  eq('上传路径', parts[1], '/app/equipment/appTask/uploadTask.jhtml');
  ok('两段均以 /app/equipment/appTask/ 开头',
    parts.every(p => p.startsWith('/app/equipment/appTask/')));
  console.log('  解出：' + parts.join('  |  '));
} else {
  console.log('  SKIP  在线解密（无远端密钥）；常量校验已完成');
}

console.log('\n[3] Swift 源码结构检查');
ok('含 HMAC<SHA256>', SRC.indexOf('HMAC<SHA256>') >= 0);
ok('含 SHA256.hash', SRC.indexOf('SHA256.hash') >= 0);
ok('含 keystream XOR', SRC.indexOf('^') >= 0 && SRC.indexOf('keystream') >= 0);
ok('含远端读取容错', SRC.indexOf('readRemoteKey') >= 0);
ok('校验失败返回垃圾路径', SRC.indexOf('junkResult') >= 0);

console.log('\n==============================');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('==============================');
process.exit(fail ? 1 : 0);
