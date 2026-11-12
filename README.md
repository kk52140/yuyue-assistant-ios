# 愉悦助手 iOS 版

巡检配图 + 超时任务消除，二合一 iOS App 工程。

- **目标设备**：iPhone / iPad，iOS 15.0+
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
│   ├── Info.plist
│   └── Resources/
│       ├── www/                      # HTML + JS 业务层（index.html / core.js / app.js）
│       └── gallery/                  # 内置图库（45 张，打包时增删）
├── verify/                           # 自检脚本（Swift / UI / 核心逻辑）
├── project.yml                       # XcodeGen 工程定义
├── Entitlements.plist
└── build_ipa.sh                      # 一键出包脚本
```

## 构建

工程本身不依赖签名（`CODE_SIGNING_ALLOWED=NO`），产物用于 TrollStore 安装。

### 方式一：GitHub Actions 自动构建（推荐，无需 Mac）

1. 仓库 → **Actions** → 左侧「构建愉悦助手 IPA」→ **Run workflow**
2. 等待完成后在该次运行的 **Artifacts** 里下载 `愉悦助手-IPA`
3. 解压得到 `愉悦助手.ipa`，传到手机用 TrollStore 安装

推送到 `main`/`master` 且改动涉及 `YuyueAssistant/**`、`project.yml` 等路径时也会自动触发。

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

## 替换内置图库

直接增删 `YuyueAssistant/Resources/gallery/` 下的 jpg/png 后重新出包；
已装机的 App 也可以在「图库」页内添加/删除，无需重新打包。
