#!/bin/sh
# assemble installer — https://github.com/MananDesai54/assemble
# Usage: curl -fsSL https://manandesai54.github.io/assemble/install.sh | sh
#
# Downloads the prebuilt app for this OS/arch from the latest GitHub release.
# Falls back to a from-source install (git clone + bun start) when no
# matching release asset exists. ASSEMBLE_FROM_SOURCE=1 forces the fallback.
set -e

GH_REPO="MananDesai54/assemble"
# release list (newest first) — not /releases/latest, so a release without
# binaries (bad tag, docs-only) can never break the install
API="https://api.github.com/repos/$GH_REPO/releases?per_page=20"

say() { printf '\033[1m◉ %s\033[0m\n' "$*"; }

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin|Linux) ;;
  *) echo "assemble supports macOS and Linux only." >&2; exit 1 ;;
esac

# bun runs the app's local AI daemon (and the source fallback)
ensure_bun() {
  if command -v bun >/dev/null 2>&1 || [ -x "$HOME/.bun/bin/bun" ]; then return; fi
  say "Installing bun (JavaScript runtime)…"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
}

install_from_source() {
  DIR="${ASSEMBLE_DIR:-$HOME/assemble}"
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required — install it first (macOS: xcode-select --install)." >&2
    exit 1
  fi
  ensure_bun
  if [ -d "$DIR/.git" ]; then
    say "Updating existing install in $DIR…"
    git -C "$DIR" pull --ff-only
  else
    say "Cloning assemble into $DIR…"
    git clone --depth 1 "https://github.com/$GH_REPO.git" "$DIR"
  fi
  say "Installing dependencies…"
  cd "$DIR"
  bun install
  say "Done. Launching assemble — the in-app onboarding takes it from here."
  say "Next time: cd $DIR && bun start"
  exec bun start
}

if [ "${ASSEMBLE_FROM_SOURCE:-}" = "1" ]; then install_from_source; fi

# pick the release asset for this machine
case "$OS-$ARCH" in
  Darwin-arm64)          PATTERN='mac-arm64\.zip' ;;
  Darwin-x86_64)         PATTERN='mac-x64\.zip' ;;
  Linux-x86_64|Linux-amd64) PATTERN='linux-x86_64\.AppImage' ;;
  *) say "No prebuilt binary for $OS/$ARCH — installing from source."; install_from_source ;;
esac

# first match across the list = asset from the newest release that has one
URL="$(curl -fsSL "$API" 2>/dev/null \
  | grep -o "\"browser_download_url\": *\"[^\"]*\"" \
  | grep -E "$PATTERN" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')" || true

if [ -z "${URL:-}" ]; then
  say "No release asset found for $OS/$ARCH — installing from source."
  install_from_source
fi

ensure_bun # the packaged app still runs its local daemon with bun

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
say "Downloading $(basename "$URL")…"
curl -fL --progress-bar -o "$TMP/asset" "$URL"

if [ "$OS" = "Darwin" ]; then
  say "Installing assemble.app into /Applications…"
  ditto -xk "$TMP/asset" "$TMP/unpacked"
  rm -rf "/Applications/assemble.app"
  ditto "$TMP/unpacked/assemble.app" "/Applications/assemble.app"
  # unsigned build — clear the quarantine bit so Gatekeeper lets it open
  xattr -dr com.apple.quarantine "/Applications/assemble.app" 2>/dev/null || true
  say "Done. Launching assemble — the in-app onboarding takes it from here."
  exec open "/Applications/assemble.app"
else
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
  mv "$TMP/asset" "$BIN_DIR/assemble"
  chmod +x "$BIN_DIR/assemble"
  say "Installed to $BIN_DIR/assemble (AppImage — needs FUSE, or run with --appimage-extract-and-run)."
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say "Note: add $BIN_DIR to your PATH." ;;
  esac
  say "Done. Launching assemble — the in-app onboarding takes it from here."
  exec "$BIN_DIR/assemble"
fi
