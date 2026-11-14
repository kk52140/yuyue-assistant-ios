# 愉悦助手 iOS 版

巡检配图 + 超时任务消除，二合一 iOS App 工程。

- **目标设备**：iPhone / iPad，arm64 真机，iOS 15.0+
- **安装方式**：TrollStore 2（巨魔），支持 14.0 ~ 16.6.1
- **工程形态**：XcodeGen（`project.yml`）+ Swift 原生壳 + HTML/JS 业务层

详细功能说明见 [使用说明.txt](使用说明.txt)。

## 目录结构

```
.
├── .github/workflows/build-ipa.yml   # GitHub Actions：macOS runner 自动编译出 IPA
├── YuyueAssistant/
│   ├── App.swift                     # 应用入口
│   ├── Guard.swift                   # 本地校验逻辑
│   ├── NativeAPI.swift               # 原生桥接（相册、文件等）
│   ├── Info.plist                    # 手写配置，禁止让 XcodeGen 覆盖（见下方说明）
│   └── Resources/
│       ├── www/                      # HTML + JS 业务层（index.html / core.js / app.js）
│       ├── gallery/                  # 内置图库（45 张，打包时增删）
│       ├── Assets.xcassets/          # AppIcon 图标集
│       └── Icon*.png                 # 桌面图标裸图（CFBundleIconFile 指向 Icon.png）
├── verify/                           # 自检脚本（Swift / UI / 核心逻辑）
├── project.yml                       # XcodeGen 工程定义
├── Entitlements.plist
└── build_ipa.sh                      # 一键出包脚本
```

## 构建

工程不依赖签名（`CODE_SIGNING_ALLOWED=NO`），产物用于 TrollStore 安装。

### 方式一：GitHub Actions（推荐，无需 Mac）

1. 仓库 → **Actions** → 左侧「构建愉悦助手 IPA」→ **Run workflow**
2. 等待完成后在该次运行的 **Artifacts** 里下载 `愉悦助手-IPA`
3. 解压得到 `愉悦助手.ipa`，传到手机用 TrollStore 安装

推送到 `main`/`master` 且改动涉及 `YuyueAssistant/**`、`project.yml` 等路径时也会自动触发。

> macOS runner 只在**公开仓库**上免费可用。仓库转 Private 后 job 会一直排队拿不到机器，
> 需要到 Billing 配置付款方式才能继续自动出包。

### 方式二：本地 macOS 构建

```bash
brew install xcodegen   # 可选，缺失时脚本会回退到 swiftc 直编
chmod +x build_ipa.sh
./build_ipa.sh
```

## 自查

```bash
python3 verify/check_swift.py
python3 verify/check_ui.py
node verify/selftest_core.js
node verify/selftest_guard.js
```

## 四个已踩过的坑（改工程前务必看）

1. **`project.yml` 里不能写 `info: {path: ...}`**
   XcodeGen 会用自动生成的空壳 plist 覆盖手写 `Info.plist`，导致
   `CFBundleDisplayName`、`CFBundleIconFile`、`UILaunchScreen` 全部丢失
   —— 装到手机上桌面名变成英文、图标变白、启动页缺失。
   正确做法是只保留 `GENERATE_INFOPLIST_FILE: NO` + `INFOPLIST_FILE`。

2. **`xcodegen generate --project` 要传目录而不是 `.xcodeproj` 路径**
   传完整 `.xcodeproj` 路径会生成 `X.xcodeproj/X.xcodeproj` 嵌套结构并崩溃。
   脚本里已改为 `cd $ROOT && xcodegen generate --spec project.yml --quiet`。

3. **XML 资源引用不可靠**
   XcodeGen 的 `type: folder` 有时不把 `www/`、`gallery/` 的目录结构带进 bundle，
   打包后 `App.app/www/index.html` 缺失会白屏。脚本已在构建后显式 `cp -R` 覆盖。

4. **`Assets.xcassets` 必须放在 `sources` 而不是 `resources`**
   放进 `resources` 只会被当成普通文件，`actool` 不执行，产物里没有 `Assets.car`，
   图标集实际未生效。放到 `sources` 后才会编出 `Assets.car` 和 `AppIcon*.png`。

## 替换内置图库

直接增删 `YuyueAssistant/Resources/gallery/` 下的 jpg/png 后重新出包；
已装机的 App 也可以在「图库」页内添加/删除，无需重新打包。
