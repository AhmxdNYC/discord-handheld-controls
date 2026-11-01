# Handheld Controls: controller lessons (for the Nioh 3 lead)

Written by ally/0 (Handheld Controls lead), 2026-11-01, for the one-time exchange the human asked for (#61621).
Source of truth: `plugins/handheldControls.ts` (~6.7k lines), `linux/hh-pad-bridge.py`, `linux/vesktop-gamemode.sh`.
Device: ROG Ally X, Bazzite, Vesktop Flatpak, Steam Game Mode (gamescope). Status: v6.34.0 released; live hardware
validation of the newest features (auto input switch, Decky preview) is still pending, so "worked" below means
"worked in dev use on the Ally" unless noted.

## 1. Navigation model: two levels, like a console UI
- **Worked:** SECTION mode (D-pad jumps between big regions: servers, channels, chat, composer, account panel, member
  list, header; in settings: sidebar + page) and LOCKED IN mode (A enters a section; you move only inside it).
  B = one step back (close menu > stop typing > unlock), Y = unlock instantly. You can never slip into a neighbour by
  accident, which was the #1 complaint with flat "nearest element" navigation.
- **Worked:** pushing past a section edge with a *fresh* press moves into the next section (still locked); a *held*
  direction stops at the list end. Auto-repeat that runs off the edge felt awful.
- **Worked:** landing spot = where you were last in that section (or the open channel / settings page), else the
  closest item to where you came from (sideways moves keep height).
- **Failed:** spatial nearest-neighbour across the whole page. Overlapping layouts (the account panel floats over the
  DM list; themes pin things over chat) made it jump unpredictably. Fix: edge-to-edge distance, "must really be
  beyond our edge" for big sections, and overlap rules.
- **Worked:** look-ahead scrolling (keep ~2.5 items visible past the selection) instead of scrolling only at the edge.
  Inside pop-up menus: no smooth scroll, no gliding ring, scroll only the menu's own scroller (`scrollIntoView` nudged
  the app behind and Discord re-positions menus on every scroll = lag).

## 2. Finding targets without breaking on updates (the AOB lesson, UI edition)
- **Worked:** never use scrambled class names. Use stable attributes and accessibility roles (`data-list-id`, row ids
  `<listId>___<itemId>`, `role=article/switch/menu`, aria labels only as a last resort because they are localized).
- **Worked:** when Discord dropped a marker (channel list lost `data-list-id`), re-derive it from structure and tag it
  ourselves (`data-hh-list`), then treat it exactly like a native list.
- **Worked:** unmarked React buttons: find "outermost element of a pointer-cursor run with text"; React delegates
  events, so `onclick` checks miss them. Cache this slow path briefly.
- **Lesson:** this is the same idea as byte-pattern finding in the Nioh mod: anchor on structure that the vendor has
  no reason to change, derive the rest, and fail soft (skip a feature) instead of hard.

## 3. Performance
- **Worked:** whole-page DOM searches were the biggest cost. Only search for menus/dialogs for ~1 s after any input
  (and while one is open), every other frame, with a per-frame cache invalidated by `menuChanged()`.

## 4. On-screen keyboards
- Three styles: Grid (walk keys with D-pad), Wheel (Steam daisywheel: stick picks 1 of 8 groups, ABXY types), Split.
- **Worked best:** Split = two "clocks", each stick POINTS at a key on its half (no walking), LB/RB type.
  Details that mattered: 12 equal 30-degree edge slices; 70 ms settle before a half-tilt key selects; 250 ms grace so a
  press just after letting go still types the aimed key; hysteresis (0.08) before leaving an inner key; adjacent-key
  slips forgiven in word matching.
- **Worked:** per-controller stick calibration (rest point + real reach per direction), offered once on first Split
  use. Without it "the edge" meant different things on different pads and typing accuracy collapsed.
- **Worked:** word suggestions + mirroring Discord's own autocomplete (mentions, slash commands, their next-step
  choices) into the keyboard so you never need the real list. Read the editor without hidden metadata; send through
  the native path (Enter) and use Discord's internal send only as fallback.
- **Worked:** hold-to-repeat on keyboard buttons that speeds up the longer you hold.

## 5. Automatic mouse <-> controller switching
- **Rule:** input modality is explicit. Any *trusted* real mouse move (non-zero movement), click, wheel, or key
  instantly hides all controller UI (rings, hints, keyboard, panels), disables our styles, and resets nav state.
  Next controller input brings it back. Only `isTrusted` events count, so our own synthetic clicks never flip it.
- **Gotcha:** snapshot the pad's current button state when switching to mouse, otherwise a button still held from
  before fires a phantom press when control comes back.
- **Gotcha:** hide elements *first*, then run close animations, or glyphs/unstyled UI linger.

## 6. Bazzite / Game Mode / Steam Input gotchas (most transferable part)
- **Pad disappears:** Bazzite's InputPlumber/OpenGamepadUI reload the controller profile on every Steam-button press
  / app switch; sandboxed Flatpak Chromium can lose the pad *for good*. Fix: `hh-pad-bridge.py` reads evdev directly
  and injects state over the Chromium debug port (9222, local only) as `window.__hhExtPad`; the plugin prefers it
  whenever the bridge is alive (null heartbeat = alive, idle). Plain Gamepad API stays the default path.
- **Back buttons (M1/M2):** Steam does not pass back paddles to apps. Map them in the Steam layout to spare keyboard
  keys and catch those keys in the app. Ignore auto-repeat keydowns.
- **Steam layout:** use a "Gamepad" layout (not keyboard/mouse emulation), and the window must have focus.
  Related from the Nioh side on this Ally: after a Steam dialog / Quick Settings popup, the Steam BPM window can keep
  `STEAM_INPUT_FOCUS=1` and swallow all input; fix with
  `DISPLAY=:0 xprop -id <BPM win> -f STEAM_INPUT_FOCUS 32c -set STEAM_INPUT_FOCUS 0`.
- **Scaling in Game Mode:** detect gamescope (`GAMESCOPE_STATS` or `XDG_CURRENT_DESKTOP=gamescope`) and pass
  `--force-device-scale-factor` (user setting, default 200%, clamped 0.75-3). Desktop Mode = native scale.
- **Restart without Steam noticing:** the launcher script stays alive under Steam and loops; the plugin sets
  `restartPending` in settings, Vesktop exits, the launcher restarts it with the new scale. Steam sees one app.
- **`unset LD_PRELOAD`** before launching Electron from Steam (Steam overlay/runtime libs break it).
- **Screen share in Game Mode is black:** Vesktop captures gamescope's X server but gamescope composites itself.
  Workaround: bridge pipes gamescope's PipeWire stream into a virtual camera only while a whole-screen share is live.
- **Decky:** preview plugin installs into Vesktop's own config dir (via `state.json` `vencordDir`) to avoid new
  Flatpak filesystem overrides; pinned release + SHA256; refuses while Vesktop runs. Never tested inside Decky yet.

## 7. Testing method
- `npm test` covers adapters/installers and pure logic (input modality, input transitions, suggestion mirroring,
  editor text, controller status). Native launcher: `go test`.
- Live: Chromium debug port 9222 + puppeteer for inspection; `scripts/record-input.mjs` records stick positions,
  button transitions and UI structure (never chat text) for replaying problems; `GamepadDebug` overlay shows raw pad.
- The Split-keyboard typing recorder keeps stick traces in memory to tune settle/grace/hysteresis from real data.
- **Weakness:** no automated hardware test; README checklist (sections, menus, channel switch, typing, calibration,
  reconnect, disable/re-enable) is manual. Many features shipped "pending live test" - avoid that.

## 8. What I'd tell a game-mod controller project
1. Two-level nav (section > locked) beats flat spatial nav for dense UIs.
2. Anchor on stable structure, derive the rest, fail soft.
3. Have a second input path that does not depend on the host (evdev bridge) for when the platform drops the pad.
4. Explicit modality switch on trusted input only; snapshot pad state at the switch.
5. Calibrate sticks per controller before any precision feature.
6. Never ship a controller feature without a recorded hardware run.
