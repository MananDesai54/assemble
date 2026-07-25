#!/bin/sh
# assemble installer — https://github.com/MananDesai54/assemble
# Usage: curl -fsSL https://manandesai54.github.io/assemble/install.sh | sh
set -e

REPO="https://github.com/MananDesai54/assemble.git"
DIR="${ASSEMBLE_DIR:-$HOME/assemble}"

say() { printf '\033[1m◉ %s\033[0m\n' "$*"; }

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) echo "assemble supports macOS and Linux only." >&2; exit 1 ;;
esac

if ! command -v git >/dev/null 2>&1; then
  echo "git is required — install it first (macOS: xcode-select --install)." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  say "Installing bun (JavaScript runtime)…"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if [ -d "$DIR/.git" ]; then
  say "Updating existing install in $DIR…"
  git -C "$DIR" pull --ff-only
else
  say "Cloning assemble into $DIR…"
  git clone --depth 1 "$REPO" "$DIR"
fi

say "Installing dependencies…"
cd "$DIR"
bun install

say "Done. Launching assemble — the in-app onboarding takes it from here."
say "Next time: cd $DIR && bun start"
exec bun start
