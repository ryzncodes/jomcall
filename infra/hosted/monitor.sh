#!/usr/bin/env bash
# JomCall server check. Cron runs it every 5 minutes on the hosted server
# (infra/hosted/RUNBOOK.md step 17). Each run:
#   - appends one line of load figures to the load log (CPU, memory, disk,
#     each container's CPU and memory), so the effect of calls is visible later;
#   - checks that every Compose service is running and, where it has a health
#     check, healthy; that the agent has not reported a missing SIP trunk or
#     dispatch rule; and that memory, load and disk are inside their limits;
#   - emails JOMCALL_OPERATOR_EMAIL (read from the engine's settings, with the
#     engine's SMTP relay) when a problem starts, again every 6 hours while it
#     lasts, and once when it clears. A failed send is logged and retried on
#     the next run. Nothing is restarted or changed.
# Prints and logs no setting values. `monitor.sh --test-mail` sends one email.
set -uo pipefail

COMPOSE_DIR=${COMPOSE_DIR:-/opt/jomcall/infra/hosted}
STATE_DIR=${STATE_DIR:-/var/lib/jomcall-monitor}
LOG_FILE=${LOG_FILE:-/var/log/jomcall/monitor.log}
MAIL_ENV=${MAIL_ENV:-/etc/jomcall/engine.env}
REPEAT_SECONDS=${REPEAT_SECONDS:-21600}
MEM_MIN_MB=${MEM_MIN_MB:-150}
LOAD_MAX=${LOAD_MAX:-1.5}
DISK_MAX=${DISK_MAX:-85}
SERVICES=${SERVICES:-"caddy livekit redis sip agent engine voice"}

mkdir -p "$STATE_DIR/open" "$(dirname "$LOG_FILE")"
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

stamp() { date -u +%FT%TZ; }
log() { printf '%s %s\n' "$(stamp)" "$*" >>"$LOG_FILE"; }

# One setting from the engine's file, without sourcing it.
setting() {
  local v
  v=$(grep -m1 "^$1=" "$MAIL_ENV" 2>/dev/null | cut -d= -f2-)
  v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
  printf '%s' "$v"
}

send_mail() {
  local subject=$1 body=$2 host port user pass from to addr netrc rc
  host=$(setting SMTP_HOST); port=$(setting SMTP_PORT); user=$(setting SMTP_USER)
  pass=$(setting SMTP_PASSWORD); from=$(setting SMTP_FROM); to=$(setting JOMCALL_OPERATOR_EMAIL)
  if [ -z "$host" ] || [ -z "$to" ] || [ -z "$from" ]; then
    log "MONITOR_MAIL_UNCONFIGURED"
    return 1
  fi
  addr=$(printf '%s' "$from" | sed -E 's/.*<([^>]+)>.*/\1/')
  netrc=$(mktemp)
  chmod 600 "$netrc"
  printf 'machine %s login %s password %s\n' "$host" "$user" "$pass" >"$netrc"
  printf 'From: %s\r\nTo: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n' \
    "$from" "$to" "$subject" "$body" |
    curl -sS --max-time 30 --url "smtp://$host:${port:-587}" --ssl-reqd \
      --netrc-file "$netrc" --mail-from "$addr" --mail-rcpt "$to" -T - >/dev/null 2>&1
  rc=$?
  rm -f "$netrc"
  [ $rc -eq 0 ] || log "MONITOR_MAIL_FAILED curl=$rc"
  return $rc
}

if [ "${1:-}" = "--test-mail" ]; then
  send_mail "JomCall server: test" "This is a test from the JomCall server check on $(hostname) at $(stamp)." &&
    echo "sent" || { echo "failed (see $LOG_FILE)"; exit 1; }
  exit 0
fi

cd "$COMPOSE_DIR" || { log "MONITOR_NO_COMPOSE_DIR"; exit 1; }

# --- Load line ---------------------------------------------------------------
read -r load1 load5 _ </proc/loadavg
cpu=$(vmstat 1 2 | tail -1 | awk '{print 100-$15}')
mem_avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
swap_used=$(awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{print int((t-f)/1024)}' /proc/meminfo)
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
containers=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' 2>/dev/null |
  awk '{n=$1; sub(/^jomcall-/,"",n); sub(/-1$/,"",n); printf "%s=%s/%s ", n, $2, $3}')
log "load1=$load1 load5=$load5 cpu=${cpu}% mem_avail=${mem_avail}MB swap=${swap_used}MB disk=${disk}% ${containers% }"

# --- Problems ----------------------------------------------------------------
declare -A now_open=()
problem() { now_open[$1]=$2; }

ps=$(docker compose ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)
for s in $SERVICES; do
  line=$(grep "^$s " <<<"$ps")
  state=$(awk '{print $2}' <<<"$line")
  health=$(awk '{print $3}' <<<"$line")
  if [ "$state" != "running" ]; then
    problem "service-$s" "$s is ${state:-missing}"
  elif [ -n "$health" ] && [ "$health" != "healthy" ] && [ "$health" != "starting" ]; then
    problem "service-$s" "$s is $health"
  fi
done

# The agent logs PHONE_SIP_CONFIG_MISSING every five minutes while LiveKit has
# no trunk or dispatch rule, and PHONE_SIP_CONFIG_OK once when they are back.
sip_last=$(docker compose logs --since 11m agent 2>/dev/null | grep -oE 'PHONE_SIP_CONFIG_(MISSING|OK)' | tail -1)
if [ "$sip_last" = "PHONE_SIP_CONFIG_MISSING" ]; then
  problem "sip-config" "LiveKit has no SIP trunk or dispatch rule: phone calls are not answered. Run scripts/hosted/sip-apply.ts (RUNBOOK step 11)."
fi

if [ -n "$mem_avail" ] && [ "$mem_avail" -lt "$MEM_MIN_MB" ]; then
  problem "memory" "only ${mem_avail} MB of memory available (limit ${MEM_MIN_MB} MB)"
fi
if awk -v a="$load5" -v b="$LOAD_MAX" 'BEGIN{exit !(a>b)}'; then
  problem "load" "5-minute load is $load5 (limit $LOAD_MAX)"
fi
if [ -n "$disk" ] && [ "$disk" -gt "$DISK_MAX" ]; then
  problem "disk" "disk is ${disk}% full (limit ${DISK_MAX}%)"
fi

# --- Alerts ------------------------------------------------------------------
now=$(date +%s)
new=() ongoing=() cleared=() due=0
for key in "${!now_open[@]}"; do
  f="$STATE_DIR/open/$key"
  if [ ! -f "$f" ]; then
    new+=("${now_open[$key]}"); due=1
  else
    ongoing+=("${now_open[$key]}")
    sent=$(cat "$f" 2>/dev/null || echo 0)
    [ $((now - sent)) -ge "$REPEAT_SECONDS" ] && due=1
  fi
done
for f in "$STATE_DIR"/open/*; do
  [ -e "$f" ] || continue
  key=$(basename "$f")
  [ -n "${now_open[$key]+x}" ] || { cleared+=("$key"); due=1; }
done

for key in "${!now_open[@]}"; do log "PROBLEM $key"; done

if [ $due -eq 1 ]; then
  body="JomCall server check on $(hostname), $(stamp)."$'\n'
  [ ${#new[@]} -gt 0 ] && body+=$'\nNew:\n'"$(printf -- '- %s\n' "${new[@]}")"$'\n'
  [ ${#ongoing[@]} -gt 0 ] && body+=$'\nStill open:\n'"$(printf -- '- %s\n' "${ongoing[@]}")"$'\n'
  [ ${#cleared[@]} -gt 0 ] && body+=$'\nCleared:\n'"$(printf -- '- %s\n' "${cleared[@]}")"$'\n'
  body+=$'\nLoad: '"load5=$load5 cpu=${cpu}% mem_avail=${mem_avail}MB disk=${disk}%"$'\n'
  body+="Log: $LOG_FILE on the server."
  open_count=${#now_open[@]}
  if [ "$open_count" -gt 0 ]; then
    subject="JomCall server: $open_count problem(s)"
  else
    subject="JomCall server: all clear"
  fi
  if send_mail "$subject" "$body"; then
    for key in "${!now_open[@]}"; do
      f="$STATE_DIR/open/$key"
      if [ ! -f "$f" ] || [ $((now - $(cat "$f"))) -ge "$REPEAT_SECONDS" ]; then echo "$now" >"$f"; fi
    done
    for key in "${cleared[@]}"; do rm -f "$STATE_DIR/open/$key"; done
    log "MONITOR_MAIL_SENT open=$open_count cleared=${#cleared[@]}"
  fi
fi
exit 0
