#!/bin/sh
set -eu

if [ -n "${VNC_PASSWORD_FILE:-}" ]; then
  if [ ! -r "$VNC_PASSWORD_FILE" ]; then
    echo "VNC_PASSWORD_FILE must point to a readable secret file." >&2
    exit 64
  fi
  vnc_password=$(cat "$VNC_PASSWORD_FILE")
elif [ -n "${VNC_PASSWORD:-}" ]; then
  vnc_password=$VNC_PASSWORD
else
  echo "Set VNC_PASSWORD or VNC_PASSWORD_FILE before starting the desktop container." >&2
  exit 64
fi

if [ "${#vnc_password}" -ne 8 ]; then
  echo "Use an exactly 8-character VNC password; the VNC protocol ignores characters after the eighth." >&2
  exit 64
fi

umask 077
vnc_passfile=$(mktemp)
printf '%s\n' "$vnc_password" >"$vnc_passfile"
unset vnc_password VNC_PASSWORD VNC_PASSWORD_FILE

app_pid=
websockify_pid=
vnc_pid=
Xvfb "$DISPLAY" -screen 0 1600x1000x24 -nolisten tcp -noreset &
xvfb_pid=$!

cleanup() {
  if [ -n "${vnc_passfile:-}" ]; then rm -f "$vnc_passfile"; fi
  for pid in "$app_pid" "$websockify_pid" "$vnc_pid" "$xvfb_pid"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 50); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "Virtual display did not start." >&2
  exit 1
fi

x11vnc -display "$DISPLAY" -forever -shared -localhost -rfbport 5900 -passwdfile "rm:$vnc_passfile" -quiet &
vnc_pid=$!
websockify --heartbeat 30 --web /usr/share/novnc 6080 127.0.0.1:5900 &
websockify_pid=$!

app_path=$(find /opt/nisar/out -maxdepth 3 -type f -name nisar-surface-change -perm -u+x -print -quit)
if [ -z "$app_path" ]; then
  echo "The packaged Linux desktop executable was not found." >&2
  exit 1
fi

"$app_path" --disable-gpu &
app_pid=$!
wait "$app_pid"
