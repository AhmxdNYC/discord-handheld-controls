# Idea: a universal "controller support" Claude skill (draft, not a project)

Built from nioh3-lessons.md and handheld-lessons.md. Goal: give any app (game mod, Electron/web app, desktop tool) good controller + handheld support, the same way every time.

## 1. Recon (before writing code)
- How does the app read input today? (XInput / DirectInput / SDL / Chromium Gamepad API / window messages / Steam Input). Hook the layer the app really reads; window messages are often ignored.
- Which device shows up on the target handheld? (Ally/Deck under Steam Input = generic XInput "standard gamepad").
- Where does UI draw? Overlays must live inside the app's own window/swapchain to survive gamescope / fullscreen.
- What already exists: native focus/keyboard nav, accessibility tree (role/aria), menus that can be reused instead of re-drawn.

## 2. Input mapping
- One action map (confirm/back/menu/sections/scroll/text) with Xbox/PS/Nintendo glyphs picked from the detected pad.
- Deadzones + first-run stick calibration; per-pad saved calibration.
- Automatic modality switch: trusted (real, not synthetic) mouse/keyboard use hides pad UI, pad use brings it back. Snapshot held pad buttons at the switch to avoid phantom presses; hide first, then animate.
- Second input path independent of the host (e.g. evdev bridge on Linux) for when the platform drops the pad.
- Back paddles: Steam doesn't pass them; map to spare keys in the Steam layout and catch those.
- Press timing rules: apps sample in bursts; holds >= 50 ms, menus >= 250 ms; repeat-on-hold for scrolling.

## 3. Focus navigation
- Two levels: SECTION mode (d-pad jumps regions) and LOCKED-IN mode (A enters, move only inside; B steps back, Y unlocks). Flat nearest-element nav fails on overlapping layouts.
- Fresh press past an edge moves to the next section; a held direction stops at the list end.
- Land where the user last was in that section; look-ahead scrolling (~2.5 items); scroll only the menu's own scroller.
- Find targets by stable structure/roles (data attributes, a11y roles), never scrambled class names; re-derive and tag missing markers; fail soft (skip a feature). Same idea as byte-pattern (AOB) finding in game mods.
- Visible focus ring readable at 7 inches; greyed items when an action does nothing; Back always has a visible hint.
- Follow popups/menus the app opens (ownership chains), and return focus where it was.

## 4. On-screen keyboard
- Grid, wheel and split-stick layouts; split = each stick points at a key (12 x 30-degree slices, ~70 ms settle, ~250 ms grace, hysteresis), LB/RB type; per-pad stick calibration first; word suggestions forgiving adjacent-key slips; hold-to-repeat that accelerates; app-specific keys (e.g. @ and /).
- Mirror the app's own autocomplete into the keyboard instead of re-implementing it.
- Never record typed text in logs.

## 5. Testing
- Pure-logic unit tests for transitions (modality switch, focus moves, key layouts) - run in CI without the app.
- Virtual pad via the app's own input hook (named pipe), exclusive mode, no focus needed - and check that fake input reaches EVERY consumer the feature reads.
- Input recorder: record a real human session (input + UI structure, no private text), replay it for regression tests.
- Before handing to a human: restore every override, check the live config, check raw input, say "controller ready".
- Video beats screenshots for timing; test on Windows AND Linux/Proton.
- Never ship a controller feature without a recorded hardware run (both projects shipped 'pending live test' features).

## 6. Per-OS gotchas
- Windows: SendInput needs foreground; ViGEm needs a driver; focus steal on launch.
- Linux/gamescope: Steam BPM window can keep STEAM_INPUT_FOCUS=1 and swallow input (xprop reset); unset LD_PRELOAD before launching Electron from Steam; detect gamescope and raise UI scale; screen capture of gamescope apps is black (use PipeWire stream); InputPlumber reloads can drop the pad from sandboxed apps.
- Linux/Proton: DLL override needed for loaders (prefix registry beats launch option); exe-basename process checks; Steam Input wraps the pad; gamescope black X11 captures; some crash types leave no report.
- Handheld power: avoid per-frame polling/busy-waits (battery + fps on a ~26 W chip).

## Skill shape (if built)
SKILL.md checklist above + scripts: input-probe (raw pad dump), vpad pipe client, recorder/replayer, glyph pack, keyboard layout JSON, test templates.
