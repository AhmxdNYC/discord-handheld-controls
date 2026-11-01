#!/bin/sh
# Scripted-pad smoke test. NEVER presses MENU (it would send the message). Holds >= 120 ms, menus >= 250 ms.
cd "$(dirname "$0")/.." || exit 1
mkdir -p /tmp/hhtest
rc=0
V="python3 scripts/vpad.py"
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; rc=1; }
js() { $V eval "$1" 2>/dev/null | tr -d '"\n'; }
p() { case "$1" in MENU*) echo "refusing to press MENU"; exit 2 ;; esac; $V press "$1" "${2:-250}" >/dev/null 2>&1; sleep 0.3; }
kbup() { [ "$(js "!!document.querySelector('.hh-kb:not(.hh-kb-out)')")" = true ]; }
box() { js "(document.querySelector('[role=textbox][data-slate-editor]')||{innerText:''}).innerText.replace(/\\uFEFF/g,'').trim()"; }

if [ "${HH_FOCUS_EMULATION:-1}" != 0 ]; then $V focus >/dev/null 2>&1 & FOCUS_PID=$!; trap 'kill $FOCUS_PID 2>/dev/null' EXIT; sleep 1; fi
sh scripts/pretest.sh || { echo "SMOKE FAIL (pretest)"; exit 1; }

p B; echo "step  B (close guide)"
f0=$(js "(document.querySelector('[data-hh-focus]')||{}).outerHTML?.slice(0,200)")
p DOWN; f1=$(js "(document.querySelector('[data-hh-focus]')||{}).outerHTML?.slice(0,200)")
[ -n "$f1" ] && [ "$f1" != "$f0" ] && pass "DOWN moves focus" || fail "DOWN moves focus"
p UP; f2=$(js "(document.querySelector('[data-hh-focus]')||{}).outerHTML?.slice(0,200)")
[ -n "$f2" ] && [ "$f2" != "$f1" ] && pass "UP moves focus" || fail "UP moves focus"

p Y; p RIGHT; p RIGHT; p A 300
n=0; while [ $n -lt 6 ] && ! kbup; do p DOWN; n=$((n+1)); done
kbup && pass "keyboard row reachable (after $n DOWN)" || fail "keyboard row not reached in 6 DOWN"
p A 300
kbup && pass "keyboard open" || fail "keyboard open"
p DOWN
before=$(box)
r1=$($V type h 2>&1 | tail -1); r2=$($V type i 2>&1 | tail -1)
[ "$r1" = selected ] && pass "aim+type h" || fail "aim+type h ($r1)"
[ "$r2" = selected ] && pass "aim+type i" || fail "aim+type i ($r2)"
sleep 0.3; after=$(box)
case "$after" in *hi) [ "${#after}" -ge $(( ${#before} + 2 )) ] && pass "textbox ends with 'hi' ('$before' -> '$after')" || fail "textbox length ('$before' -> '$after')" ;; *) fail "textbox ends with 'hi' ('$before' -> '$after')" ;; esac
$V shot /tmp/hhtest/smoke.png >/dev/null 2>&1 && echo "INFO  shot /tmp/hhtest/smoke.png"
p LB 150; p LB 150
[ "$(box)" = "$(printf %s "$after" | sed 's/..$//')" ] && pass "LB x2 deleted 'hi'" || fail "LB x2 deleted 'hi' (box now '$(box)')"
p B; p B; p B
kbup && fail "keyboard closed" || pass "keyboard closed"
$V off >/dev/null 2>&1
[ $rc = 0 ] && echo "SMOKE PASS" || echo "SMOKE FAIL"
exit $rc
