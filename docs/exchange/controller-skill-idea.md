# Idea: a universal "controller support" Claude skill (draft, not a project)

Built from nioh3-lessons.md and the Handheld Controls plugin (handheld-lessons.md will refine it). Goal: give any app (game mod, Electron/web app, desktop tool) good controller + handheld support, the same way every time.

## 1. Recon (before writing code)
- How does the app read input today? (XInput / DirectInput / SDL / Chromium Gamepad API / window messages / Steam Input). Hook the layer the app really reads; window messages are often ignored.
- Which device shows up on the target handheld? (Ally/Deck under Steam Input = generic XInput "standard gamepad").
- Where does UI draw? Overlays must live inside the app's own window/swapchain to survive gamescope / fullscreen.
- What already exists: native focus/keyboard nav, accessibility tree (role/aria), menus that can be reused instead of re-drawn.

## 2. Input mapping
- One action map (confirm/back/menu/sections/scroll/text) with Xbox/PS/Nintendo glyphs picked from the detected pad.
- Deadzones + first-run stick calibration; per-pad saved calibration.
- Automatic modality switch: mouse/keyboard use restores the normal UI, pad use brings pad UI back. No manual toggle.
- Press timing rules: apps sample in bursts; holds >= 50 ms, menus >= 250 ms; repeat-on-hold for scrolling.

## 3. Focus navigation
- Sections (sidebar/list/content/dialogs) with a lock-in/lock-out model; d-pad moves inside, bumpers jump sections.
- Visible focus ring readable at 7 inches; greyed items when an action does nothing; Back always has a visible hint.
- Follow popups/menus the app opens (ownership chains), and return focus where it was.

## 4. On-screen keyboard
- Full + split-stick layouts; word suggestions; app-specific keys (e.g. @ and / for Discord).
- Mirror the app's own autocomplete into the keyboard instead of re-implementing it.
- Never record typed text in logs.

## 5. Testing
- Pure-logic unit tests for transitions (modality switch, focus moves, key layouts) - run in CI without the app.
- Virtual pad via the app's own input hook (named pipe), exclusive mode, no focus needed - and check that fake input reaches EVERY consumer the feature reads.
- Input recorder: record a real human session (input + UI structure, no private text), replay it for regression tests.
- Before handing to a human: restore every override, check the live config, check raw input, say "controller ready".
- Video beats screenshots for timing; test on Windows AND Linux/Proton.

## 6. Per-OS gotchas
- Windows: SendInput needs foreground; ViGEm needs a driver; focus steal on launch.
- Linux/Proton: DLL override needed for loaders (prefix registry beats launch option); exe-basename process checks; Steam Input wraps the pad; gamescope black X11 captures; some crash types leave no report.
- Handheld power: avoid per-frame polling/busy-waits (battery + fps on a ~26 W chip).
- macOS: Gamepad API only in focused windows (to confirm in handheld-lessons).

## Skill shape (if built)
SKILL.md checklist above + scripts: input-probe (raw pad dump), vpad pipe client, recorder/replayer, glyph pack, keyboard layout JSON, test templates.
