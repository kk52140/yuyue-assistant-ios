import Foundation
import CryptoKit

// 运行时密钥校验 + 提交路径解封。
// 与 Windows 版 guard.py 逐字节等价：本地不保存明文密钥，也不保存明文接口路径；
// 只有读到远端 heartbeat.key、HMAC 校验通过后，才能用派生出的 seal key 解出两个提交路径。
// 校验失败 -> 返回不可用路径（提交会 404），而不是抛异常，避免被单点短路。

final class YuyueGuard {

    static let shared = YuyueGuard()

    private let expect = "79f48fa78832abb3eb62fad6092e441e54b028c9966c039c66657f9921368760"
    private let pepperA = Data("YUYUE-INSPECT-GUARD-v1-2026".utf8)
    private let pepperB = Data("YUYUE-RUNTIME-SEAL-v1-2026".utf8)
    private let sealedB64 = "iw4gctmaWPk6nItaa5RQujuFrVTyeJ34MWIaJPczWqaDN3par5nXWZDujcECKd+ACA9olyYxTcweoVzUA41Ho0ffzjGcrwtuZcMq1Kv2KoRUB92jgBI="

    // 地址拆片，参与常量指纹
    private let urlPieces = ["https://", "gitee.com/", "kk52140", "/yuyue/",
                             "raw/master/", "heartbeat.key"]
    private let altPieces: [[String]] = [
        ["https://", "raw.giteeusercontent.com/", "kk52140", "/yuyue/",
         "raw/master/", "heartbeat.key"],
        ["https://", "gitee.com/", "kk52140", "/yuyue/",
         "raw/master/", "heartbeat.key", "?raw=1"]
    ]

    private let lock = NSLock()
    private var cachedPaths: (String, String)?
    private var cachedOK = false
    private var lastReason = ""

    // MARK: - 摘要工具

    private func sha256(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }

    private func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private func hmac(_ key: Data, _ message: Data) -> Data {
        let k = SymmetricKey(data: key)
        return Data(HMAC<SHA256>.authenticationCode(for: message, using: k))
    }

    // Python: sha256(_PEPPER_A + _EXPECT.ascii + "".join(_U).utf8 + _PEPPER_B).hexdigest()
    private func realFingerprint() -> String {
        var buf = Data()
        buf.append(pepperA)
        buf.append(Data(expect.utf8))
        buf.append(Data(urlPieces.joined().utf8))
        buf.append(pepperB)
        return hex(sha256(buf))
    }

    private func keystream(_ seed: Data, _ n: Int) -> Data {
        var out = Data()
        var counter: UInt8 = 0
        while out.count < n {
            var block = seed
            block.append(counter)
            out.append(sha256(block))
            counter &+= 1
        }
        return Data(out.prefix(n))
    }

    // MARK: - 远端密钥

    private func readRemoteKey() -> (String?, String) {
        let urls = [urlPieces.joined()] + altPieces.map { $0.joined() }
        var last = ""
        for i in 0..<3 {
            var u = urls[i % urls.count]
            u += (u.contains("?") ? "&" : "?") + "_=" + String(Int(Date().timeIntervalSince1970 * 1000))
            guard let url = URL(string: u) else { continue }
            var req = URLRequest(url: url, timeoutInterval: 8)
            req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X)", forHTTPHeaderField: "User-Agent")
            req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
            req.setValue("no-cache", forHTTPHeaderField: "Pragma")

            let sem = DispatchSemaphore(value: 0)
            var result: String? = nil
            var statusErr = ""
            let task = HTTPClient.shared.dataTask(with: req) { data, resp, err in
                defer { sem.signal() }
                if let e = err {
                    statusErr = "网络错误: " + e.localizedDescription
                    return
                }
                guard let http = resp as? HTTPURLResponse else {
                    statusErr = "无响应"
                    return
                }
                if http.statusCode != 200 {
                    statusErr = "HTTP \(http.statusCode)"
                    return
                }
                guard let d = data, let s = String(data: d.prefix(256), encoding: .utf8) else {
                    statusErr = "空响应"
                    return
                }
                let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
                if t.contains("<") {
                    statusErr = "返回了网页而非密钥文件"
                    return
                }
                if !t.isEmpty { result = t }
            }
            task.resume()
            _ = sem.wait(timeout: .now() + 10)
            if let r = result { return (r, "") }
            last = statusErr.isEmpty ? "读取失败" : statusErr
            Thread.sleep(forTimeInterval: 0.5 + Double(i) * 0.4)
        }
        return (nil, last)
    }

    // MARK: - 对外接口

    /// 返回 {ok, dl, up, reason}。校验通过才给出真实的下载/上传路径。
    /// 校验不通过时返回随机不可用路径，与原版一致（防止被一眼定位）。
    func paths() -> [String: Any] {
        // 与原版一致：校验通过后缓存路径，后续提交直接命中，不重复联网读密钥
        lock.lock()
        if cachedOK, let p = cachedPaths {
            lock.unlock()
            return ["ok": true, "dl": p.0, "up": p.1, "reason": ""]
        }
        lock.unlock()

        let fetched = readRemoteKey()
        guard let remote = fetched.0 else {
            let reason = "读取不到校验密钥（\(fetched.1)）"
            lock.lock(); cachedOK = false; cachedPaths = nil
            lastReason = reason; lock.unlock()
            return junkResult(reason)
        }

        let digest = hex(hmac(pepperA, Data(remote.utf8)))
        guard digest == expect else {
            let reason = "校验密钥不匹配"
            lock.lock(); cachedOK = false; cachedPaths = nil
            lastReason = reason; lock.unlock()
            return junkResult(reason)
        }

        guard let sealed = Data(base64Encoded: sealedB64) else {
            return junkResult("内置数据损坏")
        }

        var msg = Data()
        msg.append(Data(remote.utf8))
        msg.append(Data(expect.utf8))
        msg.append(Data(realFingerprint().utf8))
        let seal = hmac(pepperB, msg)
        let ks = keystream(seal, sealed.count)
        var plain = Data()
        for i in 0..<sealed.count {
            plain.append(sealed[sealed.index(sealed.startIndex, offsetBy: i)] ^ ks[ks.index(ks.startIndex, offsetBy: i)])
        }
        guard let text = String(data: plain, encoding: .ascii) else {
            return junkResult("运行时数据校验失败")
        }
        let parts = text.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 2,
              parts[0].hasPrefix("/app/equipment/appTask/"),
              parts[1].hasPrefix("/app/equipment/appTask/") else {
            return junkResult("运行时数据校验失败")
        }
        lock.lock()
        cachedOK = true
        cachedPaths = (parts[0], parts[1])
        lastReason = ""
        lock.unlock()
        return ["ok": true, "dl": parts[0], "up": parts[1], "reason": ""]
    }

    private func junkResult(_ reason: String) -> [String: Any] {
        let junk = String(format: "%08x", UInt32.random(in: 0...UInt32.max))
        return ["ok": false, "dl": "/app/equipment/appTask/_" + junk + ".jhtml",
                "up": "/app/equipment/appTask/_" + junk + ".jhtml", "reason": reason]
    }

    func status() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return ["ok": cachedOK, "reason": lastReason, "stopped": !cachedOK]
    }
}
