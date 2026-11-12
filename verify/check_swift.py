# -*- coding: utf-8 -*-
"""Swift 源码静态检查：括号平衡 + 关键 API 存在性。
注意先剔除字符串再删注释，否则 "https://" 里的 // 会被误当注释截断整行。
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'YuyueAssistant')
FILES = ['App.swift', 'Guard.swift', 'NativeAPI.swift']

all_src = ''
fail = 0
for fn in FILES:
    s = io.open(os.path.join(BASE, fn), encoding='utf-8').read()
    all_src += s
    # 1) 先把字符串字面量整体替换（Swift 字符串插值 \(...) 内不含裸引号，安全）
    t = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', s)
    # 2) 再删单行注释与文档注释
    t = re.sub(r'//[^\n]*', '', t)
    # 3) 删块注释
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    bal = {'{': t.count('{') - t.count('}'),
           '(': t.count('(') - t.count(')'),
           '[': t.count('[') - t.count(']')}
    print('%-18s lines=%-4d balance=%s' % (fn, len(s.splitlines()), bal))
    if any(v != 0 for v in bal.values()):
        print('  ERROR: 括号不平衡'); fail += 1

print('\n--- 关键 API ---')
KEYS = ['import UIKit', 'import WebKit', 'import Foundation', 'import CryptoKit',
        'WKScriptMessageHandler', 'URLSessionDelegate', 'HMAC<SHA256>',
        'SHA256.hash', 'evaluateJavaScript', 'loadFileURL',
        'UserDefaults', 'FileManager', '@main', 'galleryList',
        'galleryAdd', 'galleryDelete', 'configSet', 'paths()']
for k in KEYS:
    hit = k in all_src
    print('  %s  %s' % ('OK  ' if hit else 'MISS', k))
    if not hit: fail += 1

print('\n--- 桥动作一致性（前端调用 vs Swift 分发）---')
html = io.open(os.path.join(BASE, 'Resources', 'www', 'index.html'), encoding='utf-8').read()
core = io.open(os.path.join(BASE, 'Resources', 'www', 'core.js'), encoding='utf-8').read()
native = io.open(os.path.join(BASE, 'NativeAPI.swift'), encoding='utf-8').read()
js = html + core
used = set(re.findall(r"nativeCall\('([a-zA-Z]+)'", js) + re.findall(r"nc\('([a-zA-Z]+)'", js))
handled = set(re.findall(r'case "([a-zA-Z]+)":', native))
print('  前端调用:', ', '.join(sorted(used)))
missing = sorted(used - handled)
print('  未处理  :', ', '.join(missing) if missing else 'NONE')
if missing: fail += 1

print('\n' + ('SWIFT_CHECK_OK' if not fail else 'SWIFT_CHECK_FAILED (%d)' % fail))
raise SystemExit(1 if fail else 0)
