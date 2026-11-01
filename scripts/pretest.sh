#!/bin/sh
# Pre-flight for on-device tests. Prints PASS/FAIL per check, exits 1 on any FAIL.
cd "$(dirname "$0")/.." || exit 1
rc=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; rc=1; }

# 1. Steam BPM window must not hold STEAM_INPUT_FOCUS while Vesktop runs (it swallows the pad)
if pgrep -f -i vesktop >/dev/null 2>&1; then
    changed=0
    for w in $(DISPLAY=:0 xwininfo -root -tree 2>/dev/null | awk '/^ *0x/ {print $1}'); do
        f=$(DISPLAY=:0 xprop -id "$w" STEAM_INPUT_FOCUS 2>/dev/null)
        case "$f" in *"= 1"*) ;; *) continue ;; esac
        g=$(DISPLAY=:0 xprop -id "$w" STEAM_GAME 2>/dev/null)
        case "$g" in *"= 769"*)
            DISPLAY=:0 xprop -id "$w" -f STEAM_INPUT_FOCUS 32c -set STEAM_INPUT_FOCUS 0
            echo "CHANGED  window $w (STEAM_GAME=769, Steam BPM): STEAM_INPUT_FOCUS 1 -> 0"; changed=1 ;;
        esac
    done
    [ $changed = 0 ] && echo "INFO  no Steam BPM input grab to clear"
    pass "steam input focus check"
else
    fail "Vesktop is not running"
fi

# 2. pad bridge + debug port with a discord page
pgrep -f hh-pad-bridge.py >/dev/null 2>&1 && pass "hh-pad-bridge.py running" || fail "hh-pad-bridge.py not running"
if curl -s --max-time 3 http://127.0.0.1:9222/json/list | grep -q 'discord.com'; then pass "debug port 9222 has a discord.com page"; else fail "no discord.com page on 127.0.0.1:9222"; fi

# 3. plugin started
v=$(python3 scripts/vpad.py eval 'Vencord.Plugins.plugins.HandheldControls?.started' 2>/dev/null | tr -d ' \n')
[ "$v" = true ] && pass "HandheldControls started" || fail "HandheldControls started = '${v:-unreachable}'"

[ $rc = 0 ] && echo "PRETEST PASS" || echo "PRETEST FAIL"
exit $rc
