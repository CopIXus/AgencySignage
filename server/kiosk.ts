function cronFromClock(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  const hour = match ? Number(match[1]) : 3
  const minute = match ? Number(match[2]) : 0
  return `${minute} ${hour} * * *`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function linuxKioskScript(options: {
  screenUrl: string
  caUrl: string
  restartTime: string
  width: number
  height: number
  turn: 'none' | 'clockwise' | 'counterclockwise'
}): string {
  const rotate = options.turn === 'clockwise' ? 'right' : options.turn === 'counterclockwise' ? 'left' : 'normal'
  const cron = cronFromClock(options.restartTime)
  return `#!/bin/bash
set -euo pipefail
SCREEN_URL=${shellQuote(options.screenUrl)}
CA_URL=${shellQuote(options.caUrl)}
MODE="${options.width}x${options.height}"
ROTATE=${shellQuote(rotate)}
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
fi
mkdir -p "$HOME/.local/share/agency-signage" "$HOME/.local/bin" "$HOME/.pki/nssdb" "$HOME/.config/systemd/user"
curl -fsSL "$CA_URL" -o "$HOME/.local/share/agency-signage/ca.crt"
certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," -n "Agency Signage" -i "$HOME/.local/share/agency-signage/ca.crt" || true
cat > "$HOME/.local/bin/agency-signage-kiosk" <<'EOF'
#!/bin/bash
export DISPLAY="\${DISPLAY:-:0}"
xset s off || true
xset -dpms || true
xset s noblank || true
BROWSER=$(command -v chromium || command -v chromium-browser)
if command -v wlr-randr >/dev/null 2>&1; then
  OUT=$(wlr-randr | awk 'NR==1{print $1}')
  wlr-randr --output "$OUT" --mode ${options.width}x${options.height} --transform ${rotate} || true
elif command -v xrandr >/dev/null 2>&1; then
  OUT=$(xrandr | awk '/ connected/{print $1; exit}')
  xrandr --output "$OUT" --mode ${options.width}x${options.height} --rotate ${rotate} || true
fi
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 --force-device-scale-factor=1 ${shellQuote(options.screenUrl)}
EOF
chmod +x "$HOME/.local/bin/agency-signage-kiosk"
cat > "$HOME/.config/systemd/user/agency-signage-kiosk.service" <<EOF
[Unit]
Description=Agency signage kiosk
After=graphical-session.target
[Service]
ExecStart=$HOME/.local/bin/agency-signage-kiosk
Restart=always
RestartSec=3
Environment=DISPLAY=:0
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload || true
systemctl --user enable --now agency-signage-kiosk.service || true
(crontab -l 2>/dev/null | grep -v agency-signage-kiosk; echo "${cron} systemctl --user restart agency-signage-kiosk.service") | crontab - || true
echo "Kiosk installed. Leave kiosk for maintenance with Ctrl+Alt+F2, then: systemctl --user stop agency-signage-kiosk.service"
`
}

export function windowsKioskScript(options: {
  screenUrl: string
  caUrl: string
  restartTime: string
}): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(options.restartTime.trim())
  const hour = String(match ? Number(match[1]) : 3).padStart(2, '0')
  const minute = String(match ? Number(match[2]) : 0).padStart(2, '0')
  const screenUrl = options.screenUrl.replace(/'/g, "''")
  const caUrl = options.caUrl.replace(/'/g, "''")
  return `$ErrorActionPreference = 'Stop'
$screenUrl = '${screenUrl}'
$caUrl = '${caUrl}'
$ca = Join-Path $env:TEMP 'agency-signage-ca.crt'
Invoke-WebRequest -Uri $caUrl -OutFile $ca
Import-Certificate -FilePath $ca -CertStoreLocation Cert:\\LocalMachine\\Root | Out-Null
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
$browser = @(
  "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
  "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Install Chrome or Edge first.' }
$args = "--kiosk --force-device-scale-factor=1 --disable-session-crashed-bubble $screenUrl"
$action = New-ScheduledTaskAction -Execute $browser -Argument $args
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'AgencySignageKiosk' -Action $action -Trigger $trigger -Force | Out-Null
$restart = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -Command "Stop-Process -Name chrome,msedge -Force -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName AgencySignageKiosk"'
$daily = New-ScheduledTaskTrigger -Daily -At '${hour}:${minute}'
Register-ScheduledTask -TaskName 'AgencySignageKioskRestart' -Action $restart -Trigger $daily -Force | Out-Null
Start-ScheduledTask -TaskName 'AgencySignageKiosk'
Write-Output 'Kiosk installed. Run Stop-ScheduledTask -TaskName AgencySignageKiosk to leave it.'
`
}
