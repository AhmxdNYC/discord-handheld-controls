#!/usr/bin/env python3
"""HandheldControls pad bridge.

Vesktop (Flatpak Chromium) sometimes stops seeing the controller: Bazzite's InputPlumber / OpenGamepadUI reload the
controller profile on every Steam-button press / app switch, and Chromium in the sandbox can lose the pad for good.
This reads the controller straight from the system (evdev) and hands its state to the HandheldControls plugin as
`window.__hhExtPad`, over Vesktop's debug port (9222). The plugin uses it whenever Chromium has no controller.
It also feeds Game Mode's whole screen into the virtual camera (/dev/video0, "OBS Virtual Camera") while the plugin
asks for it (`window.__hhWantScreenFeed`): in Game Mode an "Entire screen" share is black (gamescope draws the real
picture itself), so the plugin swaps in this feed — gamescope's own screen stream — for whole-screen shares.

Started by vesktop-gamemode.sh alongside Vesktop; exits when Vesktop does (or run it by hand).
"""
import base64, json, os, select, socket, subprocess, sys, time, urllib.request

import evdev
from evdev import ecodes as E

PORT = 9222
NAMES = ("Microsoft X-Box One Elite 2 pad", "Microsoft X-Box One Elite pad", "ASUS ROG Ally X Gamepad")

# standard gamepad layout: index → evdev key code
BUTTONS = {0: E.BTN_SOUTH, 1: E.BTN_EAST, 2: E.BTN_NORTH, 3: E.BTN_WEST, 4: E.BTN_TL, 5: E.BTN_TR,
           8: E.BTN_SELECT, 9: E.BTN_START, 10: E.BTN_THUMBL, 11: E.BTN_THUMBR, 16: E.BTN_MODE}
# the back buttons (M1 / M2 on the ROG Ally): extra indices 17 / 18
PADDLES = {17: E.BTN_TRIGGER_HAPPY7, 18: E.BTN_TRIGGER_HAPPY5}
CODE_TO_INDEX = {c: i for i, c in {**BUTTONS, **PADDLES}.items()}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


class CDP:
    """A minimal WebSocket client (no extra Python packages needed): just sends Runtime.evaluate calls."""

    def __init__(self):
        self.sock = None
        self.n = 0

    def connect(self):
        pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2))
        page = next(p for p in pages if p.get("type") == "page" and "discord.com" in p.get("url", ""))
        path = page["webSocketDebuggerUrl"].split(f":{PORT}", 1)[1]
        s = socket.create_connection(("127.0.0.1", PORT), timeout=3)
        key = base64.b64encode(os.urandom(16)).decode()
        s.sendall((f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = s.recv(4096)
            if not chunk:
                raise ConnectionError("handshake failed")
            resp += chunk
        if b" 101 " not in resp.split(b"\r\n", 1)[0]:
            raise ConnectionError(resp[:80])
        s.setblocking(False)
        self.sock = s
        log("connected to", page.get("title", "")[:40])

    def send(self, expression):
        self.n += 1
        payload = json.dumps({"id": self.n, "method": "Runtime.evaluate", "params": {"expression": expression}}).encode()
        header = bytearray([0x81])
        ln = len(payload)
        if ln < 126:
            header.append(0x80 | ln)
        elif ln < 65536:
            header += bytes([0x80 | 126]) + ln.to_bytes(2, "big")
        else:
            header += bytes([0x80 | 127]) + ln.to_bytes(8, "big")
        mask = os.urandom(4)
        frame = bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.setblocking(True)
        self.sock.sendall(frame)
        self.sock.setblocking(False)
        self.drain()

    def drain(self):
        # (the replies aren't needed: just keep the socket from filling up)
        try:
            while True:
                if not self.sock.recv(65536):
                    raise ConnectionError("closed")
        except BlockingIOError:
            pass

    def query(self, expression, timeout=1.0):
        """Evaluate and return the value (reads replies until ours comes back)."""
        self.n += 1
        want = self.n
        payload = json.dumps({"id": want, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}).encode()
        header = bytearray([0x81])
        ln = len(payload)
        header += bytes([0x80 | ln]) if ln < 126 else bytes([0x80 | 126]) + ln.to_bytes(2, "big")
        mask = os.urandom(4)
        self.sock.setblocking(True)
        self.sock.sendall(bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        self.sock.settimeout(timeout)
        buf = b""
        try:
            end = time.time() + timeout
            while time.time() < end:
                chunk = self.sock.recv(65536)
                if not chunk:
                    raise ConnectionError("closed")
                buf += chunk
                while len(buf) >= 2:
                    ln, off = buf[1] & 0x7F, 2
                    if ln == 126:
                        if len(buf) < 4: break
                        ln, off = int.from_bytes(buf[2:4], "big"), 4
                    elif ln == 127:
                        if len(buf) < 10: break
                        ln, off = int.from_bytes(buf[2:10], "big"), 10
                    if len(buf) < off + ln:
                        break
                    data, buf = buf[off:off + ln], buf[off + ln:]
                    try:
                        msg = json.loads(data)
                    except Exception:
                        continue
                    if msg.get("id") == want:
                        return ((msg.get("result") or {}).get("result") or {}).get("value")
            return None
        finally:
            self.sock.setblocking(False)

    def close(self):
        try:
            self.sock and self.sock.close()
        except Exception:
            pass
        self.sock = None


def find_pad():
    for p in evdev.list_devices():
        try:
            d = evdev.InputDevice(p)
        except Exception:
            continue
        if d.name in NAMES and E.EV_ABS in d.capabilities():
            return d
    return None


def norm(info, v):
    lo, hi = info.min, info.max
    return 0.0 if hi == lo else max(-1.0, min(1.0, (2 * (v - lo) / (hi - lo)) - 1))


IN_GAME_MODE = os.environ.get("XDG_CURRENT_DESKTOP") == "gamescope" or bool(os.environ.get("GAMESCOPE_STATS"))
FEED = ["gst-launch-1.0", "-q", "pipewiresrc", "target-object=gamescope", "always-copy=true", "keepalive-time=33", "do-timestamp=true", "!", "videoconvert", "!",
        "videoscale", "!", "videorate", "!", "video/x-raw,format=YUY2,width=1920,height=1080,framerate=30/1", "!",
        "v4l2sink", "device=/dev/video0", "sync=false"]


def _die_with_parent():
    # (the feed stops if the bridge is killed — the launcher kills it when Vesktop closes)
    import ctypes, signal
    ctypes.CDLL("libc.so.6").prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG


class Feeder:
    """gamescope's screen → the virtual camera, only while a whole-screen share wants it."""

    def __init__(self):
        self.proc = None

    def want(self, on):
        if on and (self.proc is None or self.proc.poll() is not None):
            log("screen feed: start")
            self.proc = subprocess.Popen(FEED, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=_die_with_parent)
        elif not on and self.proc is not None:
            log("screen feed: stop")
            self.proc.terminate()
            try:
                self.proc.wait(2)
            except Exception:
                self.proc.kill()
            self.proc = None


def run():
    cdp = CDP()
    feeder = Feeder()
    last_check = 0.0
    pad, absinfo = None, {}
    buttons = [0.0] * 19
    axes = [0.0, 0.0, 0.0, 0.0]
    last_sent, dirty, last_try = "", True, 0.0
    while True:
        if pad is None:
            pad = find_pad()
            if pad is None:
                time.sleep(1)
                continue
            absinfo = {code: info for code, info in pad.capabilities(absinfo=True).get(E.EV_ABS, [])}
            log("reading", pad.name, pad.path)
        if cdp.sock is None and time.time() - last_try > 1:
            last_try = time.time()
            try:
                cdp.connect()
                dirty = True
            except Exception as e:
                cdp.close()
                if not os.environ.get("HH_BRIDGE_KEEP") and "Connection refused" in str(e) and getattr(run, "had_vesktop", False):
                    log("Vesktop gone, exiting")
                    return
        # a couple of times a second: does the plugin want the screen feed? (and tell it we're in Game Mode)
        if cdp.sock is not None and time.time() - last_check > 0.5:
            last_check = time.time()
            try:
                v = cdp.query(f"(window.__hhGamescope = {'true' if IN_GAME_MODE else 'false'}, window.__hhWantScreenFeed === true)")
                feeder.want(bool(v) and IN_GAME_MODE)
            except Exception as e:
                log("debug connection lost:", e)
                cdp.close()
                feeder.want(False)
        try:
            r, _, _ = select.select([pad.fd], [], [], 0.25)
            if r:
                for ev in pad.read():
                    if ev.type == E.EV_KEY and ev.code in CODE_TO_INDEX:
                        buttons[CODE_TO_INDEX[ev.code]] = 1.0 if ev.value else 0.0
                        dirty = True
                    elif ev.type == E.EV_ABS and ev.code in absinfo:
                        info, v = absinfo[ev.code], ev.value
                        if ev.code == E.ABS_X: axes[0] = norm(info, v)
                        elif ev.code == E.ABS_Y: axes[1] = norm(info, v)
                        elif ev.code == E.ABS_RX: axes[2] = norm(info, v)
                        elif ev.code == E.ABS_RY: axes[3] = norm(info, v)
                        elif ev.code == E.ABS_Z: buttons[6] = (norm(info, v) + 1) / 2
                        elif ev.code == E.ABS_RZ: buttons[7] = (norm(info, v) + 1) / 2
                        elif ev.code == E.ABS_HAT0X: buttons[14], buttons[15] = (1.0 if v < 0 else 0.0), (1.0 if v > 0 else 0.0)
                        elif ev.code == E.ABS_HAT0Y: buttons[12], buttons[13] = (1.0 if v < 0 else 0.0), (1.0 if v > 0 else 0.0)
                        else: continue
                        dirty = True
        except OSError:
            log("controller went away, looking again")
            pad = None
            continue
        if dirty and cdp.sock is not None:
            state = json.dumps({"b": [round(x, 3) for x in buttons], "a": [round(x, 3) for x in axes]})
            if state != last_sent or not r:
                try:
                    cdp.send(f"window.__hhExtPadSet && window.__hhExtPadSet({state})")
                    run.had_vesktop = True
                    last_sent, dirty = state, False
                except Exception as e:
                    log("debug connection lost:", e)
                    cdp.close()
            else:
                dirty = False
        elif cdp.sock is not None and not r:
            # heartbeat (a few times a second while idle): the plugin knows the bridge is alive
            try:
                cdp.send("window.__hhExtPadSet && window.__hhExtPadSet(null)")
            except Exception:
                cdp.close()


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        pass
