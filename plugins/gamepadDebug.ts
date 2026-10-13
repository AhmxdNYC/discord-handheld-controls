import definePlugin from "@utils/types";

let box: HTMLDivElement | null = null;
let timer: number | null = null;

export default definePlugin({
    name: "GamepadDebug",
    description: "Shows what controller Vesktop sees and which buttons are pressed (testing only).",
    authors: [{ name: "Ahmad", id: 0n }],
    start() {
        box = document.createElement("div");
        box.style.cssText = "position:fixed;top:10px;left:10px;z-index:99999;background:#000c;color:#0f0;font:16px monospace;padding:10px;border-radius:8px;white-space:pre;pointer-events:none";
        document.body.append(box);
        timer = window.setInterval(() => {
            box!.hidden = (window as any).__hhControllerActive === false;
            const pads = [...navigator.getGamepads()].filter(Boolean) as Gamepad[];
            box!.textContent = pads.length
                ? pads.map(g =>
                    `${g.id}\nbuttons: ${g.buttons.map((b, i) => b.pressed ? i : null).filter(x => x !== null).join(",") || "-"}\naxes: ${g.axes.map(a => a.toFixed(1)).join(" ")}`
                ).join("\n\n")
                : "no gamepads (press a button)";
        }, 100);
    },
    stop() {
        if (timer) clearInterval(timer);
        box?.remove();
        box = null;
    },
});
