# -*- coding: utf-8 -*-
"""前端静态检查：事件引用的函数是否都已定义、$(id) 引用是否有对应元素。"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'YuyueAssistant', 'Resources', 'www', 'index.html')
h = io.open(HTML, encoding='utf-8').read()
js = '\n'.join(re.findall(r'<script>(.*?)</script>', h, re.S))

defined = set(re.findall(r'function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(', js))
defined |= set(re.findall(r'(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*function', js))

def calls_in(attr):
    # 只收全局函数调用，排除 obj.method() 这类成员调用
    return set(re.findall(r'(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(', attr))

called = set()
for attr in re.findall(r'on(?:click|change|input|keydown)="([^"]*)"', h):
    called |= calls_in(attr)
# 动态拼出来的 HTML 里也有 onclick（用转义单引号）
for attr in re.findall(r"on(?:click|change|input)=\\?'([^']*?)\\?'", js):
    called |= calls_in(attr)

builtin = {'if', 'for', 'while', 'switch', 'return', 'typeof', 'parseInt', 'Number',
           'String', 'Array', 'JSON', 'Math', 'Object', 'confirm', 'alert', 'setTimeout',
           'setInterval', 'clearInterval', 'encodeURIComponent', 'decodeURIComponent',
           'escape', 'unescape', 'parseFloat', 'Boolean', 'Date', 'RegExp', 'Set',
           'Map', 'Promise', 'isNaN', 'event', 'from'}
missing = sorted(c for c in called if c not in defined and c not in builtin)

ids = set(re.findall(r'id="([^"]+)"', h))
refs = set(re.findall(r"\$\('([^']+)'\)", js))
# 动态拼接的 id 前缀（如 'bar_'+scope）
dynamic = set(re.findall(r"id=\\?'([A-Za-z_]+)_", js))
static_refs = {r for r in refs if not any(r.startswith(d) for d in dynamic)}
missing_ids = sorted(r for r in static_refs if r not in ids)

print('已定义函数 : %d' % len(defined))
print('事件调用函数: %d' % len(called))
print('未定义函数 : %s' % (', '.join(missing) if missing else 'NONE'))
print('静态 $(id) 引用: %d / 已声明 id: %d' % (len(static_refs), len(ids)))
print('缺失 id   : %s' % (', '.join(missing_ids) if missing_ids else 'NONE'))
print('core.js 引用: %s' % ('<script src="core.js">' in h))
print('桥注册     : %s' % ('messageHandlers.yy' in js))
print('UI 页签    : %s' % ', '.join(re.findall(r'data-p="([^"]+)"', h)))

fail = 0
if missing:
    print('ERROR: 存在未定义的事件处理函数'); fail += 1
if missing_ids:
    print('ERROR: 存在取不到的元素 id'); fail += 1
if 'data-p="today"' not in h or 'data-p="overdue"' not in h or 'data-p="gallery"' not in h:
    print('ERROR: 缺少必要页签'); fail += 1
if fail:
    raise SystemExit(1)
print('UI_CHECK_OK')
