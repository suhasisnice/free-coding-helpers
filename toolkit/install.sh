#!/bin/sh
# One-command setup on macOS and Linux:   sh install.sh        (terminal only: sh install.sh --cli)
# Windows: double-click setup.bat instead.
cd "$(dirname "$0")" || exit 1
[ -f app/wizard-ui.js ] && cd app   # release zip keeps the code in app/
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing it with Homebrew..."; brew install node || exit 1
  else
    echo "Install Node 20 or newer from https://nodejs.org (Linux: sudo apt-get install -y nodejs), then run: sh install.sh"
    exit 1
  fi
fi
if [ "$1" = "--cli" ]; then shift; exec node setup-wizard.js "$@"; fi
echo "Opening the setup app in your browser. Keep this window open until you finish."
exec node wizard-ui.js
