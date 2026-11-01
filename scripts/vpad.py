#!/usr/bin/env python3
"""Scripted test pad for HandheldControls over Vesktop's debug port (9222, local only).

Overrides navigator.getGamepads with a fake standard pad and sets window.__hhPad so the plugin prefers it over the
evdev bridge. Usage:  vpad.py eval "<js>" | press A [ms] | hold DOWN ms | seq "A DOWN DOWN B" | shot out.png | mouse X Y | off
       vpad.py type CH   (aim the matching split-keyboard key with the stick, pull its trigger; prints 'selected' / 'missed')
       vpad.py focus     (hold a CDP session with focus emulation on until killed; smoke.sh starts it)
Focus emulation (document.hasFocus() true even when another app is shown) is on in every command unless HH_FOCUS_EMULATION=0.
Buttons: A B X Y LB RB LT RT VIEW MENU L3 R3 UP DOWN LEFT RIGHT. Presses default 120 ms, 150 ms gap.
"""
import asyncio, base64, json, os, sys, urllib.request
import websockets

BTN = dict(A=0, B=1, X=2, Y=3, LB=4, RB=5, LT=6, RT=7, VIEW=8, MENU=9, L3=10, R3=11, UP=12, DOWN=13, LEFT=14, RIGHT=15)
INSTALL = """(() => { if (!window.__vp) { window.__vp = {b: Array(17).fill(0), a: [0,0,0,0], t: 0};
  const real = navigator.getGamepads.bind(navigator);
  navigator.getGamepads = () => window.__hhPad ? [{id: 'vpad (scripted test)', index: 0, connected: true, mapping: 'standard',
    timestamp: ++window.__vp.t, axes: window.__vp.a.slice(), buttons: window.__vp.b.map(v => ({pressed: v > .5, touched: v > 0, value: v})),
    vibrationActuator: null}] : real(); }
  window.__hhPad = true; return 'vpad on'; })()"""

async def main(argv):
    pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=3))
    url = next(p for p in pages if p["type"] == "page" and "discord.com" in p["url"])["webSocketDebuggerUrl"]
    async with websockets.connect(url, max_size=None) as ws:
        n = 0
        async def call(method, **params):
            nonlocal n; n += 1; want = n
            await ws.send(json.dumps({"id": want, "method": method, "params": params}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == want: return m
        async def ev(js):
            r = await call("Runtime.evaluate", expression=js, returnByValue=True, awaitPromise=True)
            return r.get("result", {}).get("result", {}).get("value", r)
        async def press(name, ms=120):
            await ev(INSTALL); await ev(f"window.__vp.b[{BTN[name]}]=1"); await asyncio.sleep(ms / 1000)
            await ev(f"window.__vp.b[{BTN[name]}]=0"); await asyncio.sleep(0.15)
        cmd, args = argv[0], argv[1:]
        if os.environ.get("HH_FOCUS_EMULATION", "1") != "0": await call("Emulation.setFocusEmulationEnabled", enabled=True)
        if cmd == "focus":
            while True: await asyncio.sleep(3600)
        if cmd == "eval": print(json.dumps(await ev(args[0]), indent=1))
        elif cmd in ("press", "hold"): await press(args[0], int(args[1]) if len(args) > 1 else 120)
        elif cmd == "seq":
            for t in args[0].split():
                b, _, ms = t.partition(":"); await press(b, int(ms or 120))
        elif cmd == "type":
            await ev(INSTALL)
            k = await ev("""(() => { const el = [...document.querySelectorAll('.hh-kb .hh-ckey[data-ch]')].find(e => e.dataset.ch.toLowerCase() === %s);
              return el ? { k: el.dataset.k, left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null; })()""" % json.dumps(args[0].lower()))
            if not k: print("missed: key not on keyboard"); sys.exit(1)
            h = int(k["k"].split("-")[0]); dx, dy = (k["left"] - 50) / 40, (k["top"] - 50) / 40
            if abs(dx) < 1e-3 and abs(dy) < 1e-3: sx = sy = 0.0
            elif (abs(dy) < 1e-3 and abs(dx) < 0.6) or (abs(dx) < 1e-3 and abs(dy) < 0.6):
                sx, sy = (0.5 if dx > 0 else -0.5 if dx < 0 else 0.0), (0.5 if dy > 0 else -0.5 if dy < 0 else 0.0)
            else:
                m = (dx * dx + dy * dy) ** 0.5; sx, sy = 0.99 * dx / m, 0.99 * dy / m
            await ev(f"window.__vp.a[{2 * h}]={sx}; window.__vp.a[{2 * h + 1}]={sy}"); await asyncio.sleep(0.25)  # > 70 ms settle
            sel = await ev(f"!!document.querySelector('.hh-kb [data-k=\"{k['k']}\"].sel')")
            await press("RT" if h else "LT", 150)
            await ev(f"window.__vp.a[{2 * h}]=0; window.__vp.a[{2 * h + 1}]=0"); await asyncio.sleep(0.25)
            print("selected" if sel else "missed: key not selected"); sys.exit(0 if sel else 1)
        elif cmd == "shot":
            r = await call("Page.captureScreenshot", format="png")
            open(args[0], "wb").write(base64.b64decode(r["result"]["data"])); print("saved", args[0])
        elif cmd == "mouse":  # a real (trusted) mouse move, like a person touching the mouse/touchpad
            for x in (int(args[0]), int(args[0]) + 20):
                await call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=int(args[1]))
        elif cmd == "off": print(await ev("window.__hhPad = false; 'vpad off'"))

asyncio.run(main(sys.argv[1:]))
