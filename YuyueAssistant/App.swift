import UIKit
import WebKit

// 愉悦助手 —— iOS 原生壳
// 结构：WKWebView 承载单页前端，所有网络 / 文件 / 密钥操作走 NativeAPI 桥。
// 从 file:// 加载本地页面时浏览器会拦截跨域请求，因此 HTTP 全部由原生层代发。

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = UIColor(red: 0.055, green: 0.071, blue: 0.098, alpha: 1.0)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

final class WebViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate {

    private var webView: WKWebView!
    private var api: NativeAPI!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.055, green: 0.071, blue: 0.098, alpha: 1.0)

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "yy")
        config.allowsInlineMediaPlayback = true
        if #available(iOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        let wv = WKWebView(frame: .zero, configuration: config)
        wv.translatesAutoresizingMaskIntoConstraints = false
        wv.backgroundColor = UIColor(red: 0.055, green: 0.071, blue: 0.098, alpha: 1.0)
        wv.scrollView.backgroundColor = UIColor(red: 0.055, green: 0.071, blue: 0.098, alpha: 1.0)
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.isOpaque = false
        // 原生 confirm/alert 兜底：WKWebView 不设 uiDelegate 时 JS 弹窗会被静默取消
        wv.uiDelegate = self
        view.addSubview(wv)

        NSLayoutConstraint.activate([
            wv.topAnchor.constraint(equalTo: view.topAnchor),
            wv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            wv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        webView = wv
        api = NativeAPI(webView: wv)

        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") else {
            showMissingPage()
            return
        }
        // 允许读取 App Bundle 内的 www 与 gallery 资源
        webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.bundleURL)
    }

    private func showMissingPage() {
        let label = UILabel()
        label.text = "资源缺失：未找到 www/index.html\n请重新打包 IPA"
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        api.handle(body)
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let ac = UIAlertController(title: "确认", message: message, preferredStyle: .alert)
        ac.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        ac.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(ac, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let ac = UIAlertController(title: "提示", message: message, preferredStyle: .alert)
        ac.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(ac, animated: true)
    }
}
