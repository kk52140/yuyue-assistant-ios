/* 愉悦助手 iOS 版 —— 业务逻辑核心层
 * 与 Windows 版 app.py / 配图工具 app.py 口径保持一致。
 * 纯逻辑，可在 Node 下直接加载做离线自测（window.YY / module.exports 双导出）。
 */
(function (root) {
  'use strict';

  var HOST = 'https://uyo.yuzhousy.com';
  var BASE = HOST + '/yuzhouInterface';
  var LOGIN_URL = HOST + '/sys/login';
  var USERINFO_URL = HOST + '/sys/user/info';
  var LIST_INSPECT = '/equipment/inspectTask/taskList.jhtml';
  var LIST_UPKEEP = '/upkeep/task/getTaskList.jhtml';
  var PAGE_SIZE = 50;
  var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15';
  var DEFAULT_URL = HOST + '/';

  var WM_WIDTH = 412, WM_QUALITY = 0.5, WM_SIZE = 11, WM_COLOR = '#CEA048';
  var SESSION_DEAD_HINTS = ['已在其他地方登录', '重新登录', '登录已失效', '登录超时',
    '未登录', 'token失效', 'token 失效', 'token无效', 'token 无效'];

  // ---------------------------------------------------------------- 字节工具

  function utf8Bytes(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(s));
    var esc = encodeURIComponent(String(s)), out = [], i = 0;
    while (i < esc.length) {
      var ch = esc.charAt(i);
      if (ch === '%') { out.push(parseInt(esc.substr(i + 1, 2), 16)); i += 3; }
      else { out.push(ch.charCodeAt(0)); i += 1; }
    }
    return new Uint8Array(out);
  }

  function bytesToUtf8(b) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return decodeURIComponent(escape(s));
  }

  function bytesToB64(b) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < b.length; i += CH) {
      s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + CH, b.length)));
    }
    return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(b).toString('base64');
  }

  function b64ToBytes(s) {
    if (typeof atob !== 'undefined') {
      var bin = atob(s), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  function b64(s) { return bytesToB64(utf8Bytes(s)); }   // Python: base64(s.encode('utf-8'))

  function concatBytes(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  // ---------------------------------------------------------------- 原生桥

  var bridge = null, seq = 0, pending = {};

  function setBridge(b) { bridge = b; }

  function nativeCall(action, payload) {
    return new Promise(function (resolve, reject) {
      if (!bridge) { reject(new Error('原生桥不可用（需在 App 内打开）')); return; }
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      try { bridge(action, payload || {}, id); }
      catch (e) { delete pending[id]; reject(e); }
    });
  }

  // 原生层回调：b64 是 UTF-8 JSON
  function nativeDone(id, b64json) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    try { p.resolve(JSON.parse(bytesToUtf8(b64ToBytes(b64json)))); }
    catch (e) { p.reject(e); }
  }

  // ---------------------------------------------------------------- HTTP

  function headers(token, contentType) {
    return {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
      'Content-Type': contentType || 'application/json',
      'isStaff': '1',
      'token': token || '',
      'User-Agent': UA
    };
  }

  function qs(params) {
    var a = [];
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) {
      a.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return a.join('&');
  }

  function request(method, url, hdrs, bodyBytes, timeout) {
    return nativeCall('http', {
      method: method, url: url, headers: hdrs,
      bodyB64: bodyBytes && bodyBytes.length ? bytesToB64(bodyBytes) : null,
      timeout: timeout || 30
    }).then(function (r) {
      if (!r.ok) throw new Error(r.error || ('HTTP ' + r.status));
      var text = bytesToUtf8(b64ToBytes(r.bodyB64 || ''));
      try { return JSON.parse(text); }
      catch (e) { return { code: -1, msg: '响应非 JSON', _raw: text.slice(0, 300) }; }
    });
  }

  function get(path, params, token) {
    return request('GET', BASE + path + '?' + qs(params), headers(token), null, 30);
  }
  function post(path, body, token, timeout) {
    return request('POST', BASE + path, headers(token), utf8Bytes(JSON.stringify(body)), timeout || 30);
  }

  function deadCheck(r) {
    var code = r && r.code, msg = String((r && (r.msg || r.message)) || '');
    if (code === 401 || code === '401' || SESSION_DEAD_HINTS.some(function (h) { return msg.indexOf(h) >= 0; })) {
      var e = new Error(msg || '登录信息已失效，请重新登录');
      e.sessionExpired = true;
      throw e;
    }
    return r;
  }

  // ---------------------------------------------------------------- 登录

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function nowStamp(d) {
    d = d || new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function nowStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function login(username, password) {
    if (!username || !password) return Promise.reject(new Error('用户名和密码不能为空'));
    var body = {
      username: b64(username), password: b64(nowStamp() + password),
      captcha: '', uuid: '', unionId: '', isApp: 1
    };
    return request('POST', LOGIN_URL, headers(''), utf8Bytes(JSON.stringify(body)), 30)
      .then(function (r) {
        if (r.code !== 0 && r.code !== '0') {
          throw new Error('登录失败：' + (r.msg || r.message || JSON.stringify(r).slice(0, 120)));
        }
        var token = r.token;
        if (!token) throw new Error('登录成功但未返回 token');
        return request('GET', USERINFO_URL + '?' + qs({}), headers(token), null, 30)
          .then(function (ui) {
            var u = ui.user || {};
            if (!u.id) throw new Error('登录成功但取用户资料失败');
            return {
              ok: true, token: token, username: username,
              trueName: u.trueName || username, userId: u.id,
              resCode: u.resCode || '',
              orgName: u.resAreaName || u.department || '',
              department: u.department || ''
            };
          });
      });
  }

  // ---------------------------------------------------------------- 任务

  function planDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  // 严格互斥：today / overdue / future / unknown（修掉「今日混入逾期」）
  function categoryOf(planStart, today) {
    var d = planDay(planStart);
    if (!d) return 'unknown';
    var t = today || todayStr();
    if (d > t) return 'future';
    if (d === t) return 'today';
    return 'overdue';
  }

  function normalize(row, typ) {
    var tid = typ === 'inspect' ? (row.taskId || '')
      : (row.doTaskId || row.taskId || '');
    var plan = typ === 'inspect' ? (row.taskPTimeStart || '') : (row.tPTimeStart || row.taskPTimeStart || '');
    var end = typ === 'inspect' ? (row.taskPTimeEnd || '') : (row.tPTimeEnd || row.taskPTimeEnd || '');
    var d = {
      taskId: tid, name: row.eiTaskName || row.planName || '',
      planName: row.planName || '', planStart: String(plan), planEnd: String(end),
      cycle: row.eiCycleType || '', delay: row.calDays || '',
      eq: row.eqAmount, checked: row.checkEqAmount,
      liable: row.eiTaskUser || row.chekUserName || '',
      photoValue: row.photoValue, state: row.taskState
    };
    d.category = categoryOf(d.planStart);
    return d;
  }

  function fetchPage(session, typ, page) {
    var params = {
      resCode: session.resCode, type: typ, pageSize: PAGE_SIZE,
      pageNumber: page, taskState: 2
    };
    var path = LIST_INSPECT;
    if (typ === 'inspect') params.eiTaskUserName = session.trueName;
    else path = LIST_UPKEEP;

    return get(path, params, session.token).then(function (r) {
      deadCheck(r);
      var d = r.data || {}, rows, total, pages;
      if (typ === 'inspect') {
        rows = d.content || [];
        total = d.totals;
        pages = d.totalPages;
      } else {
        var lst = d.list || [];
        rows = (lst[0] && lst[0].data) || [];
        var c = d.counts || {};
        if (Array.isArray(c) && c.length) c = c[0];
        total = (c && typeof c === 'object') ? c.postponed : null;
        pages = null;
      }
      if (pages == null) pages = Math.max(1, Math.ceil((Number(total) || rows.length) / PAGE_SIZE));
      return { rows: rows.map(function (x) { return normalize(x, typ); }), total: total, pages: pages };
    });
  }

  /** 全量扫描一次，结果交给调用方缓存；按 scope 过滤后返回。 */
  function fetchAll(session, typ, onProgress) {
    var rows = [], page = 1, total = null, pages = null;
    function step() {
      return fetchPage(session, typ, page).then(function (p) {
        rows = rows.concat(p.rows);
        total = p.total; pages = p.pages;
        if (onProgress) onProgress(rows.length, total);
        if (p.rows.length < PAGE_SIZE || (pages && page >= Number(pages)) || page >= 200) {
          var seen = {}, uniq = [];
          rows.forEach(function (r) {
            if (r.taskId && !seen[r.taskId]) { seen[r.taskId] = 1; uniq.push(r); }
          });
          return { rows: uniq, total: total, pages: pages, fetchedAt: nowStr() };
        }
        page += 1;
        return step();
      });
    }
    return step();
  }

  function filterRows(rows, scope, kw) {
    kw = String(kw || '').trim();
    return rows.filter(function (r) {
      if (scope === 'today' && r.category !== 'today') return false;
      if (scope === 'overdue' && r.category !== 'overdue') return false;
      if (kw) {
        var hay = [r.name, r.planStart, r.taskId, r.planName].join(' ');
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  function sortRows(rows, mode) {
    var good = [], bad = [];
    rows.forEach(function (r) { (String(r.planStart || '').trim() ? good : bad).push(r); });
    good.sort(function (a, b) {
      var x = String(a.planStart), y = String(b.planStart);
      var c = x < y ? -1 : (x > y ? 1 : 0);
      return mode === 'oldest' ? c : -c;
    });
    return good.concat(bad);
  }

  // ---------------------------------------------------------------- 提交

  function addSeconds(ts, seconds) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(ts || ''));
    if (!m) return ts;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    d = new Date(d.getTime() + seconds * 1000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function wmDate(ts) {
    var m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String(ts || '').trim());
    if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    return todayStr();
  }

  /** 把下载到的点位明细填成「全部正常」，与 build_check_detail 一致。 */
  function buildCheckDetail(data, session, finishTime) {
    var cdl = (data && data.checkDeatilList) || [];
    var uid = session.userId, uname = session.trueName;
    cdl.forEach(function (obj, oi) {
      obj.objectState = '0'; obj.objectInfo = '';
      obj.totalStandard = true; obj.totalCompleted = true;
      obj.checkState = 1;
      obj.finishTime = addSeconds(finishTime, oi * 37);
      obj.checkUser = uid; obj.checkUserName = uname;
      obj.isOrder = 0; obj.photoList = []; obj.detailPhotoList = null;
      (obj.checkItemList || []).forEach(function (ci) {
        (ci.standardDetailList || []).forEach(function (sd) {
          var d = sd.detail || {};
          d.checkState = '0'; d.checkInfo = '';
          d.isStandard = true; d.isCompleted = true; d.photograph = true;
          delete d.checkTime;
          d.checkUser = uid;
          sd.detailPhotoList = null;
        });
      });
    });
    return cdl;
  }

  function collectDetailIds(cdl) {
    var ids = [], seen = {};
    (cdl || []).forEach(function (obj) {
      (obj.checkItemList || []).forEach(function (ci) {
        (ci.standardDetailList || []).forEach(function (sd) {
          var did = (sd.detail || {}).id;
          if (did != null && !seen[String(did)]) { seen[String(did)] = 1; ids.push(String(did)); }
        });
      });
    });
    return ids;
  }

  /** Canvas 复刻 App 口径：缩到 412 宽 + 右下角姓名/日期水印 + JPEG q50。 */
  function prepPhoto(dataUrl, name, when, ImageCtor, doc) {
    return new Promise(function (resolve) {
      var img = new ImageCtor();
      img.onload = function () {
        try {
          var w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) { resolve(null); return; }
          var W = WM_WIDTH, w = w0, h = h0;
          if (w0 > W) { w = W; h = Math.max(1, Math.round(h0 * W / w0)); }
          var cv = doc.createElement('canvas');
          cv.width = w; cv.height = h;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          var fs = Math.max(9, Math.round(WM_SIZE * w / W));
          ctx.font = fs + 'px sans-serif';
          ctx.fillStyle = WM_COLOR;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'alphabetic';
          var x = Math.round(0.98 * w);
          if (String(name || '').trim()) ctx.fillText(String(name), x, Math.round(0.90 * h));
          ctx.fillText(wmDate(when), x, Math.round(0.95 * h));
          resolve(cv.toDataURL('image/jpeg', WM_QUALITY));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  /** 组 multipart：fields 是普通字段，files 是 {name, filename, data(Uint8Array), mime} */
  function multipart(fields, files) {
    var b = '----YY' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    var parts = [];
    Object.keys(fields).forEach(function (k) {
      parts.push(utf8Bytes('--' + b + '\r\n' +
        'Content-Disposition: form-data; name="' + k + '"\r\n\r\n' + String(fields[k]) + '\r\n'));
    });
    files.forEach(function (f) {
      parts.push(utf8Bytes('--' + b + '\r\n' +
        'Content-Disposition: form-data; name="' + f.name + '"; filename="' + f.filename + '"\r\n' +
        'Content-Type: ' + f.mime + '\r\n\r\n'));
      parts.push(f.data);
      parts.push(utf8Bytes('\r\n'));
    });
    parts.push(utf8Bytes('--' + b + '--\r\n'));
    return { body: concatBytes(parts), ctype: 'multipart/form-data; boundary=' + b };
  }

  function buildPhotoPayload(cdl, photos, perDetail) {
    if (!photos || !photos.length) return { files: [], fileField: '', hasFile: '0' };
    var ids = collectDetailIds(cdl);
    if (!ids.length) return { files: [], fileField: '', hasFile: '0' };
    var per = Math.max(1, Math.min(3, Number(perDetail) || 1));
    var files = [], names = [];
    ids.forEach(function (did) {
      photos.slice(0, per).forEach(function (p, j) {
        var nm = did + '_' + j;
        var ext = (p.name || '').split('.').pop().toLowerCase();
        if (!/^(jpg|jpeg|png)$/.test(ext)) ext = 'jpg';
        names.push(nm);
        files.push({ name: nm, filename: nm + '.' + ext,
          data: p.data || new Uint8Array(), mime: p.mime || 'image/jpeg' });
      });
    });
    return { files: files, fileField: names.join(','), hasFile: files.length ? '1' : '0' };
  }

  /** 完成一条任务。photos: [{name, data(Uint8Array), mime}]，已完成水印处理。 */
  function submitOne(session, typ, tid, finishTime, photos, perDetail) {
    return nativeCall('guard', {}).then(function (g) {
      if (!g.ok) throw new Error('校验未通过：' + (g.reason || '未知原因'));
      return post(g.dl, { taskIds: [tid], type: typ }, session.token, 30).then(function (dl) {
        var data = (dl && dl.data) || {};
        var cdl = buildCheckDetail(data, session, finishTime);
        if (!cdl.length) throw new Error('下载点位为空');
        var pp = buildPhotoPayload(cdl, photos, perDetail);
        var fields = {
          resCode: session.resCode, type: typ,
          checkDeatilList: JSON.stringify(cdl),
          taskId: tid, orderList: '[]', file: pp.fileField,
          hasFile: pp.hasFile, url: DEFAULT_URL
        };
        var mp = multipart(fields, pp.files);
        return request('POST', BASE + g.up, {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': mp.ctype,
          'isStaff': '1', 'token': session.token, 'User-Agent': UA
        }, mp.body, 600).then(function (resp) {
          var ok = [100, 0, '100', '0'].indexOf(resp.code) >= 0;
          return { ok: ok, resp: resp, points: cdl.length, files: pp.files.length };
        });
      });
    });
  }

  // ---------------------------------------------------------------- 导出

  var YY = {
    HOST: HOST, BASE: BASE, PAGE_SIZE: PAGE_SIZE,
    utf8Bytes: utf8Bytes, bytesToUtf8: bytesToUtf8,
    bytesToB64: bytesToB64, b64ToBytes: b64ToBytes, b64: b64,
    concatBytes: concatBytes, qs: qs,
    setBridge: setBridge, nativeCall: nativeCall, nativeDone: nativeDone,
    headers: headers, request: request, get: get, post: post, deadCheck: deadCheck,
    nowStamp: nowStamp, nowStr: nowStr, todayStr: todayStr, pad2: pad2,
    login: login, planDay: planDay, categoryOf: categoryOf, normalize: normalize,
    fetchPage: fetchPage, fetchAll: fetchAll, filterRows: filterRows, sortRows: sortRows,
    addSeconds: addSeconds, wmDate: wmDate, buildCheckDetail: buildCheckDetail,
    collectDetailIds: collectDetailIds, prepPhoto: prepPhoto, multipart: multipart,
    buildPhotoPayload: buildPhotoPayload, submitOne: submitOne
  };

  root.YY = YY;
  if (typeof module !== 'undefined' && module.exports) module.exports = YY;
})(typeof window !== 'undefined' ? window : globalThis);
