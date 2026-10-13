// Local Vesktop controller/picker recorder. Records input and UI structure, not chat text.
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = { vencord: resolve(root, ".build/Vencord"), out: resolve(root, ".build/input-recording.jsonl"), minutes: 30, port: 9222 };
for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (key === "help") { console.log("Usage: node scripts/record-input.mjs [--vencord PATH] [--out FILE] [--minutes 30] [--port 9222]\nUse Vesktop normally. The on-screen Stop button ends recording. Chat text and typed characters are not recorded."); process.exit(0); }
    if (!(key in options) || !args[i + 1]) throw new Error(`Invalid option: ${args[i]}`);
    options[key] = ["minutes", "port"].includes(key) ? Number(args[++i]) : resolve(args[++i]);
}
const puppeteer = createRequire(resolve(options.vencord, "package.json"))("puppeteer-core");
mkdirSync(dirname(options.out), { recursive: true });
const seen = new Set();
let count = 0;
const write = event => {
    if (event.seq !== undefined) {
        const id = `${event.instance}:${event.seq}`;
        if (seen.has(id)) return;
        seen.add(id); count++;
    }
    appendFileSync(options.out, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
};
let browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${options.port}`, defaultViewport: null });
let page = (await browser.pages()).find(page => page.url().startsWith("https://discord.com"));
if (!page) { browser.disconnect(); throw new Error("No Discord page found in Vesktop"); }
const token = `hh-rec-${Date.now()}`;
const attach = async () => {
    await page.exposeFunction("__hhRecordWrite", write);
    page.on("pageerror", error => write({ kind: "page-error", message: error.message.slice(0, 500) }));
    page.on("console", message => {
        if (message.type() === "error" && message.text().includes("[HandheldControls]")) write({ kind: "plugin-error", message: message.text().slice(0, 600) });
    });
};
await attach();
const install = async () => page.evaluate(token => {
    window.__hhRecorder?.stop?.();
    const log = [];
    const instance = `${token}-${Date.now()}`;
    let sequence = 0;
    const record = (kind, data = {}) => {
        const event = { instance, seq: ++sequence, ms: Math.round(performance.now()), kind, ...data };
        log.push(event);
        // Immediate durable delivery; polling replays the buffer if an individual binding call failed.
        window.__hhRecordWrite?.(event).catch(() => { label.textContent = "● Recorder connection gap — reconnecting"; });
        if (log.length > 8000) { log.shift(); event.bufferOverflow = true; }
    };
    const control = label => {
        const known = ["emoji", "gif", "sticker", "gift", "attach", "upload", "send", "clipboard", "search", "close", "cancel"];
        return known.find(name => new RegExp(name, "i").test(label ?? "")) ?? "other";
    };
    function describe(element) {
        if (!(element instanceof Element)) return null;
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, role: element.getAttribute("role"), control: control(element.getAttribute("aria-label") ?? element.getAttribute("title")),
            rect: [rect.x, rect.y, rect.width, rect.height].map(Math.round), connected: element.isConnected,
            textbox: element.matches('[role="textbox"],input,textarea'), keyboard: !!element.closest(".hh-kb"),
            picker: !!element.closest('[class*="expressionPicker"],.hh-pk'), selected: element.getAttribute("aria-selected") === "true" };
    }
    function state() {
        const s = window.__hhState?.();
        const layer = document.querySelector('[class*="expressionPickerPosition"]');
        const search = layer?.querySelector("input");
        const activeTab = layer?.querySelector('[role="tab"][aria-selected="true"]');
        const draft = document.querySelector('form [role="textbox"]');
        return { version: s?.version, mode: s?.mode, typing: s?.typing, keyboard: s?.keyboard, menu: s?.menu, windows: s?.windows,
            focus: describe(document.querySelector("[data-hh-focus]")), active: describe(document.activeElement),
            picker: { exists: !!layer, mirrored: !!layer?.hasAttribute("data-hh-picker"), tab: control(activeTab?.textContent),
                nativeResults: layer?.querySelectorAll('[role="gridcell"],[class*="result_"][role="button"]').length ?? 0,
                mirroredResults: document.querySelectorAll(".hh-pk-t").length,
                selectedResult: document.querySelector(".hh-pk-t.sel")?.getAttribute("data-i") ?? null,
                searchLength: (search?.value ?? "").length },
            composer: [...document.querySelectorAll(".hh-cbtn")].map(element => ({ control: control(element.getAttribute("title")), selected: element.classList.contains("sel") })),
            draftLength: draft?.textContent?.length ?? 0 };
    }
    let active = true, lastState = "", lastStateAt = 0;
    const previous = new Map();
    function pad(source, buttons, axes, synthetic = false) {
        const value = { source, synthetic, buttons: buttons.map((v, i) => v > 0.5 ? i : -1).filter(i => i >= 0), axes: axes.map(v => Math.round(v * 100) / 100) };
        const signature = JSON.stringify(value);
        if (previous.get(source) !== signature) { previous.set(source, signature); record("controller", value); }
    }
    const bridge = window.__hhExtPadSet;
    const bridgeWrapper = bridge && function(value) {
        if (active && value) pad("bridge", value.b, value.a);
        return bridge.apply(this, arguments);
    };
    if (bridgeWrapper) window.__hhExtPadSet = bridgeWrapper;
    const listeners = [];
    function listen(type, callback) { document.addEventListener(type, callback, true); listeners.push([type, callback]); }
    listen("pointerdown", event => record("pointer", { button: event.button, x: Math.round(event.clientX), y: Math.round(event.clientY), target: describe(event.target?.closest?.('button,[role="button"],input,[role="textbox"],.hh-cbtn,.hh-pk-t') ?? event.target) }));
    let lastPointerAt = 0;
    listen("pointermove", event => {
        if (performance.now() - lastPointerAt < 50) return;
        lastPointerAt = performance.now();
        record("pointer-move", { x: Math.round(event.clientX), y: Math.round(event.clientY), target: describe(event.target) });
    });
    listen("pointerup", event => record("pointer-up", { target: describe(event.target), x: Math.round(event.clientX), y: Math.round(event.clientY) }));
    listen("click", event => record("click", { trusted: event.isTrusted, target: describe(event.target?.closest?.('button,[role="button"],.hh-cbtn,.hh-pk-t') ?? event.target) }));
    listen("keydown", event => record("key", { key: event.key.length === 1 ? "character" : event.key, target: describe(event.target) }));
    listen("keyup", event => record("key-up", { key: event.key.length === 1 ? "character" : event.key, target: describe(event.target) }));
    listen("wheel", event => record("wheel", { x: event.deltaX, y: event.deltaY, target: describe(event.target) }));
    listen("scroll", event => record("scroll", { top: event.target?.scrollTop ?? 0, left: event.target?.scrollLeft ?? 0, target: describe(event.target) }));
    listen("focusin", event => record("focus", { target: describe(event.target) }));
    listen("input", event => record("text-input", { target: describe(event.target), length: (event.target?.value ?? event.target?.textContent ?? "").length }));
    const box = document.createElement("div");
    box.id = "hh-input-recorder";
    box.style.cssText = "position:fixed;top:8px;right:8px;z-index:2147483647;padding:8px 12px;border-radius:8px;background:#17191fee;color:white;font:13px sans-serif;display:flex;align-items:center;gap:10px;box-shadow:0 2px 12px #0008";
    const label = document.createElement("span"); label.textContent = "● Controller recording"; label.style.color = "#ff7979";
    const marker = document.createElement("button"); marker.textContent = "Mark bug"; marker.onclick = () => record("bug-marker", { state: state() });
    const stop = document.createElement("button"); stop.textContent = "Stop";
    box.append(label, marker, stop); document.body.append(box);
    function placeRecorder() {
        const width = box.offsetWidth, height = box.offsetHeight;
        const links = [...document.querySelectorAll(".hh-brand a")].map(a => a.getBoundingClientRect()).filter(r => r.width && r.height);
        const corners = [
            { x: innerWidth - width - 8, y: 8 }, { x: 8, y: 8 },
            { x: 8, y: innerHeight - height - 8 }, { x: innerWidth - width - 8, y: innerHeight - height - 8 }
        ];
        const p = corners.find(p => !links.some(r => p.x < r.right && p.x + width > r.left && p.y < r.bottom && p.y + height > r.top)) ?? corners[0];
        const left = `${Math.max(0, p.x)}px`, top = `${Math.max(0, p.y)}px`;
        if (box.style.left !== left) { box.style.left = left; box.style.right = "auto"; }
        if (box.style.top !== top) box.style.top = top;
    }
    let frame, sampleCount = 0, labelAt = 0;
    const recorder = { token, log, active: true, sampleCount: 0, stop() {
        if (!active) return;
        record("stopped", { state: state() }); active = false; recorder.active = false;
        clearInterval(frame);
        for (const [type, callback] of listeners) document.removeEventListener(type, callback, true);
        if (window.__hhExtPadSet === bridgeWrapper) window.__hhExtPadSet = bridge;
        box.remove();
    } };
    stop.onclick = () => recorder.stop();
    window.__hhRecorder = recorder;
    function tick() {
        if (!active) return;
        recorder.sampleCount = ++sampleCount;
        if (performance.now() - labelAt > 1000) { labelAt = performance.now(); label.textContent = `● Recording · ${sequence} events`; }
        for (const gamepad of navigator.getGamepads()) if (gamepad) pad(`browser-${gamepad.index}`, gamepad.buttons.map(b => b.value), [...gamepad.axes], /^HH Fake/.test(gamepad.id));
        if (performance.now() - lastStateAt >= 100) {
            lastStateAt = performance.now();
            placeRecorder();
            const snapshot = state(), signature = JSON.stringify(snapshot);
            if (signature !== lastState) { lastState = signature; record("state", snapshot); }
        }
    }
    record("started", { state: state() });
    // The renderer can suspend animation frames when Steam/another window obscures it.
    frame = setInterval(() => { try { tick(); } catch (error) { record("recorder-error", { message: String(error?.message ?? error) }); } }, 10);
    tick();
}, token);
await install();
write({ kind: "session", token, minutes: options.minutes });
console.log(`Recording controller/picker interactions to ${options.out}\nClick Mark bug when something goes wrong; Stop ends recording.`);
let quit = false;
process.on("SIGINT", () => { quit = true; });
process.on("SIGTERM", () => { quit = true; });
const deadline = Date.now() + options.minutes * 60000;
try {
    while (!quit && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250));
        let batch;
        try { batch = await page.evaluate(token => {
            const rec = window.__hhRecorder;
            if (rec?.token !== token) return null;
            return { events: rec.log.splice(0), active: rec.active };
        }, token); } catch (error) {
            write({ kind: "connection-gap", message: error.message.slice(0, 300) });
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!browser.connected || !page || page.isClosed()) {
                browser.disconnect();
                try {
                    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${options.port}`, defaultViewport: null });
                    page = (await browser.pages()).find(page => page.url().startsWith("https://discord.com"));
                    if (!page) throw new Error("Waiting for Discord page");
                    await attach(); await install();
                } catch { /* Retry connection on the next loop. */ }
            }
            continue;
        }
        if (!batch) { write({ kind: "page-reloaded" }); await install(); continue; }
        for (const event of batch.events) write(event);
        if (!batch.active) break;
    }
} finally {
    await page.evaluate(token => { if (window.__hhRecorder?.token === token) window.__hhRecorder.stop(); }, token).catch(() => {});
    const remaining = await page.evaluate(token => window.__hhRecorder?.token === token ? window.__hhRecorder.log.splice(0) : [], token).catch(() => []);
    for (const event of remaining) write(event);
    browser.disconnect();
    write({ kind: "session-end", events: count });
    console.log(`Saved ${count} events to ${options.out}`);
}
