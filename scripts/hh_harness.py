#!/usr/bin/env python3
"""Hands-free test harness for HandheldControls in Vesktop (Bazzite Game Mode).

  hh_harness.py pretest [--no-fix]   check the setup before any test (and clear Steam's input grab)
  hh_harness.py smoke [--shots DIR] [--channel /channels/G/C]  short scripted-pad run: nav down/up, open keyboard, type "hi", clear, close
  hh_harness.py pad "DOWN UP A:300"  press buttons on the scripted pad (NAME[:ms], default 120 ms)

The scripted pad goes through the same hook the pad bridge uses (window.__hhExtPadSet over Vesktop's debug port 9222,
local only), so the plugin sees it as the real controller. It does NOT cover the back-button keyboard path.
Holds are >= 50 ms (menus >= 250 ms). Nothing is ever sent: typed text is deleted again before the keyboard closes.
"""
import asyncio, base64, json, math, os, subprocess, sys, time, urllib.request
import websockets

PORT = 9222
BTN = dict(A=0, B=1, X=2, Y=3, LB=4, RB=5, LT=6, RT=7, VIEW=8, MENU=9, L3=10, R3=11, UP=12, DOWN=13, LEFT=14, RIGHT=15)


# ---------- pretest: Steam input grab (gamescope / X) ----------
def x(display, *args):
    r = subprocess.run(args, env={**os.environ, "DISPLAY": display}, capture_output=True, text=True, timeout=5)
    return r.stdout


def steam_input_grabs():
    """Windows with STEAM_INPUT_FOCUS=1 on any Xwayland display: they make gamescope send all input to Steam."""
    found = []
    for d in (":0", ":1", ":2"):
        for line in x(d, "xwininfo", "-root", "-children").splitlines():
            w = line.split()[0] if line.strip().startswith("0x") else None
            if w and "STEAM_INPUT_FOCUS(CARDINAL) = 1" in x(d, "xprop", "-id", w, "STEAM_INPUT_FOCUS"):
                name = x(d, "xprop", "-id", w, "WM_NAME").partition("=")[2].strip()
                found.append((d, w, name))
    return found


def clear_grab(d, w):
    x(d, "xprop", "-id", w, "-f", "STEAM_INPUT_FOCUS", "32c", "-set", "STEAM_INPUT_FOCUS", "0")


def focused_app():
    out = x(":0", "xprop", "-root", "GAMESCOPE_FOCUSED_APP", "GAMESCOPE_FOCUSED_APP_GFX")
    return dict(l.split("(CARDINAL) = ") for l in out.splitlines() if "(CARDINAL) = " in l)


# ---------- CDP ----------
class Page:
    def __init__(self, ws): self.ws, self.n = ws, 0

    async def call(self, method, **params):
        self.n += 1; want = self.n
        await self.ws.send(json.dumps({"id": want, "method": method, "params": params}))
        while True:
            m = json.loads(await self.ws.recv())
            if m.get("id") == want: return m

    async def ev(self, js):
        r = await self.call("Runtime.evaluate", expression=js, returnByValue=True, awaitPromise=True)
        res = r.get("result", {})
        if "exceptionDetails" in res: raise RuntimeError(res["exceptionDetails"].get("text", "js error"))
        return res.get("result", {}).get("value")

    async def shot(self, path):
        r = await self.call("Page.captureScreenshot", format="png")
        open(path, "wb").write(base64.b64decode(r["result"]["data"]))
        return path


async def open_page():
    pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=3))
    url = next(p for p in pages if p["type"] == "page" and "discord.com" in p["url"])["webSocketDebuggerUrl"]
    ws = await websockets.connect(url, max_size=None)
    return Page(ws)


# ---------- scripted pad ----------
class Pad:
    def __init__(self, page): self.p, self.b, self.a = page, [0.0] * 19, [0.0] * 4

    async def push(self):
        await self.p.ev(f"window.__hhExtPadSet({json.dumps({'b': self.b, 'a': self.a})})")

    async def press(self, name, ms=120, gap=0.18):
        ms = max(ms, 50)
        self.b[BTN[name]] = 1.0; await self.push(); await asyncio.sleep(ms / 1000)
        self.b[BTN[name]] = 0.0; await self.push(); await asyncio.sleep(gap)

    async def stick(self, h, sx, sy):
        self.a[2 * h], self.a[2 * h + 1] = sx, sy; await self.push()

    async def neutral(self):
        self.b, self.a = [0.0] * 19, [0.0] * 4; await self.push()


STATE_JS = """(() => { const f = document.querySelector('[data-hh-focus]'); const box = document.querySelector('[role="textbox"][data-slate-editor]');
  return { plugin: !!(window.Vencord && Vencord.Plugins.plugins.HandheldControls),
    enabled: !!(window.Vencord && Vencord.Settings.plugins.HandheldControls && Vencord.Settings.plugins.HandheldControls.enabled),
    extSet: typeof window.__hhExtPadSet, testPad: !!window.__hhPad, hasFocus: document.hasFocus(),
    kb: !!document.querySelector('.hh-kb:not(.hh-kb-out)'), calib: !!document.querySelector('.hh-calib-title'),
    split: !!document.querySelector('.hh-kb .hh-split'),
    focus: f ? (f.getAttribute('aria-label') || f.textContent || f.tagName).trim().slice(0, 60)
      : (fr => fr ? 'area@' + [fr.left, fr.top, fr.width, fr.height].map(Math.round).join(',') : null)(document.querySelector('.hh-frame')?.getBoundingClientRect()),
    path: location.pathname,
    box: box ? box.innerText.replace(/\\uFEFF/g, '').trim() : null, title: document.title.slice(0, 80) }; })()"""


async def bridge_alive(page):
    """The bridge's heartbeat calls __hhExtPadSet a few times a second; wrap it briefly and count calls."""
    await page.ev("""(() => { if (!window.__hhExtPadSet || window.__hhHbCount !== undefined) return;
      const o = window.__hhExtPadSet; window.__hhHbCount = 0;
      window.__hhExtPadSet = s => { window.__hhHbCount++; return o(s); }; window.__hhHbOrig = o; })()""")
    await asyncio.sleep(1.5)
    n = await page.ev("(() => { const n = window.__hhHbCount; if (window.__hhHbOrig) window.__hhExtPadSet = window.__hhHbOrig; delete window.__hhHbCount; delete window.__hhHbOrig; return n; })()")
    return n or 0


async def pretest(fix=True):
    """Returns (ok, lines)."""
    lines, ok = [], True
    grabs = steam_input_grabs()
    for d, w, name in grabs:
        if fix:
            clear_grab(d, w)
            lines.append(f"FIXED  STEAM_INPUT_FOCUS=1 on {name or w} ({d}) -> set 0")
        else:
            ok = False; lines.append(f"FAIL   STEAM_INPUT_FOCUS=1 on {name or w} ({d}): Steam swallows the pad")
    if fix and grabs:
        time.sleep(0.5); left = steam_input_grabs()
        if left: ok = False; lines.append(f"FAIL   still grabbed: {left}")
    if not grabs: lines.append("OK     no Steam input grab")
    fa = focused_app()
    lines.append(f"INFO   gamescope focused app {fa.get('GAMESCOPE_FOCUSED_APP', '?')} (gfx {fa.get('GAMESCOPE_FOCUSED_APP_GFX', '?')})")
    try:
        page = await open_page()
    except Exception as e:
        return False, lines + [f"FAIL   Vesktop debug port {PORT} not reachable: {e}"]
    st = await page.ev(STATE_JS)
    for key, label in (("plugin", "HandheldControls loaded"), ("enabled", "HandheldControls enabled")):
        ok &= bool(st[key]); lines.append(f"{'OK  ' if st[key] else 'FAIL'}   {label}")
    if st["testPad"]:
        await page.ev("window.__hhPad = false"); lines.append("FIXED  leftover test pad override (__hhPad) turned off")
    hb = await bridge_alive(page)
    ok &= hb > 0; lines.append(f"{'OK  ' if hb else 'FAIL'}   pad bridge alive ({hb} calls in 1.5 s)")
    lines.append(f"{'OK  ' if st['hasFocus'] else 'WARN'}   Vesktop window has focus ({st['title']})")
    await page.ws.close()
    return ok, lines


# ---------- smoke ----------
async def type_char(page, pad, ch):
    """Aim the right stick at the key's spot on its clock (read from the keyboard's own layout), then pull its trigger."""
    k = await page.ev(f"""(() => {{ const el = [...document.querySelectorAll('.hh-kb .hh-ckey[data-ch]')].find(e => e.dataset.ch.toLowerCase() === {json.dumps(ch)});
      return el ? {{ k: el.dataset.k, left: parseFloat(el.style.left), top: parseFloat(el.style.top) }} : null; }})()""")
    if not k: return False, f"key {ch!r} not on the keyboard"
    h, r, c = (int(v) for v in k["k"].split("-"))
    dx, dy = (k["left"] - 50) / 40, (k["top"] - 50) / 40
    if abs(dx) < 1e-3 and abs(dy) < 1e-3: sx, sy = 0.0, 0.0          # centre key
    elif (abs(dy) < 1e-3 and abs(dx) < 0.6) or (abs(dx) < 1e-3 and abs(dy) < 0.6):
        sx, sy = (0.5 if dx > 0 else -0.5 if dx < 0 else 0.0), (0.5 if dy > 0 else -0.5 if dy < 0 else 0.0)  # half tilt
    else:
        m = math.hypot(dx, dy); sx, sy = 0.99 * dx / m, 0.99 * dy / m  # rim
    await pad.stick(h, sx, sy); await asyncio.sleep(0.16)                # > 70 ms settle
    sel = await page.ev(f"!!document.querySelector('.hh-kb [data-k=\"{k['k']}\"].sel')")
    await pad.press("RT" if h else "LT", 120, 0.05)
    await pad.stick(h, 0.0, 0.0); await asyncio.sleep(0.2)
    return sel, f"key {ch!r} aimed ({sx:+.2f},{sy:+.2f}) {'selected' if sel else 'NOT selected'}"


async def smoke(shots, channel=None):
    os.makedirs(shots, exist_ok=True)
    results = []
    def step(name, ok, note=""): results.append((name, ok, note)); print(f"{'PASS' if ok else 'FAIL'}  {name}  {note}")
    page = await open_page(); pad = Pad(page)
    await page.ev("window.__hhPad = false"); await pad.neutral()
    s0 = await page.ev(STATE_JS)
    await pad.press("DOWN"); s1 = await page.ev(STATE_JS)
    step("nav down", s1["focus"] is not None and s1["focus"] != s0["focus"], f"{s0['focus']!r} -> {s1['focus']!r}")
    await pad.press("UP"); s2 = await page.ev(STATE_JS)
    step("nav up", s2["focus"] is not None and s2["focus"] != s1["focus"], f"-> {s2['focus']!r}")
    if not (await page.ev(STATE_JS))["box"] and (await page.ev("!document.querySelector('[role=\"textbox\"][data-slate-editor]')")):
        # no message box here: go to a chat (--channel PATH, else the first DM in the list). Draft only, never sent.
        js = f"Vencord.Webpack.Common.NavigationRouter.transitionTo({json.dumps(channel)})" if channel else \
            "(() => { const a = document.querySelector('a[href^=\"/channels/@me/\"]'); a && a.click(); return !!a; })()"
        await page.ev(js); await asyncio.sleep(2.0)
    # open the keyboard the way a player does: Y (areas), D-pad to the message box's area, A (go in), A (type)
    has_box = await page.ev("!!document.querySelector('[role=\"textbox\"][data-slate-editor]')")
    before = (await page.ev(STATE_JS))["box"] or ""
    if has_box:
        in_box = """(() => { const b = document.querySelector('[role="textbox"][data-slate-editor]').getBoundingClientRect();
          const f = document.querySelector('[data-hh-focus]'); if (f && f.matches('[role="textbox"], [role="textbox"] *')) return 'item';
          const r = document.querySelector('.hh-frame')?.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          return r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom ? 'area' : ''; })()"""
        await pad.press("Y", 250, 0.4)
        for btn in ["DOWN"] * 4 + ["RIGHT"] * 2 + ["DOWN"] * 3:
            if await page.ev(in_box): break
            await pad.press(btn, 120, 0.3)
        where = await page.ev(in_box)
        if where == "area": await pad.press("A", 120, 0.4); where = await page.ev(in_box)
        step("pad to message box", where == "item", f"focus={(await page.ev(STATE_JS))['focus']!r}")
    if not has_box:
        step("open keyboard", False, "no message box in this view (open a channel first)")
    else:
        if not (await page.ev(STATE_JS))["kb"]: await pad.press("A", 120, 0.6)
        s3 = await page.ev(STATE_JS)
        if s3["calib"]:
            await pad.press("B", 250, 0.6); s3 = await page.ev(STATE_JS)
            step("calibration prompt skipped", not s3["calib"])
        step("open keyboard", s3["kb"], f"split={s3['split']}")
        if s3["kb"]:
            await page.shot(os.path.join(shots, "smoke-keyboard.png"))
            notes, ok = [], s3["split"]
            for ch in "hi":
                sel, note = await type_char(page, pad, ch); ok &= sel; notes.append(note)
            await asyncio.sleep(0.3); typed = (await page.ev(STATE_JS))["box"] or ""
            await page.shot(os.path.join(shots, "smoke-typed.png"))
            step("type 'hi'", ok and typed.lower().endswith("hi") and len(typed) == len(before) + 2, f"box {before!r} -> {typed!r}; " + "; ".join(notes))
            for _ in range(max(0, len(typed) - len(before))): await pad.press("LB", 80, 0.12)  # LB = delete
            await asyncio.sleep(0.3); after = (await page.ev(STATE_JS))["box"] or ""
            step("text cleared (nothing sent)", after == before, f"box -> {after!r}")
            for _ in range(3):
                if not (await page.ev(STATE_JS))["kb"]: break
                await pad.press("B", 250, 0.5)
            s4 = await page.ev(STATE_JS)
            step("close keyboard", not s4["kb"])
    await pad.neutral()
    await page.shot(os.path.join(shots, "smoke-end.png"))
    await page.ws.close()
    return results


def main(argv):
    cmd = argv[0] if argv else "pretest"
    if cmd == "pretest":
        ok, lines = asyncio.run(pretest(fix="--no-fix" not in argv))
        print("\n".join(lines)); print("PRETEST", "PASS" if ok else "FAIL"); return 0 if ok else 1
    if cmd == "smoke":
        shots = argv[argv.index("--shots") + 1] if "--shots" in argv else os.path.expanduser("~/hh-test-shots")
        ok, lines = asyncio.run(pretest()); print("\n".join(lines))
        if not ok: print("PRETEST FAIL - smoke not run"); return 1
        res = asyncio.run(smoke(shots, argv[argv.index("--channel") + 1] if "--channel" in argv else None))
        good = all(r[1] for r in res); print(f"SMOKE {'PASS' if good else 'FAIL'} ({sum(r[1] for r in res)}/{len(res)}) shots in {shots}")
        return 0 if good else 1
    if cmd == "pad":
        async def run():
            page = await open_page(); pad = Pad(page)
            for t in argv[1].split():
                b, _, ms = t.partition(":"); await pad.press(b, int(ms or 120))
            await page.ws.close()
        asyncio.run(run()); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
