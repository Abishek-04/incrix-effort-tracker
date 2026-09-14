#!/usr/bin/env bash
# Incrix Effort Tracker — run on a Mac mini as an always-on, local-network-only service.
#
#   ./deploy/macmini.sh install     first-time setup: build, auto-start at boot, keep the Mac awake
#   ./deploy/macmini.sh update      rebuild after copying in new code, then restart
#   ./deploy/macmini.sh status      is it running? which addresses to open?
#   ./deploy/macmini.sh logs        follow the server log (Ctrl+C to exit)
#   ./deploy/macmini.sh restart | stop | start
#   ./deploy/macmini.sh uninstall   remove the background service (app files and data are kept)
#
# Add --dry-run after any command to print what would happen without changing anything.
set -euo pipefail

LABEL="com.teamincrix.effort-tracker"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/incrix-effort-tracker"
LOG_FILE="$LOG_DIR/server.log"
PORT="${PORT:-3000}"
RUN_USER="$(id -un)"
CMD="${1:-help}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" || "${1:-}" == "--dry-run" ]] && DRY_RUN=1
NODE_BIN=""

bold() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die()  { printf "  \033[31m✗\033[0m %s\n" "$*" >&2; exit 1; }
run()  { if (( DRY_RUN )); then printf "  \033[2m[dry-run] %s\033[0m\n" "$*"; else "$@"; fi; }

[[ "$(uname -s)" == "Darwin" ]] || die "This script is for macOS."
[[ $EUID -ne 0 ]] || die "Run this as your normal user (not with sudo) — it asks for your password when needed."

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      bold "Installing Node.js 22 with Homebrew…"
      run brew install node@22
      run brew link --overwrite --force node@22
    else
      die "Node.js isn't installed. Install the Node.js 22 LTS macOS installer from https://nodejs.org, then run this again."
    fi
  fi
  NODE_BIN="$(command -v node)"
  local v; v="$(node -p 'process.versions.node')"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' \
    || die "Node.js $v is too old — version 22.18 or newer is required."
  ok "Node.js $v"
}

check_env() {
  local env="$APP_DIR/.env.local"
  [[ -f "$env" ]] || die "Missing .env.local — copy it into $APP_DIR (it holds the AWS keys)."
  local k
  for k in AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
    grep -qE "^(APP_)?${k}=.+" "$env" || die "$k is missing in .env.local"
  done
  run chmod 600 "$env"
  ok ".env.local found (readable only by $RUN_USER)"
}

build_app() {
  bold "Installing dependencies and building (takes a minute or two)…"
  cd "$APP_DIR"
  run npm ci --no-audit --no-fund
  run npm run build
  ok "Build complete"
}

keep_awake() {
  bold "Keeping the Mac mini awake and online (asks for your password)…"
  run sudo pmset -a sleep 0 disksleep 0 womp 1 autorestart 1
  ok "System sleep off · wake for network access on · restart after power failure on"
  ok "The display can still turn off — that doesn't affect the app"
}

allow_firewall() {
  local fw=/usr/libexec/ApplicationFirewall/socketfilterfw
  if "$fw" --getglobalstate 2>/dev/null | grep -q "enabled"; then
    run sudo "$fw" --add "$NODE_BIN" >/dev/null
    run sudo "$fw" --unblockapp "$NODE_BIN" >/dev/null
    ok "macOS firewall is on — allowed incoming connections for Node.js"
  else
    ok "macOS firewall is off — nothing to change"
  fi
}

write_service() {
  bold "Registering the background service…"
  run mkdir -p "$LOG_DIR"
  local tmp; tmp="$(mktemp)"
  cat >"$tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>UserName</key><string>${RUN_USER}</string>
  <key>WorkingDirectory</key><string>${APP_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${APP_DIR}/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>${PORT}</string>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
EOF
  plutil -lint "$tmp" >/dev/null || { rm -f "$tmp"; die "Generated service file is invalid"; }
  if (( DRY_RUN )); then
    printf "  \033[2m[dry-run] would install %s:\033[0m\n" "$PLIST"; sed 's/^/    /' "$tmp"; rm -f "$tmp"; return
  fi
  sudo install -m 644 -o root -g wheel "$tmp" "$PLIST"
  rm -f "$tmp"
  ok "Starts automatically at boot (no login needed) and restarts if it crashes"
}

is_loaded() { sudo launchctl print "system/${LABEL}" >/dev/null 2>&1; }

stop_service() {
  if (( DRY_RUN )); then run sudo launchctl bootout "system/${LABEL}"; return; fi
  if is_loaded; then sudo launchctl bootout "system/${LABEL}" 2>/dev/null || true; sleep 1; fi
}

start_service() {
  [[ -f "$PLIST" || $DRY_RUN -eq 1 ]] || die "Service isn't installed — run: ./deploy/macmini.sh install"
  if (( DRY_RUN )); then run sudo launchctl bootstrap system "$PLIST"; return; fi
  if is_loaded; then sudo launchctl kickstart -k "system/${LABEL}"; else sudo launchctl bootstrap system "$PLIST"; fi
}

wait_healthy() {
  (( DRY_RUN )) && return 0
  printf "  Waiting for the app to start"
  local i
  for i in $(seq 1 45); do
    if curl -sf -o /dev/null --max-time 5 "http://localhost:${PORT}/api/bootstrap"; then
      echo; ok "App is running and connected to the database"; return 0
    fi
    printf "."; sleep 1
  done
  echo; warn "The app hasn't responded yet. Check the log: ./deploy/macmini.sh logs"
  return 1
}

print_urls() {
  local host ip
  host="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
  ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  bold "Open the tracker on any phone or laptop connected to the office network:"
  echo "  http://${host}.local:${PORT}"
  [[ -n "$ip" ]] && echo "  http://${ip}:${PORT}"
  echo
  echo "  Tip: reserve this Mac mini's IP in your router (DHCP reservation) so the IP address never changes."
}

case "$CMD" in
  install)
    bold "Installing Incrix Effort Tracker on $(scutil --get ComputerName 2>/dev/null || hostname)"
    require_node; check_env; build_app; keep_awake; allow_firewall
    stop_service; write_service; start_service
    wait_healthy || true; print_urls ;;
  update)
    require_node; check_env; build_app
    bold "Restarting…"; stop_service; write_service; start_service
    wait_healthy || true; print_urls ;;
  restart) require_node; stop_service; start_service; wait_healthy || true ;;
  start)   start_service; wait_healthy || true; print_urls ;;
  stop)    stop_service; ok "Stopped (it will start again at next boot — use 'uninstall' to remove it)" ;;
  status)
    if [[ -f "$PLIST" ]] && is_loaded; then
      pid="$(sudo launchctl print "system/${LABEL}" | awk '/^\tpid = /{print $3}')"
      ok "Service is loaded${pid:+ (pid $pid)}"
      if curl -sf -o /dev/null --max-time 5 "http://localhost:${PORT}/api/bootstrap"; then ok "App responds and the database is reachable"; else warn "App isn't responding — see: ./deploy/macmini.sh logs"; fi
      print_urls
    else
      warn "Service is not running. Install it with: ./deploy/macmini.sh install"
    fi ;;
  logs)
    [[ -f "$LOG_FILE" ]] || die "No log yet at $LOG_FILE"
    tail -n 50 -f "$LOG_FILE" ;;
  uninstall)
    stop_service
    run sudo rm -f "$PLIST"
    ok "Background service removed. App files, .env.local and the database are untouched."
    warn "Power settings were left as they are. To restore default sleep: sudo pmset -a sleep 1" ;;
  *)
    awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0" ;;
esac
