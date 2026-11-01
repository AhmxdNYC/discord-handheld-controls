# Nioh 3 mod: controller / handheld lessons (pc lead, 2026-11-01)

What the Nioh 3 mod project learned about controller and handheld use (PC RX 9070, ROG Ally on Bazzite/Proton). Each line: what we did -> worked/failed -> why. Sources: nioh3-engine/notes/*.md, universal-optimizer/TECH_DEBT.md.

## 1. Scripted input for automated tests
- Global SendInput (old harness) -> FAILED in practice: needs the app in the foreground; any mouse touch by the human broke the test, and the PC was unusable meanwhile.
- PostMessage/SendMessage -> rejected: the game never reads input from window messages. ViGEmBus would work but needs a kernel driver.
- Hooked XInputGetState + named pipe (`[Debug] VirtualPad`, `\.\pipe\nioh3vpad`) -> WORKED: test drove title -> field (31 s, 5 A presses) and walked 367 units with the window unfocused. Mode 1 = exclusive (real pad ignored), `realpads on|off` toggle.
- Only patch the "is the app focused?" checks for pad + pause. Forcing the whole app "active" was unsafe: the human's mouse clicks would become in-game actions.
- Press timing: the game samples the pad in bursts, so presses < 50 ms are lost; menus need >= 250 ms. 100 ms presses were often ignored.
- Limits still open: the virtual pad cannot jump (A gives no jump), its bits don't reach some higher-level button readers, scripted attacks don't land real hits, rumble is not intercepted. Result: some gameplay features went to the human untested. Lesson: verify the fake input reaches EVERY consumer the feature reads before relying on it.
- Blind "press A" macros (no screen reading) break as soon as the default menu item changes.

## 2. Before a human plays: check the controller config
- A bench run left `VirtualPad=1` in the ini -> the human's real pad was dead in the next session. Rule now: restore the override after every test and check it before every hands-on session; tell the human "controller ready".
- A new feature row existed in the build but the live ini lacked the key, so it stayed off by default. Check the live config, not just the build.
- Twice the "controller not working" report was the pad itself asleep/disconnected (0 presses in 25 s while Windows listed it). Check raw input first, then blame the mod.
- Blocking pad buttons via one API (XInput) leaves keyboard input and user rebinds unblocked; button maps are not always the default Xbox layout.

## 3. ROG Ally / Bazzite / Proton / gamescope
- Steam Input / InputPlumber shows the Ally pad to the game as an XInput pad; the game has no Steam Input code itself. Expect a generic XInput/"standard gamepad", not an Ally-specific device.
- DLL loader under Proton needs the dll override (launch option or prefix registry `dinput8=native,builtin`); one typo = mod silently not loaded. The new one-file installer writes the registry so no launch option is needed (Ally PASS #61022).
- Process detection must match the exact exe basename; a regex for the word "nioh3" matched unrelated processes and hung the installer forever (#61001).
- Overlays must draw inside the app's own swapchain/window to show in gamescope Game Mode; separate overlay windows (GDI) likely don't composite (unverified). X11 root recording comes out black; use gamescope screenshots (~2.4 s each).
- Proton busy-wait threads burn CPU (24k wakes/s) -> fixed with real sleeps. Some crashes (stack overflow) leave no report under Proton.
- Behaviour can differ Windows vs Proton (a teleport/Return soft-locked only on Proton): every input/UI feature needs a test on BOTH.

## 4. Input latency and frame pacing
- Measuring pad latency needs your own probe (PresentMon can't see pad input). The pad sample was ~5-9 ms stale before use (static estimate, never measured in game).
- Frame generation on the Ally: shown fps up (48.5) but real fps down (34 -> 24) and input-to-display +12 ms. Only worth it if real fps stays >= 40.
- The Ally is power-bound (~26 W): fewer wakeups/less background work = more fps. A UI that polls every frame costs battery.

## 5. Readability on a 7-inch screen
- Show the real glyph of the active pad type (Xbox/PS), never words like "cross". Reuse one glyph set everywhere.
- Pressed state: colour the fill only, keep the symbol readable.
- One shared background alpha for all overlays; keep corners free of game HUD (minimap, items); make position/size adjustable.
- Menu nav: a dedicated open gesture (triple-tap Start), Back/View with a visible hint to go back, grey out items that do nothing in the current screen, pause the app while the menu is open.
- Small keycap hints in footers got crushed; test text size on the real handheld.

## 6. Test harness
- One lock per device, check owner PID before closing anything, back up user data (sha256) first, restore after. Two runners sharing one lock overwrote each other.
- Every run logs fullscreen + focus state; runs without that were thrown out.
- Screenshots can't prove timing; start video before the action. Windows capture: `ffmpeg gdigrab -i desktop` (window-title capture gives a static frame).
- Keep harness scripts in the repo (Ally /tmp is wiped on reboot).
- The human is the final check for feel ("twitching", "awkward delay") - get a cheap build to them early instead of more analysis.
