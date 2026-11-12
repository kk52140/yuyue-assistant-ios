#!/bin/bash
# 愉悦助手 —— 生成可用 TrollStore（巨魔）安装的未签名 IPA
# 运行要求：macOS + Xcode（或 Xcode Command Line Tools），iOS 真机 16.4.1 已装 TrollStore 2
#
#   ./build_ipa.sh
#
# 产物：./愉悦助手.ipa
#
# 【换图】打包前直接编辑 YuyueAssistant/Resources/gallery/ 目录：
#   加图 = 把 jpg/png 拷进去；删图 = 把文件删掉。重新运行本脚本即可。
#   图片会原样打进 App，首次启动时可再用界面增删（存 Documents/gallery）。

set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
APPNAME="YuyueAssistant"
BUNDLE="com.kk521.yuyue.assistant"
OUT="$ROOT/build"
APP="$OUT/Payload/$APPNAME.app"
IPA="$ROOT/愉悦助手.ipa"

echo "=== 0/5 环境检查 ==="
if ! command -v xcrun >/dev/null 2>&1; then
  echo "错误：未找到 xcrun。需要 macOS + Xcode（App Store 免费版即可）。" >&2
  echo "安装：xcode-select --install  或  从 App Store 安装 Xcode 后执行 sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi
SDK=$(xcrun --sdk iphoneos --show-sdk-path)
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "错误：未找到 iPhoneOS SDK。请先安装完整 Xcode（Command Line Tools 不含 iOS SDK）。" >&2
  exit 1
fi
echo "SDK: $SDK"
xcrun --sdk iphoneos --show-sdk-version

echo "=== 1/5 清理旧产物 ==="
rm -rf "$OUT" "$IPA"
mkdir -p "$APP"

echo "=== 2/5 编译 arm64 可执行文件 ==="
SWIFT_SRC=(
  "$ROOT/YuyueAssistant/App.swift"
  "$ROOT/YuyueAssistant/Guard.swift"
  "$ROOT/YuyueAssistant/NativeAPI.swift"
)
TARGET="arm64-apple-ios15.0"

# 优先用 XcodeGen + xcodebuild（自动处理 plist / 资源 / 签名）；没装就退回纯 swiftc。
if command -v xcodegen >/dev/null 2>&1 && [ -f "$ROOT/project.yml" ]; then
  echo "使用 XcodeGen 生成工程"
  # 注意：--project 接受的是「目录」，xcodegen 会在该目录下生成 <名字>.xcodeproj。
  # 传 .xcodeproj 的完整路径会生成 <...>.xcodeproj/<...>.xcodeproj 的嵌套路径并报错。
  ( cd "$ROOT" && xcodegen generate --spec project.yml --quiet )
  xcrun xcodebuild -quiet \
    -project "$ROOT/$APPNAME.xcodeproj" -scheme "$APPNAME" \
    -configuration Release -sdk iphoneos -derivedDataPath "$OUT/dd" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY="" \
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE" \
    TARGETED_DEVICE_FAMILY="1,2" build
  BUILT=$(find "$OUT/dd/Build/Products" -name "$APPNAME.app" -type d | head -1)
  if [ -z "$BUILT" ]; then echo "错误：xcodebuild 未产出 .app" >&2; exit 1; fi
  rm -rf "$APP"
  cp -R "$BUILT" "$APP"
  # XcodeGen 的 folder 引用在不同版本下对目录结构处理不一致（有时会摊平或干脆不拷），
  # 这里统一显式覆盖拷贝，保证 App.app/www 与 App.app/gallery 的目录形态稳定。
  rm -rf "$APP/www" "$APP/gallery"
  cp -R "$ROOT/YuyueAssistant/Resources/www" "$APP/www"
  cp -R "$ROOT/YuyueAssistant/Resources/gallery" "$APP/gallery"
else
  echo "XcodeGen 未安装，使用 swiftc 直接编译（无需额外依赖）"
  xcrun --sdk iphoneos swiftc \
    -target "$TARGET" -sdk "$SDK" \
    -F "$SDK/System/Library/Frameworks" \
    -I "$SDK/usr/lib/swift" -L "$SDK/usr/lib/swift" \
    -Xlinker -rpath -Xlinker /usr/lib/swift \
    -Xlinker -framework -Xlinker UIKit \
    -Xlinker -framework -Xlinker WebKit \
    -Xlinker -framework -Xlinker CryptoKit \
    -Xlinker -framework -Xlinker Foundation \
    -O -parse-as-library \
    "${SWIFT_SRC[@]}" \
    -o "$APP/$APPNAME"
  cp "$ROOT/YuyueAssistant/Info.plist" "$APP/Info.plist"
  printf 'APPL????' > "$APP/PkgInfo"
  # 文件夹引用：www 与 gallery 保持目录结构
  cp -R "$ROOT/YuyueAssistant/Resources/www" "$APP/www"
  cp -R "$ROOT/YuyueAssistant/Resources/gallery" "$APP/gallery"
fi

echo "=== 3/5 校验资源 ==="
for f in "$APP/$APPNAME" "$APP/Info.plist" "$APP/www/index.html" "$APP/www/core.js"; do
  if [ ! -f "$f" ]; then
    echo "错误：缺少 $f" >&2
    echo "--- .app 实际内容 ---" >&2
    find "$APP" -maxdepth 2 >&2 || true
    exit 1
  fi
done
GAL_N=$(find "$APP/gallery" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) 2>/dev/null | wc -l | tr -d ' ')
echo "内置图库：$GAL_N 张"
/usr/bin/plutil -lint "$APP/Info.plist" >/dev/null

echo "=== 4/5 签名（巨魔会在安装时重签，这里做 ad-hoc 占位签名）==="
if command -v ldid >/dev/null 2>&1; then
  ldid -S"$ROOT/Entitlements.plist" "$APP/$APPNAME" 2>/dev/null || \
    codesign -f -s - --entitlements "$ROOT/Entitlements.plist" "$APP" 2>/dev/null || true
elif command -v codesign >/dev/null 2>&1; then
  codesign -f -s - --entitlements "$ROOT/Entitlements.plist" "$APP" 2>/dev/null || true
fi
# 保证可执行位
chmod +x "$APP/$APPNAME"

echo "=== 5/5 打包 IPA ==="
cd "$OUT"
/usr/bin/zip -qry "$IPA" Payload
cd "$ROOT"
SIZE=$(stat -f%z "$IPA" 2>/dev/null || stat -c%s "$IPA")
echo ""
echo "完成：$IPA ($SIZE 字节)"
echo "机型要求：arm64 真机，iOS 15.0+（你的 16.4.1 完全支持）"
echo "安装：把 IPA 传到 iPhone → 用「文件」App 点开 → 共享给 TrollStore → 安装"
echo ""
echo "提示：如果只是换图库图片，改完 Resources/gallery/ 后重跑本脚本即可，不用改代码。"
