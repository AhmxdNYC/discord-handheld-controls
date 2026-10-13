/*
 * HeldIndicator — companion plugin for the "Discord+ Handheld Mode" theme.
 * Marks the message/channel/thread/server you held (or right-clicked) with
 * data-hh-held while its menu is open, and clears it when the menu closes.
 */

import definePlugin from "@utils/types";

const MENU_SELECTOR = [
    '#message[role="menu"]',
    '#guild-context[role="menu"]',
    '#channel-context[role="menu"]',
    '#thread-context[role="menu"]',
].join(", ");

const TARGET_SELECTOR = [
    'li[id^="chat-messages-"]',
    '[data-list-item-id^="channels___"]',
    '[data-list-item-id^="guildsnav___"]',
].join(", ");

const ATTR = "data-hh-held";

let held: Element | null = null;
let observer: MutationObserver | null = null;
let checkQueued = false;

function clearHeld() {
    held?.removeAttribute(ATTR);
    held = null;
}

function onContextMenu(e: MouseEvent) {
    clearHeld();
    if ((window as any).__hhControllerActive === false || e.isTrusted) return;
    const target = (e.target as Element | null)?.closest?.(TARGET_SELECTOR);
    if (!target) return;
    held = target;
    target.setAttribute(ATTR, "");
    setTimeout(() => {
        if (held === target && !document.querySelector(MENU_SELECTOR)) clearHeld();
    }, 500);
}

function checkMenuClosed() {
    checkQueued = false;
    if (!held) return;
    if (!held.isConnected || !document.querySelector(MENU_SELECTOR)) clearHeld();
}

export default definePlugin({
    name: "HeldIndicator",
    description: "Keeps the item you held or right-clicked marked while its menu is open (for the Discord+ Handheld Mode theme).",
    authors: [{ name: "Ahmad", id: 0n }],

    start() {
        document.addEventListener("contextmenu", onContextMenu, true);
        observer = new MutationObserver(() => {
            if (held && !checkQueued) {
                checkQueued = true;
                requestAnimationFrame(checkMenuClosed);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        document.removeEventListener("contextmenu", onContextMenu, true);
        observer?.disconnect();
        observer = null;
        clearHeld();
    },
});
