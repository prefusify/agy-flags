#!/bin/bash
# agy-flags: one-step installer for macOS.
#
#   Install or update:
#     curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash
#   Show the status:
#     curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- status
#   Remove:
#     curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- uninstall
#
# What "install" does, in this order:
#   1. Looks for Node.js 18 or later. If there is none, it downloads the official Node.js
#      build from nodejs.org into the agy-flags data folder and checks its SHA-256 against
#      the value written in this file. Nothing is installed system-wide and no password is asked.
#   2. Downloads agy-flags from GitHub (or uses the folder this script is in).
#   3. Runs "agy-flags install": copies the program into the data folder and registers a
#      login item that starts it at every login.
#   4. Says how to reach the settings page: it is inside Antigravity, under Settings > AGY-flags,
#      after Antigravity was restarted once.
#
# The data folder is ~/Library/Application Support/agy-flags. This script writes nowhere else,
# apart from the login item in ~/Library/LaunchAgents that agy-flags itself registers.

set -euo pipefail

REPO="prefusify/agy-flags"
BRANCH="main"
LABEL="dev.agy-flags.daemon"
MIN_NODE_MAJOR=18

# The Node.js build that is downloaded when the machine has none. The checksums are the ones
# published in https://nodejs.org/dist/v24.22.3/SHASUMS256.txt.
NODE_VERSION="24.22.3"
NODE_SHA256_ARM64="ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd"
NODE_SHA256_X64="977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7"
NODE_MIN_MACOS_MAJOR=13
NODE_MIN_MACOS_MINOR=5

DATA_DIR="${AGY_FLAGS_HOME:-$HOME/Library/Application Support/agy-flags}"
RUNTIME_DIR="$DATA_DIR/runtime"
APP_SCRIPT="$DATA_DIR/app/bin/agy-flags.mjs"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WORK=""

# ---- messages -------------------------------------------------------------------------

LANG_ZH=0
case "$(defaults read -g AppleLocale 2>/dev/null || echo "${LANG:-}")" in
  zh*) LANG_ZH=1 ;;
esac

# say "中文" "English"
say() {
  if [ "$LANG_ZH" = 1 ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi
}

die() {
  say "错误：$1" "Error: $2" >&2
  exit 1
}

cleanup() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

# ---- Node.js --------------------------------------------------------------------------

# node_ok <path>: true when the file is a Node.js of a supported version.
node_ok() {
  [ -x "$1" ] || return 1
  local major
  major="$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  case "$major" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

# Prints the path of a usable Node.js, or nothing.
find_node() {
  local candidate
  candidate="$(command -v node 2>/dev/null || true)"
  for candidate in "$candidate" /opt/homebrew/bin/node /usr/local/bin/node "$RUNTIME_DIR/bin/node"; do
    if [ -n "$candidate" ] && node_ok "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 0
}

# Downloads the pinned Node.js into the data folder and prints its path.
download_node() {
  local arch sha version major minor
  # Under Rosetta "uname -m" says x86_64 on an Apple-silicon Mac; ask the hardware instead.
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
    arch="arm64"
    sha="$NODE_SHA256_ARM64"
  else
    arch="x64"
    sha="$NODE_SHA256_X64"
  fi

  version="$(sw_vers -productVersion)"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  case "$minor" in '' | *[!0-9]*) minor=0 ;; esac
  if [ "$major" -lt "$NODE_MIN_MACOS_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MACOS_MAJOR" ] && [ "$minor" -lt "$NODE_MIN_MACOS_MINOR" ]; }; then
    die "这台 Mac 的系统是 macOS ${version}。自动下载的 Node.js 需要 macOS $NODE_MIN_MACOS_MAJOR.$NODE_MIN_MACOS_MINOR 或更新。请先在「系统设置 → 通用 → 软件更新」里更新系统，或者自己从 https://nodejs.org 安装 Node.js，然后再运行本命令。" \
      "this Mac runs macOS $version. The Node.js that is downloaded automatically needs macOS $NODE_MIN_MACOS_MAJOR.$NODE_MIN_MACOS_MINOR or later. Update macOS in System Settings > General > Software Update, or install Node.js yourself from https://nodejs.org, and run this command again."
  fi

  local name="node-v$NODE_VERSION-darwin-$arch"
  local url="${AGY_FLAGS_NODE_MIRROR:-https://nodejs.org/dist}/v$NODE_VERSION/$name.tar.gz"
  local file="$WORK/$name.tar.gz"
  say "没有找到 Node.js。正在下载官方的 Node.js ${NODE_VERSION}（约 55 MB），只放进 agy-flags 自己的文件夹：" \
    "Node.js was not found. Downloading the official Node.js $NODE_VERSION (about 55 MB) into the agy-flags folder only:" >&2
  say "  $url" "  $url" >&2
  curl -fL --progress-bar --retry 2 -o "$file" "$url" >&2 ||
    die "下载 Node.js 失败。请检查网络后重试。" "could not download Node.js. Check the network and try again."

  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [ "$actual" != "$sha" ]; then
    die "下载到的 Node.js 校验值不对，已停止安装，没有运行它。预期 ${sha}，实际 ${actual}。" \
      "the downloaded Node.js has the wrong checksum. Nothing was run. Expected $sha, got $actual."
  fi

  # Each step is checked by hand: a function whose output is captured does not stop at a
  # failing command by itself.
  if ! { mkdir -p "$WORK/node" && tar -xzf "$file" -C "$WORK/node" --strip-components=1 "$name/bin/node" "$name/LICENSE"; }; then
    die "解压 Node.js 失败。" "could not unpack Node.js."
  fi
  node_ok "$WORK/node/bin/node" ||
    die "下载的 Node.js 在这台 Mac 上运行不了。" "the downloaded Node.js does not run on this Mac."
  if ! {
    mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR" && rm -rf "$RUNTIME_DIR.new" && mv "$WORK/node" "$RUNTIME_DIR.new" &&
      rm -rf "$RUNTIME_DIR" && mv "$RUNTIME_DIR.new" "$RUNTIME_DIR"
  }; then
    die "写不进文件夹 ${DATA_DIR}。请检查磁盘空间和这个文件夹的权限。" "could not write to $DATA_DIR. Check the disk space and the permissions of that folder."
  fi
  printf '%s\n' "$RUNTIME_DIR/bin/node"
}

# ---- the program ----------------------------------------------------------------------

# Prints the folder that holds the agy-flags source to install from.
fetch_source() {
  # A folder given by hand, or the folder this script lies in when it is run from a download
  # or a clone ("bash install.sh"). Through "curl | bash" there is no script file.
  local here=""
  if [ -n "${AGY_FLAGS_SOURCE:-}" ]; then
    here="$AGY_FLAGS_SOURCE"
    [ -f "$here/bin/agy-flags.mjs" ] || die "AGY_FLAGS_SOURCE 指的文件夹里没有 agy-flags。" "AGY_FLAGS_SOURCE does not hold agy-flags."
  elif [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    [ -f "$here/bin/agy-flags.mjs" ] && [ -f "$here/package.json" ] || here=""
  fi
  if [ -n "$here" ]; then
    printf '%s\n' "$here"
    return 0
  fi

  local url="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
  say "正在从 GitHub 下载 agy-flags……" "Downloading agy-flags from GitHub..." >&2
  curl -fsSL --retry 2 -o "$WORK/agy-flags.tar.gz" "$url" ||
    die "下载 agy-flags 失败。请检查网络后重试。" "could not download agy-flags. Check the network and try again."
  if ! { mkdir -p "$WORK/src" && tar -xzf "$WORK/agy-flags.tar.gz" -C "$WORK/src" --strip-components=1; }; then
    die "解压 agy-flags 失败。" "could not unpack agy-flags."
  fi
  [ -f "$WORK/src/bin/agy-flags.mjs" ] || die "下载到的文件不完整。" "the download is incomplete."
  printf '%s\n' "$WORK/src"
}

cmd_install() {
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/agy-flags-install.XXXXXX")"
  say "正在安装 agy-flags……" "Installing agy-flags..."

  local node
  node="$(find_node)"
  if [ -z "$node" ]; then node="$(download_node)"; fi
  [ -n "$node" ] || die "没有可用的 Node.js。" "no usable Node.js."

  local source output
  source="$(fetch_source)"
  # The folder of the chosen Node.js goes first in PATH. The program then records that path in
  # the login item (a package manager's link survives an upgrade; the file behind it does not).
  if ! output="$(PATH="$(dirname "$node"):$PATH" "$node" "$source/bin/agy-flags.mjs" install 2>&1)"; then
    printf '%s\n' "$output" >&2
    die "安装没有成功，原因见上面的输出。" "the installation failed. See the output above."
  fi

  if [ ! -d "/Applications/Antigravity.app" ]; then
    say "提示：没有在「应用程序」里找到 Antigravity。装好 Antigravity 之后，本工具才有作用。" \
      "Note: Antigravity was not found in Applications. agy-flags does nothing until it is installed."
  fi

  say "" ""
  say "安装完成。agy-flags 已经在运行，以后每次登录会自动启动。" "Done. agy-flags is running and starts at every login."
  say "接下来：" "Next:"
  say "  1. 退出并重新打开 Antigravity（已经开着的窗口里还没有设置页）。" "  1. Quit and reopen Antigravity (a window that is already open does not have the page yet)."
  say "  2. 在 Antigravity 里打开「设置」，左侧最后一项是 AGY-flags，在那里选要开的功能。" "  2. In Antigravity, open Settings. The last entry on the left is AGY-flags; choose your features there."
  say "  3. 按页面上的提示重启 Antigravity，功能就生效了。" "  3. Restart Antigravity when the page asks you to. The features are then on."
  say "" ""
  say "要卸载，运行：" "To remove agy-flags, run:"
  say "  curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/install.sh | bash -s -- uninstall" \
    "  curl -fsSL https://raw.githubusercontent.com/$REPO/$BRANCH/install.sh | bash -s -- uninstall"
}

# ---- status ---------------------------------------------------------------------

# Runs one command of the installed program. Installs nothing and restarts nothing.
run_installed() {
  local node
  node="$(node_of_login_item)"
  if [ -z "$node" ]; then node="$(find_node)"; fi
  if [ -z "$node" ] || [ ! -f "$APP_SCRIPT" ]; then
    die "agy-flags 还没有安装。请先运行安装命令。" "agy-flags is not installed. Run the install command first."
  fi
  "$node" "$APP_SCRIPT" "$@"
}

# ---- removal --------------------------------------------------------------------------

# The Node.js that the login item starts, when it is still there.
node_of_login_item() {
  [ -f "$PLIST" ] || return 0
  local node
  node="$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$PLIST" 2>/dev/null || true)"
  if [ -n "$node" ] && node_ok "$node"; then printf '%s\n' "$node"; fi
}

# Used only when the program itself can no longer run: stop the login item, remove the
# files, and clear the variables that still point at the default ports.
remove_by_hand() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  local pair name value
  for pair in "CLOUD_CODE_URL=http://127.0.0.1:47931" "AICODE_ENDPOINT_URL=http://127.0.0.1:47932" "AGY_DEV_UI_URL=http://127.0.0.1:47933"; do
    name="${pair%%=*}"
    value="${pair#*=}"
    if [ "$(launchctl getenv "$name" 2>/dev/null || true)" = "$value" ]; then launchctl unsetenv "$name" || true; fi
  done
  rm -f "$PLIST"
  rm -rf "$DATA_DIR/app"
  if [ "$1" = "purge" ]; then rm -rf "$DATA_DIR"; fi
}

cmd_uninstall() {
  local purge="keep" arg
  for arg in "$@"; do
    if [ "$arg" = "--purge" ]; then purge="purge"; fi
  done

  local node
  node="$(node_of_login_item)"
  if [ -z "$node" ]; then node="$(find_node)"; fi

  if [ -n "$node" ] && [ -f "$APP_SCRIPT" ]; then
    # Antigravity is restarted when it still runs through agy-flags: without that it could
    # no longer reach its servers.
    local args=(uninstall --restart-client)
    if [ "$purge" = "purge" ]; then args+=(--purge); fi
    "$node" "$APP_SCRIPT" "${args[@]}" || remove_by_hand "$purge"
  else
    remove_by_hand "$purge"
    if pgrep -f '/Applications/Antigravity.app/Contents/MacOS/' >/dev/null 2>&1; then
      say "Antigravity 还在运行。请退出并重新打开它，否则它连不上服务器。" \
        "Antigravity is still running. Quit and reopen it, or it cannot reach its servers."
    fi
  fi
  rm -rf "$RUNTIME_DIR" "$RUNTIME_DIR.new"

  say "" ""
  say "agy-flags 已卸载。" "agy-flags was removed."
  if [ "$purge" != "purge" ] && [ -d "$DATA_DIR" ]; then
    say "你选过的功能还保留在这个文件夹里，重新安装后会恢复：" "The features you chose are kept in this folder and come back after a new install:"
    say "  $DATA_DIR" "  $DATA_DIR"
    say "想连它一起删掉，在卸载命令的末尾加上 --purge 再运行一次。" "To delete it too, run the uninstall command again with --purge at the end."
  fi
  say "在 agy-flags 开着的时候打开的程序（例如「终端」）还带着它的设置。" \
    "Programs that were opened while agy-flags was on (Terminal, for example) still carry its settings."
  say "如果你用命令行的 agy，请把终端完全退出再打开，然后再使用。" \
    "If you use the agy command line, quit Terminal completely and open it again before you use it."
}

# ---- entry ----------------------------------------------------------------------------

main() {
  [ "$(uname -s)" = "Darwin" ] || die "本工具只支持 macOS。" "agy-flags supports macOS only."
  [ "$(id -u)" != "0" ] || die "请不要用 sudo 运行。本工具只装在你自己的账户里。" "do not run this with sudo. agy-flags installs into your own account only."

  # --purge deletes the data folder. Refuse a folder that cannot be the one of agy-flags.
  case "$DATA_DIR" in
    / | "$HOME" | "$HOME/" | /Users | /tmp | /private/tmp)
      die "AGY_FLAGS_HOME 指向了不能用作数据文件夹的位置。" "AGY_FLAGS_HOME names a folder that cannot be the data folder."
      ;;
  esac

  case "${1:-install}" in
    install) cmd_install ;;
    status) run_installed status ;;
    uninstall)
      shift
      cmd_uninstall "$@"
      ;;
    -h | --help | help)
      say "用法：install.sh [install | status | uninstall [--purge]]" "Usage: install.sh [install | status | uninstall [--purge]]"
      ;;
    *) die "不认识的参数：$1" "unknown argument: $1" ;;
  esac
}

# The whole file is read before anything runs, so a download that stops halfway does nothing.
main "$@"
