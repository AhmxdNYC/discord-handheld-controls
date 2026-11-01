# Item 2: Vesktop hands-on on the Ally (ally/0, 2026-11-01 ~4:15 pm EST)

Device: ROG Ally X, Bazzite, Steam Game Mode (gamescope), Vesktop Flatpak 1.6.7 launched from its Steam shortcut
(`vesktop-gamemode.sh`, scale 2.00, debug port 9222). Build: v6.34.0 Linux release payload (Vencord b52ed365),
put in `~/.var/app/dev.vencord.Vesktop/config/vesktop/hh-v634/dist` + `package.json` (see the bug below).
Input: `scripts/vpad.py` = scripted standard pad (getGamepads override + `__hhPad`), no physical presses.
Screenshots (local only, they show private chats): `~/hhtest-2026-11-01/` on the Ally.

| Check | Result |
| --- | --- |
| Plugin starts, v6.34 guide on first input, "Connected" header badge | PASS (10-down.png) |
| Section mode: D-pad between areas, hint bar, edge stop on held press | PASS (11/12/13) |
| Lock into server list, move, server switch | PASS (14) |
| Chat section frame, lock in, down to the message box, "A type" hint | PASS (15/16) |
| New-pad calibration wizard: step 1 rest, step 2 edge laps | PASS with scripted sticks; step 3 aim not scripted (B skip works) |
| Split keyboard opens, LT/RT type "dk", LB deletes, B closes; nothing sent | PASS (19/21) |
| Keyboard opens in box-buttons mode first (DOWN to reach keys) | note: easy to miss, first LT/RT typed nothing |
| Mouse move -> controller UI hidden; pad press -> controller UI back | PASS (22/23) |
| RT/LT next/prev channel, RB/LB next/prev server | PASS (LB back landed on #rules, not the last-viewed #general-chat) |
| X on a channel -> side context menu, B closes | PASS (25) |
| Real Ally pad: Chromium sees none; bridge reads "Xbox One Elite 2 pad" (InputPlumber) | bridge alive; physical presses NOT tested (needs a person) |
| Back buttons (Steam key mapping) | NOT tested (needs physical paddles) |
| Controls guide at 200%: bottom row cut off | minor readability issue |

## Bug found (real, all platforms, Vesktop only)
Vesktop 1.6.7 `isValidVencordInstall()` requires `package.json` next to `vencordDesktop*.js` in the custom
`vencordDir`. Release payloads have no `dist/package.json`, so at start Vesktop downloads upstream Vencord over the
folder (plugin silently gone) and its "Vencord Location" picker rejects the folder. Affects the Go installer's
Vesktop option and the Decky installer. Fix task sent to cx-ally (#61646 thread).
