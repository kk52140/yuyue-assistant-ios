import Foundation
import WebKit

// MARK: - HTTP 客户端（允许自签证书，与 Windows 版 ssl._create_unverified_context() 对齐）

final class HTTPClient: NSObject, URLSessionDelegate {

    static let shared = HTTPClient()

    private var session: URLSession!

    private override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 660
        cfg.httpAdditionalHeaders = nil
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }

    func dataTask(with request: URLRequest,
                  completion: @escaping (Data?, URLResponse?, Error?) -> Void) -> URLSessionDataTask {
        session.dataTask(with: request, completionHandler: completion)
    }

    func urlSession(_ session: URLSession,
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }

    /// 同步发一次请求；返回 {ok, status, bodyB64, error}
    func send(method: String, urlString: String, headers: [String: String],
              bodyB64: String?, timeout: Double) -> [String: Any] {
        guard let url = URL(string: urlString) else {
            return ["ok": false, "status": 0, "bodyB64": "", "error": "URL 无效"]
        }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        if let b = bodyB64, let d = Data(base64Encoded: b) {
            req.httpBody = d
        }
        let sem = DispatchSemaphore(value: 0)
        var out: [String: Any] = ["ok": false, "status": 0, "bodyB64": "", "error": ""]
        let task = dataTask(with: req) { data, resp, err in
            defer { sem.signal() }
            if let e = err {
                out["error"] = e.localizedDescription
                return
            }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            out["status"] = code
            out["bodyB64"] = (data ?? Data()).base64EncodedString()
            out["ok"] = (200...299).contains(code)
        }
        task.resume()
        _ = sem.wait(timeout: .now() + timeout + 5)
        return out
    }
}

// MARK: - 原生桥

final class NativeAPI {

    private weak var webView: WKWebView?
    private let fm = FileManager.default
    private let defaults = UserDefaults.standard

    init(webView: WKWebView) { self.webView = webView }

    // MARK: 目录

    private var docsDir: String {
        NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
    }

    private var userGalleryDir: String {
        let p = (docsDir as NSString).appendingPathComponent("gallery")
        if !fm.fileExists(atPath: p) {
            try? fm.createDirectory(atPath: p, withIntermediateDirectories: true)
        }
        return p
    }

    private var bundleGalleryDir: String? {
        let p = Bundle.main.bundleURL.appendingPathComponent("gallery").path
        return fm.fileExists(atPath: p) ? p : nil
    }

    private var hiddenFile: String {
        (userGalleryDir as NSString).appendingPathComponent("_hidden.json")
    }

    private func hiddenSet() -> Set<String> {
        guard let d = try? Data(contentsOf: URL(fileURLWithPath: hiddenFile)),
              let a = try? JSONSerialization.jsonObject(with: d) as? [String] else { return [] }
        return Set(a)
    }

    private func saveHidden(_ s: Set<String>) {
        if let d = try? JSONSerialization.data(withJSONObject: Array(s), options: []) {
            try? d.write(to: URL(fileURLWithPath: hiddenFile))
        }
    }

    private func safeName(_ id: String) -> String? {
        guard !id.isEmpty, !id.contains("/"), !id.contains(".."),
              id.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else { return nil }
        return id
    }

    private let imgExts: Set<String> = ["jpg", "jpeg", "png"]

    // MARK: 分发

    func handle(_ body: [String: Any]) {
        guard let id = body["id"] as? Int,
              let action = body["action"] as? String else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let result = self.dispatch(action, payload)
            self.resolve(id, result)
        }
    }

    private func dispatch(_ action: String, _ p: [String: Any]) -> [String: Any] {
        switch action {
        case "http":        return http(p)
        case "guard":       return YuyueGuard.shared.paths()
        case "guardStatus": return YuyueGuard.shared.status()
        case "configGet":   return ["ok": true, "value": defaults.string(forKey: "yy.config") ?? ""]
        case "configSet":
            defaults.set(p["value"] as? String ?? "", forKey: "yy.config")
            return ["ok": true]
        case "galleryList": return galleryList()
        case "galleryAdd":  return galleryAdd(p)
        case "galleryDelete": return galleryDelete(p)
        case "galleryRead": return galleryRead(p)
        case "galleryRestore": return galleryRestore()
        default: return ["ok": false, "error": "未知动作: " + action]
        }
    }

    private func resolve(_ id: Int, _ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        let b64 = data.base64EncodedString()
        let js = "window.__yyDone(\(id),'\(b64)')"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: HTTP

    private func http(_ p: [String: Any]) -> [String: Any] {
        let method = p["method"] as? String ?? "GET"
        let url = p["url"] as? String ?? ""
        let headers = p["headers"] as? [String: String] ?? [:]
        let bodyB64 = p["bodyB64"] as? String
        let timeout = p["timeout"] as? Double ?? 30
        return HTTPClient.shared.send(method: method, urlString: url, headers: headers,
                                      bodyB64: bodyB64, timeout: timeout)
    }

    // MARK: 图库

    private func galleryList() -> [String: Any] {
        let hidden = hiddenSet()
        var items: [[String: Any]] = []
        if let bd = bundleGalleryDir,
           let names = try? fm.contentsOfDirectory(atPath: bd) {
            for n in names where imgExts.contains((n as NSString).pathExtension.lowercased()) {
                if hidden.contains(n) { continue }
                let full = (bd as NSString).appendingPathComponent(n)
                let attrs = try? fm.attributesOfItem(atPath: full)
                let sz = (attrs?[.size] as? NSNumber)?.intValue ?? 0
                items.append(["id": n, "name": n, "size": sz, "builtin": true])
            }
        }
        if let names = try? fm.contentsOfDirectory(atPath: userGalleryDir) {
            for n in names where imgExts.contains((n as NSString).pathExtension.lowercased()) {
                let full = (userGalleryDir as NSString).appendingPathComponent(n)
                let attrs = try? fm.attributesOfItem(atPath: full)
                let sz = (attrs?[.size] as? NSNumber)?.intValue ?? 0
                items.append(["id": n, "name": n, "size": sz, "builtin": false])
            }
        }
        items.sort { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }
        return ["ok": true, "items": items, "hiddenCount": hidden.count]
    }

    private func galleryAdd(_ p: [String: Any]) -> [String: Any] {
        guard let b64 = p["dataB64"] as? String, let data = Data(base64Encoded: b64) else {
            return ["ok": false, "error": "图片数据无效"]
        }
        var name = (p["name"] as? String ?? "photo.jpg")
        name = (name as NSString).lastPathComponent
        let ext = (name as NSString).pathExtension.lowercased()
        guard imgExts.contains(ext) else { return ["ok": false, "error": "仅支持 jpg / png"] }
        let base = (name as NSString).deletingPathExtension
            .components(separatedBy: CharacterSet.alphanumerics.inverted).joined(separator: "_")
        let finalName = (base.isEmpty ? "img" : base) + "_" +
                        String(Int(Date().timeIntervalSince1970 * 1000)) + "." + ext
        let path = (userGalleryDir as NSString).appendingPathComponent(finalName)
        do {
            try data.write(to: URL(fileURLWithPath: path))
            return ["ok": true, "id": finalName]
        } catch {
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    private func galleryDelete(_ p: [String: Any]) -> [String: Any] {
        guard let id = p["id"] as? String, let n = safeName(id) else {
            return ["ok": false, "error": "文件名无效"]
        }
        let userPath = (userGalleryDir as NSString).appendingPathComponent(n)
        if fm.fileExists(atPath: userPath) {
            try? fm.removeItem(atPath: userPath)
            return ["ok": true]
        }
        // 内置图不可物理删除（Bundle 只读），记入隐藏清单
        var s = hiddenSet(); s.insert(n); saveHidden(s)
        return ["ok": true, "hidden": true]
    }

    private func galleryRestore() -> [String: Any] {
        saveHidden(Set<String>())
        return ["ok": true]
    }

    private func galleryRead(_ p: [String: Any]) -> [String: Any] {
        guard let id = p["id"] as? String, let n = safeName(id) else {
            return ["ok": false, "error": "文件名无效"]
        }
        var path = (userGalleryDir as NSString).appendingPathComponent(n)
        if !fm.fileExists(atPath: path) {
            guard let bd = bundleGalleryDir else { return ["ok": false, "error": "图不存在"] }
            path = (bd as NSString).appendingPathComponent(n)
        }
        guard let d = try? Data(contentsOf: URL(fileURLWithPath: path)) else {
            return ["ok": false, "error": "读取失败"]
        }
        let ext = (n as NSString).pathExtension.lowercased()
        let mime = ext == "png" ? "image/png" : "image/jpeg"
        return ["ok": true, "name": n, "dataB64": d.base64EncodedString(), "mime": mime]
    }
}
