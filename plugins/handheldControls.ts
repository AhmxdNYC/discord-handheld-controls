/*
 * HandheldControls v5.16 — controller navigation for Discord (Vencord / Vesktop)
 * Built for the ROG Ally X on Bazzite (Game Mode, Steam "Gamepad" layout); works with any standard controller.
 *
 * Theme-agnostic: finds things with Discord's stable attributes and accessibility roles
 * (never scrambled class names), draws its own UI on top using Discord's color variables,
 * and never rearranges Discord's layout.
 *
 * Two levels, like a console UI:
 *   SECTION mode  — the D-pad moves between the big sections (servers, channels, chat, message box,
 *                   account panel, member list, header; in settings: sidebar and page). The whole section glows.
 *   LOCKED IN     — after pressing A on a section, you only move inside it: items, scrolling, typing, menus.
 *                   You can't slip into a neighbouring section.
 *
 * Controls:
 *   D-pad / left stick   move (between sections, or inside the one you're locked into) — hold to speed up
 *   A                    lock into a section · inside: open / select / toggle / start typing
 *   B                    back one step: close menu → stop typing → unlock
 *   Y                    unlock instantly (back to moving between sections)
 *   X                    hold action (right-click / long-press menu) on what's selected
 *   LB / RB              previous / next server
 *   LT / RT              previous / next channel
 *   Right stick          scroll the section you're in (chat when not locked in)
 *   L3                   jump to newest message
 *   View  (⧉)            show / hide the controls list
 *   Menu  (☰)            open Discord settings
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps, findByPropsLazy, findStore } from "@webpack";
import { ChannelStore, FluxDispatcher, MessageStore, NavigationRouter, SelectedChannelStore, SelectedGuildStore, SettingsRouter, SortedGuildStore, UserStore } from "@webpack/common";

const BACK_ACTIONS_LIST: [string, string][] = [["mute", "Mute / unmute mic"], ["deafen", "Deafen / undeafen"], ["type", "Type in the open chat"], ["switcher", "Quick switcher (jump anywhere)"], ["back", "Previous channel"], ["newest", "Jump to newest message"], ["read", "Mark channel read"], ["inbox", "Open inbox"], ["chatonly", "Big chat on / off"], ["none", "Nothing"]];
function BACK_ACTIONS_OPTIONS(slot: number) {
    const def = ["mute", "type", "switcher", "back"][slot];
    return BACK_ACTIONS_LIST.map(([value, label]) => ({ label, value, default: value === def }));
}

const settings = definePluginSettings({
    stickDeadzone: {
        type: OptionType.SLIDER,
        description: "How far a stick must move before it counts",
        markers: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
        default: 0.5,
        stickToMarkers: false,
    },
    scrollSpeed: {
        type: OptionType.SLIDER,
        description: "Right-stick scroll speed",
        markers: [5, 10, 15, 20, 25, 30, 40],
        default: 18,
        stickToMarkers: false,
    },
    autoLockAfterChannel: {
        type: OptionType.BOOLEAN,
        description: "Pressing A on the channel that's already open jumps into its chat (the first press just shows it)",
        default: true,
    },
    autoLockAfterServer: {
        type: OptionType.BOOLEAN,
        description: "After opening a server, jump straight into its channel list (locked in)",
        default: true,
    },
    settingsMethod: {
        type: OptionType.STRING,
        description: "Which way of opening settings worked last time (set automatically)",
        default: "",
        hidden: true,
    },
    menuDrawer: {
        type: OptionType.BOOLEAN,
        description: "Hold / right-click menus slide in from the side of the screen (the app moves over to make room)",
        default: true,
    },
    keyboardChatOnly: {
        type: OptionType.BOOLEAN,
        description: "While the keyboard is up in a chat, hide the server / channel lists so the chat gets the whole width (R3 on the keyboard toggles it)",
        default: true,
    },
    buttonLayout: {
        type: OptionType.SELECT,
        description: "Which controller's button names the hints show",
        options: [
            { label: "Auto (from the controller)", value: "auto", default: true },
            { label: "Xbox (A B X Y)", value: "xbox" },
            { label: "PlayStation (✕ ○ □ △)", value: "playstation" },
            { label: "Nintendo (B A Y X)", value: "nintendo" },
        ],
    },
    buttonColors: {
        type: OptionType.SELECT,
        description: "Colours of the button hints",
        options: [
            { label: "Auto (coloured in the guide, plain elsewhere)", value: "auto", default: true },
            { label: "Controller colours everywhere", value: "brand" },
            { label: "Plain", value: "plain" },
            { label: "Highlight colour", value: "accent" },
        ],
    },
    hintsMoveTitle: {
        type: OptionType.BOOLEAN,
        description: "When the hints are in the top bar, move the server / channel name over to the right of them",
        default: true,
    },
    keyboardStartOn: {
        type: OptionType.SELECT,
        description: "When the keyboard opens, start on the message box's buttons (B / ▼ to the keys) or straight on the keys",
        options: [
            { label: "Box buttons", value: "box", default: true },
            { label: "Keys", value: "keys" },
        ],
    },
    backButton1: { type: OptionType.SELECT, description: "M1 / left back button (map it in Steam to the F13 or F9 key)", options: BACK_ACTIONS_OPTIONS(0) },
    backButton2: { type: OptionType.SELECT, description: "M2 / right back button (map it in Steam to the F14 or F10 key)", options: BACK_ACTIONS_OPTIONS(1) },
    backButton3: { type: OptionType.SELECT, description: "Back button 3 (map it in Steam to the F15 or Insert key)", options: BACK_ACTIONS_OPTIONS(2) },
    backButton4: { type: OptionType.SELECT, description: "Back button 4 (map it in Steam to the F16 or Pause key)", options: BACK_ACTIONS_OPTIONS(3) },
    showHints: {
        type: OptionType.BOOLEAN,
        description: "Show which controller buttons do what right now (a small bar above the message box)",
        default: true,
    },
    keyboardHideTitle: {
        type: OptionType.BOOLEAN,
        description: "While the keyboard is up, hide Discord's top bar (server name, back / forward, inbox) so the chat starts at the very top",
        default: true,
    },
    keyboardSlimHeader: {
        type: OptionType.BOOLEAN,
        description: "While the keyboard is up, shrink the channel header to a thin strip with just the name and description, for more chat",
        default: true,
    },
    drawerCover: {
        type: OptionType.BOOLEAN,
        description: "Side menus slide in over that side of the screen (covering the server / channel lists) instead of shrinking the app",
        default: true,
    },
    menuStyle: {
        type: OptionType.SELECT,
        description: "Look of pop-up menus: a blend of the plugin's style and Discord's, the plugin's big rows, or Discord's own",
        options: [
            { label: "Blend (plugin + Discord)", value: "blend", default: true },
            { label: "Handheld (big rows)", value: "handheld" },
            { label: "Discord default", value: "discord" },
        ],
    },
    drawerSide: {
        type: OptionType.SELECT,
        description: "Which side the menus slide in from",
        options: [
            { label: "The side with the server / channel lists (works with any theme)", value: "lists", default: true },
            { label: "Right", value: "right" },
            { label: "Left", value: "left" },
            { label: "Auto (the side away from what you held)", value: "auto" },
        ],
    },
    drawerWidth: {
        type: OptionType.SLIDER,
        description: "Side menu width (px)",
        markers: [280, 320, 360, 400, 440, 500],
        default: 360,
        stickToMarkers: false,
    },
    appShift: {
        type: OptionType.SELECT,
        description: "How the screen makes room for side menus and the keyboard",
        options: [
            { label: "Shrink the app", value: "shrink", default: true },
            { label: "Slide the app over", value: "slide" },
            { label: "Don't move it (cover it)", value: "none" },
        ],
    },
    onScreenKeyboard: {
        type: OptionType.BOOLEAN,
        description: "Show an on-screen keyboard when you start typing with the controller",
        default: true,
    },
    keyboardMode: {
        type: OptionType.SELECT,
        description: "On-screen keyboard style",
        options: [
            { label: "Grid (move to a key, press A)", value: "grid", default: true },
            { label: "Split (each stick points at a key on its half, LT / RT type)", value: "split" },
            { label: "Wheel (stick picks a group, A/B/X/Y type)", value: "wheel" },
        ],
    },
    keyboardHeight: {
        type: OptionType.SLIDER,
        description: "On-screen keyboard height (% of the screen, message box included)",
        markers: [30, 35, 40, 45, 50, 55, 60],
        default: 45,
        stickToMarkers: false,
    },
    sliderNotches: {
        type: OptionType.SLIDER,
        description: "Volume slider speed (steps per press)",
        markers: [2, 4, 8, 12, 16, 20],
        default: 10,
        stickToMarkers: false,
    },
    prefsVersion: {
        type: OptionType.NUMBER,
        description: "internal",
        default: 0,
        hidden: true,
    },
    showHelpOnConnect: {
        type: OptionType.BOOLEAN,
        description: "Show the controls list when a controller is first used",
        default: true,
    },
    keyboardSound: {
        type: OptionType.BOOLEAN,
        description: "On-screen keyboard: a soft click when a key is typed",
        default: true,
    },
    keyboardVolume: {
        type: OptionType.SLIDER,
        description: "On-screen keyboard click volume",
        markers: [0, 25, 50, 75, 100],
        default: 40,
        stickToMarkers: false,
    },
    splitStyle: {
        type: OptionType.SELECT,
        description: "Split keyboard typing style: how long an aimed key waits after you let go before the centre key comes back",
        options: [
            { label: "Forgiving (0.25 s — a late press still counts)", value: "forgiving" },
            { label: "Balanced (0.15 s)", value: "balanced", default: true },
            { label: "Fast (0.06 s — centre comes back almost instantly)", value: "fast" },
        ],
    },
    splitRollThrough: {
        type: OptionType.BOOLEAN,
        description: "Split keyboard: a press while the stick passes over s f / j l (e.g. springing back from t) types that key — fast rolls like \"wtf\"; repeated outer letters then need the stick held on them",
        default: false,
    },
    restartPending: { type: OptionType.BOOLEAN, description: "internal", default: false, hidden: true },
    restartRestoreTray: { type: OptionType.BOOLEAN, description: "internal", default: false, hidden: true },
    gameModeScale: {
        type: OptionType.SLIDER,
        description: "Game Mode: how big Discord is drawn (%), applied when Vesktop is started from Steam with the Handheld launcher (restart Vesktop to apply)",
        markers: [100, 150, 200, 250, 300],
        default: 200,
        stickToMarkers: false,
    },
    splitMoreInner: {
        type: OptionType.BOOLEAN,
        description: "Split keyboard: half-tilt keys up and down too (e t / i o move there; ! - / : take their edge spots)",
        default: false,
        onChange: () => renderKeyboard(),
    },
    splitEdge: {
        type: OptionType.SELECT,
        description: "Split keyboard: how far out the outer keys start",
        options: [
            { label: "Normal (from 93% tilt)", value: "normal" },
            { label: "Strict (only at the very edge, 96%+ — inner keys get more room)", value: "strict", default: true },
        ],
    },
    splitSensitivity: {
        type: OptionType.SLIDER,
        description: "Split keyboard: how far the sticks travel across the keys (lower = calmer)",
        markers: [0.6, 0.8, 1, 1.2, 1.4, 1.6],
        default: 1,
        stickToMarkers: false,
    },
    holdSpeed: {
        type: OptionType.SLIDER,
        description: "How fast the selection repeats while you hold a direction",
        markers: [0.5, 0.75, 1, 1.25, 1.5, 2],
        default: 1,
        stickToMarkers: false,
    },
    highlightColor: {
        type: OptionType.STRING,
        description: "Selection ring / frame color (\"theme\" = your theme's accent, or a color like #ff4fa3)",
        default: "theme",
        onChange: () => applyColors(),
    },
    keyboardColor: {
        type: OptionType.STRING,
        description: "On-screen keyboard: selected key color (\"same\" = the highlight color, or a color like #3ba5ff)",
        default: "same",
        onChange: () => applyColors(),
    },
});

/** Colors to pick from in the controller settings (the plugin settings page also takes any CSS color). */
const COLOR_CHOICES: [string, string][] = [
    ["theme", "Theme"], ["#5865f2", "Blurple"], ["#3ba5ff", "Blue"], ["#00c8d7", "Cyan"], ["#23a55a", "Green"],
    ["#f0b232", "Yellow"], ["#ff9f43", "Orange"], ["#f23f43", "Red"], ["#ff4fa3", "Pink"], ["#a970ff", "Purple"], ["#ffffff", "White"],
];
/** Point our accent variables at the chosen colors (left alone = the theme's own accent). */
function applyColors() {
    const hl = opt<string>("highlightColor"), kb = opt<string>("keyboardColor");
    setRootVar("--hh-accent", hl && hl !== "theme" ? hl : "var(--focus-primary, var(--brand-500, var(--brand-experiment, #5865f2)))");
    setRootVar("--hh-kb-accent", kb && kb !== "same" ? kb : "var(--hh-accent)");
}

/** A setting's value, falling back to its default (settings added in an update may not be saved yet). */
/** Back buttons: Steam can't pass them to apps, but it can turn them into keyboard keys — these (either of each pair). */
const BACK_KEYS: string[][] = [["F13", "F9"], ["F14", "F10"], ["F15", "Insert"], ["F16", "Pause"]];
const BACK_ACTIONS: [string, string][] = [["mute", "Mute / unmute mic"], ["deafen", "Deafen / undeafen"], ["type", "Type in the open chat"], ["switcher", "Quick switcher (jump anywhere)"], ["back", "Previous channel"], ["newest", "Jump to newest message"], ["read", "Mark channel read"], ["inbox", "Open inbox"], ["chatonly", "Big chat on / off"], ["none", "Nothing"]];
const BACK_DEFAULTS = ["mute", "type", "switcher", "back"];
/** What the back buttons are called (ROG Ally: M1 / M2; slots 3 and 4 for controllers with four). */
const BACK_NAMES = ["M1", "M2", "Back 3", "Back 4"];
const OPT_DEFAULTS: Record<string, unknown> = {
    backButton1: "mute", backButton2: "type", backButton3: "switcher", backButton4: "back",
    menuDrawer: true, menuStyle: "blend", keyboardChatOnly: true, keyboardStartOn: "box", showHints: true, buttonLayout: "auto", buttonColors: "auto", hintsMoveTitle: true, keyboardHideTitle: true, keyboardSlimHeader: true, drawerCover: true, drawerSide: "lists", drawerWidth: 360, appShift: "shrink",
    onScreenKeyboard: true, keyboardMode: "grid", keyboardHeight: 45, sliderNotches: 10,
    splitStyle: "balanced", splitRollThrough: false, splitEdge: "strict", splitMoreInner: false, gameModeScale: 200, splitSensitivity: 1, holdSpeed: 1, highlightColor: "theme", keyboardColor: "same", keyboardSound: true, keyboardVolume: 40,
};
function opt<T = any>(key: string): T {
    const v = (settings.store as any)[key];
    return (v === undefined || v === null || v === "" ? OPT_DEFAULTS[key] : v) as T;
}

const VERSION = "v6.32";
const brandHtml = `<a href="https://github.com/AhmxdNYC/discord-handheld-controls" target="_blank" rel="noopener noreferrer" aria-label="Handheld Controls on GitHub">Handheld × Controller</a>`;
// Discord's own message sending (used only if pressing Enter in the box doesn't send)
const MessageActions = findByPropsLazy("sendMessage", "editMessage");

// ---------- constants ----------
const enum Btn {
    A = 0, B = 1, X = 2, Y = 3,
    LB = 4, RB = 5, LT = 6, RT = 7,
    View = 8, Menu = 9, L3 = 10, R3 = 11,
    Up = 12, Down = 13, Left = 14, Right = 15,
}

type Dir = "up" | "down" | "left" | "right";
type Mode = "sections" | "inside";

const FOCUS_ATTR = "data-hh-focus";
const REPEAT_DELAY = 300;
const REPEAT_SLOW = 95;
const REPEAT_FAST = 50;
const ACCEL_AFTER = 900;
const FAST_TAP = 170;

const ROW = {
    server: '[data-list-item-id^="guildsnav___"]',
    channel: '[data-list-item-id^="channels___"], [data-list-item-id^="private-channels-"]',
    message: 'li[id^="chat-messages-"]',
};
const ROW_ANY = Object.values(ROW).join(", ");
/** Discord marks its lists with data-list-id, but not always (the server channel list lost it): rows still carry
 *  "<listId>___<itemId>", so such lists get our own data-hh-list on the box holding all their rows (see tagLists). */
const LIST = "[data-list-id], [data-hh-list]";
const listIdOf = (el: Element) => el.getAttribute("data-list-id") ?? el.getAttribute("data-hh-list");
const listSel = (id: string) => { const v = id.replace(/["\\]/g, ""); return `[data-list-id="${v}"], [data-hh-list="${v}"]`; };
const CHAT_LIST = listSel("chat-messages");
const MENU_ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="listbox"] [role="option"]';
const NEW_JUMP = '[class*="unreadMentionsBar"]:not([aria-hidden="true"]), [class*="mentionsBar"][role="button"]:not([aria-hidden="true"]), [class*="unreadBar"]:not([aria-hidden="true"])';
const FOCUSABLE = [
    NEW_JUMP, '[data-hh-discovered]',
    'label:has(input[type="checkbox"]), label:has(input[type="radio"])', "button", "a[href]", 'input:not([type="hidden"])', "textarea", "select",
    '[role="button"]', '[role="tab"]', '[role="option"]', '[role="switch"]', '[role="checkbox"]', '[role="gridcell"]',
    '[role="radio"]', '[role="link"]', '[role="treeitem"]', '[role="slider"]', '[role="combobox"]',
    '[role="textbox"]', '[contenteditable="true"]', MENU_ITEM, '[tabindex="0"]', ROW_ANY,
].join(", ");
const TEXT_ENTRY = '[role="textbox"], [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea';
// landmarks that make a natural "section" when there's no scroll area
const LANDMARK = 'form, nav, aside, section, header, main, [role="tablist"], [role="toolbar"], [role="listbox"], [role="dialog"], [role="list"], [role="tree"]';

// ---------- state ----------
let raf = 0;
let frame = 0;
let prevPressed: boolean[] = [];
let navigationButtonsBlocked = false;
let heldDir: Dir | null = null;
let heldSince = 0;
let lastRepeat = 0;
let lastMoveAt = 0;
let lastPadUse = -Infinity;

let mode: Mode = "sections";
let section: Element | null = null;      // the highlighted / locked-in section
let focused: Element | null = null;      // the selected item (only while locked in, or in a menu)
let typingMode = false;
let typingBase = 0; // windows open when typing started (see watchLayers)
const memory = new WeakMap<Element, Element>(); // last item used in each section
type Saved = { mode: Mode; section: Element | null; focused: Element | null; };
let returnStack: Saved[] = [];
let lastMenu: Element | null = null;

let styleEl: HTMLStyleElement | null = null;
let ringEl: HTMLDivElement | null = null;
let frameEl: HTMLDivElement | null = null;
let helpEl: HTMLDivElement | null = null;
let helpShownOnce = false;

// ---------- basic helpers ----------
const isOurs = (el: Element) => !!el.closest(".hh-ring, .hh-frame, .hh-help, .hh-toast, .hh-debug, .hh-kb, .hh-panel, #hh-input-recorder");
const isVisible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
};
const center = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const isDisabled = (el: Element) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true"
    || !!el.closest('[inert], [aria-disabled="true"], fieldset[disabled]')
    || (el.matches("label") && !!el.querySelector("input:disabled"));
/** The open pop-up menu — the deepest one when a sub-menu ("Apps ›") is open on top of its parent. */
/** (Searching Discord's whole page is the plugin's biggest cost, so the answer is kept for the rest of the frame;
 *  anything that opens / closes a menu resets it with `menuChanged()`.) */
let openMenuFrame = -1, openMenuVal: HTMLElement | null = null;
const menuChanged = () => { openMenuFrame = -1; bumpChecks(); };
/** Menus and windows only open right after some input — so the page is only searched for them for a second after
 *  any input (and while one is open). `checksPaused` is set each frame by the input loop. */
let checkUntil = 0, checksPaused = false, lastBgCheck = 0;
const bumpChecks = () => { checkUntil = performance.now() + 1000; checksPaused = false; };
const openMenu = (): HTMLElement | null => {
    if (checksPaused && openMenuFrame >= 0) return openMenuVal;
    // (every other frame is plenty: at 60–120 fps a new menu is still picked up within ~17 ms)
    if (openMenuFrame >= 0 && frame - openMenuFrame < 2 && (!openMenuVal || openMenuVal.isConnected)) return openMenuVal;
    const menus = document.querySelectorAll<HTMLElement>('[role="menu"]');
    openMenuVal = menus[menus.length - 1] ?? openDropdown();
    openMenuFrame = frame;
    return openMenuVal;
};
/** A dropdown's option list (settings "Select" boxes: language, theme, input device...). Treated just like a pop-up menu. */
function openDropdown(): HTMLElement | null {
    if (isTyping()) return null; // that's the chat's autocomplete, leave it to the keyboard
    const trig = document.querySelector('[aria-expanded="true"]:is([role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"])');
    if (!trig) return null;
    const id = trig.getAttribute("aria-controls");
    const byId = id ? document.getElementById(id) : null;
    const box = byId?.matches('[role="listbox"]') ? byId : byId?.querySelector<HTMLElement>('[role="listbox"]')
        ?? [...document.querySelectorAll<HTMLElement>('[role="listbox"]')].find(l => isVisible(l) && !!l.querySelector('[role="option"]'));
    return box && isVisible(box) && box.querySelector('[role="option"]') ? box : null;
}
const alive = (el: Element | null | undefined): el is Element => !!el && el.isConnected;

function isOnTop(el: Element) {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + Math.min(r.width / 2, 24), 1), window.innerWidth - 2);
    const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 24), 1), window.innerHeight - 2);
    let hit = document.elementFromPoint(x, y);
    if (hit && isOurs(hit)) hit = document.elementsFromPoint(x, y).find(node => !isOurs(node)) ?? null;
    if (!hit) return false;
    if (hit === el || el.contains(hit)) return true;
    // a text box with its grey "Message @someone" placeholder drawn on top of it still counts as visible
    if (el.matches(TEXT_ENTRY)) {
        let wrap: Element | null = el;
        for (let i = 0; i < 4 && wrap; i++) {
            wrap = wrap.parentElement;
            if (wrap && wrap.contains(hit) && wrap.getBoundingClientRect().height < 200) return true;
        }
    }
    return false;
}

function isScrollArea(n: Element) {
    const s = getComputedStyle(n);
    return (s.overflowY === "auto" || s.overflowY === "scroll") && (n as HTMLElement).clientHeight > 40;
}

function scrollableAncestor(el: Element | null): HTMLElement | null {
    let n = el?.parentElement ?? null;
    while (n && n !== document.body) {
        const s = getComputedStyle(n);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && n.scrollHeight > n.clientHeight) return n;
        n = n.parentElement;
    }
    return null;
}

function isTyping() {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}

// ---------- items and sections ----------
/** The X / ESC that closes settings or a window. Never a place to land while moving — B closes things instead. */
function isCloseButton(el: Element) {
    const label = (el.getAttribute("aria-label") ?? "").trim();
    if (/^close\b|\bclose$/i.test(label)) return true;
    const text = (el.textContent ?? "").trim();
    if (/^(esc|×|✕)$/i.test(text)) return true;
    // Discord's settings closer: a round X with "ESC" written under it
    const box = el.parentElement;
    return !!box && box.children.length <= 3 && /^esc$/i.test((box.textContent ?? "").replace(text, "").trim());
}

/** Discover Discord controls without relying on theme class names or English labels.
 * React delegates events, so onclick alone misses its otherwise unmarked buttons. */
let discoveredAt = -Infinity;
const discovered = new Set<Element>();
function discoverControls() {
    if (performance.now() - discoveredAt < 500) return;
    discoveredAt = performance.now();
    const next = new Set<Element>();
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
        // Cheap event check first: avoid selector walks and layout reads for ordinary text/layout nodes.
        const key = Object.keys(el).find(k => k.startsWith("__reactProps"));
        const props = key ? (el as any)[key] : null;
        const click = typeof el.onclick === "function" || typeof props?.onClick === "function";
        const pointer = el.style?.cursor === "pointer";
        if (!click && !pointer) continue;
        if (isOurs(el) || el.closest('.hh-brand, [inert], [aria-hidden="true"], [aria-disabled="true"], fieldset[disabled], [role="tooltip"]')
            || isDisabled(el) || el.matches('[role="separator"], html, body')) continue;
        if (el.matches(FOCUSABLE.replace(', [data-hh-discovered]', ''))) continue;
        if (!click && el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue;
        if (!isVisible(el) || !isOnTop(el)) continue;
        // A wrapper for an existing target is not another navigation stop.
        const existing = [...el.querySelectorAll(FOCUSABLE)].some(control => {
            const target = controlTarget(control);
            return target !== el && isVisible(target) && isOnTop(target);
        });
        if (existing && !el.matches(NEW_JUMP)) continue;
        next.add(el);
    }
    for (const el of discovered) if (!next.has(el)) el.removeAttribute("data-hh-discovered");
    discovered.clear();
    for (const el of next) { el.setAttribute("data-hh-discovered", ""); discovered.add(el); }
}

/** React Aria renders switches as visually hidden inputs inside the visible, clickable label. */
function controlTarget(el: Element): Element {
    if (!el.matches('input[type="checkbox"], input[type="radio"]')) return el;
    const label = el.closest("label") ?? (el.id ? [...document.querySelectorAll("label[for]")].find(l => l.getAttribute("for") === el.id) : null);
    return label && isVisible(label) ? label : el;
}

/** Pressable things on top of the screen. Whole lists aren't items; neither are the little buttons inside a row. */
function itemsOnTop(within?: Element | null): Element[] {
    discoverControls();
    const root: ParentNode = within ?? document;
    // (drag handles like "Resize Sidebar" are focusable but nothing to select — and they'd glue whole columns together)
    const raw = [...new Set([...root.querySelectorAll(FOCUSABLE)].map(controlTarget))].filter(el => !isOurs(el) && !isDisabled(el) && isVisible(el) && !el.matches('[role="separator"]'));
    const set = new Set(raw);
    const out: Element[] = [];
    for (const el of raw) {
        const tile = expressionTile(el);
        if (tile && tile !== el) continue; // the GIF's favorite star is not a separate navigation stop
        const row = el.parentElement?.closest(ROW_ANY);
        if (row && set.has(row)) continue;
        if (!el.matches(ROW_ANY) && !el.matches(TEXT_ENTRY)) {
            const inner = el.querySelector(FOCUSABLE);
            if (!tile && inner && set.has(inner) && controlTarget(inner) !== el) continue; // a container, not an item
        }
        if (!isOnTop(el)) continue;
        out.push(el);
    }
    return out;
}

/** The account panel (your avatar, mute, deafen, settings): the small area holding the mic/deafen switches. */
function accountPanel(): Element | null {
    const switches = [...document.querySelectorAll('button[role="switch"], [role="switch"]')]
        .filter(b => isVisible(b) && !b.closest(LIST) && !b.closest('[role="dialog"]'));
    for (const sw of switches) {
        // climb while the area stays panel-sized (short and not wider than a sidebar)
        let n: Element | null = sw.parentElement, best: Element | null = null;
        while (n && n !== document.body) {
            const r = n.getBoundingClientRect();
            if (r.height > 140 || r.width > 480) break;
            if (n.querySelectorAll('[role="switch"]').length >= 2) best = n;
            n = n.parentElement;
        }
        if (best) {
            // include the avatar/name part if it sits right next to the buttons
            const up = best.parentElement;
            if (up && up.getBoundingClientRect().height <= 140 && up.getBoundingClientRect().width <= 480) return up;
            return best;
        }
    }
    // fallback (English Discord): climb from the settings gear itself
    const gear = document.querySelector('button[aria-label="User Settings"], [role="button"][aria-label="User Settings"]');
    if (gear && isVisible(gear)) {
        let n: Element | null = gear.parentElement, best: Element | null = null;
        while (n && n !== document.body) {
            const r = n.getBoundingClientRect();
            if (r.height > 140 || r.width > 480) break;
            best = n;
            n = n.parentElement;
        }
        return best;
    }
    return null;
}
let panelCache: { el: Element | null; at: number; } = { el: null, at: 0 };
function getPanel() {
    const now = performance.now();
    if (now - panelCache.at > 500 || (panelCache.el && !panelCache.el.isConnected)) panelCache = { el: accountPanel(), at: now };
    return panelCache.el;
}

/** Give unmarked lists a data-hh-list: the smallest box holding all rows of that list. Only writes when it changes. */
let listsTaggedAt = -Infinity;
function tagLists(force = false) {
    const now = performance.now();
    if (now - listsTaggedAt < (force ? 100 : 500)) return; // (forced: still at most ~10 times a second)
    listsTaggedAt = now;
    const byList = new Map<string, Element[]>();
    for (const row of document.querySelectorAll("[data-list-item-id]")) {
        const id = row.getAttribute("data-list-item-id")!;
        const cut = id.indexOf("___");
        if (cut <= 0) continue;
        const listId = id.slice(0, cut);
        if (listId === "NO_LIST") continue; // Discord's placeholder (search results): not one list
        if (!byList.has(listId)) byList.set(listId, []);
        byList.get(listId)!.push(row);
    }
    // search results: messages (role=article) outside the chat — they get rows like any list (A jumps to one)
    const results = [...document.querySelectorAll('[role="article"]')].filter(a => !a.closest(`${CHAT_LIST}, [role="dialog"]`) && a.getClientRects().length);
    if (results.length) byList.set("search-results", results);
    for (const [listId, rows] of byList) {
        if (rows[0].closest(`[data-list-id="${listId.replace(/["\\]/g, "")}"]`)) continue; // Discord marks it itself
        // the smallest box around all the rows (with a single row: the list element it sits in)
        let box: Element | null = rows.length > 1 ? rows[0].parentElement : rows[0].closest('ul, ol, [role="list"], [role="tree"]');
        while (box && box !== document.body && !rows.every(r => box!.contains(r))) box = box.parentElement;
        if (!box || box === document.body) continue;
        for (const old of document.querySelectorAll(`[data-hh-list="${listId.replace(/["\\]/g, "")}"]`)) if (old !== box) old.removeAttribute("data-hh-list");
        if (box.getAttribute("data-hh-list") !== listId) box.setAttribute("data-hh-list", listId);
    }
}

/** The section an item belongs to.
 *  1) Discord's own lists: a row's id is "<listId>___<itemId>", and the list carries data-list-id="<listId>".
 *     That gives exact sections for servers, channels/DMs and chat — no guessing.
 *  2) The account panel.
 *  3) Otherwise the nearest scroll area / landmark, but never something bigger than ~half the screen. */
function sectionOf(el: Element): Element {
    if (el.matches(NEW_JUMP)) return el;
    // (anything inside a list's row belongs to that list too — a member's booster badge is part of the member list)
    const rowId = (el.closest("[data-list-item-id]") ?? el).getAttribute("data-list-item-id");
    if (rowId && rowId.includes("___") && !rowId.startsWith("NO_LIST")) {
        const listId = rowId.split("___")[0];
        let list = el.closest(listSel(listId));
        if (!list) { tagLists(true); list = el.closest(listSel(listId)); }
        if (list) return listSectionFor(list);
    }
    if (el.matches(ROW.message)) {
        const list = el.closest(CHAT_LIST);
        if (list) return listSectionFor(list);
    }
    // a non-row item that lives in the same scroll area as a list (e.g. "Events", "Channels & Roles")
    {
        let n: Element | null = el.parentElement;
        while (n && n !== document.body) {
            if (isScrollArea(n)) {
                const lists = n.querySelectorAll(LIST);
                const r = n.getBoundingClientRect();
                // (a column-sized area only: a whole window that scrolls isn't "the list's area")
                if (lists.length === 1 && r.width * r.height <= window.innerWidth * window.innerHeight * 0.55) return n;
                break;
            }
            n = n.parentElement;
        }
    }
    const panel = getPanel();
    if (panel && panel.contains(el)) return panel;

    // tab bars and toolbars (e.g. Friends: Online / All / Pending / Add Friend) are their own section
    const bar = el.closest('[role="tablist"], [role="toolbar"]');
    if (bar && isVisible(bar)) return bar;

    // any short, wide strip with several buttons is a "bar" section (header bars, tab rows)
    {
        let n: Element | null = el.parentElement, strip: Element | null = null;
        while (n && n !== document.body) {
            const r = n.getBoundingClientRect();
            if (r.height > 90) break;
            if (r.width > r.height * 4 && n.querySelectorAll(FOCUSABLE).length >= 3) strip = n;
            n = n.parentElement;
        }
        if (strip) return strip;
    }

    const screen = window.innerWidth * window.innerHeight;
    let n: Element | null = el.parentElement;
    let lastSmall: Element | null = null;
    while (n && n !== document.body) {
        const r = n.getBoundingClientRect();
        if (r.width * r.height > screen * 0.55) break;
        lastSmall = n;
        if (isScrollArea(n) || n.matches(LANDMARK)) return n;
        n = n.parentElement;
    }
    return lastSmall ?? el;
}

/** All sections that currently have something pressable on top. */
function listSections(): Element[] {
    tagLists();
    const out = new Set<Element>();
    for (const el of itemsOnTop()) out.add(sectionOf(el));
    const secs = [...out].filter(s => {
        const r = s.getBoundingClientRect();
        return s.matches(NEW_JUMP) || r.width * r.height > 1500;
    });
    // settings: the whole options page is ONE section (no sections inside sections)
    {
        const merged: Element[] = [];
        for (const sec of secs) { const m = widen(sec); if (!merged.includes(m)) merged.push(m); }
        secs.length = 0; secs.push(...merged.filter(m => m.matches(NEW_JUMP) || !merged.some(o => o !== m && o.contains(m))));
    }
    // the settings / window X is a section of its own: move onto it and press A to close
    for (const c of closeButtons()) if (!secs.includes(c)) secs.push(c);
    return secs;
}

/** Settings' page list on the left (only while settings is open). */
function settingsSidebar(): Element | null {
    const list = newSettingsList();
    if (list) return listSectionFor(list);
    return settingsOpen() ? pageList() ?? document.querySelector('[class*="standardSidebarView"] [role="tablist"]') : null;
}
/** The options page that a part of settings belongs to: the biggest area around it that holds neither the page list nor the X. */
function settingsPane(el: Element, side: Element): Element {
    const closers = closeButtons();
    let n = el;
    while (n.parentElement && n.parentElement !== document.body && !n.parentElement.contains(side) && !closers.some(c => n.parentElement!.contains(c)))
        n = n.parentElement;
    return n;
}

/** The open channel's whole view (header, messages, message box, member list): ONE section, like a settings page. */
function chatPane(): Element | null {
    const list = [...document.querySelectorAll(CHAT_LIST)].find(isVisible);
    if (!list || list.closest('[role="dialog"]')) return null;
    // what the channel view must never swallow: the server list, the channel/DM list and the account panel —
    // by the page structure AND by what's on screen (themes can pin those over the chat's area)
    // (the member list too: it's a section of its own, with its own lock — not part of the chat)
    const others = [...document.querySelectorAll(`${listSel("guildsnav")}, ${listSel("channels")}, [data-list-id^="private-channels"], [data-hh-list^="private-channels"], [data-list-id^="members-"]`)];
    const panel = getPanel();
    if (panel) others.push(panel);
    const avoid = others.map(o => {
        const sc = o === panel ? o : listSectionFor(o);
        const r = sc.getBoundingClientRect(); // only the part that's on screen
        const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
        const left = Math.max(r.left, 0), right = Math.min(r.right, window.innerWidth);
        return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    }).filter(r => r.width > 10 && r.height > 10);
    const overlaps = (n: Element) => {
        const r = n.getBoundingClientRect();
        return avoid.some(a => Math.min(r.right, a.right) - Math.max(r.left, a.left) > 24 && Math.min(r.bottom, a.bottom) - Math.max(r.top, a.top) > 24);
    };
    // the channel's top bar (threads, pins, members, search) is its own section, so the channel view stops below it
    const isHeader = (h: Element) => {
        const r = h.getBoundingClientRect();
        return r.height > 0 && r.height <= 90 && h.querySelectorAll(FOCUSABLE).length >= 2;
    };
    const header = [...document.querySelectorAll('section[aria-label*="header" i], [aria-label="Channel header"], [class*="title_"][class*="container"], [class*="titleWrapper"], [class*="toolbar_"]')]
        .filter(isVisible).map(h => h.closest("section") ?? h).find(isHeader) ?? null;
    const stop = (n: Element) => others.some(o => n.contains(o)) || overlaps(n) || (!!header && n.contains(header) && !header.contains(list));
    let n: Element = list;
    while (n.parentElement && n.parentElement !== document.body && !stop(n.parentElement)) n = n.parentElement;
    return n;
}
/** The big section a smaller part belongs to (a settings page or the channel view), or the part itself. */
function widen(sec: Element): Element {
    if (sec.matches(NEW_JUMP)) return sec;
    if (isCloseSection(sec)) return sec;
    const side = settingsSidebar();
    if (side) return sec.contains(side) || side.contains(sec) ? sec : settingsPane(sec, side);
    if (overlayCount()) return sec;
    const pane = chatPane();
    return pane && pane.contains(sec) ? pane : sec;
}
const isMerged = (sec: Element) => {
    const side = settingsSidebar();
    if (side) return !sec.contains(side) && !side.contains(sec) && !isCloseSection(sec);
    return !overlayCount() && sec === chatPane();
};

/** Visible close buttons (settings X, dialog X) that are actually on screen and not covered. */
function closeButtons(): Element[] {
    if (!overlayCount()) return [];
    return [...document.querySelectorAll(FOCUSABLE)]
        .filter(el => !isOurs(el) && isCloseButton(el) && isVisible(el) && isOnTop(el));
}
const isCloseSection = (sec: Element | null) => !!sec && sec.matches(FOCUSABLE) && isCloseButton(sec);

/** A list's section: the scroll area around it if that area holds only this list, else the list itself. */
function listSectionFor(list: Element): Element {
    let n: Element | null = list.parentElement;
    while (n && n !== document.body) {
        if (isScrollArea(n)) return n.querySelectorAll(LIST).length === 1 ? n : list;
        n = n.parentElement;
    }
    return list;
}

/** Discord's own lists (servers, channels, DMs, friends, members, chat): just the rows, in order.
 *  Fast (no per-item hit testing) and skips the little extra buttons like a DM's "x". */
function listRows(sec: Element): Element[] | null {
    const list = sec.matches(LIST) ? sec : sec.querySelectorAll(LIST).length === 1 ? sec.querySelector(LIST) : null;
    if (!list) return null;
    const listId = listIdOf(list);
    const rendered = (el: Element) => el.getClientRects().length > 0 && !isDisabled(el);
    const sel = listId === "chat-messages" ? 'li[id^="chat-messages-"]' : listId === "search-results" ? '[role="article"]' : "[data-list-item-id]";
    const rows = [...list.querySelectorAll(sel)].filter(rendered);
    if (listId === "chat-messages") return rows;
    // links that aren't tagged rows (announcement / rules channels, "Channels & Roles"...) are rows too
    for (const a of sec.querySelectorAll('a[href], [role="link"]')) {
        if (!rendered(a) || !isVisible(a) || rows.includes(a) || rows.some(r => r.contains(a) || a.contains(r))) continue;
        rows.push(a);
    }
    // plus standalone things in the same area that aren't a row's own buttons (e.g. "Events", "Channels & Roles")
    // a small button inside a bigger pressable thing (an announcement channel's bell) stands for its parent, not itself
    const outermost = (el: Element) => {
        let o = el;
        for (let n = el.parentElement; n && n !== sec && sec.contains(n); n = n.parentElement) {
            if (rows.some(r => n!.contains(r))) break;
            if (n.matches(FOCUSABLE) && n.getBoundingClientRect().height <= 80) o = n;
        }
        return o;
    };
    const extras: Element[] = [];
    for (const el of sec.querySelectorAll(FOCUSABLE)) {
        if (rows.includes(el) || !rendered(el) || !isVisible(el) || rows.some(r => r.contains(el)) || rowAround(el, rows) !== null) continue;
        const o = outermost(el);
        if (o !== el && !(o.getClientRects().length > 0)) continue;
        if (o === el && el.querySelector(FOCUSABLE) && el.getBoundingClientRect().height > 80) continue; // a container, not an item
        if (!extras.includes(o)) extras.push(o);
    }
    for (const el of clickableExtras(sec, rows)) if (!extras.includes(el)) extras.push(el);
    if (!extras.length) return rows.sort((a, b) => (a.compareDocumentPosition(b) & 4 /* following */) ? -1 : 1);
    return [...rows, ...extras].sort((a, b) => (a.compareDocumentPosition(b) & 4 /* following */) ? -1 : 1);
}

/** Things that act like buttons but aren't marked as one (Discord's "Events", "Channels & Roles"...):
 *  outermost elements with a pointer cursor and some text, outside any row. Cached briefly — this is the slow path. */
const clickCache = new WeakMap<Element, { at: number; els: Element[]; }>();
function clickableExtras(sec: Element, rows: Element[]): Element[] {
    const hit = clickCache.get(sec);
    if (hit && performance.now() - hit.at < 400) return hit.els.filter(e => e.isConnected);
    const out: Element[] = [];
    let scanned = 0;
    for (const el of sec.querySelectorAll("div, a, li")) {
        if (++scanned > 600) break;
        if (rows.some(r => r === el || r.contains(el) || el.contains(r))) continue;
        if (out.some(o => o.contains(el))) continue;
        if (!isVisible(el) || el.closest(FOCUSABLE)) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 20 || r.height > 80) continue;
        if ((el.textContent ?? "").trim().length < 3) continue;
        if (getComputedStyle(el).cursor !== "pointer") continue;
        out.push(el);
    }
    clickCache.set(sec, { at: performance.now(), els: out });
    return out;
}

/** The row that an extra button (like a DM's "x") sits next to. */
function rowAround(el: Element, rows: Element[]): Element | null {
    let n: Element | null = el.parentElement;
    while (n && n !== document.body) {
        const inside = rows.filter(r => n!.contains(r));
        if (inside.length === 1) return inside[0];
        if (inside.length > 1) return null;
        n = n.parentElement;
    }
    return null;
}

/** A row plus its own buttons, left to right (the row itself first). */
function rowParts(row: Element, rows: Element[]): Element[] {
    // the smallest container that holds this row and no other row
    let box: Element = row;
    let n: Element | null = row.parentElement;
    while (n && n !== document.body && rows.filter(r => n!.contains(r)).length === 1) { box = n; n = n.parentElement; }
    const extras = [...box.querySelectorAll(FOCUSABLE)]
        .filter(el => el !== row && !rows.includes(el) && isVisible(el) && !isDisabled(el) && !el.querySelector(FOCUSABLE))
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return [row, ...extras];
}

/** The item a section "points at": the one you last used there, or the open server / channel / settings page. */
function preferredItem(sec: Element, items: Element[]): Element | null {
    const remembered = memory.get(sec);
    if (alive(remembered) && items.includes(remembered)) return remembered;
    const idOf = (el: Element) => el.getAttribute("data-list-item-id") ?? "";
    const gid = SelectedGuildStore.getGuildId();
    const cid = SelectedChannelStore.getChannelId();
    return items.find(el => el.matches(ROW.server) && (gid ? idOf(el).endsWith(gid) : idOf(el).includes("home"))) ??
        items.find(el => el.matches(ROW.channel) && !!cid && idOf(el).endsWith(cid)) ??
        items.find(el => el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current") === "page") ?? null;
}

/** Best item to land on when locking into a section. */
function entryItemFor(sec: Element): Element | null {
    // a pop-out: everything you could tap in it (a profile card's marked buttons alone would start you on its message box)
    const asWindow = !!sec.closest('[role="dialog"], [aria-modal="true"]') && !settingsSidebar() && !listFillsWindow(sec);
    const all = asWindow ? windowPressables(sec) : listRows(sec) ?? itemsOnTop(sec);
    // Close is reachable, but entering a window should prefer one of its ordinary actions.
    const actions = all.filter(el => !isCloseButton(el));
    const items = actions.length ? actions : all;
    if (!items.length) return null;
    const pick = preferredItem(sec, items);
    if (pick) return pick;

    // chat: newest visible message
    const msgs = items.filter(el => el.matches(ROW.message));
    if (msgs.length) return msgs[msgs.length - 1];

    // otherwise the top-left-most
    return items.reduce((best, el) => {
        const r = el.getBoundingClientRect(), b = best.getBoundingClientRect();
        return r.top + r.left * 0.3 < b.top + b.left * 0.3 - 2 ? el : best;
    }, items[0]);
}

/** Section to start on: settings' tab list if settings is open, else the channel list, else the first one. */
function defaultSection(): Element | null {
    const items = itemsOnTop();
    const secs = listSections();
    // the same section you'd get by moving there (a list can sit inside a bigger section, e.g. the DM list in its nav)
    const asListed = (s: Element) => secs.find(x => x === s || x.contains(s)) ?? s;
    // in settings: its page list
    if (settingsOpen()) {
        const side = newSettingsList() ? settingsSidebar() : null;
        if (side) return asListed(side);
        const tab = items.find(el => el.matches('[role="tab"][aria-selected="true"]')) ?? items.find(el => el.matches('[role="tab"]'));
        if (tab) return asListed(sectionOf(tab));
    }
    // otherwise: the channel / DM list (never the Friends bar)
    const chan = items.find(el => el.matches(ROW.channel));
    if (chan) return asListed(sectionOf(chan));
    return secs[0] ?? null;
}

/** Nearest element in a direction — edge-to-edge distance so big and small things compare fairly. */
function nearestInDirection(from: Element, candidates: Element[], dir: Dir, edgesOnly = false): Element | null {
    const a = edgesOnly ? visibleOutlineRect(from) : from.getBoundingClientRect();
    const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    let best: Element | null = null;
    let bestScore = Infinity;
    for (const el of candidates) {
        if (el === from || ((el.contains(from) || from.contains(el)) && !el.matches(NEW_JUMP) && !from.matches(NEW_JUMP))) continue;
        const b = edgesOnly ? visibleOutlineRect(el) : el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        const ahead = dir === "down" ? bc.y > ac.y + 2 : dir === "up" ? bc.y < ac.y - 2 : dir === "right" ? bc.x > ac.x + 2 : bc.x < ac.x - 2;
        if (!ahead) continue;
        // for big sections: must really be beyond our edge (a tall column next to us isn't "below" us)
        if (edgesOnly) {
            const beyond = dir === "down" ? b.top >= a.bottom - 24 : dir === "up" ? b.bottom <= a.top + 24 : dir === "right" ? b.left >= a.right - 24 : b.right <= a.left + 24;
            // overlapping layouts (default Discord floats the account panel over the bottom of the DM list):
            // a section that sticks out past our edge that way, or sits on our far edge, is still "that way"
            const sticksOut = dir === "down" ? b.bottom > a.bottom + 24 : dir === "up" ? b.top < a.top - 24 : dir === "right" ? b.right > a.right + 24 : b.left < a.left - 24;
            const onFarEdge = dir === "down" ? b.top > a.top + a.height / 2 && b.bottom >= a.bottom - 24
                : dir === "up" ? b.bottom < a.bottom - a.height / 2 && b.top <= a.top + 24
                : dir === "right" ? b.left > a.left + a.width / 2 && b.right >= a.right - 24
                : b.right < a.right - a.width / 2 && b.left <= a.left + 24;
            // (only for something lined up with us across the way we're going — not a taller column beside us)
            const across = dir === "up" || dir === "down"
                ? Math.min(a.right, b.right) - Math.max(a.left, b.left) > Math.min(a.width, b.width) * 0.5
                : Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) * 0.5;
            if (!beyond && !(across && (sticksOut || onFarEdge))) continue;
        }
        const primary =
            dir === "down" ? b.top - a.bottom : dir === "up" ? a.top - b.bottom : dir === "right" ? b.left - a.right : a.left - b.right;
        const side = dir === "up" || dir === "down"
            ? Math.max(0, b.left - a.right, a.left - b.right)
            : Math.max(0, b.top - a.bottom, a.top - b.bottom);
        const drift = dir === "up" || dir === "down" ? Math.abs(bc.x - ac.x) : Math.abs(bc.y - ac.y);
        // (a section that overlaps us — default Discord's DM list runs down behind the voice / account panels — counts
        //  by how far its middle is, not as "right next to us": the voice panel just above wins over it)
        const centre = dir === "up" ? ac.y - bc.y : dir === "down" ? bc.y - ac.y : dir === "left" ? ac.x - bc.x : bc.x - ac.x;
        const score = (primary >= 0 ? primary : Math.max(0, centre)) + side * 3 + drift * 0.15;
        if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
}

// ---------- selection + scrolling ----------
function ensureInView(el: Element, fast: boolean) {
    const behavior: ScrollBehavior = fast ? "auto" : "smooth";
    const sc = scrollableAncestor(el);
    if (!sc) return el.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
    const r = el.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    // look ahead: keep ~2½ items' worth of room past the selection (at least a quarter of the list, at most ~40%),
    // so moving through a list shows what's coming instead of only scrolling once you hit the edge
    const margin = Math.min(s.height * 0.38, Math.max(r.height * 2.5, s.height * 0.25));
    if (r.height > s.height - margin * 2) {
        if (r.top < s.top || r.top > s.bottom - 40) sc.scrollBy({ top: r.top - s.top - 12, behavior });
        return;
    }
    if (r.top < s.top + margin) sc.scrollBy({ top: r.top - (s.top + margin), behavior });
    else if (r.bottom > s.bottom - margin) sc.scrollBy({ top: r.bottom - (s.bottom - margin), behavior });
}

function markFast() {
    const now = performance.now();
    const fast = now - lastMoveAt < FAST_TAP;
    lastMoveAt = now;
    if (ringEl && ringEl.classList.contains("hh-fast") !== fast) ringEl.classList.toggle("hh-fast", fast);
    if (frameEl && frameEl.classList.contains("hh-fast") !== fast) frameEl.classList.toggle("hh-fast", fast);
    return fast;
}

function setItem(el: Element | null) {
    el = el && controlTarget(expressionTile(el) ?? el);
    if (el && nativePickerLock) {
        const layer = nativeExpressionPicker();
        if (layer?.contains(el)) {
            nativePickerLock.results = !!expressionTile(el);
            if (nativePickerLock.results) nativePickerLock.index = Math.max(0, nativeExpressionResults(layer).indexOf(el as HTMLElement));
        }
    }
    // inside pop-up menus everything is instant: no gliding ring, no smooth scrolling
    const inMenu = !!el && !!el.closest('[role="menu"]');
    const fast = markFast() || inMenu;
    if (ringEl && ringEl.classList.contains("hh-menu") !== inMenu) ringEl.classList.toggle("hh-menu", inMenu);
    if (inMenu) {
        if (ringEl && !ringEl.classList.contains("hh-fast")) ringEl.classList.add("hh-fast");
        if (frameEl && !frameEl.classList.contains("hh-fast")) frameEl.classList.add("hh-fast");
    }
    focused?.removeAttribute(FOCUS_ATTR);
    focused = el;
    if (!el) return;
    el.setAttribute(FOCUS_ATTR, "");
    if (section && section.contains(el)) memory.set(section, el);
    if (inMenu) { scrollWithinMenu(el); return; }
    ensureInView(el, fast);
}

/** Scroll only the menu's OWN scroll area, and only if needed. (scrollIntoView would also nudge the app behind the
 *  menu, and Discord re-positions open menus on every scroll — that was making menus feel laggy.) */
function scrollWithinMenu(el: Element) {
    const menu = el.closest('[role="menu"]');
    const stopAt = menu?.parentElement ?? null;
    let sc: HTMLElement | null = el.parentElement;
    while (sc && sc !== stopAt) {
        if (sc.scrollHeight > sc.clientHeight + 2) {
            const st = getComputedStyle(sc);
            if (st.overflowY === "auto" || st.overflowY === "scroll") break;
        }
        sc = sc.parentElement;
    }
    if (!sc || sc === stopAt) return;
    const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
    // (one item of look-ahead, so the next choice is already showing)
    const ahead = Math.min(r.height, b.height * 0.3);
    if (r.top < b.top + ahead) sc.scrollTop -= b.top + ahead - r.top;
    else if (r.bottom > b.bottom - ahead) sc.scrollTop += r.bottom - (b.bottom - ahead);
}

function highlightSection(sec: Element | null) {
    setItem(null);
    mode = "sections";
    section = sec;
    sectionKey = keyOf(sec);
}

function lockInto(sec: Element | null, quiet = false) {
    if (!sec) return;
    sec = widen(sec);
    section = sec;
    sectionKey = keyOf(sec);
    mode = "inside";
    // the message box: go straight to typing (not when you just moved past an edge into it)
    const box = quiet || overlayCount() || sec.querySelector(CHAT_LIST) ? undefined : [...sec.querySelectorAll('[role="textbox"][contenteditable="true"]')].find(b => isVisible(b));
    if (box) { setItem(box); startTyping(box); return; }
    const entry = entryItemFor(sec);
    setItem(entry);
    // a window that is just a text box (e.g. "add a note"): start typing; anything with more to it (a profile card), don't
    if (!quiet && entry && entry.matches(TEXT_ENTRY) && itemsOnTop(sec).length <= 1) startTyping(entry);
}

/** Settings just opened: go onto its page list, on the selected page — again once it has finished drawing, unless
 *  you've already moved. */
function enterSettingsList() {
    const go = () => {
        if (!controllerActive) return;
        const side = settingsSidebar() ?? defaultSection();
        if (!side) return;
        lockInto(side, true);
        const on = side.querySelector('[aria-selected="true"], [aria-current="page"], [class*="selected"]');
        const item = on?.closest(MENU_ITEM + ', [data-list-item-id], [role="tab"]') ?? on;
        if (item && isVisible(item)) setItem(item);
    };
    go();
    const f0 = focused;
    setTimeout(() => { if (focused === f0 || !alive(focused)) go(); lastOverlays = overlayCount(); }, 250);
}

/** Pushing past the edge of the section you're in moves you into the next section that way (still locked in). */
let moveIsRepeat = false; // this move comes from holding the direction down (auto-repeat), not a fresh press
function hop(dir: Dir, from: Element | null, fromSec: Element) {
    // holding a direction stops at the end of a list; a fresh press past the edge moves on (like a console menu)
    if (moveIsRepeat) return false;
    // only sections actually lined up with you that way (down from the server bar isn't the account panel off to the side)
    const fr = fromSec.getBoundingClientRect();
    const lined = (s: Element) => {
        const r = s.getBoundingClientRect();
        return dir === "up" || dir === "down"
            ? Math.min(r.right, fr.right) - Math.max(r.left, fr.left) > 16
            : Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top) > 16;
    };
    // inside a pop-out window, stay inside it
    const win = fromSec.closest('[role="dialog"], [aria-modal="true"]');
    const secs = listSections().filter(s => s !== fromSec && !isCloseSection(s) && !s.contains(fromSec) && !fromSec.contains(s) && lined(s)
        && (!win || win.contains(s)));
    const target = nearestInDirection(fromSec, secs, dir, true) ?? (from ? nearestInDirection(from, secs, dir, true) : null);
    if (!target) return false;
    lockInto(target, true);
    // land on the spot the section points at (where you were, the open channel / settings page) if it's on screen;
    // otherwise on whatever is closest to where you came from (moving sideways keeps your height, like a console menu)
    const rows = alive(section) ? listRows(section) : null;
    if (from && alive(section)) {
        const items = (rows?.length ? rows : itemsOnTop(section)).filter(isVisible);
        const pref = preferredItem(section, items);
        if (!pref || !isVisible(pref)) {
            const near = nearestInDirection(from, items, dir);
            if (near) setItem(near);
        }
    }
    markFast();
    debugNote(`hop ${dir} → ${describe(section).slice(0, 50)}`);
    return true;
}

function unlock() {
    if (typingMode) stopTyping();
    highlightSection(alive(section) && itemsOnTop(section).length ? section : defaultSection());
}

function startTyping(el: Element) {
    const field = el.matches(TEXT_ENTRY) ? el : el.querySelector(TEXT_ENTRY);
    if (!field) return;
    (field as HTMLElement).focus();
    typingMode = true;
    typingBase = overlayCount();
    // the cursor goes at the end of what's already there (focusing a box can leave it at the start, where delete
    // does nothing and new letters land in front of the old text)
    if ((field as HTMLElement).isContentEditable) {
        const sel = window.getSelection();
        if (sel) {
            const r = document.createRange();
            r.selectNodeContents(field); r.collapse(false);
            sel.removeAllRanges(); sel.addRange(r);
            document.dispatchEvent(new Event("selectionchange")); // (Discord's editor keeps its own copy of the cursor)
        }
    } else if (field.matches("input, textarea")) {
        const i = field as HTMLInputElement;
        try { i.setSelectionRange(i.value.length, i.value.length); } catch { }
    }
    // typing with the controller: bring up the on-screen keyboard
    if (performance.now() - lastPadUse < 1500) openKeyboard(field);
}

function stopTyping() {
    typingMode = false;
    closeKeyboard();
    if (isTyping()) (document.activeElement as HTMLElement).blur();
}

/** B while typing: stop typing — and if the box is empty, also drop a pending Reply / Edit
 *  (Escape in the box, which is what cancels them in Discord, whatever the language). */
function backOutOfTyping() {
    const f = kbTarget() ?? (isTyping() ? document.activeElement as HTMLElement : null);
    // (not in a pop-out: there Escape would close the whole card)
    // (and not in the search box: there Escape throws away the search results)
    // editing a message (the box inside the message itself): B cancels the edit, whatever is in it (☰ saves)
    const editedMsg = f?.closest(ROW.message) ?? null;
    if (f && f.isContentEditable && !f.matches('[role="combobox"]') && !f.closest('[role="dialog"]') && (editedMsg || !(f.innerText ?? "").replace(/﻿/g, "").trim())) pressKey("Escape", f);
    stopTyping();
    // the edit box goes away with the edit: land back on the message itself
    if (editedMsg) setTimeout(() => { if (alive(editedMsg) && mode === "inside") setItem(editedMsg); }, 120);
}

// ---------- movement ----------
function moveSections(dir: Dir) {
    const secs = listSections();
    if (!secs.length) return;
    if (!alive(section)) {
        const start = defaultSection() ?? secs[0];
        highlightSection(nearestInDirection(start, secs, dir, true) ?? start);
        return;
    }
    if (!alive(section) || !secs.includes(section)) {
        // the highlighted area isn't a known section any more: continue from where it was instead of getting stuck
        const from = alive(section) ? section : null;
        const next = from ? nearestInDirection(from, secs, dir, true) ?? nearestInDirection(from, secs, dir) : null;
        const pick = next ?? defaultSection() ?? secs[0];
        if (pick === section) return highlightSection(secs.find(s => s !== section) ?? pick);
        return highlightSection(pick);
    }
    const next = nearestInDirection(section, secs, dir, true);
    if (next) { markFast(); highlightSection(next); }
    else debugNote(`move ${dir}: no section that way (${secs.length} sections)`);
}

/** Something you can press at this spot: a real button/link, or a Discord div that only acts like one (pointer cursor). */
function pressableAt(hit: Element | null, region: Element): Element | null {
    if (!hit || isOurs(hit) || !region.contains(hit)) return null;
    let real = hit.closest(FOCUSABLE);
    // inside a list box (role pills, members): the item under the point, not the whole list
    if (real && real.matches(`${LIST}, [role="list"], [role="listbox"]`)) real = hit.closest('[role="listitem"], [role="option"], [data-list-item-id]') ?? real;
    if (real && region.contains(real) && real !== region) return real;
    // pointer cursor is inherited, so take the OUTERMOST element of the pointer-cursor run (the actual clickable box)
    let n: Element | null = hit, best: Element | null = null;
    for (let i = 0; n && i < 8 && n !== region; i++, n = n.parentElement) {
        if (n.getBoundingClientRect().height > 120) break;
        const c = getComputedStyle(n).cursor;
        if (c === "pointer" || c === "text") best = n;
        else if (best) break;
    }
    // a text box hiding under its placeholder: the box itself
    const box = best?.closest("form, [class*='inner'], [class*='textArea'], [class*='input']")?.querySelector(TEXT_ENTRY);
    if (box && region.contains(box)) return box;
    return best && (best.textContent ?? "").trim().length >= 2 ? best : null;
}

/** The column a list lives in (the channel sidebar, the server bar...), so a scan can find things the list itself doesn't mark. */
function columnOf(sec: Element): Element {
    return sec.closest('nav, aside, [role="navigation"]') ?? sec.parentElement ?? sec;
}

/** Walk the screen up or down from an item, looking at what's actually drawn there, and return the first pressable thing.
 *  This is what finds "Events", "Channels & Roles", announcement/rules channels etc. whatever Discord or a theme calls them. */
function scanColumn(from: Element, sec: Element, step: 1 | -1, limitY: number | null): Element | null {
    let region = columnOf(sec);
    // a pop-out window (or anything not in a sidebar column): look only inside it
    if (region === document.body || sec.closest('[role="dialog"]') || region.getBoundingClientRect().height < sec.getBoundingClientRect().height) region = sec;
    const fr = from.getBoundingClientRect();
    const sr = sec.getBoundingClientRect();
    const cr = region.getBoundingClientRect();
    const xs = [sr.left + Math.min(sr.width * 0.35, 90), sr.left + sr.width / 2].map(x => Math.min(Math.max(x, 1), window.innerWidth - 2));
    const edge = step > 0 ? Math.min(cr.bottom, window.innerHeight - 1) : Math.max(cr.top, 0);
    const end = limitY === null ? edge : (step > 0 ? Math.min(limitY, edge) : Math.max(limitY, edge));
    let y = step > 0 ? fr.bottom + 3 : fr.top - 3;
    for (let i = 0; i < 120 && (step > 0 ? y < end : y > end); i++, y += step * 6) {
        for (const x of xs) {
            const t = pressableAt(document.elementFromPoint(x, y), region);
            if (!t || t === from || t.contains(from) || from.contains(t) || isDisabled(t)) continue;
            return t;
        }
    }
    return null;
}

/** Slide a volume / sensitivity slider one notch. */
function nudgeSlider(el: Element, step: 1 | -1) {
    if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "range") {
        const inp = el as HTMLInputElement;
        const st = Math.max(Number(inp.step) || 0, (Number(inp.max || 100) - Number(inp.min || 0)) * opt("sliderNotches") / 80);
        const v = Math.min(Math.max(Number(inp.value) + step * st, Number(inp.min || 0)), Number(inp.max || 100));
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), "value")?.set?.call(inp, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
    }
    const before = el.getAttribute("aria-valuenow");
    (el as HTMLElement).focus?.();
    // several notches per press so it doesn't crawl: Page keys move 10 at once; Discord takes only one key per frame,
    // so the rest are spaced out a frame apart
    const n = Math.max(1, Math.round(opt<number>("sliderNotches")));
    const keys = [
        ...Array(Math.floor(n / 10)).fill(step > 0 ? "PageUp" : "PageDown"),
        ...Array(n % 10).fill(step > 0 ? "ArrowRight" : "ArrowLeft"),
    ] as string[];
    const send = (i: number) => {
        if (i >= keys.length || !el.isConnected) return;
        for (const type of ["keydown", "keyup"]) el.dispatchEvent(keyEvent(type, keys[i]));
        requestAnimationFrame(() => send(i + 1));
    };
    send(0);
    // didn't move: drag its handle a little instead
    setTimeout(() => {
        if (!el.isConnected || el.getAttribute("aria-valuenow") !== before) return;
        const track = (el.getAttribute("role") === "slider" ? el : el.closest('[role="slider"]')) ?? el;
        const handle = track.querySelector('[class*="grabber"], [class*="handle"], [class*="thumb"]') ?? track;
        const tr = track.getBoundingClientRect(), hr = handle.getBoundingClientRect();
        const x = hr.left + hr.width / 2, y = hr.top + hr.height / 2, dx = step * Math.max(12, tr.width / 8);
        const ev = (t: string, cx: number) => new MouseEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: y, button: 0, buttons: t === "mouseup" ? 0 : 1 });
        handle.dispatchEvent(ev("mousedown", x));
        document.dispatchEvent(ev("mousemove", x + dx));
        document.dispatchEvent(ev("mouseup", x + dx));
    }, 40);
}

/** The part of a merged section an item sits in (the message list, the message box, a settings group...). */
function partOf(el: Element, pane: Element): Element {
    const p = sectionOf(el);
    return p && pane.contains(p) && p !== pane ? p : pane;
}

function moveInside(dir: Dir) {
    if (!alive(section)) return unlock();
    if ((dir === "left" || dir === "right") && alive(focused) && focused.matches('[role="slider"], input[type="range"]'))
        return nudgeSlider(focused, dir === "right" ? 1 : -1);
    // try to move inside the section; if nothing moves (no item that way, nothing left to scroll), go to the next section
    const before = focused, sec0 = section;
    const sc = alive(focused) ? scrollableAncestor(focused) : null;
    const top = sc?.scrollTop;
    moveInsideCore(dir);
    if (focused === before && section === sec0 && mode === "inside" && (!sc || sc.scrollTop === top)) {
        // the chat's top just means "older messages are loading": don't jump out
        if (dir === "up" && alive(before) && before.matches(ROW.message)) return;
        hop(dir, alive(before) ? before : null, sec0);
    }
}

/** Everything in a pop-out you could tap: marked buttons plus whatever is drawn as clickable / typeable (sampled on a grid). */
const winCache = new WeakMap<Element, { at: number; els: Element[]; }>();
function windowPressables(win: Element): Element[] {
    const hit = winCache.get(win);
    if (hit && performance.now() - hit.at < 350 && hit.els.every(e => e.isConnected)) return hit.els;
    const set = new Set<Element>(itemsOnTop(win));
    const r = win.getBoundingClientRect();
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight), left = Math.max(r.left, 0), right = Math.min(r.right, window.innerWidth);
    for (let y = top + 10; y < bottom - 4; y += 22)
        for (let x = left + 12; x < right - 4; x += 26) {
            const p = pressableAt(document.elementFromPoint(x, y), win);
            if (p && p.getBoundingClientRect().height < 160) set.add(p);
        }
    // a list box (a card's role pills) isn't a stop of its own when you can reach what's inside it
    for (const e of [...set]) if (e.matches(`${LIST}, [role="list"], [role="listbox"]`) && [...set].some(o => o !== e && e.contains(o))) set.delete(e);
    // drop things inside other things in the set (keep the outer, tappable box)
    const els = [...set].filter(e => ![...set].some(o => o !== e && o.contains(e) && !e.matches(TEXT_ENTRY)));
    els.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); });
    winCache.set(win, { at: performance.now(), els });
    return els;
}

/** Walk sideways across the screen from an item, inside its section, and return the first other pressable thing. */
function scanSideways(from: Element, sec: Element, dir: "left" | "right"): Element | null {
    const a = from.getBoundingClientRect(), sr = sec.getBoundingClientRect();
    const y = a.top + a.height / 2;
    const step = dir === "right" ? 6 : -6;
    for (let x = dir === "right" ? a.right + 3 : a.left - 3, i = 0; i < 150 && x > sr.left && x < sr.right; x += step, i++) {
        const t = pressableAt(document.elementFromPoint(x, y), sec);
        if (t && t !== from && !t.contains(from) && !from.contains(t)) return t;
    }
    return null;
}

function moveInsideCore(dir: Dir) {
    if (!alive(section)) return unlock();
    const pane = section;
    const composer = alive(focused) ? focused.closest("form") : null;
    if (composer && pane.contains(composer) && composer.querySelector('[role="textbox"][contenteditable="true"]')) {
        const before = focused;
        moveInWindow(composer, dir);
        if (focused !== before || dir !== "up") return;
        const previous = nearestInDirection(focused!, itemsOnTop(pane).filter(el => !composer.contains(el)), "up");
        if (previous) setItem(previous);
        return;
    }
    // settings pages: plain free movement over the whole page (already works well); the channel view: part by part
    if (settingsSidebar() || !isMerged(pane) || !alive(focused) || !pane.contains(focused)) return moveIn(pane, dir);
    const part = partOf(focused, pane);
    if (part === pane) return moveIn(pane, dir);
    // move inside the part first (rows, scrolling...), and only when that goes nowhere, cross to the next part
    const before = focused;
    const sc = scrollableAncestor(focused);
    const top = sc?.scrollTop;
    moveIn(part, dir);
    if (focused !== before || (sc && sc.scrollTop !== top) || section !== pane) return;
    const fr = focused.getBoundingClientRect();
    const others = itemsOnTop(pane).filter(el => {
        if (part.contains(el)) return false;
        const r = el.getBoundingClientRect();
        // up / down: only things really above / below you — past your edge, not just past your middle (a very tall
        // message's middle is far down) — and not off to the side (the member list isn't "below" the last message)
        if (dir === "up" || dir === "down")
            return r.left < fr.right && r.right > fr.left && (dir === "up" ? r.bottom <= fr.top + 8 : r.top >= fr.bottom - 8);
        // sideways: only things level with you
        return r.top < fr.bottom && r.bottom > fr.top;
    });
    // straight back the way you came (right into the member list, then left: the message you came from)
    const back = { up: "down", down: "up", left: "right", right: "left" }[dir];
    if (crossedFrom && crossedFrom.to === focused && crossedFrom.dir === back && alive(crossedFrom.from) && isVisible(crossedFrom.from) && pane.contains(crossedFrom.from)) {
        const from = crossedFrom.from;
        crossedFrom = null;
        return setItem(from);
    }
    let next = nearestInDirection(focused, others, dir);
    // landed on a little button inside a row (a member's booster badge): the row itself
    const row = next?.closest('[data-list-item-id], [data-hh-list="search-results"] [role="article"]');
    if (row && row !== next && pane.contains(row)) next = row;
    // landed on a whole list (the member list box itself is focusable): go to its nearest row instead
    if (next && next.matches(LIST)) {
        const rows = (listRows(next) ?? []).filter(isVisible);
        next = nearestInDirection(focused, rows, dir) ?? rows[0] ?? next;
    }
    if (next) { crossedFrom = { from: focused, to: next, dir }; setItem(next); }
}
let crossedFrom: { from: Element; to: Element; dir: Dir; } | null = null;

/** A pop-out window (profile card…): move over everything you could tap in it, line by line, so nothing is skipped. */
function moveInWindow(sec: Element, dir: Dir) {
    const all = windowPressables(sec);
    if (!all.length) return;
    if (!alive(focused) || !all.includes(focused)) return setItem(all[0]);
    const a = focused.getBoundingClientRect();
    const past = all.filter(p => {
        if (p === focused) return false;
        const b = p.getBoundingClientRect();
        return dir === "down" ? b.top >= a.bottom - 4 : dir === "up" ? b.bottom <= a.top + 4 : dir === "right" ? b.left >= a.right - 4 && b.top < a.bottom && b.bottom > a.top : b.right <= a.left + 4 && b.top < a.bottom && b.bottom > a.top;
    });
    let n: Element | null = null;
    if ((dir === "up" || dir === "down") && past.length) {
        // go to the very next line of things (never skip a row), and the closest thing on it
        const rs = past.map(p => [p, p.getBoundingClientRect()] as const);
        const edge = dir === "down" ? Math.min(...rs.map(([, r]) => r.top)) : Math.max(...rs.map(([, r]) => r.bottom));
        const line = rs.filter(([, r]) => dir === "down" ? r.top <= edge + 14 : r.bottom >= edge - 14);
        const cx = a.left + a.width / 2;
        line.sort((p, q) => Math.abs(p[1].left + p[1].width / 2 - cx) - Math.abs(q[1].left + q[1].width / 2 - cx));
        n = line[0]?.[0] ?? null;
    } else n = nearestInDirection(focused, past, dir);
    if (n) return setItem(n);
    // nothing that way on screen: scroll the window's content if it can
    const sc = scrollableAncestor(focused);
    if (sc && sec.contains(sc) && (dir === "up" || dir === "down")) sc.scrollBy({ top: (dir === "down" ? 1 : -1) * Math.max(80, sc.clientHeight * 0.4) });
    return;
}

/** Treat a pop-out as one list only when a list fills most of it (Pinned Messages); a card that merely contains a
 *  small list (a profile card's role pills) is navigated as a window, or everything outside the list is skipped. */
function listFillsWindow(sec: Element): boolean {
    const lists = sec.querySelectorAll(LIST);
    if (lists.length !== 1) return false;
    const l = lists[0].getBoundingClientRect(), w = sec.getBoundingClientRect();
    return l.width * l.height >= w.width * w.height * 0.5;
}

function moveIn(sec: Element, dir: Dir) {
    if ((dir === "left" || dir === "right") && alive(focused) && focused.matches('[role="slider"], input[type="range"]'))
        return nudgeSlider(focused, dir === "right" ? 1 : -1);

    if (sec.closest('[role="dialog"], [aria-modal="true"]') && !settingsSidebar() && !listFillsWindow(sec)) return moveInWindow(sec, dir);

    // Discord lists: up/down steps through the rows; left/right moves across the current row's own buttons (x, gear...)
    const rows = listRows(sec);
    if (rows && rows.length) {
        const rowOf = (el: Element | null) => (el ? rows.find(r => r === el || r.contains(el)) ?? rowAround(el, rows) : null);
        const currentRow = alive(focused) ? rowOf(focused) : null;

        if (dir === "left" || dir === "right") {
            // a message's own buttons are reached with A (go inside it); sideways leaves the chat (member list, next section)
            if (!currentRow || currentRow.matches(ROW.message)) return;
            const parts = rowParts(currentRow, rows);
            const i = parts.indexOf(focused!);
            const next = parts[(i < 0 ? 0 : i) + (dir === "right" ? 1 : -1)];
            if (next) return setItem(next);
            // things side by side on the same line (a tab bar above the list: Online · All · Pending)
            const a = focused!.getBoundingClientRect();
            const level = rows.filter(r => {
                if (r === currentRow || !isVisible(r)) return false;
                const b = r.getBoundingClientRect();
                return b.top < a.bottom - 4 && b.bottom > a.top + 4;
            });
            const side = nearestInDirection(focused!, level, dir);
            if (side) setItem(side);
            return;
        }

        const step = dir === "down" ? 1 : -1;
        const isChat = sec.matches(CHAT_LIST) || !!sec.querySelector(CHAT_LIST);
        // something we found by scanning (not one of the list's rows): keep going by position
        // on the message box below the chat: up goes back to the newest message
        if (isChat && alive(focused) && focused.matches(TEXT_ENTRY) && !sec.contains(focused)) { // (message box outside the list)
            if (step < 0) { const vis = rows.filter(isVisible); if (vis.length) setItem(vis[vis.length - 1]); }
            return;
        }
        const from = currentRow ?? (alive(focused) && sec.contains(focused) || alive(focused) && columnOf(sec).contains(focused!) ? focused : null);
        if (!from) {
            const vis = rows.filter(isVisible);
            return setItem((step < 0 ? vis[0] : vis[vis.length - 1]) ?? entryItemFor(sec));
        }
        let next: Element | undefined;
        if (currentRow) {
            next = rows[rows.indexOf(currentRow) + step];
            // page order is right for the list's own rows; loose buttons around it (tabs, search, "New Group DM")
            // go by position, so up from the search box is the tab above it, not whatever comes before it in the page
            const isListRow = (r: Element) => r.matches("[data-list-item-id], " + ROW.message);
            if (next && !(isListRow(currentRow) && isListRow(next))) {
                const fy = center(currentRow).y;
                const ahead = (r: Element) => step > 0 ? center(r).y > fy + 4 : center(r).y < fy - 4;
                next = nearestInDirection(currentRow, rows.filter(ahead), dir) ?? undefined;
            }
        } else {
            const fy = center(from).y;
            const byPos = rows.filter(r => step > 0 ? center(r).y > fy + 2 : center(r).y < fy - 2);
            next = step > 0 ? byPos[0] : byPos[byPos.length - 1];
        }
        if (!isChat) {
            // anything drawn between here and the next row that the list doesn't mark (announcements, "Channels & Roles"...)
            const nr = next && isVisible(next) ? next.getBoundingClientRect() : null;
            const limit = nr ? (step > 0 ? nr.top + 2 : nr.bottom - 2) : (scrollableAncestor(from)?.getBoundingClientRect()[step > 0 ? "bottom" : "top"] ?? null);
            let found = scanColumn(from, sec, step, limit);
            // landed on (part of) a real row? use the row itself
            const asRow = found ? rows.find(r => r === found || r.contains(found!) || found!.contains(r)) : undefined;
            if (asRow) found = asRow;
            if (found && found !== next && found !== currentRow) { debugNote(`scan found ${describe(found).slice(0, 60)}`); return setItem(found); }
        }
        if (next) return setItem(next);
        // end of what Discord has built: scroll a bit, then continue from the new rows
        const sc = scrollableAncestor(from);
        const before = sc?.scrollTop ?? 0;
        if (sc) sc.scrollBy({ top: step * Math.max(80, sc.clientHeight * 0.4) });
        if (!sc || sc.scrollTop === before) {
            // the real end of the list: look past it, in the same column (things above/below the scroll area)
            // bottom of the chat: down once more goes to the message box (press A there to type)
            if (isChat) {
                if (step > 0) {
                    const box = [...document.querySelectorAll('[role="textbox"][contenteditable="true"]')].find(b => isVisible(b) && !b.closest('[role="dialog"]'));
                    const composer = box?.closest("form") ?? sec.querySelector("form");
                    const controls = composer ? itemsOnTop(composer) : [];
                    const next = nearestInDirection(from, controls, "down");
                    if (next || box) setItem(next ?? box!);
                }
                return;
            }
            let beyond = scanColumn(from, sec, step, null);
            const bRow = beyond ? rows.find(r => r === beyond || r.contains(beyond!) || beyond!.contains(r)) : undefined;
            if (bRow) beyond = bRow === from ? null : bRow;
            if (beyond) { debugNote(`scan past end ${describe(beyond).slice(0, 60)}`); setItem(beyond); }
            return;
        }
        setTimeout(() => {
            if (!alive(sec) || mode !== "inside" || !alive(section) || !section.contains(sec)) return;
            const fresh = listRows(sec) ?? [];
            const n = alive(from) && fresh.includes(from) ? fresh[fresh.indexOf(from) + step] : fresh.filter(isVisible)[step > 0 ? fresh.length - 1 : 0];
            if (n) setItem(n);
        }, 60);
        return;
    }


    const items = itemsOnTop(sec);
    if (!items.length) return;
    if (alive(focused) && !items.includes(focused) && sec.contains(focused)) {
        // on something we found by looking (not a marked button): move on from where it is
        const n = nearestInDirection(focused, items, dir);
        if (n) return setItem(n);
        if (hop(dir, focused, section ?? sec)) return;
        return;
    }
    if (!alive(focused) || !items.includes(focused)) {
        // our row scrolled off and was rebuilt: continue from the edge in the direction we're going
        const vis = items.filter(isVisible);
        return setItem((dir === "up" || dir === "left" ? vis[0] : vis[vis.length - 1]) ?? entryItemFor(sec));
    }

    let next = nearestInDirection(focused, items, dir);
    // left / right with nothing level with you: first look at what's drawn on that side within this section
    // (e.g. your name/avatar in the account panel, which isn't marked as a button), then go to the next section
    if (dir === "left" || dir === "right") {
        const a = focused.getBoundingClientRect(), b = next?.getBoundingClientRect();
        const level = !!b && b.top < a.bottom && b.bottom > a.top;
        if (!level) {
            const seen = scanSideways(focused, sec, dir);
            if (seen) return setItem(seen);
            if (hop(dir, focused, section ?? sec)) return;
        }
    }
    if (next) return setItem(next);
    if (dir === "up" || dir === "down") {
        const seen = scanColumn(focused, sec, dir === "down" ? 1 : -1, (dir === "down" ? sec.getBoundingClientRect().bottom : sec.getBoundingClientRect().top));
        if (seen && sec.contains(seen) && !items.includes(seen)) return setItem(seen);
    }

    // nothing more on screen that way: scroll this section and pick up what appears (never leave it)
    if (dir !== "up" && dir !== "down") return;
    const sc = isScrollArea(sec) ? sec as HTMLElement : scrollableAncestor(focused);
    if (!sc || !(sc === sec || sec.contains(sc) || sc.contains(sec))) return;
    const before = sc.scrollTop;
    sc.scrollBy({ top: (dir === "down" ? 1 : -1) * Math.max(80, sc.clientHeight * 0.4) });
    if (sc.scrollTop === before) return; // the real end
    const from = focused;
    setTimeout(() => {
        if (!alive(sec) || section !== sec) return;
        const fresh = itemsOnTop(sec);
        const n = alive(from) ? nearestInDirection(from, fresh, dir) : entryItemFor(sec);
        if (n) setItem(n);
    }, 70);
}

function firstMenuChoice(items: Element[]) {
    // a dropdown: start on the option that's currently chosen
    const chosen = items.find(el => el.matches('[role="option"]') && el.getAttribute("aria-selected") === "true");
    if (chosen) return chosen;
    // a message menu: start on the first quick reaction, then Reply
    const emoji = items.find(isEmojiItem);
    if (emoji) return emoji;
    const reply = items.find(el => /-reply$/.test(el.id));
    if (reply) return reply;
    return items.find(el => !el.querySelector("img") && (el.textContent ?? "").trim().length > 1) ?? items[0] ?? null;
}

/** Discord opens sub-menus ("Apps ›") on hover, not on click. */
function hoverEl(el: Element) {
    const { x, y } = center(el);
    for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
        const Ev = t.startsWith("pointer") ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ev(t, { bubbles: t.endsWith("over") || t.endsWith("move"), clientX: x, clientY: y }));
    }
}
const hasSubmenu = (el: Element) => el.getAttribute("aria-haspopup") === "true" || el.getAttribute("aria-haspopup") === "menu";
let menuOpener: Element | null = null; // the item whose sub-menu is open
function openSubmenu(item: Element) {
    menuOpener = item;
    hoverEl(item);
}
/** Close just the sub-menu: hovering another item of the parent menu closes it (that's how Discord's menus work). */
function closeSubmenu() {
    const opener = menuOpener;
    const parent = opener?.closest('[role="menu"]');
    if (!alive(opener) || !parent) return false;
    const other = [...parent.querySelectorAll(MENU_ITEM)].find(i => i !== opener && !hasSubmenu(i) && isVisible(i));
    if (!other) return false;
    hoverEl(other);
    return true;
}
const inSubmenu = () => alive(menuOpener) && !openMenu()?.contains(menuOpener);

let menuCache: { menu: Element; at: number; items: Element[]; } | null = null;
function moveInMenu(menu: Element, dir: Dir) {
    const now = performance.now();
    if (!menuCache || menuCache.menu !== menu || now - menuCache.at > 500 || menuCache.items.some(e => !e.isConnected)) {
        const its = [...menu.querySelectorAll(MENU_ITEM)].filter(el => isVisible(el) && !isDisabled(el));
        // volume sliders in a menu (mic / headphone menus) that aren't wrapped in a menu item
        for (const sl of menu.querySelectorAll('[role="slider"], input[type="range"]'))
            if (isVisible(sl) && !its.some(i => i.contains(sl))) its.push(sl);
        its.sort((a, b) => (a.compareDocumentPosition(b) & 4) ? -1 : 1);
        menuCache = { menu, at: now, items: its };
    }
    const items = menuCache.items;
    if (!items.length) return;
    if (!focused || !menu.contains(focused)) return setItem(firstMenuChoice(items));
    // on a volume slider: left / right slide it
    if (dir === "left" || dir === "right") {
        const sl = focused.matches('[role="slider"], input[type="range"]') ? focused : focused.querySelector('[role="slider"], input[type="range"]');
        if (sl && isVisible(sl)) return nudgeSlider(sl, dir === "right" ? 1 : -1);
        // ▶ opens a sub-menu, ◀ closes it
        if (dir === "right" && hasSubmenu(focused)) return openSubmenu(focused);
        if (dir === "left" && inSubmenu() && closeSubmenu()) return;
    }
    setItem(nearestInDirection(focused, items, dir) ?? focused);
}

let channelHints = 0;

// ---------- inside a message ----------
let innerMsg: Element | null = null;
function messageParts(msg: Element): Element[] {
    const raw = [...msg.querySelectorAll(`${FOCUSABLE}, img[class*="avatar"], [class*="username"]`)]
        .filter(el => el !== msg && !isOurs(el) && isVisible(el) && !isDisabled(el) && !el.matches(TEXT_ENTRY));
    // the smallest pressable things only (a reaction, not the whole reaction bar)
    const parts = raw.filter(el => !raw.some(o => o !== el && el.contains(o) && o.matches(FOCUSABLE)));
    const uniq: Element[] = [];
    for (const p of parts) {
        const r = p.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) continue;
        if (uniq.some(u => u.contains(p) || p.contains(u))) continue;
        uniq.push(p);
    }
    // the avatar opens the same profile card as the name next to it: keep just the name (one stop, not two)
    if (uniq.some(p => p.matches('[class*="username"]'))) return uniq.filter(p => !p.matches('img[class*="avatar"]'));
    return uniq;
}
function enterMessage(msg: Element) {
    const parts = messageParts(msg);
    if (!parts.length) return rightClick(msg); // nothing inside to press: open its menu instead
    innerMsg = msg;
    // start on the name (or the avatar) if there is one, else the first thing
    const start = parts.find(p => p.matches('[class*="username"]')) ?? parts.find(p => p.matches('img[class*="avatar"]')) ?? parts[0];
    setItem(start);
    debugNote(`inside message: ${parts.length} parts`);
}
function exitMessage() {
    const msg = innerMsg;
    innerMsg = null;
    if (alive(msg)) setItem(msg);
}
function moveInMessage(dir: Dir) {
    if (!alive(innerMsg)) { innerMsg = null; return; }
    const parts = messageParts(innerMsg);
    if (!alive(focused) || !parts.includes(focused)) return setItem(parts[0] ?? innerMsg);
    // up / down: reading order (line by line, left to right) — the tall avatar beside the text can't make you skip lines
    const rect = new Map(parts.map(p => [p, p.getClientRects()[0] ?? p.getBoundingClientRect()] as const));
    const order = [...parts].sort((p, q) => {
        const a = rect.get(p)!, b = rect.get(q)!;
        return Math.abs(a.top - b.top) < 8 ? a.left - b.left : a.top - b.top;
    });
    const i = order.indexOf(focused);
    if (dir === "up" || dir === "down") {
        const next = order[i + (dir === "down" ? 1 : -1)];
        if (next) setItem(next);
        return;
    }
    // left / right: the nearest thing on the same line
    const a = rect.get(focused)!;
    const level = parts.filter(p => {
        if (p === focused) return false;
        const b = rect.get(p)!;
        return b.top < a.bottom - 2 && b.bottom > a.top + 2 && (dir === "right" ? b.left > a.left + 2 : b.left < a.left - 2);
    });
    level.sort((p, q) => Math.abs(rect.get(p)!.left - a.left) - Math.abs(rect.get(q)!.left - a.left));
    if (level[0]) setItem(level[0]);
}

function move(dir: Dir) {
    const menu = openMenu();
    if (menu) return moveInMenu(menu, dir);
    if (innerMsg && (!alive(innerMsg) || !alive(focused) || !innerMsg.contains(focused) || mode !== "inside")) innerMsg = null;
    if (innerMsg) return moveInMessage(dir);
    if (mode === "inside") moveInside(dir);
    else moveSections(dir);
}

// ---------- actions ----------
function rightClick(el: Element) {
    const target = (el.matches(ROW.message) && el.querySelector('[id^="message-content-"]')) || el;
    const { x, y } = center(target);
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2 }));
}

const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, PageUp: 33, PageDown: 34, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Backspace: 8, Tab: 9 };
/** A synthetic key event that Discord actually reacts to: Chrome ignores keyCode/which passed to the constructor,
 *  and Discord's handlers check them, so they're set by hand. */
function keyEvent(type: string, key: string): KeyboardEvent {
    const ev = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true, composed: true });
    const kc = KEY_CODES[key] ?? 0;
    for (const prop of ["keyCode", "which"]) { try { Object.defineProperty(ev, prop, { get: () => kc }); } catch { } }
    if (type === "keypress") { try { Object.defineProperty(ev, "charCode", { get: () => kc }); } catch { } }
    return ev;
}
function pressKey(key: string, target: EventTarget) {
    target.dispatchEvent(keyEvent("keydown", key));
    target.dispatchEvent(keyEvent("keyup", key));
}
/** One Escape, sent to the topmost thing (a menu, else the newest pop-out — some only listen on themselves, like
 *  Pinned Messages — else what has focus). It bubbles up to the page, so page-wide listeners still get it;
 *  sending a second one there could close two layers at once. */
const escape = () => {
    menuChanged();
    const pops = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(isVisible);
    const active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const top = pops[pops.length - 1];
    pressKey("Escape", openMenu() ?? (active && top?.contains(active) ? active : top) ?? active ?? document.body);
};

/** Close settings or the top dialog: try Escape, then press its close (X / ESC) button. */
function closeWindow(tries = 0) {
    const before = overlayCount();
    if (tries === 0) escape();
    setTimeout(() => {
        if (overlayCount() < before) return;
        const closers = [...document.querySelectorAll('[aria-label="Close"], [aria-label*="close" i], [aria-label*="Close"]')]
            .filter(b => isVisible(b) && isOnTop(b));
        // prefer the one nearest the top-right corner
        closers.sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return (ra.top - ra.right) - (rb.top - rb.right);
        });
        if (closers[0]) { debugNote("closing via close button"); (closers[0] as HTMLElement).click(); }
        // (a page still sliding in has its X not quite on screen yet: look again shortly)
        else if (tries < 4) closeWindow(tries + 1);
        else debugNote("close: no close button found");
    }, 150);
}

function settingsOpen() {
    // the redesigned settings (2025+): its sidebar is a Discord list called "settings-sidebar…"
    if (newSettingsList()) return true;
    // the settings screen's sidebar layout (Discord's own name for it; themes don't change this)
    for (const el of document.querySelectorAll('[class*="standardSidebarView"]')) if (isVisible(el)) return true;
    // otherwise: a tall page list (6+ pages, stacked top to bottom) that's on screen.
    // (The Friends bar is a tab list too, but it runs left to right — that's not settings.)
    return !!pageList();
}
/** The redesigned settings' page list (Account, Account Info, Vencord, Voice & Video…), if it's on screen. */
function newSettingsList(): Element | null {
    for (const l of document.querySelectorAll('[data-list-id^="settings-sidebar"], [data-hh-list^="settings-sidebar"]'))
        if (isVisible(l)) return l;
    return null;
}
const isSettingsPage = (el: Element) => !!el.closest('[data-list-id^="settings-sidebar"], [data-hh-list^="settings-sidebar"]')
    && el.matches('[data-list-item-id^="settings-sidebar"]');
function pageList(): Element | null {
    for (const tl of document.querySelectorAll('[role="tablist"]')) {
        if (!isVisible(tl)) continue;
        const tabs = [...tl.querySelectorAll('[role="tab"]')].filter(isVisible);
        if (tabs.length < 2) continue;
        const a = tabs[0].getBoundingClientRect(), b = tabs[1].getBoundingClientRect();
        const vertical = Math.abs(b.top - a.top) > Math.abs(b.left - a.left);
        const controlsPage = tabs.some(tab => document.getElementById(tab.getAttribute("aria-controls") ?? "")?.matches('[role="tabpanel"]'));
        if (vertical && (controlsPage || tabs.length >= 6) && isOnTop(tabs[0])) return tl;
    }
    return null;
}

/** True when the main screen (server list / channel list) is covered by something. */
function mainCovered() {
    const row = [...document.querySelectorAll(`${ROW.server}, ${ROW.channel}`)].find(isVisible);
    return !!row && !isOnTop(row);
}
/** A full-screen page that isn't marked as a dialog (e.g. "Boost this server"): something from one of Discord's
 *  upper layers drawn over the main screen. (Just "a row isn't on top" also happens for a moment while the
 *  layout settles, e.g. as the keyboard closes — that must not count as a window.) */
function fullScreenPage(): boolean {
    // a row that's really showing — inside its list's visible area, not scrolled off the top of the server list
    const shown = (el: Element) => {
        if (!isVisible(el)) return false;
        const sc = scrollableAncestor(el);
        if (!sc) return true;
        const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        return cy > s.top && cy < s.bottom;
    };
    const row = [...document.querySelectorAll(`${ROW.server}, ${ROW.channel}`)].find(shown);
    if (!row || isOnTop(row)) return false;
    const { x, y } = center(row);
    const hit = document.elementFromPoint(Math.min(Math.max(x, 1), window.innerWidth - 2), Math.min(Math.max(y, 1), window.innerHeight - 2));
    // covered by something outside the app's own base layer (Discord draws pages / pop-ups in layers above it)…
    if (!hit || isOurs(hit) || hit.closest('[class*="baseLayer"]') || hit === document.documentElement || hit === document.body) return false;
    // …that is a whole page (at least half the screen), not a tooltip or a badge floating over the row
    let n: Element | null = hit, big = false;
    // (only up to the layer it lives in — the app root above it, which also holds the base layer, is always full-screen)
    for (; n && n !== document.body && !n.querySelector('[class*="baseLayer"]'); n = n.parentElement) {
        const r = n.getBoundingClientRect();
        if (r.width * r.height >= window.innerWidth * window.innerHeight * 0.5) { big = true; break; }
    }
    return big;
}

/** Jump into the next indicated server, rather than leaving focus on the floating scroll badge. */
function jumpToNew(bar: HTMLElement) {
    if (!bar.matches('[class*="unreadMentionsBar"]')) { bar.click(); return; }
    const list = bar.closest('[data-list-id="guildsnav"]') ?? document.querySelector('[data-list-id="guildsnav"]');
    const br = bar.getBoundingClientRect(), lr = list?.getBoundingClientRect();
    const down = !lr || br.top + br.height / 2 > lr.top + lr.height / 2;
    const reads = findStore("GuildReadStateStore");
    const rows = list ? [...list.querySelectorAll<HTMLElement>(ROW.server)] : [];
    const ahead = rows.filter(row => {
        const r = row.getBoundingClientRect();
        return down ? r.top >= br.bottom : r.bottom <= br.top;
    });
    const mentions = (row: HTMLElement) => {
        const id = (row.getAttribute("data-list-item-id") ?? "").split("___")[1];
        const badge = row.closest('[class*="listItem"]')?.querySelector('[class*="numberBadge"]');
        return (reads?.getMentionCount?.(id) ?? 0) > 0 || Number(badge?.textContent) > 0;
    };
    const marked = ahead.filter(mentions);
    const candidates = marked.length ? marked : ahead.filter(row => reads?.hasUnread?.((row.getAttribute("data-list-item-id") ?? "").split("___")[1]));
    candidates.sort((a, b) => down ? a.getBoundingClientRect().top - b.getBoundingClientRect().top : b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    const target = candidates[0];
    bar.click();
    if (!target) return; // retain Discord's native jump for other unread-bar variants
    target.click();
    const sec = sectionOf(target);
    section = sec; sectionKey = keyOf(sec); mode = "inside";
    setItem(target);
}

function pressA() {
    menuChanged();
    const menu = openMenu();
    if (menu) {
        if (focused && menu.contains(focused)) {
            const item = focused as HTMLElement;
            lastPadUse = performance.now();
            if (hasSubmenu(item)) return openSubmenu(item);
            item.click();
            afterMenuChoice(item);
        }
        return;
    }
    if (mode === "sections") {
        if (!alive(section)) { debugNote("A: enter default section"); return lockInto(defaultSection()); }
        if (section.matches(NEW_JUMP)) {
            jumpToNew(section as HTMLElement);
            bumpChecks();
            return;
        }
        if (isCloseSection(section)) { debugNote("A: close"); (section as HTMLElement).click(); return; }
        lockInto(section);
        debugNote(`A: lock ${describe(section).slice(0, 60)} → item ${focused ? describe(focused).slice(0, 50) : "NONE"}`);
        return;
    }
    if (!alive(focused)) return moveInside("down");
    if (isCloseButton(focused)) {
        (focused as HTMLElement).click();
        menuChanged();
        restoreSoon();
        return;
    }

    // a message: A goes inside it (name, avatar, reactions, links, images, buttons); X opens its menu
    if (focused.matches(ROW.message)) return enterMessage(focused);
    if (innerMsg && (focused.matches('img[class*="avatar"]') || !focused.matches(FOCUSABLE))) {
        // not a real button (e.g. the avatar picture): click it the way a finger would
        const target = focused;
        const { x, y } = center(target);
        for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
            target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: t.endsWith("down") ? 1 : 0 }));
        return;
    }
    if (focused.matches(TEXT_ENTRY)) return startTyping(focused);

    // a settings page (sidebar tab): open it and go straight into its options
    const sideTabs = focused.matches('[role="tab"]') ? focused.closest('[role="tablist"]')?.getBoundingClientRect() : null;
    if ((sideTabs && sideTabs.height > sideTabs.width * 1.5 && settingsOpen()) || isSettingsPage(focused)) {
        const tabSec = section;
        (focused as HTMLElement).click();
        setTimeout(() => {
            if (!alive(tabSec) || section !== tabSec || mode !== "inside") return;
            let target = nearestInDirection(tabSec, listSections(), "right", true);
            if (!target) return debugNote("settings: no options area found to the right");
            // a page with just one button would make that button "the section": use the page around it
            while (target && !(listRows(target)?.length) && itemsOnTop(target).length === 0 && target.parentElement && !target.parentElement.contains(tabSec))
                target = target.parentElement;
            memory.delete(target);
            lockInto(target);
            debugNote(`settings page → ${describe(target).slice(0, 50)}`);
        }, 160);
        return;
    }

    const wasServer = focused.matches(ROW.server);
    const guildBefore = SelectedGuildStore.getGuildId();
    const channelBefore = SelectedChannelStore.getChannelId();

    // a channel: open it with ONE press, then go straight into its chat
    const chanLink = focused.matches(ROW.channel) || focused.closest(ROW.channel)
        ? ((focused.matches("a[href]") ? focused : focused.querySelector("a[href]")) as HTMLAnchorElement | null)
        : (focused.matches('a[href*="/channels/"]') ? focused as HTMLAnchorElement : null);
    if (chanLink || focused.matches(ROW.channel)) {
        const href = chanLink?.getAttribute("href") ?? "";
        const rowId = (focused.closest("[data-list-item-id]") ?? focused).getAttribute("data-list-item-id")?.split("___")[1] ?? "";
        const thisId = /\/(\d+)$/.exec(href)?.[1] ?? rowId;
        // already open → second press dives into its chat
        if (thisId && thisId === channelBefore && settings.store.autoLockAfterChannel) { enterChat(); return; }
        ((chanLink ?? focused) as HTMLElement).click();
        setTimeout(() => {
            let changed = SelectedChannelStore.getChannelId() !== channelBefore;
            // the click didn't take (Discord ignored a synthetic click): navigate directly
            if (!changed && /^\/channels\/[^/]+\/\d+$/.test(href) && !href.endsWith("/" + channelBefore)) {
                debugNote("channel: click ignored, navigating");
                NavigationRouter.transitionTo(href);
                changed = true;
            }
            // first press just shows the channel (keep browsing the list); A again — or ◀ — goes into the chat
            if (changed && channelHints < 3) { channelHints++; toast("Showing channel · A again (or ◀) to jump into the chat", 1800); }
        }, 120);
        return;
    }

    const clicked = focused as HTMLElement;
    clicked.click();
    if (!clicked.matches(FOCUSABLE)) setTimeout(() => {
        const a = document.activeElement;
        if (a && a.matches(TEXT_ENTRY)) { setItem(a); startTyping(a); }
    }, 150);
    if (wasServer && settings.store.autoLockAfterServer) {
        setTimeout(() => {
            // a folder just opens/closes (no server change): stay put in the server list
            if (SelectedGuildStore.getGuildId() === guildBefore) return;
            const chan = itemsOnTop().find(el => el.matches(ROW.channel));
            if (chan) lockInto(sectionOf(chan));
        }, 300);
    }
}

/** Wait for the opened channel's messages, then lock into them on the newest one (voice channels with no chat: stay put). */
function enterChat(tries = 0) {
    const list = [...document.querySelectorAll(CHAT_LIST)].find(isVisible);
    const msgs = list ? [...list.querySelectorAll(ROW.message)].filter(isVisible) : [];
    if (!list || (!msgs.length && tries < 8)) {
        if (tries < 12) setTimeout(() => enterChat(tries + 1), 120);
        else debugNote("channel: no chat to enter");
        return;
    }
    const sec = sectionOf(msgs[msgs.length - 1] ?? list);
    if (!sec) return;
    memory.delete(sec); memory.delete(widen(sec)); // a new channel: start at the newest message
    lockInto(sec);
    // (the channel view also holds the member list & header: make sure it's the newest message you land on)
    const newest = msgs[msgs.length - 1];
    if (newest && alive(section) && section.contains(newest)) setItem(newest);
    debugNote(`entered chat → ${focused ? describe(focused).slice(0, 50) : "NONE"}`);
}

/** After a search: wait for the results, then select the first one (A jumps to it in the chat). */
function enterSearchResults(tries = 0) {
    tagLists(true);
    const list = document.querySelector('[data-hh-list="search-results"]');
    const first = list ? (listRows(list) ?? []).find(r => r.matches('[role="article"]') && isVisible(r)) : null;
    if (!first) { if (tries < 20) setTimeout(() => enterSearchResults(tries + 1), 120); return; }
    const pane = widen(sectionOf(first));
    section = pane; sectionKey = keyOf(pane); mode = "inside";
    setItem(first);
}

/** Menu choices that lead to typing (Reply, Edit Message, Create Thread…): put you in the message box, keyboard up. */
function isTypeChoice(item: Element) {
    const id = item.id ?? "";
    const label = (item.getAttribute("aria-label") || item.textContent || "").trim().replace(/\s+/g, " ");
    return /(^|-)(reply|edit)$/.test(id) || /^(reply|edit message|edit)$/i.test(label);
}
function afterMenuChoice(item: Element) {
    if (!isTypeChoice(item)) return;
    let tries = 0;
    const go = () => {
        if (!controllerActive) return;
        tries++;
        if (openMenu() && tries < 12) return void setTimeout(go, 60); // wait for the menu to close
        // Discord usually focuses the box itself; if not, find it (an inline edit box first, then the message box)
        let box = document.activeElement?.matches(TEXT_ENTRY) ? document.activeElement as HTMLElement : null;
        if (!box) {
            const boxes = [...document.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"]')].filter(b => isVisible(b) && !b.closest('[role="dialog"]'));
            box = boxes.find(b => b.closest(ROW.message)) ?? boxes[boxes.length - 1] ?? null;
        }
        if (!box) { if (tries < 12) setTimeout(go, 60); return; }
        box.focus();
        // caret at the end
        const sel = window.getSelection();
        if (sel && !box.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(box); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
        const pane = chatPane();
        if (pane && pane.contains(box)) { section = pane; sectionKey = keyOf(pane); mode = "inside"; }
        innerMsg = null;
        setItem(box);
        lastPadUse = performance.now();
        startTyping(box);
    };
    setTimeout(go, 80);
}
// tapping Reply with a finger does the same
const onMenuClickCapture = (e: MouseEvent) => {
    if (!controllerActive || !e.isTrusted) return; // our own A press is handled in pressA
    const item = (e.target as Element)?.closest?.(MENU_ITEM);
    if (item && opt("onScreenKeyboard")) afterMenuChoice(item);
};

function pressB() {
    menuChanged();
    if (!openMenu() && innerMsg) return exitMessage();
    if (inSubmenu() && closeSubmenu()) return;
    if (openMenu()) return escape();
    if (typingMode) return backOutOfTyping();
    // in a pop-out (profile card, pins, a dialog): there's nowhere else to go inside it, so B closes it right away
    if (mode === "inside" && alive(section)) {
        const win = section.closest('[role="dialog"], [aria-modal="true"]');
        const side = settingsSidebar();
        const isSettings = !!win && !!side && win.contains(side); // settings itself: B steps back (unlock) first
        if ((win && !isSettings) || (!win && !settingsOpen() && fullScreenPage())) return closeWindow();
    }
    if (mode === "inside") return unlock();
    // already picking sections: if settings / a window is open on top, close it
    if (overlayCount() > 0) {
        // deeper settings pages have their own Back button: go back a page before closing settings
        const back = [...document.querySelectorAll('button, [role="button"]')].find(b => {
            const t = (b.getAttribute("aria-label") || b.textContent || "").trim();
            return /^(back|go back)$/i.test(t) && isVisible(b) && isOnTop(b);
        });
        if (back && settingsOpen()) { debugNote("B: settings back"); (back as HTMLElement).click(); return; }
        closeWindow();
    }
}

function pressY() {
    menuChanged();
    innerMsg = null;
    if (openMenu()) escape();
    unlock();
}

function pressX() {
    menuChanged();
    if (openMenu()) return escape();
    if (innerMsg && alive(innerMsg)) return rightClick(innerMsg);
    if (mode === "inside" && alive(focused)) rightClick(focused);
}

function switchServer(step: 1 | -1) {
    const ids = SortedGuildStore.getFlattenedGuildIds();
    if (!ids.length) return;
    const cur = SelectedGuildStore.getGuildId();
    const i = cur ? ids.indexOf(cur) : -1;
    // (stops at the first / last server — no looping round)
    const next = i < 0 ? (step > 0 ? 0 : ids.length - 1) : i + step;
    if (next < 0 || next >= ids.length) return toast(step > 0 ? "Last server" : "First server", 700);
    NavigationRouter.transitionToGuild(ids[next]);
}

function switchChannel(step: 1 | -1) {
    const links = [...document.querySelectorAll(ROW.channel)].filter(el => isVisible(el) && (el.tagName === "A" || el.querySelector("a")));
    const cid = SelectedChannelStore.getChannelId();
    const i = links.findIndex(el => !!cid && (el.getAttribute("data-list-item-id") ?? "").endsWith(cid));
    const next = links[i + step];
    if (!next) return;
    ((next.tagName === "A" ? next : next.querySelector("a")) as HTMLElement).click();
    if (mode === "inside" && focused?.matches(ROW.channel)) setItem(next);
}

function chatScroller(): HTMLElement | null {
    const l = document.querySelector(CHAT_LIST);
    return l ? scrollableAncestor(l.firstElementChild ?? l) : null;
}

/** Right stick scrolling: speed in pixels per second, by how far the stick is pushed (a curve: a light push reads
 *  slowly, a full push flies), measured in time so it's the same at any frame rate. Applied instantly. */
let stickScrollAt = 0, stickCarry = 0;
function scrollStick(ry: number, deadzone: number) {
    const now = performance.now();
    const dt = Math.min(now - stickScrollAt, 50); // (a long gap since the last frame isn't a giant jump)
    stickScrollAt = now;
    if (Math.abs(ry) <= deadzone) { stickCarry = 0; return; }
    const push = (Math.abs(ry) - deadzone) / (1 - deadzone);           // 0 … 1
    const pxPerSec = Math.pow(push, 1.6) * settings.store.scrollSpeed * 190; // default 18 → ~3400 px/s at full tilt
    stickCarry += Math.sign(ry) * pxPerSec * dt / 1000;
    const step = Math.trunc(stickCarry); // whole pixels only; the rest carries over (slow scrolling still moves)
    if (!step) return;
    stickCarry -= step;
    const sec = mode === "inside" && alive(section) ? section : null;
    const target = (sec ? (isScrollArea(sec) ? sec as HTMLElement : scrollableAncestor(focused)) : null) ?? chatScroller();
    target?.scrollBy({ top: step, behavior: "instant" as ScrollBehavior });
}

function jumpToNewest() {
    if (!document.querySelector(CHAT_LIST)) return;
    if (typingMode) stopTyping();
    chatScroller()?.scrollTo({ top: 1e9, behavior: "auto" });
    // Discord's own "Jump to present" when you're far up in history
    const jump = [...document.querySelectorAll('button, [role="button"]')].find(b => /jump to present/i.test(b.textContent ?? "") && isVisible(b));
    (jump as HTMLElement | undefined)?.click();
    const pick = (tries: number) => {
        const list = [...document.querySelectorAll(CHAT_LIST)].find(isVisible);
        const msgs = list ? [...list.querySelectorAll(ROW.message)].filter(isVisible) : [];
        const last = msgs[msgs.length - 1];
        if (!last) { if (tries < 8) setTimeout(() => pick(tries + 1), 100); return; }
        const pane = widen(sectionOf(last));
        if (mode !== "inside" || section !== pane) { section = pane; sectionKey = keyOf(pane); mode = "inside"; }
        setItem(last);
        if (tries < 3) setTimeout(() => { // more may load in: keep the newest one
            const fresh = [...(list?.querySelectorAll(ROW.message) ?? [])].filter(isVisible);
            if (fresh.length && focused === last && fresh[fresh.length - 1] !== last) setItem(fresh[fresh.length - 1]);
        }, 250);
    };
    setTimeout(() => pick(0), 60);
}

function openSettings() {
    if (openMenu()) escape();
    if (typingMode) stopTyping();
    if (settingsOpen()) return;
    const before = save();
    const attempts: Array<[string, () => void]> = [
        ["gear (label)", () => {
            const gear = [...document.querySelectorAll('[aria-label="User Settings"], [aria-label="User settings"], [aria-label="Settings"]')]
                .find(b => isVisible(b) && isOnTop(b));
            (gear as HTMLElement | undefined)?.click();
        }],
        ["gear button", () => {
            const panel = getPanel();
            const buttons = panel ? [...panel.querySelectorAll('button, [role="button"]')].filter(b => isVisible(b) && b.getAttribute("role") !== "switch") : [];
            (buttons[buttons.length - 1] as HTMLElement | undefined)?.click();
        }],
        ["settings router", () => SettingsRouter?.openUserSettings?.()],
        ["dispatch", () => FluxDispatcher?.dispatch?.({ type: "USER_SETTINGS_MODAL_OPEN", section: "My Account" })],
        ["Ctrl+,", () => {
            for (const t of [document, document.body, window]) t.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "Comma", ctrlKey: true, bubbles: true, cancelable: true }));
        }],
    ];
    // try the method that worked last time first
    const remembered = settings.store.settingsMethod;
    attempts.sort((a, b) => (b[0] === remembered ? 1 : 0) - (a[0] === remembered ? 1 : 0));

    const regionOf = (el: Element | null) => el ? (scrollableAncestor(el) ?? el.closest(LANDMARK) ?? el) : null;
    const probe = () => document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const regionBefore = regionOf(probe());
    const changed = () => { const r = regionOf(probe()); return !!r && r !== regionBefore && !(regionBefore && regionBefore.contains(r)); };
    const tryNext = (i: number) => {
        if (settingsOpen() || (i > 0 && changed())) {
            if (i > 0) {
                const how = attempts[i - 1][0];
                if (how !== settings.store.settingsMethod) {
                    settings.store.settingsMethod = how;
                    toast("Settings opened using: " + how + " (remembered)", 4000);
                }
                debugNote("settings opened via " + how);
            }
            // land on the settings' page list, on the page that's open (like a menu)
            returnStack.push(before);
            enterSettingsList();
            lastOverlays = overlayCount();
            return;
        }
        if (i >= attempts.length) { debugNote("settings: no change seen after all methods"); return; }
        debugNote("settings: trying " + attempts[i][0]);
        try { attempts[i][1](); } catch (e) { debugNote("settings: " + attempts[i][0] + " threw " + e); }
        setTimeout(() => tryNext(i + 1), 450);
    };
    tryNext(0);
}

// ---------- back buttons: shortcuts ----------
// Steam doesn't hand the back buttons to apps, so they're mapped (in Steam) to spare keyboard keys, caught here.
function onBackKey(e: KeyboardEvent) {
    if (!controllerActive) return;
    const slot = BACK_KEYS.findIndex(ks => ks.includes(e.key) || ks.includes(e.code));
    if (slot < 0 || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    lastPadUse = performance.now(); bumpChecks();
    runBackAction(String(opt(`backButton${slot + 1}`) ?? BACK_DEFAULTS[slot]), BACK_NAMES[slot]);
}
function clickLabelled(re: RegExp): HTMLElement | null {
    const b = [...document.querySelectorAll<HTMLElement>("button, [role='button'], [role='switch']")].find(x => re.test(x.getAttribute("aria-label") ?? "") && isVisible(x));
    b?.click();
    return b ?? null;
}
/** Every press shows which back button it was and what it did ("M1 · 🎙 Muted"). */
function runBackAction(a: string, name = "") {
    const say = (t: string, ms = 1300) => toast(name ? `${name} · ${t}` : t, ms);
    const label = BACK_ACTIONS.find(x => x[0] === a)?.[1] ?? a;
    if (a !== "mute" && a !== "deafen" && a !== "read") say(a === "none" ? "does nothing (set it in controller settings › Back buttons)" : label);
    switch (a) {
        case "mute": {
            const b = clickLabelled(/^(mute|unmute)$/i);
            if (!b) return say("🎙 no mic button here");
            setTimeout(() => { const on = b.getAttribute("aria-checked") === "true" || /^unmute$/i.test(b.getAttribute("aria-label") ?? ""); say(on ? "🎙 Muted" : "🎙 Unmuted"); }, 120);
            return;
        }
        case "deafen": {
            const b = clickLabelled(/^(deafen|undeafen)$/i);
            if (!b) return say("🎧 no deafen button here");
            setTimeout(() => { const on = b.getAttribute("aria-checked") === "true" || /^undeafen$/i.test(b.getAttribute("aria-label") ?? ""); say(on ? "🎧 Deafened" : "🎧 Undeafened"); }, 120);
            return;
        }
        case "type": {
            if (kbEl) return;
            const box = [...document.querySelectorAll<HTMLElement>('[class*="baseLayer"] form [role="textbox"]')].find(isVisible);
            if (!box) return say("no message box here");
            const sec = sectionOf(box);
            if (sec) { section = widen(sec); sectionKey = keyOf(section); }
            mode = "inside"; setItem(box); startTyping(box); openKeyboard(box);
            return;
        }
        case "switcher": {
            const t = document.activeElement ?? document.body;
            for (const type of ["keydown", "keyup"]) t.dispatchEvent(new KeyboardEvent(type, { key: "k", code: "KeyK", keyCode: 75, ctrlKey: true, bubbles: true, cancelable: true }));
            return;
        }
        case "back": return void (NavigationRouter as any).back?.();
        case "newest": return jumpToNewest();
        case "read": {
            const bar = [...document.querySelectorAll<HTMLElement>("button, [role='button']")].find(b => /^mark as read$/i.test(b.textContent?.trim() ?? "") && isVisible(b));
            if (bar) { bar.click(); say("✓ Marked as read"); } else say("nothing unread here");
            return;
        }
        case "inbox": { if (!clickLabelled(/^inbox$/i)) say("no inbox button here"); return; }
        case "chatonly": {
            if (kbEl && kbOverComposer) setChatOnly(!opt("keyboardChatOnly"));
            else { (settings.store as any).keyboardChatOnly = !opt("keyboardChatOnly"); say(opt("keyboardChatOnly") ? "Big chat while typing: on" : "Big chat while typing: off"); }
            return;
        }
    }
}

// ---------- button hints: what you can press right now ----------
// A small bar above the message box (right side), like a console's button prompts. The keyboard, the settings panel
// and the guide show their own; it fades away when the controller hasn't been used for a while.
let hintsEl: HTMLDivElement | null = null;
type Hint = [Badge[], string];
/** The Menu shortcut is Send only while the selected chat owns a pending message or attachment. */
function composerSendContext(): { box: HTMLElement; attachment: boolean; text: boolean; } | null {
    if (openMenu() || nativeExpressionPicker() || overlayCount() || settingsOpen() || adjustMode) return null;
    const box = document.querySelector<HTMLElement>('[class*="baseLayer"] form [role="textbox"][contenteditable="true"]');
    const form = box?.closest("form");
    if (!box || !form || !(alive(section) && section.contains(form) || alive(focused) && form.contains(focused))) return null;
    const attachment = !!form.querySelector('[data-list-item-id^="attachments___"]');
    const text = !!(box.innerText ?? box.textContent ?? "").replace(/\uFEFF/g, "").trim();
    return attachment || text ? { box, attachment, text } : null;
}
function hintItems(): Hint[] {
    const items = baseHintItems();
    const send = composerSendContext();
    if (!send) return items;
    const label = send.attachment ? send.text ? "send message + attachment" : "send attachment" : "send message";
    return [[["MENU"], label], ...items.filter(([buttons]) => !buttons.includes("MENU"))];
}
function baseHintItems(): Hint[] {
    if (mode === "sections" && alive(section) && section!.matches(NEW_JUMP)) return [[["DPAD"], "pick area"], [["A"], "jump to new"], [["B"], "back"]];
    if (adjustMode) return [[["DPAD"], "◀▶ change"], [["L"], "hold: faster"], [["LB", "RB"], "next / previous"], [["B"], "done"]];
    const menu = openMenu();
    if (menu) {
        const more = alive(focused) && menu.contains(focused) && hasSubmenu(focused!);
        return [[["DPAD"], "move"], [["A"], more ? "open ▶" : "select"], [["B"], "close"]];
    }
    if (nativeExpressionPicker()) return [[["DPAD"], "move"], [["A"], "select"], [["LB", "RB"], "picker tabs"], [["LT", "RT"], "scroll picker"], [["Y"], "picker controls"], [["B"], "close"]];
    if (typingMode) return [[["A"], "keyboard"], [["B"], "stop typing"], [["Y"], "areas"]];
    if (mode === "sections") return [[["DPAD"], "pick area"], [["A"], "go in"], [["LB", "RB"], "servers"], [["LT", "RT"], "channels"], [["R3"], "sliders"], [["VIEW"], "guide"], [["MENU"], "settings"]];
    if (settingsOpen()) return [[["DPAD"], "move"], [["A"], "open"], [["B"], "back"]];
    if (innerMsg && alive(innerMsg)) return [[["DPAD"], "move"], [["A"], "press"], [["X"], "message options"], [["B"], "leave message"]];
    if (alive(focused) && focused!.matches(ROW.message)) return [[["DPAD"], "move"], [["A"], "go inside"], [["X"], "options / react"], [["R"], "scroll"], [["L3"], "newest"], [["Y"], "areas"]];
    if (alive(focused) && focused!.matches(TEXT_ENTRY)) return [[["A"], "type"], [["DPAD"], "move"], [["Y"], "areas"]];
    return [[["DPAD"], "move"], [["A"], "open"], [["X"], "options"], [["Y"], "areas"], [["R3"], "sliders"], [["B"], "back"]];
}
/** Contextual actions appear in the shared controls row. */
/** Does it really have its own menu? Found out by trying: the first time you rest on a kind of item, a hidden
 *  right-click — if a menu opens it's closed again at once (and never shown); the answer is remembered for every item
 *  of that kind (also across restarts). Text boxes are never tried (their menu is the system's). */
const CTX_KEY = "hh-ctx-v1";
const ctxKnown = new Map<string, boolean>();
let probing = false, probeEl: Element | null = null, probeAt = 0, ctxSaveTimer = 0;
function ctxSig(el: Element): string {
    const role = el.getAttribute("role") ?? "";
    const named = el.tagName === "BUTTON" || /^(button|switch|tab|link)$/.test(role);
    const cls = String((el as any).className?.baseVal ?? el.className ?? "").split(/\s+/)[0].replace(/_+[0-9a-z]{5,6}$/i, "");
    return `${el.tagName}|${role}|${named ? (el.getAttribute("aria-label") ?? "").slice(0, 40) : ""}|${cls}|${el.closest(ROW.message) ? "m" : ""}`;
}
function hasCtxMenu(el: Element): boolean { return ctxKnown.get(ctxSig(el)) === true; }
async function loadCtx() {
    try { const v = await DataStore.get(CTX_KEY); if (v && typeof v === "object") for (const [k, b] of Object.entries(v)) ctxKnown.set(k, !!b); } catch { }
}
function saveCtx() {
    clearTimeout(ctxSaveTimer);
    ctxSaveTimer = window.setTimeout(() => { void DataStore.set(CTX_KEY, Object.fromEntries(ctxKnown)); }, 1500);
}
let probeStarted = 0;
function probeCtx(el: Element) {
    if (!controllerActive) return;
    if (probing && performance.now() - probeStarted > 2000) { probing = false; document.documentElement.removeAttribute("data-hh-probing"); } // (watchdog)
    if (probing || openMenu() || !el.isConnected) return;
    probeStarted = performance.now();
    const sig = ctxSig(el);
    probing = true;
    document.documentElement.setAttribute("data-hh-probing", "");
    try { rightClick(el); } catch { probing = false; document.documentElement.removeAttribute("data-hh-probing"); return; }
    const t0 = performance.now();
    const done = (found: boolean) => {
        if (!controllerActive) { probing = false; document.documentElement.removeAttribute("data-hh-probing"); return; }
        ctxKnown.set(sig, found); saveCtx();
        const m = openMenu();
        if (m) pressKey("Escape", m);
        setTimeout(() => {
            const still = controllerActive ? openMenu() : null;
            if (still) pressKey("Escape", still);
            setTimeout(() => { probing = false; document.documentElement.removeAttribute("data-hh-probing"); }, 60);
        }, 80);
    };
    const check = () => {
        if (!controllerActive) { probing = false; document.documentElement.removeAttribute("data-hh-probing"); return; }
        if (openMenu()) return done(true);
        if (performance.now() - t0 > 500) return done(false);
        requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
}
function focusTag(el: Element): Hint[] | null {
    const base = baseTag(el);
    const ctx = !base?.some(([bs]) => bs.includes("X")) && hasCtxMenu(el);
    if (!base) return ctx ? [[["A"], "press"], [["X"], "menu"]] : null;
    return ctx ? [...base, [["X"], "menu"]] : base;
}
function baseTag(el: Element): Hint[] | null {
    if (el.hasAttribute("data-hh-send")) return [[["A"], "send"]];
    if (el.hasAttribute("data-hh-discovered")) return [[["A"], "press"]];
    if (el.matches(NEW_JUMP)) return [[["A"], "jump to new"]];
    if (el.matches(ROW.server)) return [[["A"], "open"], [["X"], "menu"]];
    if (el.matches(ROW.channel)) return [[["A"], "open"], [["X"], "menu"]];
    if (el.matches(ROW.message)) return [[["A"], "inside"], [["X"], "react"]];
    // things that also have a menu on X (Discord doesn't mark them, so by kind)
    const label = el.getAttribute("aria-label") ?? "";
    if (/^(mute|unmute)$/i.test(label)) return [[["A"], "toggle"], [["X"], "mic devices"]];
    if (/^(deafen|undeafen)$/i.test(label)) return [[["A"], "toggle"], [["X"], "audio devices"]];
    if (el.matches('[data-list-item-id^="members-"], [class*="member_"], [class*="voiceUser"], [class*="username_"], img[class*="avatar"], [class*="avatar_"]')) return [[["A"], "profile"], [["X"], "menu"]];
    if (el.matches('a[href]') && el.closest(ROW.message)) return [[["A"], "open"], [["X"], "menu"]];
    if (el.matches('img, video, [class*="imageWrapper"], [class*="clickableWrapper"]') && el.closest(ROW.message)) return [[["A"], "view"], [["X"], "menu"]];
    if (el.matches('[data-list-item-id^="settings-sidebar"], [role="tab"]')) return [[["A"], "open"]];
    if (el.matches('[role="switch"], [role="checkbox"], input[type="checkbox"]') || el.querySelector(':scope > [role="switch"], :scope input[type="checkbox"]')) return [[["A"], "toggle"]];
    if (el.matches('[role="slider"], input[type="range"]')) return [[["DPAD"], "◀▶ adjust"]];
    if (el.matches(TEXT_ENTRY)) return [[["A"], "type"]];
    if (el.matches('[role="combobox"], select')) return [[["A"], "choose"]];
    if (el.matches('a, button, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="radio"]')) return [[["A"], "press"]];
    return null;
}
function updateContextActions(hide: boolean) {
    const el = !hide && mode === "inside" && !typingMode && !openMenu() && !probing && alive(focused) ? focused! : null;
    // (a kind of item not tried yet: once you've rested on it a moment, find out whether it has a menu)
    if (el && !el.matches(ROW_ANY + ", " + TEXT_ENTRY) && !ctxKnown.has(ctxSig(el))) {
        if (probeEl !== el) { probeEl = el; probeAt = performance.now(); }
        else if (performance.now() - probeAt > 450) probeCtx(el);
    }
}

/** The widest set of top-bar hints (picking an area), measured once per button style. */
let topHintsW = 0, topHintsFor = "";
function topHintsWidth(): number {
    const key = `${buttonLayout()}|${opt("buttonColors")}|${opt("menuStyle")}`;
    if (topHintsW && topHintsFor === key) return topHintsW;
    const sets: Hint[][] = [
        [[["DPAD"], "pick area"], [["A"], "go in"], [["LB", "RB"], "servers"], [["LT", "RT"], "channels"], [["VIEW"], "guide"], [["MENU"], "settings"]],
        [[["DPAD"], "move"], [["A"], "open"], [["X"], "options"], [["Y"], "areas"], [["B"], "back"]],
    ];
    const probe = document.createElement("div");
    probe.className = "hh-hints hh-hints-top";
    probe.style.cssText = "visibility:hidden;left:-9999px;top:0";
    document.body.append(probe);
    let w = 0;
    for (const set of sets) {
        probe.innerHTML = set.map(([bs, t]) => `<span class="hh-hint">${bs.map(badgeHtml).join("")}<span>${t}</span></span>`).join("");
        w = Math.max(w, Math.ceil(probe.getBoundingClientRect().width));
    }
    probe.remove();
    topHintsW = w; topHintsFor = key;
    return w;
}
/** Hints in the top bar: the server / channel name moves over to their right (setting). */
function shiftTitle(on: boolean) {
    const bar = document.querySelector('[class*="base_"] > [class*="bar_"]');
    const title = bar?.querySelector<HTMLElement>(':scope > [class*="title_"]');
    const want = on && !!title && !!hintsEl && !hintsEl.classList.contains("off") && opt("hintsMoveTitle") !== false;
    if (want) {
        const pad = `${Math.round(hintsEl!.getBoundingClientRect().right - title!.getBoundingClientRect().left + 14)}px`;
        if (title!.style.getPropertyValue("--hh-title-pad") !== pad) title!.style.setProperty("--hh-title-pad", pad);
        if (!title!.hasAttribute("data-hh-title-shift")) title!.setAttribute("data-hh-title-shift", "");
    } else for (const t of document.querySelectorAll("[data-hh-title-shift]")) t.removeAttribute("data-hh-title-shift");
}
let composerSendEl: HTMLButtonElement | null = null;
/** One visible action for text, attachments, or both, placed in Discord's own composer controls. */
function updateComposerSend() {
    const box = document.querySelector<HTMLElement>('[class*="baseLayer"] form [role="textbox"][contenteditable="true"]');
    const form = box?.closest("form");
    const content = (box?.innerText ?? box?.textContent ?? "").replace(/\uFEFF/g, "").trim();
    const pending = !!form?.querySelector('[data-list-item-id^="attachments___"]');
    const uploads = form?.querySelector<HTMLElement>('[data-list-id="attachments"]');
    if (uploads && box) {
        const parent = uploads.parentElement;
        const cap = parent ? parseFloat(getComputedStyle(parent).maxHeight) : NaN;
        const line = box.closest('[class*="inner"]')?.getBoundingClientRect().height ?? box.getBoundingClientRect().height;
        const space = Number.isFinite(cap) ? Math.max(0, cap - line) : window.innerHeight;
        const height = `${Math.floor(Math.min(window.innerHeight * .25, space))}px`;
        if (uploads.style.getPropertyValue("--hh-upload-height") !== height) uploads.style.setProperty("--hh-upload-height", height);
    }
    const nativeSend = form?.querySelector('[aria-label="Send Message"], [aria-label="Send"]');
    if (!box || !form || (!content && !pending) || nativeSend) {
        composerSendEl?.remove(); composerSendEl = null; return;
    }
    const controls = box.closest('[class*="inner"]')?.querySelector('[class*="buttons"]')
        ?? form.querySelector('[class*="buttons"]');
    if (!controls) return;
    if (!composerSendEl || !composerSendEl.isConnected) {
        composerSendEl = document.createElement("button");
        composerSendEl.type = "button";
        composerSendEl.className = "hh-composer-send";
        composerSendEl.setAttribute("data-hh-send", "");
        composerSendEl.setAttribute("aria-label", "Send message or attachment");
        composerSendEl.title = "Send message or attachment";
        composerSendEl.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M3 3.5a1 1 0 0 1 1.4-.92l17 8.5a1 1 0 0 1 0 1.84l-17 8.5A1 1 0 0 1 3 20.5v-6.7l10-1.8-10-1.8V3.5Z"/></svg>';
        composerSendEl.onclick = () => {
            const target = composerSendEl?.closest("form")?.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]');
            if (target) kbSend(target);
        };
    }
    if (composerSendEl.parentElement !== controls) controls.append(composerSendEl);
}

function updateHints() {
    updateComposerSend();
    const hide = !opt("showHints") || !!kbEl || !!panelEl || !!helpEl || !!calibEl || performance.now() - lastPadUse > 20000;
    updateContextActions(hide);
    if (hide) { if (hintsEl && !hintsEl.classList.contains("off")) hintsEl.classList.add("off"); shiftTitle(false); return; }
    markButtons();
    if (!hintsEl) {
        hintsEl = document.createElement("div");
        hintsEl.className = "hh-hints off";
        document.body.append(hintsEl);
        markMenuStyle();
    }
    const actions = mode === "inside" && !typingMode && !adjustMode && !openMenu() && alive(focused)
        ? focusTag(focused!) : null;
    const replaced = new Set(actions?.flatMap(([bs]) => bs) ?? []);
    const items = actions ? [...actions, ...hintItems().filter(([bs]) => !bs.some(b => replaced.has(b)))] : hintItems();
    const html = items.map(([bs, t]) => `<span class="hh-hint">${bs.map(badgeHtml).join("")}<span>${t}</span></span>`).join("");
    let rebuilt = false;
    if (hintsEl.dataset.html !== html) { hintsEl.dataset.html = html; hintsEl.innerHTML = html; rebuilt = true; }
    // above the message box, on the right (anywhere else: the bottom-right corner); while a side menu is open on the
    // right, the other side
    // working in the chat (a message, the message box): just above Discord's message box, lined up with its right
    // edge. Anywhere else: the top bar, left side (next to the back / forward arrows)
    const inChat = mode === "inside" && !openMenu() && !overlayCount() && (!!innerMsg || (alive(focused) && (focused!.matches(ROW.message)
        || !!focused!.closest('[class*="baseLayer"] form'))) || (!!section && !!section.querySelector?.(CHAT_LIST) && !section.querySelector(ROW.channel)));
    const boxEl = inChat ? document.querySelector<HTMLElement>('[class*="baseLayer"] form [class*="scrollableContainer"]') : null;
    const sc = boxEl && isVisible(boxEl) ? boxEl.getBoundingClientRect() : undefined;
    let pos: string;
    if (sc) pos = `r:${Math.round(window.innerWidth - sc.right)},b:${Math.round(window.innerHeight - sc.top + 6)}`;
    else {
        const bar = document.querySelector('[class*="base_"] > [class*="bar_"]');
        const br = bar && isVisible(bar) ? bar.getBoundingClientRect() : null;
        const arrows = bar?.querySelector('[class*="leading"], [class*="trailing"]')?.getBoundingClientRect();
        // (a side menu open on the left: start after it)
        const dl = document.querySelector('[data-hh-drawer="left"]')?.getBoundingClientRect();
        const sub = document.querySelector('[data-hh-subdrawer="left"]')?.getBoundingClientRect();
        const from = Math.max(dl?.right ?? 0, sub?.right ?? 0);
        pos = br ? `l:${Math.round(Math.max(br.left + 8, from + 10, (arrows && arrows.left < br.left + 200 ? arrows.right : br.left + 80) + 8))},t:${Math.round(br.top + (br.height - 20) / 2)}` : "l:10,t:6";
    }
    if (hintsEl.dataset.pos !== pos) {
        hintsEl.dataset.pos = pos;
        const v: Record<string, string> = Object.fromEntries(pos.split(",").map(kv => kv.split(":")));
        hintsEl.style.left = v.l ? `${v.l}px` : "auto";
        hintsEl.style.right = v.r ? `${v.r}px` : "auto";
        hintsEl.style.top = v.t ? `${v.t}px` : "auto";
        hintsEl.style.bottom = v.b ? `${v.b}px` : "auto";
        hintsEl.classList.toggle("hh-hints-top", !v.b);
    }
    // in the top bar: one fixed width, ending just before the (centred) server / channel name — the name never moves;
    // hints that don't fit are dropped from the end (the most important come first)
    const top = hintsEl.classList.contains("hh-hints-top");
    let w = "";
    if (top) {
        const bar = document.querySelector('[class*="base_"] > [class*="bar_"]');
        const name = bar?.querySelector(':scope > [class*="title_"] > *')?.getBoundingClientRect();
        const left = hintsEl.getBoundingClientRect().left;
        const room = name && name.width ? Math.floor(name.left - left - 12) : topHintsWidth();
        w = `${Math.max(120, Math.min(room, topHintsWidth()))}px`;
    }
    if (hintsEl.style.width !== w) { hintsEl.style.width = w; hintsEl.style.minWidth = ""; if (!rebuilt) { hintsEl.innerHTML = html; rebuilt = true; } }
    if (top && rebuilt) { const max = parseFloat(w); while (hintsEl.childElementCount > 1 && hintsEl.scrollWidth > max + 1) hintsEl.lastElementChild!.remove(); }
    shiftTitle(false);
    if (hintsEl.classList.contains("off")) hintsEl.classList.remove("off");
}

let debugEl: HTMLDivElement | null = null;
let debugLog: string[] = [];
function debugNote(msg: string) {
    debugLog.push(msg);
    if (debugLog.length > 4) debugLog.shift();
}
function describe(el: Element | null): string {
    if (!el) return "none";
    const r = el.getBoundingClientRect();
    const attrs = ["data-list-id", "data-hh-list", "data-list-item-id", "role", "aria-label", "id"]
        .map(a => el.getAttribute(a) ? `${a}=${(el.getAttribute(a) ?? "").slice(0, 28)}` : "").filter(Boolean).join(" ");
    return `<${el.tagName.toLowerCase()} ${attrs}> ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}${el.isConnected ? "" : " (gone)"}`;
}
function updateDebug() {
    if (!debugEl) return;
    const text = [
        `mode: ${mode}${typingMode ? " (typing)" : ""} · windows: ${overlayCount()} · stack: ${returnStack.length}`,
        `section: ${describe(section)}`,
        `item: ${describe(focused)}`,
        sectionContents(),
        topProbe(),
        ...debugLog.map(l => "· " + l),
    ].join("\n");
    if (debugEl.textContent !== text) debugEl.textContent = text;
}
/** What's actually drawn at the top of the current section's column (for photos when something can't be reached). */
function topProbe(): string {
    if (!alive(section) || mode !== "inside") return "";
    const region = columnOf(section);
    const sr = section.getBoundingClientRect();
    const x = sr.left + Math.min(sr.width * 0.35, 90);
    const seen: string[] = [];
    for (let y = Math.max(region.getBoundingClientRect().top, 0) + 8, i = 0; i < 14 && y < sr.top + 260; y += 22, i++) {
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        const p = pressableAt(hit, region);
        const el = p ?? hit;
        const tag = `${el.tagName.toLowerCase()}${el.getAttribute("data-list-item-id") ? "#" + el.getAttribute("data-list-item-id")!.split("___")[1]?.slice(0, 10) : ""}${p ? "" : "(x)"}`;
        const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 10);
        const d = `${tag}:${txt}`;
        if (seen[seen.length - 1] !== d) seen.push(d);
    }
    return "top: " + seen.join(" | ");
}
function sectionContents(): string {
    if (!alive(section)) return "contents: -";
    const items = listRows(section) ?? itemsOnTop(section);
    const name = (el: Element) => ((el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 16));
    return `contents (${items.length}): ` + items.slice(0, 7).map(name).join(" | ") + (items.length > 7 ? " | …" : "");
}

// ---------- adjust mode (R3): sliders and resize handles only ----------
// Everything on screen you can drag or slide — the channel list's width handle, volume sliders, any slider — in one
// place: ▲▼ / LB RB pick one, ◀▶ (or the left stick, held to keep going) changes it, B or R3 leaves. Done with the
// arrow keys they all understand, so it works on anything Discord adds later too.
let adjustMode = false, adjIdx = 0, adjLast = 0, adjSince = 0, adjDir = 0, adjEnteredAt = 0;
let adjEl: HTMLElement | null = null;
const ADJUSTABLE = '[role="separator"][aria-valuenow], [role="slider"], input[type="range"]';
function adjustables(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(ADJUSTABLE)].filter(e => isVisible(e) && !isOurs(e) && !e.closest("[data-hh-picker]") && isOnTop(e))
        .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.round(ra.top / 20) - Math.round(rb.top / 20) || ra.left - rb.left; });
}
function adjName(el: Element): string {
    const l = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent || "";
    if (el.matches('[class*="sidebarResizeHandle"]')) return "Channel list width";
    return l.trim() || (el.matches('[role="separator"]') ? "Panel size" : "Slider");
}
function adjValue(el: Element): string {
    const v = (el as HTMLInputElement).value ?? el.getAttribute("aria-valuenow");
    const t = el.getAttribute("aria-valuetext");
    return t || (v != null && v !== "" ? String(Math.round(Number(v) * 100) / 100) : "");
}
function toggleAdjust(on = !adjustMode) {
    if (on) {
        const list = adjustables();
        if (!list.length) return toast("Nothing to adjust here (no sliders or size handles on screen)", 1600);
        adjustMode = true; adjEnteredAt = performance.now();
        adjIdx = Math.max(0, list.indexOf(adjEl!));
        showAdjust(list[adjIdx]);
        toast("🎚 Adjust mode — ◀▶ change · ▲▼ next · B done", 1600);
    } else {
        adjustMode = false;
        adjEl?.removeAttribute("data-hh-adjust");
        adjEl?.blur?.();
        document.querySelector(".hh-adjust-label")?.remove();
    }
    lastPadUse = performance.now();
}
function showAdjust(el: HTMLElement | undefined) {
    adjEl?.removeAttribute("data-hh-adjust");
    if (!el) return;
    adjEl = el;
    el.setAttribute("data-hh-adjust", "");
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    let lab = document.querySelector<HTMLElement>(".hh-adjust-label");
    if (!lab) { lab = document.createElement("div"); lab.className = "hh-hints hh-adjust-label"; document.body.append(lab); markMenuStyle(); }
    const r = el.getBoundingClientRect();
    lab.innerHTML = `<span class="hh-hint"><span>🎚 ${adjName(el).replace(/</g, "&lt;")}</span></span><span class="hh-hint"><b>${adjValue(el)}</b></span>`;
    const w = lab.offsetWidth;
    // (a tall handle like the channel list's edge: next to it, halfway down; anything else: just above it)
    const tall = r.height > 120;
    const x = tall ? r.right + 10 : r.left + r.width / 2 - w / 2;
    const y = tall ? r.top + r.height / 2 - 12 : r.top > 40 ? r.top - 30 : r.bottom + 6;
    lab.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, x)))}px`;
    lab.style.top = `${Math.round(Math.max(4, Math.min(window.innerHeight - 30, y)))}px`;
    lab.style.right = lab.style.bottom = "auto";
}
function adjStep(el: HTMLElement, step: 1 | -1) {
    if (el instanceof HTMLInputElement && el.type === "range") {
        // (a real range input only moves for real key presses: set it the way a drag would)
        const min = Number(el.min || 0), max = Number(el.max || 100), st = Number(el.step) || (max - min) / 50;
        const v = Math.min(max, Math.max(min, Number(el.value) + step * st));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
        if (document.activeElement !== el) el.focus();
        const vertical = el.getAttribute("aria-orientation") === "vertical" && !el.matches('[role="separator"]');
        const key = vertical ? (step > 0 ? "ArrowUp" : "ArrowDown") : (step > 0 ? "ArrowRight" : "ArrowLeft");
        el.dispatchEvent(keyEvent("keydown", key)); el.dispatchEvent(keyEvent("keyup", key));
    }
    setTimeout(() => adjEl === el && showAdjust(el), 30);
}
function handleAdjust(pad: Gamepad, jp: (b: Btn) => boolean, pressed: boolean[]) {
    const list = adjustables();
    // (the R3 that turned it on can still read as "just pressed" for a frame: ignore leaving for a moment)
    const leave = performance.now() - adjEnteredAt > 250 && (jp(Btn.B) || jp(Btn.R3) || jp(Btn.Y));
    if (!list.length || leave) return toggleAdjust(false);
    if (!adjEl || !list.includes(adjEl)) { adjIdx = Math.min(adjIdx, list.length - 1); showAdjust(list[adjIdx]); }
    const next = (d: 1 | -1) => { adjIdx = Math.max(0, Math.min(list.length - 1, list.indexOf(adjEl!) + d)); showAdjust(list[adjIdx]); };
    if (jp(Btn.Down) || jp(Btn.RB)) next(1);
    if (jp(Btn.Up) || jp(Btn.LB)) next(-1);
    // ◀▶ / left stick: one step, then (held) keep going, faster the longer
    const x = pad.axes[0] ?? 0, dz = Math.max(0.35, settings.store.stickDeadzone ?? 0.5);
    const d = pressed[Btn.Left] || x < -dz ? -1 : pressed[Btn.Right] || x > dz ? 1 : 0;
    const now = performance.now();
    if (d !== adjDir) { adjDir = d; adjSince = adjLast = now; if (d && adjEl) adjStep(adjEl, d as 1 | -1); }
    else if (d && adjEl && now - adjSince > 300 && now - adjLast > (now - adjSince > 900 ? 40 : 90)) { adjLast = now; adjStep(adjEl, d as 1 | -1); }
}

function toggleDebug() {
    if (debugEl) { debugEl.remove(); debugEl = null; return; }
    debugEl = document.createElement("div");
    debugEl.className = "hh-debug";
    document.body.append(debugEl);
}

/** "Controller connected / disconnected" card (top right), with the controller's name and calibration status. */
/** Persistent connection status belongs to the native header layout, not controller overlays. */
let controllerStatusEl: HTMLSpanElement | null = null;
function detectedControllerNames(pads: readonly (Gamepad | null)[], bridgeAlive: boolean): string[] {
    const connected = pads.filter((p): p is Gamepad => !!p && p.connected && !/^HH Fake/.test(p.id));
    const names = [...new Map(connected.map(p => [p.index, padName(p.id)])).values()];
    // The bridge represents the same physical controller; never count it twice.
    return names.length ? names : bridgeAlive ? ["Controller (HandheldControls bridge)"] : [];
}
function updateControllerStatus() {
    const names = detectedControllerNames([...navigator.getGamepads()], !!extPad && performance.now() - extAliveAt < 3000);
    const bar = document.querySelector('[class*="base_"] > [class*="bar_"]');
    const slot = bar?.querySelector<HTMLElement>(':scope > [class*="trailing"]');
    if (!names.length || !slot || !isVisible(slot)) { controllerStatusEl?.remove(); controllerStatusEl = null; return; }
    if (!controllerStatusEl) {
        controllerStatusEl = document.createElement("span");
        controllerStatusEl.className = "hh-controller-status";
        controllerStatusEl.setAttribute("role", "img");
        controllerStatusEl.style.cssText = "display:inline-flex;align-items:center;gap:.25em;flex:0 1 auto;max-width:100%;pointer-events:none;line-height:1;white-space:nowrap;box-sizing:border-box";
    }
    if (slot.firstElementChild !== controllerStatusEl) slot.prepend(controllerStatusEl);
    const nativeIcon = slot.querySelector<SVGElement>('svg:not(.hh-controller-status svg)');
    const size = nativeIcon?.getBoundingClientRect().height || parseFloat(getComputedStyle(slot).fontSize);
    controllerStatusEl.style.fontSize = `${size}px`;
    const nativeGap = parseFloat(getComputedStyle(slot).columnGap) || 0;
    controllerStatusEl.style.marginInlineEnd = `${-nativeGap / 2}px`;
    controllerStatusEl.style.color = nativeIcon ? getComputedStyle(nativeIcon).color : "inherit";
    const count = names.length;
    if (controllerStatusEl.dataset.count !== String(count)) {
        controllerStatusEl.dataset.count = String(count);
        const icon = '<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em;border-radius:.4em;background:color-mix(in srgb,var(--status-positive,currentColor) 15%,transparent);border:1px solid color-mix(in srgb,var(--status-positive,currentColor) 50%,transparent);box-sizing:border-box">🎮</span>';
        controllerStatusEl.innerHTML = icon.repeat(Math.min(count, 3)) + `<span style="font-size:.6em;font-weight:600">${count > 1 ? `${count} connected` : "Connected"}</span>`;
    }
    const label = `${count} controller${count === 1 ? "" : "s"} detected: ${names.join(", ")}`;
    controllerStatusEl.setAttribute("aria-label", label);
    controllerStatusEl.title = label;
}
let padCardEl: HTMLDivElement | null = null, padCardTimer = 0;
const padName = (id: string) => id.replace(/\s*\((?:STANDARD GAMEPAD|Vendor)[^)]*\)\s*/gi, " ").replace(/^Microsoft\s+/i, "").replace(/\s+/g, " ").trim() || "Controller";
function showPadCard(pad: Gamepad, connected: boolean) {
    if (!controllerActive) return;
    if (/^HH Fake/.test(pad.id)) return; // (test controller)
    padCardEl?.remove();
    padCardEl = document.createElement("div");
    padCardEl.className = `hh-padcard ${connected ? "" : "hh-padcard-off"}`;
    const cal = connected ? (calibFor(pad.id) ? "Calibrated" : "Not calibrated — set up the first time you type") : "";
    padCardEl.innerHTML = `<div class="hh-padcard-dot"></div><div><div class="hh-padcard-title">${connected ? "Controller connected" : "Controller disconnected"}</div>
        <div class="hh-padcard-name">${padName(pad.id)}</div>${cal ? `<div class="hh-padcard-sub">${cal}</div>` : ""}</div>`;
    document.body.append(padCardEl);
    clearTimeout(padCardTimer);
    const el = padCardEl;
    padCardTimer = window.setTimeout(() => { el.classList.add("hh-padcard-out"); setTimeout(() => el.remove(), 250); }, 3200);
}
const onPadConnected = (e: GamepadEvent) => showPadCard(e.gamepad, true);
const onPadDisconnected = (e: GamepadEvent) => showPadCard(e.gamepad, false);

/** "Message sent" card (same style as the controller card), with the start of the message. */
let sentCardEl: HTMLDivElement | null = null, sentCardTimer = 0;
function showSentCard(text: string) {
    if (!controllerActive) return;
    sentCardEl?.remove();
    sentCardEl = document.createElement("div");
    sentCardEl.className = "hh-padcard hh-sentcard";
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    sentCardEl.innerHTML = `<div class="hh-padcard-dot"></div><div><div class="hh-padcard-title">Message sent</div><div class="hh-padcard-name">${esc(text.length > 60 ? text.slice(0, 60) + "…" : text)}</div></div>`;
    document.body.append(sentCardEl);
    clearTimeout(sentCardTimer);
    const el = sentCardEl;
    sentCardTimer = window.setTimeout(() => { el.classList.add("hh-padcard-out"); setTimeout(() => el.remove(), 250); }, 1800);
}

/** The message you're replying to keeps an outline while the reply is pending (Discord's own "Replying to" bar can be
 *  under the keyboard). Re-applied on reply changes and on the periodic checks, since Discord re-renders messages. */
let replyMarked: Element | null = null;
function markReplyTarget() {
    let el: Element | null = null;
    try {
        const cid = SelectedChannelStore.getChannelId();
        const pr = cid ? (findStore("PendingReplyStore") as any)?.getPendingReply?.(cid) : null;
        if (pr?.message?.id) el = document.getElementById(`chat-messages-${cid}-${pr.message.id}`);
    } catch { }
    if (el === replyMarked) return;
    replyMarked?.removeAttribute("data-hh-replying");
    replyMarked = el;
    el?.setAttribute("data-hh-replying", "");
}
const onReplyChange = () => setTimeout(markReplyTarget, 50);

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(text: string, ms = 1400) {
    if (!controllerActive) return;
    if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "hh-toast";
        document.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (toastEl) toastEl.style.opacity = "0"; }, ms);
}

// ---------- automatic handling when things open / close ----------
function save(): Saved { return { mode, section, focused }; }

function restore() {
    while (returnStack.length) {
        const s = returnStack.pop()!;
        if (s.mode === "inside" && alive(s.section) && alive(s.focused) && isOnTop(s.focused)) {
            section = s.section; sectionKey = keyOf(s.section); mode = "inside"; setItem(s.focused); return;
        }
        if (alive(s.section) && itemsOnTop(s.section).length) { highlightSection(s.section); return; }
    }
    highlightSection(defaultSection());
}

/** Go back to where you were once a closing menu is really gone (while it closes, it can still cover the screen). */
function restoreSoon(tries = 0) {
    setTimeout(() => {
        const picker = nativeExpressionPicker();
        if (picker && nativePickerLock) { keepNativeExpressionFocus(picker); return; }
        if (openMenu()) return; // another menu opened meanwhile: that one owns the selection now
        const s = returnStack[returnStack.length - 1];
        const stillCovered = s && alive(s.focused) ? !isOnTop(s.focused) : !defaultSection();
        if (stillCovered && tries < 8) return restoreSoon(tries + 1);
        restore();
    }, 50);
}

/** scrollableAncestor, remembered per element for half a second (the highlight asks every frame; the answer rarely changes). */
const scrollAncCache = new WeakMap<Element, { at: number; v: HTMLElement | null; }>();
function scrollAreaOf(el: Element | null): HTMLElement | null {
    if (!el) return null;
    const hit = scrollAncCache.get(el), now = performance.now();
    if (hit && now - hit.at < 500 && (!hit.v || hit.v.isConnected)) return hit.v;
    const v = scrollableAncestor(el);
    scrollAncCache.set(el, { at: now, v });
    return v;
}

/** The newest pop-out / dialog (e.g. the mic & headphone volume pop-outs), unless it's the settings screen. */
/** Pop-outs Discord doesn't mark as windows (voice panel's noise suppression, the stream / activity pickers…): anything
 *  with buttons in its pop-up layer that isn't a menu, a tooltip or our own. */
function popouts(): Element[] {
    const out: Element[] = [];
    for (const lc of document.querySelectorAll('[class*="layerContainer"]')) for (const layer of lc.children) {
        if (layer.matches('[role="tooltip"], [class*="tooltip"]') || layer.querySelector('[role="menu"], [role="tooltip"], [class*="tooltip"]')) continue;
        if (layer.matches("[data-hh-picker], [data-hh-drawer]") || layer.querySelector("[data-hh-picker], [data-hh-drawer]")) continue;
        if (layer.querySelector('[role="dialog"], [aria-modal="true"]') || !isVisible(layer)) continue;
        if (layer.querySelector(FOCUSABLE)) out.push(layer);
    }
    return out;
}
function newestWindow(): Element | null {
    const wins = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(isVisible).concat(popouts());
    const top = wins[wins.length - 1];
    if (!top || !itemsOnTop(top).length) return null;
    const tl = top.querySelector('[role="tablist"]');
    if (tl && tl.querySelectorAll('[role="tab"]').length >= 6) return null; // that's settings: use its page list
    const list = newSettingsList();
    if (list && top.contains(list)) return null;
    return top;
}

/** How many "windows" are open on top of the main screen (settings counts as one, plus any dialogs). */
function overlayCount(): number {
    let n = 0, settingsCounted = false;
    const list = newSettingsList();
    for (const d of document.querySelectorAll('[role="dialog"], [aria-modal="true"]')) if (isVisible(d)) {
        n++;
        if (list && d.contains(list)) settingsCounted = true; // the redesigned settings is itself a dialog: count it once
    }
    if (!settingsCounted && settingsOpen()) n++;
    n += popouts().length;
    // a full-screen page that isn't marked as a dialog (e.g. "Boost this server") still covers everything: a window
    if (n === 0 && fullScreenPage()) n = 1;
    return n;
}
let lastOverlays = 0;
let sectionKey: string | null = null; // remembers WHICH list we're in, so we can find it again after Discord re-renders it

function keyOf(sec: Element | null): string | null {
    if (sec && sec.querySelector(CHAT_LIST) && sec.querySelectorAll(LIST).length > 1) return CHAT_LIST;
    const inner = sec && !sec.matches(LIST) && sec.querySelectorAll(LIST).length === 1 ? sec.querySelector(LIST) : null;
    const id = sec ? (sec.matches(LIST) ? listIdOf(sec) : inner ? listIdOf(inner) : null) : null;
    return id ? listSel(id) : null;
}

function watchLayers() {
    if (probing && performance.now() - probeStarted > 2000) { probing = false; document.documentElement.removeAttribute("data-hh-probing"); }
    if (probing) return; // (a hidden test right-click: not a menu you opened)
    const menu = openMenu();
    const usingPad = performance.now() - lastPadUse < 20000;

    // a menu opened → select its first option right away; when it closes, go back
    if (menu !== lastMenu) {
        // a menu replacing a menu is the same session: a sub-menu opening / closing, or Discord re-drawing the menu
        const nested = !!menu && !!lastMenu;
        if (menu && usingPad) {
            if (!nested) returnStack.push(save());
            // back from a sub-menu: the item that opened it
            const back = nested && alive(menuOpener) && menu.contains(menuOpener) ? menuOpener : null;
            if (back) menuOpener = null;
            // re-drawn: stay on the same option (found again by its id), or where you are if it's still there
            const same = !nested || back ? null
                : alive(focused) && menu.contains(focused) ? focused
                : focused?.id ? document.getElementById(focused.id) : null;
            const choices = [...menu.querySelectorAll(MENU_ITEM)].filter(el => isVisible(el) && !isDisabled(el));
            // (a sub-menu that just opened starts at its top; a fresh menu on its usual first choice)
            const first = back ?? (same && menu.contains(same) ? same : null) ?? (nested ? choices[0] : firstMenuChoice(choices));
            if (first) setItem(first);
        }
        if (menu && !nested) openDrawer(menu);
        syncSubDrawer(menu);
        if (!menu) {
            menuOpener = null;
            closeDrawer();
            if (lastMenu && usingPad) restoreSoon();
        }
    }
    lastMenu = menu;
    const expression = nativeExpressionPicker();
    if (!menu && expression && nativePickerLock) {
        keepNativeExpressionFocus(expression);
        lastOverlays = overlayCount();
        return;
    }
    if (menu || (frame % 15 !== 0 && performance.now() - lastBgCheck > 50)) return; // (dialogs / settings: ~4–8 checks a second while active, and on each background check)

    // Discord rebuilds lists while you scroll: if our list/row got swapped out, quietly find it again (never jump away)
    if (section && !section.isConnected) {
        const list = sectionKey ? document.querySelector(sectionKey) : null;
        if (list) section = widen(listSectionFor(list));
    }
    if (mode === "inside" && focused && !focused.isConnected && alive(section)) {
        const fresh = itemsOnTop(section);
        if (fresh.length) setItem(entryItemFor(section) ?? fresh[0]);
    }

    // a real window opened (settings / dialog) → lock into it; it closed → go back to where you were
    if (!usingPad) { lastOverlays = overlayCount(); return; }
    const count = overlayCount();
    // pop-ups that come and go while you type (emoji / mention suggestions) aren't windows to move into;
    // but a window that was already open when you started typing (a profile card you sent from) closing is
    // (but Discord's settings opening while you type is a real window: put the keyboard away and go into it)
    if (typingMode && count > lastOverlays && settingsOpen()) stopTyping();
    if (typingMode) {
        if (count < typingBase) { restoreSoon(); typingBase = count; }
        lastOverlays = count;
        return;
    }
    if (count > lastOverlays) {
        returnStack.push(save());
        // a dialog (also one opened from inside settings, e.g. "Edit username"): go into it;
        // settings itself: straight onto its page list, on the page that's open (like a menu)
        const win = newestWindow();
        if (win) lockInto(win);
        else if (settingsOpen()) enterSettingsList();
        else lockInto(defaultSection());
    } else if (count < lastOverlays) {
        restoreSoon(); // (once the closing window is really gone)
    }
    lastOverlays = count;
}

// ---------- on-screen UI ----------
const lastPlaced = new WeakMap<HTMLElement, string>();
function place(el: HTMLElement, r: DOMRect | null, pad = 0) {
    const key = !r || r.width === 0 || r.height === 0
        ? "hidden"
        : `${Math.round(r.left - pad)},${Math.round(r.top - pad)},${Math.round(r.width + pad * 2)},${Math.round(r.height + pad * 2)}`;
    if (lastPlaced.get(el) === key) return;
    lastPlaced.set(el, key);
    if (key === "hidden") { el.style.opacity = "0"; return; }
    const [x, y, w, h] = key.split(",");
    el.style.cssText = `opacity:1;transform:translate(${x}px,${y}px);width:${w}px;height:${h}px`;
}

function ensureOverlays() {
    if (ringEl && frameEl) return;
    frameEl = document.createElement("div");
    frameEl.className = "hh-frame";
    // padlock badge in the frame's top-right corner: shows while you're locked into this section
    const lock = document.createElement("div");
    lock.className = "hh-lock";
    lock.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Zm3 4a1.5 1.5 0 0 1 .75 2.8V18a.75.75 0 0 1-1.5 0v-1.2A1.5 1.5 0 0 1 12 14Z"/></svg>`;
    frameEl.append(lock);
    ringEl = document.createElement("div");
    ringEl.className = "hh-ring";
    document.body.append(frameEl, ringEl);
}

function clipTo(r: DOMRect, area: Element | null) {
    if (!area) return r;
    const s = area.getBoundingClientRect();
    const top = Math.max(r.top, s.top), bottom = Math.min(r.bottom, s.bottom);
    return bottom > top ? new DOMRect(r.left, top, r.width, bottom - top) : new DOMRect(0, 0, 0, 0);
}

/** Match the part Discord actually draws, including nested horizontal and vertical clipping. */
function visibleOutlineRect(el: Element, pad = 0, clipFrom: Element | null = el.parentElement): DOMRect {
    const r = el.getBoundingClientRect();
    let left = Math.max(0, r.left - pad), top = Math.max(0, r.top - pad);
    let right = Math.min(window.innerWidth, r.right + pad), bottom = Math.min(window.innerHeight, r.bottom + pad);
    for (let n = clipFrom; n && n !== document.body; n = n.parentElement) {
        const st = getComputedStyle(n), b = n.getBoundingClientRect();
        if (/^(hidden|clip|auto|scroll)$/.test(st.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
        if (/^(hidden|clip|auto|scroll)$/.test(st.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}
let outlinePeers: Element[] = [], outlinePeersAt = -Infinity;
/** Floating peer panels can cover a section even when its DOM rectangle extends behind them. */
function visibleSectionRect(el: Element): DOMRect {
    let r = visibleOutlineRect(el);
    if (performance.now() - outlinePeersAt > 250) { outlinePeers = listSections(); outlinePeersAt = performance.now(); }
    for (const peer of outlinePeers) {
        if (!peer.isConnected || peer === el || peer.contains(el) || el.contains(peer)) continue;
        const b = visibleOutlineRect(peer);
        const left = Math.max(r.left, b.left), right = Math.min(r.right, b.right);
        const top = Math.max(r.top, b.top), bottom = Math.min(r.bottom, b.bottom);
        if (right <= left || bottom <= top) continue;
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (!hit || !peer.contains(hit)) continue;
        if (right - left > r.width * .5) {
            if (b.top > r.top + r.height / 2 && b.bottom >= r.bottom - Math.min(r.height, b.height) * .2) r = new DOMRect(r.left, r.top, r.width, b.top - r.top);
            else if (b.top <= r.top + Math.min(r.height, b.height) * .2 && b.bottom < r.top + r.height / 2) r = new DOMRect(r.left, b.bottom, r.width, r.bottom - b.bottom);
        } else if (bottom - top > r.height * .5) {
            if (b.left > r.left + r.width / 2 && b.right >= r.right - Math.min(r.width, b.width) * .2) r = new DOMRect(r.left, r.top, b.left - r.left, r.height);
            else if (b.left <= r.left + Math.min(r.width, b.width) * .2 && b.right < r.left + r.width / 2) r = new DOMRect(b.right, r.top, r.right - b.right, r.height);
        }
    }
    return r;
}

function updateOverlays() {
    // The keyboard owns focus here; a native composer ring underneath leaks glow past its edges.
    if (kbEl && typingMode && !openMenu() && !nativeExpressionPicker()) {
        if (ringEl) place(ringEl, null);
        if (frameEl) place(frameEl, null);
        return;
    }
    const menuOpen = !!openMenu();
    const hasSection = alive(section);
    const hasItem = alive(focused) && (mode === "inside" || menuOpen);
    if (!hasSection && !hasItem) {
        document.documentElement.removeAttribute("data-hh-server-area-picking");
        if (ringEl && frameEl) { place(ringEl, null); place(frameEl, null); }
        return;
    }
    ensureOverlays();
    if (!ringEl || !frameEl) return;

    const picking = mode === "sections" && !menuOpen;
    if (frameEl.classList.contains("hh-picking") !== picking) frameEl.classList.toggle("hh-picking", picking);

    // section frame: bright while picking sections, faint while locked in, hidden while a menu is open
    let secRect: DOMRect | null = null;
    const serverArea = hasSection && section!.matches('[data-list-id="guildsnav"]');
    frameEl.classList.toggle("hh-server-area", serverArea);
    document.documentElement.toggleAttribute("data-hh-server-area-picking", serverArea && picking);
    if (hasSection && picking) secRect = visibleSectionRect(section!);
    place(frameEl, secRect);
    // keep the padlock on screen when the section touches the screen's edge (e.g. the server list on the right)
    if (secRect) {
        const edgeR = secRect.right > window.innerWidth - 14, edgeT = secRect.top < 14;
        if (frameEl.classList.contains("hh-edge-r") !== edgeR) frameEl.classList.toggle("hh-edge-r", edgeR);
        if (frameEl.classList.contains("hh-edge-t") !== edgeT) frameEl.classList.toggle("hh-edge-t", edgeT);
    }

    // item ring: only while locked in (or in a menu)
    if (hasItem) {
        const isServer = focused!.matches(ROW.server);
        ringEl.classList.toggle("hh-channel", focused!.matches(ROW.channel));
        if (ringEl.classList.contains("hh-round") !== isServer) ringEl.classList.toggle("hh-round", isServer);
        const fr = focused!.getBoundingClientRect();
        // small things (switches, icon buttons) get a gap around them, so the ring never blends into a same-colored switch
        if (isServer) {
            const border = parseFloat(getComputedStyle(ringEl).borderLeftWidth) || 0;
            const pad = border + Math.min(fr.width, fr.height) * .075;
            // SVG icon masks clip Discord's picture, not our ring. Still respect the row's scroll containers.
            const row = focused!.closest('[class*="listItem"]');
            place(ringEl, visibleOutlineRect(focused!, pad, row ?? focused!.parentElement));
        } else place(ringEl, visibleOutlineRect(focused!, fr.height < 48 ? 5 : 1));
    } else place(ringEl, null);
}

type Badge = "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "L" | "R" | "L3" | "R3" | "DPAD" | "MENU" | "VIEW";
const HELP_GROUPS: { title: string; rows: [Badge[], string, string?][]; }[] = [
    {
        title: "Getting around",
        rows: [
            [["DPAD", "L"], "Move", "past the edge = next section"],
            [["A"], "Lock into a section", "inside: select · open · type"],
            [["B"], "Back one step", "close menu → stop typing → unlock"],
            [["Y"], "Unlock", "jump back to picking sections"],
        ],
    },
    {
        title: "Actions",
        rows: [
            [["X"], "Hold action", "menu slides in from the side"],
            [["A"], "On a message: go inside", "name · avatar · reactions · links (B = back out)"],
            [["A"], "On the message box: type", "brings up the on-screen keyboard"],
            [["R"], "Scroll", "the section you're in"],
            [["L3"], "Jump to newest message"],
            [["R3"], "Debug info", "for reporting bugs"],
        ],
    },
    {
        title: "Shortcuts",
        rows: [
            [["LB", "RB"], "Previous / next server"],
            [["LT", "RT"], "Previous / next channel"],
            [["MENU"], "Discord settings"],
            [["VIEW"], "This guide", "then ☰ = controller settings"],
        ],
    },
];

/** Button names for each kind of controller (by position: "A" is always the bottom face button). */
const BUTTON_NAMES: Record<string, Partial<Record<Badge, string>>> = {
    xbox: {},
    playstation: { A: "✕", B: "○", X: "□", Y: "△", LB: "L1", RB: "R1", LT: "L2", RT: "R2", MENU: "☰", VIEW: "⊡" },
    nintendo: { A: "B", B: "A", X: "Y", Y: "X", LB: "L", RB: "R", LT: "ZL", RT: "ZR", L3: "LS", R3: "RS", MENU: "+", VIEW: "−" },
};
let lastPadName = "";
function buttonLayout(): string {
    const v = String(opt("buttonLayout") ?? "auto");
    if (v !== "auto") return v;
    const id = getPad()?.id ?? lastPadName;
    if (id) lastPadName = id;
    if (/054c|dualsense|dualshock|playstation|wireless controller/i.test(id)) return "playstation";
    if (/057e|nintendo|pro controller|joy-?con/i.test(id)) return "nintendo";
    return "xbox";
}
/** The look of the button hints (html[data-hh-btns="<layout> <colours>"]). */
function markButtons() {
    if (!controllerActive) return;
    const v = `${buttonLayout()} ${opt("buttonColors") ?? "auto"}`;
    if (document.documentElement.getAttribute("data-hh-btns") !== v) document.documentElement.setAttribute("data-hh-btns", v);
}
function badgeHtml(b: Badge): string {
    const label: Record<Badge, string> = {
        A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", LT: "LT", RT: "RT",
        L: "L", R: "R", L3: "L3", R3: "R3", DPAD: "✚", MENU: "☰", VIEW: "⧉",
        ...BUTTON_NAMES[buttonLayout()],
    };
    const kind =
        "ABXY".includes(b) && b.length === 1 ? `face face-${b}` :
        b === "LB" || b === "RB" ? "bumper" :
        b === "LT" || b === "RT" ? "trigger" :
        b === "L" || b === "R" || b === "L3" || b === "R3" ? "stick" :
        b === "DPAD" ? "dpad" : "system";
    const shapes: Record<string, string> = {
        DPAD: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" stroke="none"/>',
        MENU: '<path d="M5 6h14M5 12h14M5 18h14"/>',
        VIEW: '<rect x="4" y="4" width="12" height="12" rx="1"/><path d="M9 9h11v11H9z"/>',
        "✕": '<path d="m6 6 12 12M18 6 6 18"/>',
        "○": '<circle cx="12" cy="12" r="8"/>',
        "□": '<rect x="5" y="5" width="14" height="14"/>',
        "△": '<path d="m12 4 9 16H3z"/>',
        "+": '<path d="M4 12h16M12 4v16"/>',
        "−": '<path d="M4 12h16"/>',
    };
    const shape = b === "DPAD" ? shapes.DPAD : (b === "MENU" || b === "VIEW") && buttonLayout() !== "nintendo" ? shapes[b] : shapes[label[b]];
    const content = shape ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>` : label[b];
    return `<span class="hh-badge hh-${kind.replace(" ", " hh-")}" aria-label="${b === "DPAD" ? "D-pad" : b === "MENU" ? "Menu" : b === "VIEW" ? "View" : label[b]}">${content}</span>`;
}

let helpTimer = 0;
function toggleHelp(force?: boolean, autoCloseMs = 0) {
    const show = force ?? !helpEl;
    clearTimeout(helpTimer);
    if (!show) {
        if (helpEl) {
            const el = helpEl;
            helpEl = null;
            el.classList.add("hh-help-out");
            setTimeout(() => el.remove(), 160);
        }
        return;
    }
    if (helpEl) return;
    helpEl = document.createElement("div");
    helpEl.className = "hh-help";
    helpEl.innerHTML = `
        <div class="hh-help-card"><div class="hh-brand">${brandHtml}</div>
            <div class="hh-help-head">
                <div class="hh-help-title">🎮 Controller <span style="opacity:.5;font-size:.6em">${VERSION}</span></div>
                <div class="hh-help-sub">Press any button to close · ${badgeHtml("VIEW")} brings this back · ${badgeHtml("MENU")} controller settings</div>
            </div>
            <div class="hh-help-grid">
                ${HELP_GROUPS.map(g => `
                    <div class="hh-help-group">
                        <div class="hh-help-group-title">${g.title}</div>
                        ${g.rows.map(([badges, what, hint]) => `
                            <div class="hh-help-row">
                                <div class="hh-help-badges">${badges.map(badgeHtml).join("")}</div>
                                <div class="hh-help-text"><div class="hh-help-what">${what}</div>${hint ? `<div class="hh-help-hint">${hint}</div>` : ""}</div>
                            </div>`).join("")}
                    </div>`).join("")}
            </div>
        </div>`;
    document.body.append(helpEl);
    if (autoCloseMs) helpTimer = window.setTimeout(() => toggleHelp(false), autoCloseMs);
}

const CSS = `
:root { --hh-accent: var(--focus-primary, var(--brand-500, var(--brand-experiment, #5865f2))); }
[class*="baseLayer"] form [data-list-id="attachments"] { max-height: var(--hh-upload-height, 25vh); overflow-y: auto; box-sizing: border-box; }
.hh-composer-send { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 2em; height: 2em; padding: 0; margin: 0; border: 0; border-radius: .4em; background: transparent; color: var(--interactive-normal, var(--text-normal)); cursor: pointer; }
.hh-composer-send:hover { background: var(--background-modifier-hover); color: var(--interactive-hover, var(--text-normal)); }
.hh-composer-send:focus-visible { outline: 2px solid var(--hh-accent); }
.hh-ring, .hh-frame {
  position: fixed; left: 0; top: 0; z-index: 99999; pointer-events: none; opacity: 0; box-sizing: border-box;
  transition: transform 90ms cubic-bezier(.2,.8,.2,1), width 90ms cubic-bezier(.2,.8,.2,1),
              height 90ms cubic-bezier(.2,.8,.2,1), opacity 90ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.hh-ring.hh-fast, .hh-frame.hh-fast { transition: none; }
.hh-ring {
  border: 3px solid var(--hh-accent); border-radius: 10px;
  background: color-mix(in srgb, var(--hh-accent) 6%, transparent);
  box-shadow: 0 0 0 1px rgb(0 0 0 / .3), inset 0 0 0 1px rgb(0 0 0 / .45), 0 0 10px color-mix(in srgb, var(--hh-accent) 30%, transparent);
}
/* Discord's active-server marker shares our accent; unread dots retain their native appearance. */
[class*="listItem"]:has([data-list-item-id^="guildsnav___"]) > [aria-hidden="true"] > [class*="item_"][class*="selected_"] {
  background-color: var(--hh-accent) !important;
  border-radius: 4px !important;
  box-shadow: none !important;
}
/* Keep the full server-list frame in place; native markers return when the area frame leaves. */
:root[data-hh-server-area-picking] [class*="listItem"]:has([data-list-item-id^="guildsnav___"]) > [aria-hidden="true"] > [class*="item_"] {
  visibility: hidden !important;
}
/* One indicator on the controller-focused server; restore Discord's marker when focus leaves. */
[class*="listItem"]:has([data-list-item-id^="guildsnav___"][data-hh-focus]) > [aria-hidden="true"] > [class*="item_"] {
  visibility: hidden !important;
}
/* Keep channel unread markers distinct without shifting the controller outline or theme layout. */
:is(li, [class*="containerDefault"]):has([data-list-item-id^="channels___"][data-hh-focus]) [class*="unread_"] {
  visibility: hidden !important;
}
.hh-ring.hh-channel { box-shadow: inset 0 0 0 1px rgb(0 0 0 / .45); }
.hh-ring.hh-round { border-radius: 30%; border-width: 3px;
  box-shadow: 0 0 0 2px rgb(0 0 0 / .45), 0 0 16px color-mix(in srgb, var(--hh-accent) 65%, transparent); }
.hh-frame { border: 2px solid color-mix(in srgb, var(--hh-accent) 40%, transparent); border-radius: 12px; }
.hh-lock {
  position: absolute; top: -11px; right: -11px; width: 24px; height: 24px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--hh-accent); color: #fff;
  box-shadow: 0 0 0 2px var(--background-primary, #313338), 0 2px 8px rgb(0 0 0 / .45);
  transform: scale(1); opacity: 1;
  transition: transform 160ms cubic-bezier(.3,1.6,.5,1), opacity 120ms ease;
}
.hh-frame .hh-lock { display: none !important; } /* (no padlock: moving around is free-form now) */
.hh-frame.hh-edge-r .hh-lock { right: 4px; }
.hh-frame.hh-edge-t .hh-lock { top: 4px; }
.hh-frame.hh-picking .hh-lock { transform: scale(.3); opacity: 0; transition-duration: 90ms; }
.hh-frame.hh-picking {
  border: 3px solid var(--hh-accent);
  background: color-mix(in srgb, var(--hh-accent) 4%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--hh-accent) 30%, transparent);
}
.hh-frame.hh-server-area.hh-picking { box-shadow: none; }
.hh-toast {
  position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 100001; pointer-events: none;
  padding: 8px 14px; border-radius: 10px; font-size: 14px; font-weight: 600; opacity: 0; transition: opacity 150ms ease;
  background: var(--background-floating, #111214); color: var(--text-normal, #dbdee1);
  border: 2px solid var(--hh-accent); box-shadow: 0 6px 24px rgb(0 0 0 / .5);
}
.hh-debug {
  position: fixed; left: 8px; bottom: 8px; z-index: 100002; pointer-events: none; white-space: pre;
  max-width: 70vw; padding: 8px 10px; border-radius: 8px; font: 12px/1.4 monospace;
  background: rgb(0 0 0 / .8); color: #7CFC7C;
}

.hh-help {
  position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center;
  background: rgb(0 0 0 / .55); backdrop-filter: blur(3px); pointer-events: none;
  animation: hh-fade-in 160ms ease-out;
}
.hh-help.hh-help-out { animation: hh-fade-out 150ms ease-in forwards; }
.hh-help-card {
  width: min(980px, 94vw); max-height: 90vh; overflow: hidden; box-sizing: border-box;
  padding: 26px 30px 28px; border-radius: 22px;
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--hh-accent) 22%, transparent), transparent 55%),
    var(--background-floating, var(--background-base-lowest, #111214));
  color: var(--text-normal, var(--text-default, #dbdee1));
  border: 1px solid color-mix(in srgb, var(--hh-accent) 45%, transparent);
  box-shadow: 0 30px 80px rgb(0 0 0 / .6), 0 0 0 1px rgb(255 255 255 / .04) inset;
  animation: hh-pop-in 200ms cubic-bezier(.2,.9,.25,1.15);
}
.hh-help.hh-help-out .hh-help-card { animation: hh-pop-out 150ms ease-in forwards; }
.hh-help-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.hh-help-title { font-size: 28px; font-weight: 800; letter-spacing: .3px; color: var(--header-primary, var(--text-strong, #fff)); }
.hh-help-sub { font-size: 14px; opacity: .75; display: flex; align-items: center; gap: 6px; }
.hh-help-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.hh-help-group {
  padding: 16px; border-radius: 16px;
  background: color-mix(in srgb, var(--text-normal, #fff) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--text-normal, #fff) 8%, transparent);
}
.hh-help-group-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; color: var(--hh-accent); margin-bottom: 12px; }
.hh-help-row { display: flex; align-items: center; gap: 14px; padding: 8px 0; }
.hh-help-row + .hh-help-row { border-top: 1px solid color-mix(in srgb, var(--text-normal, #fff) 7%, transparent); }
.hh-help-badges { display: flex; gap: 6px; min-width: 84px; justify-content: flex-end; }
.hh-help-what { font-size: 16px; font-weight: 700; color: var(--header-primary, var(--text-strong, #fff)); line-height: 1.2; }
.hh-help-hint { font-size: 13px; opacity: .7; margin-top: 2px; line-height: 1.25; }
.hh-badge {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  height: 34px; min-width: 34px; padding: 0 8px; box-sizing: border-box;
  font: 800 14px/1 system-ui, sans-serif; color: #fff;
  background: #3a3c43; border: 2px solid rgb(255 255 255 / .18);
  box-shadow: 0 3px 0 rgb(0 0 0 / .45), 0 0 0 1px rgb(0 0 0 / .3);
}
.hh-badge > svg { display: block; width: 18px; height: 18px; flex: none; }
.hh-face { border-radius: 50%; width: 34px; padding: 0; font-size: 16px; }
.hh-face-A { background: #2fb344; } .hh-face-B { background: #d63939; }
.hh-face-X { background: #2f7bd6; } .hh-face-Y { background: #e3a008; color: #1d1d1d; }
.hh-bumper { border-radius: 8px 8px 4px 4px; min-width: 42px; }
.hh-trigger { border-radius: 12px 12px 6px 6px; min-width: 38px; height: 38px; }
.hh-stick { border-radius: 50%; width: 34px; padding: 0; background: radial-gradient(circle at 40% 35%, #5a5d66, #26282d); }
.hh-dpad { border-radius: 8px; font-size: 18px; background: #26282d; }
.hh-system { border-radius: 50%; width: 34px; padding: 0; background: #26282d; font-size: 15px; }
.hh-help-sub .hh-badge { height: 24px; min-width: 24px; width: 24px; font-size: 12px; box-shadow: none; }
@keyframes hh-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes hh-fade-out { to { opacity: 0; } }
@keyframes hh-pop-in { from { opacity: 0; transform: scale(.94) translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes hh-pop-out { to { opacity: 0; transform: scale(.97); } }
@media (max-width: 760px) { .hh-help-grid { grid-template-columns: 1fr; } }
`;

// ---------- input loop ----------
// ---------- Game Mode: whole-screen sharing ----------
// In Game Mode an "Entire screen" share is black: Vesktop captures gamescope's X server, but gamescope draws the real
// picture itself. The pad bridge (hh-pad-bridge.py) can feed gamescope's own screen stream into the virtual camera
// (/dev/video0, "OBS Virtual Camera") — so for a whole-screen share we ask it to, and hand Discord that picture
// instead. App-window shares (and everything outside Game Mode) are left exactly as they are.
let origGetDisplayMedia: ((o?: DisplayMediaStreamOptions) => Promise<MediaStream>) | null = null;
const feedTracks = new Set<MediaStreamTrack>();
let feedWatch = 0;
function installScreenSwap(on: boolean) {
    const md = navigator.mediaDevices as any;
    if (on && !origGetDisplayMedia) {
        origGetDisplayMedia = md.getDisplayMedia;
        md.getDisplayMedia = async function (opts?: DisplayMediaStreamOptions) {
            const stream = await origGetDisplayMedia!.call(this, opts);
            try { return await swapScreenIfBlack(stream); } catch (e) { console.error("[HandheldControls] screen swap", e); return stream; }
        };
    } else if (!on && origGetDisplayMedia) {
        md.getDisplayMedia = origGetDisplayMedia; origGetDisplayMedia = null;
        (window as any).__hhWantScreenFeed = false; clearInterval(feedWatch);
    }
}
async function swapScreenIfBlack(stream: MediaStream): Promise<MediaStream> {
    const w = window as any;
    const v = stream.getVideoTracks()[0];
    if (!w.__hhGamescope || !v) return stream;
    const st = v.getSettings() as any;
    const isScreen = st.displaySurface === "monitor" || /^screen[:\s]/i.test(v.label) || /entire screen/i.test(v.label);
    if (!isScreen) return stream;
    w.__hhWantScreenFeed = true;
    // the virtual camera only shows up once the feed is running (a second or so)
    let dev: MediaDeviceInfo | undefined;
    for (let i = 0; i < 40 && !dev; i++) {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        dev = cams.find(d => /obs virtual camera|v4l2loopback|dummy video/i.test(d.label)) ?? (cams.length === 1 ? cams[0] : undefined);
        if (!dev) await new Promise(r => setTimeout(r, 150));
    }
    if (!dev) { w.__hhWantScreenFeed = false; toast("Couldn't get the Game Mode screen — sharing as usual", 2500); return stream; }
    const cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: dev.deviceId }, width: { ideal: st.width || 1920 }, height: { ideal: st.height || 1080 }, frameRate: { ideal: st.frameRate || 30 } } });
    const ct = cam.getVideoTracks()[0];
    watchFeedTrack(ct);
    v.stop();
    return new MediaStream([ct, ...stream.getAudioTracks()]);
}
/** The feed runs while any copy of the shared picture is still live; once they've all stopped, it stops. */
function watchFeedTrack(t: MediaStreamTrack) {
    feedTracks.add(t);
    const clone = t.clone.bind(t);
    t.clone = () => { const c = clone(); watchFeedTrack(c); return c; };
    clearInterval(feedWatch);
    feedWatch = window.setInterval(() => {
        for (const x of feedTracks) if (x.readyState === "ended") feedTracks.delete(x);
        if (!feedTracks.size) { (window as any).__hhWantScreenFeed = false; clearInterval(feedWatch); }
    }, 1500);
}

/** The controller as read by the pad bridge (~/.local/bin/hh-pad-bridge.py, started with Vesktop): straight from the
 *  system, over the debug port — for when Chromium loses the controller (Bazzite reloads the controller profile on every
 *  Steam-button press, and the sandboxed browser can drop the pad for good). Used whenever the bridge is alive. */
let extPad: Gamepad | null = null, extAliveAt = 0;
let sampledExtPad: Gamepad | null = null;
let extTransitions: Gamepad[] = [];
let extInputKey = "";
(window as any).__hhExtPadSet = (st: { b: number[]; a: number[]; } | null) => {
    extAliveAt = performance.now();
    if (!st) return; // Existing bridges send null as an idle heartbeat.
    extPad = {
        id: "Controller (via HandheldControls bridge)", index: 0, connected: true, mapping: "standard", timestamp: extAliveAt,
        axes: st.a, buttons: st.b.slice(0, 17).map(v => ({ pressed: v > 0.5, touched: v > 0, value: v })),
        vibrationActuator: null, hapticActuator: null,
    } as unknown as Gamepad;
    const key = extPad.buttons.map(b => b.pressed ? "1" : "0").join("") + ":" + stickDir(extPad);
    // A press and release can arrive in the same animation frame. Keep both, in order.
    if (!document.hasFocus() || (window as any).__hhNativeFileChooser || (window as any).__hhPad) {
        extTransitions = []; sampledExtPad = extPad;
    } else if (key !== extInputKey) {
        extTransitions.push(extPad);
    } else if (extTransitions.length) {
        // Analog updates do not build a backlog while a stick is held in one direction.
        extTransitions[extTransitions.length - 1] = extPad;
    }
    extInputKey = key;
};
(window as any).__hhExtPadDisconnect = () => {
    extPad = null; sampledExtPad = null; extTransitions = []; extInputKey = ""; extAliveAt = 0;
};
function sampleControllerInput() {
    if ((window as any).__hhPad) { extTransitions = []; sampledExtPad = extPad; return; }
    sampledExtPad = extTransitions.shift() ?? extPad;
}
function getPad(): Gamepad | null {
    if (extPad && performance.now() - extAliveAt < 3000 && !(window as any).__hhPad) return sampledExtPad ?? extPad; // (the test pad wins)
    const pads = [...navigator.getGamepads()].filter(Boolean) as Gamepad[];
    return pads.find(p => p.mapping === "standard" && p.buttons.length >= 16) ?? pads[0] ?? null;
}

function stickDir(pad: Gamepad): Dir | null {
    const dz = settings.store.stickDeadzone;
    const [x = 0, y = 0] = pad.axes;
    if (Math.abs(x) < dz && Math.abs(y) < dz) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
}

let errorCount = 0;
function tick() {
    raf = requestAnimationFrame(tick);
    frame++;
    try {
        tickInner();
        if (frame % 30 === 0) updateControllerStatus();
        if (controllerActive && kbEl && frame % 6 === 0) updateSuggestions();
        const idle = performance.now() - lastPadUse > 15000 && !kbEl && !panelEl && !calibEl && !helpEl;
        if (controllerActive && (!idle || frame % 30 === 0)) updateOverlays();
        if (controllerActive && frame % 4 === 0) updateHints();
        errorCount = 0;
    } catch (e) {
        // (never stops for good — that left the controller dead until a reload: report it once, then keep trying)
        if (++errorCount <= 3 || errorCount % 300 === 0) console.error("[HandheldControls]", e);
        if (errorCount === 30) toast("🎮 Controller hiccup — still running (if something's stuck, press B)", 2500);
    }
}

function tickInner() {
    // idle (controller untouched for a while, nothing of ours open): only watch for a button press, and keep the
    // highlight / menus in sync a couple of times a second instead of every frame — the first press wakes it up
    const idle = performance.now() - lastPadUse > 15000 && !kbEl && !panelEl && !calibEl && !helpEl;
    // menus / windows: searched for only just after input, while one is open, or as a background check twice a second
    const bg = performance.now() - lastBgCheck > 1000;
    if (bg) { lastBgCheck = performance.now(); if (replyMarked || (findStore("PendingReplyStore") as any)?.getPendingReply?.(SelectedChannelStore.getChannelId())) markReplyTarget(); }
    checksPaused = !(performance.now() < checkUntil || lastMenu || lastOverlays > 0 || bg);
    if (controllerActive && (!idle || frame % 30 === 0)) {
        if (!checksPaused && (section || focused || openMenu() !== lastMenu)) watchLayers();
    }
    if (debugEl && frame % 20 === 0) updateDebug(); // the readout is costly: a few times a second is plenty
    if (!document.hasFocus()) return;
    sampleControllerInput();
    const pad = getPad();
    if (!pad) return;

    const pressed = pad.buttons.map(b => b.pressed || b.value > 0.5);
    const justPressed = (b: Btn) => pressed[b] && !prevPressed[b];
    if ((window as any).__hhNativeFileChooser) { prevPressed = pressed; heldDir = null; return; }
    const activity = controllerActivity(pad);
    const activeInput = pressed.some(Boolean) || stickDir(pad) || Math.abs(pad.axes[2] ?? 0) > settings.store.stickDeadzone || Math.abs(pad.axes[3] ?? 0) > settings.store.stickDeadzone;
    if (!controllerActive) {
        if (!activeInput || activity === lastControllerActivity) { lastControllerActivity = activity; prevPressed = pressed; return; }
        activateController();
    }
    lastControllerActivity = activity;
    const expression = nativeExpressionPicker();
    const popupOwnsInput = !!expression || !!openMenu() || overlayCount() > 0;
    if (popupOwnsInput) navigationButtonsBlocked = true;
    else if (![Btn.LB, Btn.RB, Btn.LT, Btn.RT].some(b => pressed[b])) navigationButtonsBlocked = false;
    if (pressed.some(Boolean) || stickDir(pad)) { lastPadUse = performance.now(); bumpChecks(); }

    if (!helpShownOnce && pressed.some(Boolean)) {
        helpShownOnce = true;
        if (settings.store.showHelpOnConnect) { toggleHelp(true, 10000); prevPressed = pressed; return; }
    }

    const now0 = performance.now();
    const dir0: Dir | null =
        pressed[Btn.Up] ? "up" : pressed[Btn.Down] ? "down" : pressed[Btn.Left] ? "left" : pressed[Btn.Right] ? "right" : stickDir(pad);
    const repeatFire = (): Dir | null => {
        if (dir0 !== heldDir) { heldDir = dir0; heldSince = now0; lastRepeat = now0; return dir0; }
        if (dir0 && now0 - heldSince > 260 && now0 - lastRepeat > 70) { lastRepeat = now0; return dir0; }
        return null;
    };

    // controller settings panel
    if (calibEl) {
        handleCalibration(pad, justPressed);
        prevPressed = pressed;
        return;
    }
    if (panelEl) {
        handlePanel(repeatFire(), justPressed);
        prevPressed = pressed;
        return;
    }

    // guide open: any button just closes it (☰ opens the controller settings instead)
    if (helpEl) {
        if (justPressed(Btn.Menu)) { toggleHelp(false); togglePanel(true); prevPressed = pressed; heldDir = null; return; }
        if (pressed.some((p, i) => p && !prevPressed[i])) toggleHelp(false);
        prevPressed = pressed;
        heldDir = null;
        return;
    }

    // typing: the controller stays out of your way — only B (stop typing) and Y (unlock) work
    if (typingMode && !isTyping() && !kbEl) typingMode = false;
    if (kbEl && !kbTarget()) closeKeyboard();
    if (typingMode && kbEl) {
        handleKeyboard(repeatFire(), justPressed, pressed, pad);
        prevPressed = pressed;
        return;
    }
    if (typingMode) {
        if (justPressed(Btn.Menu)) { const send = composerSendContext(); if (send) kbSend(send.box); }
        if (justPressed(Btn.A) || justPressed(Btn.X)) { const a = document.activeElement; if (a && a.matches(TEXT_ENTRY)) openKeyboard(a); }
        if (justPressed(Btn.B)) backOutOfTyping();
        if (justPressed(Btn.Y)) pressY();
        prevPressed = pressed;
        heldDir = null;
        return;
    }

    // adjust mode (R3): only the sliders / resize handles on screen
    if (adjustMode) { handleAdjust(pad, justPressed, pressed); prevPressed = pressed; return; }

    // The native picker owns navigation until it closes, including while Discord replaces category results.
    if (expression && !openMenu() && (nativePickerLock || performance.now() - lastPadUse < 20000)) {
        handleNativeExpressionPicker(expression, repeatFire(), justPressed, pressed, pad);
        prevPressed = pressed;
        return;
    }
    if (!expression) nativePickerLock = null;

    const dir: Dir | null =
        pressed[Btn.Up] ? "up" : pressed[Btn.Down] ? "down" : pressed[Btn.Left] ? "left" : pressed[Btn.Right] ? "right" : stickDir(pad);
    const now = performance.now();
    if (dir !== heldDir) {
        heldDir = dir; heldSince = now; lastRepeat = now;
        if (dir) { moveIsRepeat = false; move(dir); }
    } else if (dir && now - heldSince > (lastMenu ? 220 : REPEAT_DELAY) / opt<number>("holdSpeed")) {
        const rate = (lastMenu ? REPEAT_FAST : now - heldSince > ACCEL_AFTER ? REPEAT_FAST : REPEAT_SLOW) / opt<number>("holdSpeed");
        if (now - lastRepeat > rate) { lastRepeat = now; moveIsRepeat = true; move(dir); moveIsRepeat = false; }
    }

    if (justPressed(Btn.A)) pressA();
    if (justPressed(Btn.B)) pressB();
    if (justPressed(Btn.X)) pressX();
    if (justPressed(Btn.Y)) pressY();
    // (held down, these keep going — faster the longer you hold)
    if (expression && !openMenu()) {
        if (justPressed(Btn.LB)) switchExpressionTab(expression, -1);
        if (justPressed(Btn.RB)) switchExpressionTab(expression, 1);
        if (held(Btn.LT, pressed)) scrollExpressionPicker(expression, -1);
        if (held(Btn.RT, pressed)) scrollExpressionPicker(expression, 1);
    } else if (!popupOwnsInput && !navigationButtonsBlocked) {
        if (held(Btn.LB, pressed)) switchServer(-1);
        if (held(Btn.RB, pressed)) switchServer(1);
        if (held(Btn.LT, pressed)) switchChannel(-1);
        if (held(Btn.RT, pressed)) switchChannel(1);
    }
    if (justPressed(Btn.L3)) jumpToNewest();
    if (justPressed(Btn.R3)) toggleAdjust(true);
    if (justPressed(Btn.View)) toggleHelp();
    if (justPressed(Btn.Menu)) {
        const send = composerSendContext();
        if (send) kbSend(send.box); else openSettings();
    }

    const ry = pad.axes[3] ?? 0;
    scrollStick(ry, settings.store.stickDeadzone * 0.6); // (every frame: it keeps its own clock)

    prevPressed = pressed;
}

// =====================================================================
// Making room: shrink (or slide) the app so side menus and the keyboard never cover what you're working on
// =====================================================================
const shiftState = { left: 0, right: 0, bottom: 0 };
/** Our CSS variables live in our own <style>, not on <html>: Discord rewrites <html>'s class and style
 *  (e.g. when it switches into "mouse mode"), which used to wipe them and break the side drawer. */
const rootVars = new Map<string, string>();
let varsEl: HTMLStyleElement | null = null;
function setRootVar(name: string, value: string) {
    if (rootVars.get(name) === value && varsEl?.isConnected) return;
    rootVars.set(name, value);
    if (!varsEl || !varsEl.isConnected) {
        varsEl = document.createElement("style");
        varsEl.id = "hh-controls-vars";
        varsEl.disabled = !controllerActive;
        document.head.append(varsEl);
    }
    varsEl.textContent = `:root { ${[...rootVars].map(([k, v]) => `${k}: ${v};`).join(" ")} }`;
}
/** Things a theme pins to the screen edge (e.g. a server bar fixed on the right). They don't move with the app,
 *  so they're tagged and moved along by hand — otherwise they leave a gap where they were. */
function tagPinned() {
    for (const el of document.querySelectorAll("[data-hh-pinned]")) el.removeAttribute("data-hh-pinned");
    const base = document.querySelector('[class*="layers_"] > [class*="baseLayer"]') ?? document.querySelector('[class*="baseLayer"]');
    if (!base) return;
    let n = 0;
    for (const el of base.querySelectorAll('nav, aside, section, [class*="guilds"], [class*="sidebar"], [class*="panels"]')) {
        if (++n > 400) break;
        if (getComputedStyle(el).position !== "fixed") continue;
        if (el.parentElement?.closest("[data-hh-pinned]")) continue;
        const r = el.getBoundingClientRect();
        const side = r.right > window.innerWidth - 60 ? "r" : r.left < 60 ? "l" : "";
        if (side) el.setAttribute("data-hh-pinned", side);
    }
}

function applyShift() {
    const root = document.documentElement;
    const { left, right, bottom } = shiftState;
    const how = opt("appShift");
    if ((!left && !right && !bottom) || how === "none") {
        root.removeAttribute("data-hh-shift");
        for (const el of document.querySelectorAll("[data-hh-pinned]")) el.removeAttribute("data-hh-pinned");
        return;
    }
    if (!root.hasAttribute("data-hh-shift")) tagPinned();
    setRootVar("--hh-shift-l", `${left}px`);
    setRootVar("--hh-shift-r", `${right}px`);
    setRootVar("--hh-shift-b", `${bottom}px`);
    root.setAttribute("data-hh-shift", how === "slide" ? "slide" : "shrink");
}

// =====================================================================
// Side-drawer menus: hold menus slide in from the edge of the screen, full height, big touch targets
// =====================================================================
let drawerLayer: Element | null = null;
let lastCtx = { x: -1, at: 0, target: null as Element | null, raw: null as Element | null };
const onContextMenuCapture = (e: MouseEvent) => {
    const t = e.target as Element | null;
    lastCtx = { x: e.clientX, at: performance.now(), target: t?.closest?.(ROW_ANY) ?? t, raw: t };
};

function openDrawer(menu: Element) {
    if (!controllerActive) return;
    if (!opt("menuDrawer") || !menu.matches('[role="menu"]')) return;
    const layer = menu.closest('[class*="layer_"]') ?? menu.parentElement;
    if (!layer || layer === document.body || layer.matches('[class*="baseLayer"]')) return;
    if (drawerLayer && drawerLayer.isConnected && drawerLayer !== layer) return; // a sub-menu: leave it beside the drawer
    let side = opt("drawerSide");
    // the held item lives in the server / channel / DM lists?
    const heldEl = performance.now() - lastCtx.at < 2000 ? lastCtx.target : alive(focused) && !menu.contains(focused) ? focused : null;
    const heldInLists = !!heldEl?.closest?.('[data-list-id="guildsnav"], [data-list-id^="private-channels"], [data-hh-list="channels"], [data-list-id="channels"], nav');
    if (side === "lists" || side === undefined) {
        // the side the server list / channel list is on (default Discord: left; themes may move it)
        const nav = [...document.querySelectorAll('[data-list-id="guildsnav"], [data-hh-list="channels"], [data-list-id="channels"], [data-list-id^="private-channels"]')].find(isVisible);
        side = nav ? (center(nav).x < window.innerWidth / 2 ? "left" : "right") : "right";
    } else if (side !== "left" && side !== "right") {
        // open on the side AWAY from what you held, so it stays in view
        const x = performance.now() - lastCtx.at < 2000 && lastCtx.x >= 0 ? lastCtx.x
            : alive(focused) && !menu.contains(focused) ? center(focused).x : window.innerWidth / 2;
        side = x > window.innerWidth / 2 ? "left" : "right";
    }
    let width = Math.min(opt("drawerWidth"), Math.round(window.innerWidth * 0.6));
    // covering the lists: exactly as wide as they are — the edge of the box with your name / settings at the bottom
    if (opt("drawerCover") !== false && !heldInLists) {
        const panel = [...document.querySelectorAll('section[aria-label="User area"], [class*="panels_"]')].find(isVisible);
        const r = panel?.getBoundingClientRect();
        const edge = r ? Math.round(side === "left" ? r.right : window.innerWidth - r.left) : 0;
        if (edge >= 200 && edge <= window.innerWidth * 0.6) width = edge;
    }
    setRootVar("--hh-dw", `${width}px`);
    // the held server's outline: its icon is drawn in a masked picture that cuts off anything outside it, so the
    // outline goes on the box around that picture
    // anything else you opened a menu on (a person, avatar, name, DM, image, link…) stays outlined too; messages and
    // server channels have their own outline already
    // (the exact thing you held: an avatar / name / picture inside a message, not the whole message)
    const rawHeld = performance.now() - lastCtx.at < 2000 ? lastCtx.raw : null;
    const exact = rawHeld?.isConnected && rawHeld !== heldEl && rawHeld.closest?.('img[class*="avatar"], [class*="avatar_"], [class*="username_"], a[href], img, video, [class*="member_"], [class*="voiceUser"]');
    const outlineEl = (exact || heldEl) as Element | null;
    if (outlineEl?.isConnected && !outlineEl.matches?.('li[id^="chat-messages-"], [data-list-item-id^="channels___"]') && outlineEl !== document.body) {
        // someone in a list (member list, voice users, DMs…): the whole row, like servers and messages
        const row = !outlineEl.closest(ROW.message) ? outlineEl.closest('[class*="member_"], [role="listitem"], [class*="voiceUser"], [data-list-item-id]:not([data-list-item-id^="guildsnav___"])') : null;
        let host: Element = row ?? outlineEl;
        let pic: Element | null = row ? null : outlineEl.closest("svg");
        while (pic?.parentElement?.closest("svg")) pic = pic.parentElement.closest("svg"); // (pictures inside pictures)
        if (pic?.parentElement) host = pic.parentElement;
        host.setAttribute("data-hh-heldring", outlineEl.closest('[data-list-item-id^="guildsnav___"]') || /avatar/i.test(String((host as HTMLElement).className)) ? "round" : "");
    }
    layer.setAttribute("data-hh-drawer", side);
    // the quick reactions become one row at the top
    for (const i of menu.querySelectorAll(MENU_ITEM)) if (isEmojiItem(i)) {
        i.setAttribute("data-hh-emoji", "");
        (i.closest('[role="group"]') ?? i.parentElement)?.setAttribute("data-hh-emoji-row", "");
    }
    // (marked here instead of CSS :has(), which makes the browser re-check the whole page on every change)
    for (const g of menu.querySelectorAll('[role="group"]')) g.parentElement?.setAttribute("data-hh-groups", "");
    for (const sl of menu.querySelectorAll('[role="slider"]')) {
        sl.closest('[role="menuitem"]')?.setAttribute("data-hh-slideritem", "");
        sl.parentElement?.setAttribute("data-hh-sliderwrap", ""); sl.parentElement?.parentElement?.setAttribute("data-hh-sliderwrap", "");
    }
    drawerLayer = layer;
    drawerMenu = menu;
    if (!layer.querySelector(":scope > .hh-brand")) layer.insertAdjacentHTML("beforeend", `<div class="hh-brand">${brandHtml}</div>`);
    document.documentElement.setAttribute("data-hh-drawer-on", "");
    markMenuStyle();
    // cover the lists — unless what you held is IN them (a server / channel menu): then push them over to keep it in view
    const cover = opt("drawerCover") !== false && !heldInLists;
    // a held channel: still slide over the server list (on that side), and push the app only by the rest
    let push = width;
    const guilds = heldInLists && !heldEl?.closest?.('[data-list-id="guildsnav"]') ? document.querySelector('[data-list-id="guildsnav"]') : null;
    if (guilds && isVisible(guilds)) {
        const g = guilds.getBoundingClientRect();
        const under = side === "left" ? (g.left < 40 ? g.right : 0) : (g.right > window.innerWidth - 40 ? window.innerWidth - g.left : 0);
        push = Math.max(0, width - Math.round(under));
    }
    shiftState.left = !cover && side === "left" ? push : 0;
    shiftState.right = !cover && side === "right" ? push : 0;
    applyShift();
    snapDrawer(layer, side);
    const held = lastCtx.target;
    if (held && held.isConnected) setTimeout(() => held.isConnected && held.scrollIntoView({ block: "nearest", inline: "nearest" }), 80);
}

/** Discord draws a menu where it normally goes first; checking once a frame let that show for a moment before it
 *  became the side menu. This catches it as it's added (before the screen is drawn). Only looks at Discord's pop-up
 *  layer boxes and the open drawer, so chat updates cost nothing. */
let menuObserver: MutationObserver | null = null;
function watchMenusEarly() {
    menuObserver = new MutationObserver(muts => {
        if (!controllerActive || !opt("menuDrawer")) return;
        for (const m of muts) {
            const t = m.target as Element;
            const inLayers = typeof t.className === "string" && /layerContainer|layers?_/.test(t.className);
            if (!inLayers && !(drawerLayer && drawerLayer.contains(t))) continue;
            for (const n of m.addedNodes) {
                if (!(n instanceof HTMLElement)) continue;
                const menu = n.matches('[role="menu"]') ? n : n.querySelector('[role="menu"]');
                if (!menu) continue;
                if (probing) continue;
                if (!drawerLayer || !drawerLayer.isConnected) openDrawer(menu);
                else syncSubDrawer(menu);
            }
        }
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });
}
/** Which pop-up menu look is on (html[data-hh-menu-style]) — set whenever a menu or the panel opens, since Discord
 *  rewrites the html element's attributes now and then. */
function markMenuStyle() {
    if (!controllerActive) return;
    markButtons();
    const v = String(opt("menuStyle") ?? "blend");
    if (document.documentElement.getAttribute("data-hh-menu-style") !== v) document.documentElement.setAttribute("data-hh-menu-style", v);
}
/** A quick-reaction button: an emoji picture and no visible words. */
function isEmojiItem(i: Element) {
    if (/quick-?react|reaction-\d/i.test(i.id)) return true;
    if (!i.querySelector('img, [class*="emoji"]')) return false;
    let text = "";
    const walk = (n: Node) => {
        for (const c of n.childNodes) {
            if (c.nodeType === 3) text += c.textContent;
            else if (c.nodeType === 1 && !(c as Element).matches('[class*="hidden"], [class*="sr-only"], img, svg')) walk(c);
        }
    };
    walk(i);
    return !/[a-z]{2}/i.test(text);
}

/** Make the drawer touch the real screen edges, even if a theme / Discord wrapper makes "fixed" relative to a smaller box. */
function snapDrawer(layer: Element, side: string) {
    // the boxes around the menu may clip anything outside them (Discord's layer stack does): let the drawer show past them
    for (let n = layer.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflow !== "visible" || cs.overflowX !== "visible" || (cs.contain && cs.contain !== "none") || cs.clipPath !== "none")
            n.setAttribute("data-hh-unclip", "");
    }
    for (const v of ["--hh-dn-t", "--hh-dn-b", "--hh-dn-l", "--hh-dn-r"]) setRootVar(v, "0px");
    // measure where it lands with no correction (reading the box forces the layout), then correct by the difference
    const r = layer.getBoundingClientRect();
    setRootVar("--hh-dn-t", `${Math.round(r.top)}px`);
    setRootVar("--hh-dn-b", `${Math.round(window.innerHeight - r.bottom)}px`);
    if (side === "right") setRootVar("--hh-dn-r", `${Math.round(window.innerWidth - r.right)}px`);
    else setRootVar("--hh-dn-l", `${Math.round(r.left)}px`);
}

/** A sub-menu (Add Reaction ›, Apps ›…) becomes a second full-height column right beside the drawer, and the drawer
 *  narrows so the two together stay clear of the chat. */
let subLayer: Element | null = null;
let drawerMenu: Element | null = null;
function syncSubDrawer(menu: Element | null) {
    // (Discord puts the sub-menu's own layer inside the drawer's menu; the drawer's own menu is never one — some
    //  menus come wrapped in an extra layer, which once made a plain menu look like a sub-menu)
    const isMain = !!menu && (menu === drawerMenu || !drawerMenu?.isConnected || !drawerMenu.contains(menu));
    const own = menu && !isMain && drawerLayer?.isConnected ? menu.closest('[class*="layer_"]') ?? menu.parentElement : null;
    const layer = own && own !== drawerLayer ? own : null;
    if (subLayer && !subLayer.isConnected) subLayer = null;
    if (layer === subLayer) return;
    subLayer?.querySelector(":scope > .hh-brand")?.remove();
    subLayer?.removeAttribute("data-hh-subdrawer");
    subLayer = null;
    document.documentElement.removeAttribute("data-hh-sub");
    if (!layer || layer === document.body || !menu) return;
    const side = drawerLayer!.getAttribute("data-hh-drawer") === "right" ? "right" : "left";
    // (the layer is a little wider than the menu: Discord pads it)
    const subW = Math.round(Math.min(290, Math.max(220, layer.getBoundingClientRect().width, menu.getBoundingClientRect().width + 16)));
    // the chat column's edge on that side (the drawer covers the lists, so it's where the app starts), with a small gap
    const sc = (chatScroller()?.closest('[class*="chat_"]') ?? chatScroller())?.getBoundingClientRect();
    const room = sc ? (side === "left" ? sc.left : window.innerWidth - sc.right) - 4 : 0;
    const full = Math.min(opt("drawerWidth"), Math.round(window.innerWidth * 0.6));
    const dws = Math.round(Math.min(full, Math.max(150, room - subW)));
    setRootVar("--hh-dws", `${dws}px`);
    setRootVar("--hh-subw", `${subW}px`);
    layer.setAttribute("data-hh-subdrawer", side);
    if (!layer.querySelector(":scope > .hh-brand")) layer.insertAdjacentHTML("beforeend", `<div class="hh-brand">${brandHtml}</div>`);
    subLayer = layer;
    document.documentElement.setAttribute("data-hh-sub", "");
}
function closeDrawer() {
    syncSubDrawer(null);
    for (const el of document.querySelectorAll("[data-hh-heldring]")) el.removeAttribute("data-hh-heldring");
    for (const el of document.querySelectorAll("[data-hh-unclip]")) el.removeAttribute("data-hh-unclip");
    if (!drawerLayer && !document.documentElement.hasAttribute("data-hh-drawer-on")) return;
    drawerLayer?.querySelector(":scope > .hh-brand")?.remove();
    drawerLayer?.removeAttribute("data-hh-drawer");
    drawerLayer = null; drawerMenu = null;
    document.documentElement.removeAttribute("data-hh-drawer-on");
    shiftState.left = shiftState.right = 0;
    applyShift();
}

// =====================================================================
// Controller settings panel (open the guide with ⧉, then press ☰)
// =====================================================================
type PanelRow =
    | { key: string; label: string; kind: "bool"; }
    | { key: string; label: string; kind: "slider"; min: number; max: number; step: number; unit?: string; }
    | { key: string; label: string; kind: "choice"; choices: [string, string][]; }
    | { key: string; label: string; kind: "action"; run: () => void; }
    | { key: string; label: string; kind: "cat"; cat: string; desc: string; };
const PANEL_ROWS_BASE: PanelRow[] = [
    { key: "calibrate", label: "Calibrate sticks (for this controller)", kind: "action", run: () => { togglePanel(false); openCalibration(); } },
    { key: "menuDrawer", label: "Hold menus slide in from the side", kind: "bool" },
    { key: "keyboardChatOnly", label: "Keyboard up: hide server / channel lists (big chat)", kind: "bool" },
    { key: "keyboardHideTitle", label: "Keyboard up: hide the top bar (chat starts at the top)", kind: "bool" },
    { key: "keyboardSlimHeader", label: "Keyboard up: slim channel header", kind: "bool" },
    { key: "drawerCover", label: "Side menus cover the server / channel side (don't shrink the app)", kind: "bool" },
    { key: "menuStyle", label: "Pop-up style (menus, keyboard, settings)", kind: "choice", choices: [["blend", "Blend"], ["handheld", "Handheld"], ["discord", "Discord default"]] },
    { key: "drawerSide", label: "Side menus open on", kind: "choice", choices: [["lists", "Server / channel side"], ["right", "Right"], ["left", "Left"], ["auto", "Away from item"]] },
    { key: "drawerWidth", label: "Side menu width", kind: "slider", min: 220, max: 520, step: 10, unit: "px" },
    { key: "appShift", label: "Make room for menus / keyboard by", kind: "choice", choices: [["shrink", "Shrinking the app"], ["slide", "Sliding the app"], ["none", "Nothing (cover it)"]] },
    { key: "onScreenKeyboard", label: "On-screen keyboard when typing with controller", kind: "bool" },
    { key: "keyboardMode", label: "Keyboard style (⧉ switches Split on / off while typing)", kind: "choice", choices: [["grid", "Grid"], ["split", "Split: two sticks + LT / RT"], ["wheel", "Wheel: stick + A/B/X/Y"]] },
    { key: "keyboardSound", label: "Keyboard click sound", kind: "bool" },
    { key: "keyboardVolume", label: "Keyboard click volume", kind: "slider", min: 0, max: 100, step: 5, unit: "%" },
    { key: "splitStyle", label: "Split keyboard typing style", kind: "choice", choices: [["forgiving", "Forgiving"], ["balanced", "Balanced"], ["fast", "Fast"]] },
    { key: "splitRollThrough", label: "Split: type the key you're passing over (fast rolls)", kind: "bool" },
    { key: "gameModeScale", label: "Game Mode size (restart Vesktop to apply)", kind: "slider", min: 100, max: 300, step: 5, unit: "%" },
    { key: "splitMoreInner", label: "Split: half-tilt keys up & down too (e t / i o)", kind: "bool" },
    { key: "splitEdge", label: "Split: outer keys start at", kind: "choice", choices: [["normal", "Normal (93%)"], ["strict", "Strict (edge only)"]] },
    { key: "splitSensitivity", label: "Split keyboard stick sensitivity", kind: "slider", min: 0.6, max: 1.6, step: 0.05 },
    { key: "keyboardStartOn", label: "Keyboard opens on", kind: "choice", choices: [["box", "Box buttons"], ["keys", "Keys"]] },
    { key: "keyboardHeight", label: "Keyboard height", kind: "slider", min: 30, max: 60, step: 1, unit: "% of screen" },
    { key: "sliderNotches", label: "Volume slider speed", kind: "slider", min: 2, max: 20, step: 1, unit: " notches / press" },
    { key: "autoLockAfterServer", label: "Opening a server jumps into its channels", kind: "bool" },
    { key: "autoLockAfterChannel", label: "A on the open channel jumps into its chat", kind: "bool" },
    { key: "scrollSpeed", label: "Right-stick scroll speed", kind: "slider", min: 5, max: 40, step: 1 },
    { key: "stickDeadzone", label: "Stick deadzone", kind: "slider", min: 0.2, max: 0.7, step: 0.05 },
    { key: "holdSpeed", label: "Hold-to-move speed", kind: "slider", min: 0.5, max: 2, step: 0.05 },
    { key: "highlightColor", label: "Highlight color", kind: "choice", choices: COLOR_CHOICES },
    { key: "keyboardColor", label: "Keyboard color", kind: "choice", choices: [["same", "Same as highlight"], ...COLOR_CHOICES.filter(c => c[0] !== "theme")] },
    { key: "showHelpOnConnect", label: "Show the controls guide on first use", kind: "bool" },
    { key: "debugReadout", label: "Debug readout (for troubleshooting)", kind: "action", run: () => { togglePanel(false); toggleDebug(); } },
    { key: "showHints", label: "Button hints (what you can press right now)", kind: "bool" },
    { key: "backButton1", label: "M1  (Steam key: F13 or F9)", kind: "choice", choices: BACK_ACTIONS },
    { key: "backButton2", label: "M2  (Steam key: F14 or F10)", kind: "choice", choices: BACK_ACTIONS },
    { key: "backButton3", label: "Back button 3  (Steam key: F15 or Insert)", kind: "choice", choices: BACK_ACTIONS },
    { key: "backButton4", label: "Back button 4  (Steam key: F16 or Pause)", kind: "choice", choices: BACK_ACTIONS },
    { key: "buttonLayout", label: "Button names", kind: "choice", choices: [["auto", "Auto (from the controller)"], ["xbox", "Xbox  A B X Y"], ["playstation", "PlayStation  ✕ ○ □ △"], ["nintendo", "Nintendo  B A Y X"]] },
    { key: "buttonColors", label: "Button colours", kind: "choice", choices: [["auto", "Auto"], ["brand", "Controller colours"], ["plain", "Plain"], ["accent", "Highlight colour"]] },
    { key: "hintsMoveTitle", label: "Top-bar hints: move the server / channel name over", kind: "bool" },
];
let panelEl: HTMLDivElement | null = null;
let panelIndex = 0;

function panelValueHtml(row: PanelRow): string {
    if (row.kind === "cat") return `<span class="hh-cat-desc">${row.desc} ›</span>`;
    if (row.kind === "action" && row.key === "back") return "";
    if (row.kind === "action" && row.key === "debugReadout") return `<span class="hh-choice">${debugEl ? "on" : "off"} · A ›</span>`;
    if (row.kind === "action" && row.key === "restartVesktop") return `<span class="hh-choice hh-restart">Restart ${badgeHtml("A")}</span>`;
    if (row.kind === "action") return `<span class="hh-choice">${calibFor(currentPadId()) ? "✓ calibrated · " : ""}A ›</span>`;
    const v = opt(row.key);
    if (row.kind === "bool") return `<span class="hh-switch ${v ? "on" : ""}"><span></span></span>`;
    if (row.kind === "choice") {
        const sw = /Color$/.test(row.key) ? `<span class="hh-swatch" style="background:${String(v).startsWith("#") ? v : row.key === "keyboardColor" ? "var(--hh-kb-accent)" : "var(--hh-accent)"}"></span>` : "";
        return `<span class="hh-choice">${sw}‹ ${row.choices.find(c => c[0] === v)?.[1] ?? row.choices[0][1]} ›</span>`;
    }
    const pct = Math.round(((Number(v) - row.min) / (row.max - row.min)) * 100);
    const shown = row.step < 1 ? Number(v).toFixed(2) : String(Math.round(Number(v)));
    return `<span class="hh-pslider"><span class="hh-pslider-bar"><span style="width:${pct}%"></span></span><span class="hh-pslider-val">${shown}${row.unit ?? ""}</span></span>`;
}
/** Changing "Game Mode size" this session shows a restart row right under it. */
let scaleChanged = false;
const RESTART_ROW: PanelRow = { key: "restartVesktop", label: "Applies after Vesktop restarts — restart now", kind: "action", run: () => restartVesktop() };
/** The settings, sorted into pages: the panel opens on this list, A goes into one, B comes back out. */
const PANEL_CATS: { id: string; label: string; desc: string; keys: string[]; }[] = [
    { id: "look", label: "🎨  Look & style", desc: "menu / keyboard style, colours, button hints, Game Mode size", keys: ["menuStyle", "showHints", "buttonLayout", "buttonColors", "hintsMoveTitle", "highlightColor", "keyboardColor", "gameModeScale"] },
    { id: "menus", label: "📋  Hold menus", desc: "where they open, how wide", keys: ["menuDrawer", "drawerCover", "drawerSide", "drawerWidth", "appShift", "sliderNotches"] },
    { id: "keyboard", label: "⌨️  Keyboard", desc: "style, height, big chat, sound", keys: ["onScreenKeyboard", "keyboardMode", "keyboardStartOn", "keyboardHeight", "keyboardChatOnly", "keyboardHideTitle", "keyboardSlimHeader", "keyboardSound", "keyboardVolume"] },
    { id: "split", label: "🕹️  Split keyboard", desc: "calibration, typing style, sensitivity", keys: ["calibrate", "splitStyle", "splitSensitivity", "splitEdge", "splitMoreInner", "splitRollThrough"] },
    { id: "back", label: "🎮  Back buttons", desc: "M1 / M2 shortcuts: mute, type, jump anywhere…", keys: ["backButton1", "backButton2", "backButton3", "backButton4"] },
    { id: "nav", label: "🧭  Navigation", desc: "sticks, scrolling, jumping in", keys: ["showHints", "stickDeadzone", "holdSpeed", "scrollSpeed", "autoLockAfterServer", "autoLockAfterChannel", "showHelpOnConnect", "debugReadout"] },
];
let panelCat: string | null = null;
const BACK_ROW: PanelRow = { key: "back", label: "‹  All settings", kind: "action", run: () => panelBack() };
function panelBack() {
    const i = PANEL_CATS.findIndex(c => c.id === panelCat);
    panelCat = null; panelIndex = Math.max(0, i);
    renderPanel();
}
function panelRows(): PanelRow[] {
    const cat = PANEL_CATS.find(c => c.id === panelCat);
    if (!cat) return PANEL_CATS.map(c => ({ key: `cat:${c.id}`, label: c.label, kind: "cat", cat: c.id, desc: c.desc }));
    const rows: PanelRow[] = [BACK_ROW];
    for (const key of cat.keys) {
        const r = PANEL_ROWS_BASE.find(x => x.key === key);
        if (!r) continue;
        rows.push(r);
        if (key === "gameModeScale" && scaleChanged) rows.push(RESTART_ROW);
    }
    return rows;
}
/** Restart Vesktop so a new Game Mode size takes effect. The Handheld launcher (vesktop-gamemode.sh) stays running
 *  under Steam, sees `restartPending`, and starts Vesktop again with the new size. Closing would normally only hide
 *  Vesktop to the tray, so that's switched off for the moment (the launcher switches it back on). */
async function restartVesktop() {
    const store = settings.store as any;
    store.restartPending = true;
    toast("Restarting Vesktop…", 3000);
    await new Promise(r => setTimeout(r, 1500)); // (let the settings reach the disk)
    try {
        const vn = (window as any).VesktopNative;
        const cur = vn.settings.get();
        if (cur.minimizeToTray !== false) { store.restartRestoreTray = true; await new Promise(r => setTimeout(r, 600)); }
        await vn.settings.set({ ...cur, minimizeToTray: false });
        vn.win.close();
    } catch { toast("Couldn't restart — please restart Vesktop from Steam", 4000); }
}
function renderPanel() {
    if (!panelEl) return;
    const list = panelEl.querySelector(".hh-panel-rows")!;
    markMenuStyle(); // (the look can change right here)
    const cat = PANEL_CATS.find(c => c.id === panelCat);
    const title = panelEl.querySelector(".hh-help-title");
    const t = cat ? `⚙️ Settings <span class="hh-crumb">› ${cat.label.replace(/^\S+\s+/, "")}</span>` : "⚙️ Controller settings";
    if (title && title.innerHTML !== t) title.innerHTML = t;
    panelIndex = Math.min(panelIndex, panelRows().length - 1);
    list.innerHTML = panelRows().map((r, i) => `<div class="hh-prow ${i === panelIndex ? "sel" : ""}" data-i="${i}"><div class="hh-prow-label">${r.label}</div>${panelValueHtml(r)}</div>`).join("");
    (list.children[panelIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
}
function changePanel(i: number, step: 1 | -1 | 0) {
    const row = panelRows()[i];
    const store = settings.store as any;
    if (row.kind === "cat") { if (step >= 0) { panelCat = row.cat; panelIndex = 1; renderPanel(); } return; }
    if (row.kind === "action") { if (step >= 0) row.run(); return; }
    if (row.kind === "bool") store[row.key] = !opt(row.key);
    else if (row.kind === "choice") {
        const at = Math.max(0, row.choices.findIndex(c => c[0] === opt(row.key)));
        store[row.key] = row.choices[(at + (step || 1) + row.choices.length) % row.choices.length][0];
    } else {
        if (!step) return;
        const v = Math.round((Number(opt(row.key)) + step * row.step) / row.step) * row.step;
        store[row.key] = Math.min(row.max, Math.max(row.min, Number(v.toFixed(2))));
    }
    if (row.key === "appShift") applyShift();
    if (row.key === "gameModeScale") scaleChanged = true;
    if (/Color$/.test(row.key)) applyColors();
    renderPanel();
}
function togglePanel(show = !panelEl) {
    if (!show) {
        if (panelEl) { const el = panelEl; panelEl = null; el.classList.add("hh-help-out"); setTimeout(() => el.remove(), 160); }
        return;
    }
    if (panelEl) return;
    panelCat = null; panelIndex = 0; // (always opens on the list of pages)
    panelEl = document.createElement("div");
    panelEl.className = "hh-help hh-panel";
    panelEl.innerHTML = `<div class="hh-help-card hh-panel-card"><div class="hh-brand">${brandHtml}</div>
        <div class="hh-help-head"><div class="hh-help-title">⚙️ Controller settings</div>
        <div class="hh-help-sub">${badgeHtml("DPAD")} choose · ${badgeHtml("A")} open / toggle · ◀ ▶ change · ${badgeHtml("B")} back · or just tap</div></div>
        <div class="hh-panel-rows"></div></div>`;
    panelEl.addEventListener("click", e => {
        const rowEl = (e.target as Element).closest<HTMLElement>(".hh-prow");
        if (!rowEl) { if (e.target === panelEl) togglePanel(false); return; }
        const i = Number(rowEl.dataset.i);
        panelIndex = i;
        const row = panelRows()[i];
        if (row.kind === "slider") {
            const bar = rowEl.querySelector(".hh-pslider-bar")!.getBoundingClientRect();
            const x = (e as MouseEvent).clientX;
            changePanel(i, x > bar.left + bar.width / 2 ? 1 : -1);
        } else changePanel(i, 1);
    });
    document.body.append(panelEl);
    renderPanel();
}
function handlePanel(dirFire: Dir | null, jp: (b: Btn) => boolean) {
    const n = panelRows().length;
    if (dirFire === "up" && panelIndex > 0) { panelIndex--; renderPanel(); }
    if (dirFire === "down" && panelIndex < n - 1) { panelIndex++; renderPanel(); }
    if (dirFire === "left") changePanel(panelIndex, -1);
    if (dirFire === "right") changePanel(panelIndex, 1);
    if (jp(Btn.A)) changePanel(panelIndex, 1);
    if (jp(Btn.B) && panelCat) return panelBack(); // (B: back to the list first, then closes)
    if (jp(Btn.B) || jp(Btn.Menu) || jp(Btn.View)) togglePanel(false);
}

// =====================================================================
// On-screen keyboard: slides up from the bottom while you type with the controller
// =====================================================================
type Key = { label: string; text?: string; act?: "shift" | "sym" | "back" | "space" | "enter" | "close" | "left" | "right"; w?: number; };
const k = (s: string): Key[] => s.split(" ").map(c => ({ label: c, text: c }));
const KB_LETTERS: Key[][] = [
    k("1 2 3 4 5 6 7 8 9 0"),
    k("q w e r t y u i o p"),
    [...k("a s d f g h j k l"), { label: "'", text: "'" }],
    [{ label: "⇧", act: "shift", w: 1.5 }, ...k("z x c v b n m"), { label: "⌫", act: "back", w: 1.5 }],
    [{ label: "?123", act: "sym", w: 1.5 }, { label: ",", text: "," }, { label: "space", act: "space", w: 4.5 }, { label: ".", text: "." }, { label: "◀", act: "left" }, { label: "▶", act: "right" }, { label: "Send ↵", act: "enter", w: 1.8 }],
];
const KB_SYMBOLS: Key[][] = [
    k("! @ # $ % ^ & * ( )"),
    k("- _ = + / \\ | ~ ` :"),
    [...k("; \" < > [ ] { } ?"), { label: "…", text: "…" }],
    [{ label: "😀", text: "😀" }, { label: "😂", text: "😂" }, { label: "❤️", text: "❤️" }, { label: "👍", text: "👍" }, { label: "🔥", text: "🔥" }, { label: "😭", text: "😭" }, { label: "🙏", text: "🙏" }, { label: "⌫", act: "back", w: 1.5 }],
    [{ label: "ABC", act: "sym", w: 1.5 }, { label: ",", text: "," }, { label: "space", act: "space", w: 4.5 }, { label: ".", text: "." }, { label: "◀", act: "left" }, { label: "▶", act: "right" }, { label: "Send ↵", act: "enter", w: 1.8 }],
];
let kbEl: HTMLDivElement | null = null;
let kbField: HTMLElement | null = null;
let kbSym = false, kbShift = false, kbCaps = false;
let kbRow = 1, kbCol = 0;

function kbLayout() { return kbSym ? KB_SYMBOLS : KB_LETTERS; }
function kbLabel(key: Key) {
    if (key.text && key.text.length === 1 && /[a-z]/.test(key.text) && (kbShift || kbCaps)) return key.text.toUpperCase();
    return key.label;
}

// =====================================================================
// Word suggestions (like a phone keyboard): complete the word being typed, or guess the next one after a space.
// Ranked by the words YOU use most (learned from messages you send and your own messages in channels you open —
// kept in Vencord's local database on this PC, never synced), then a built-in list of common words. Also forgives a
// one-key stick slip: a word one neighbouring clock key off still matches ("thid" → "this").
// =====================================================================
const BASE_WORDS = (
    "i you the to a and it is that in of for me my so be on what do lol this just not was it's i'm have but like with " +
    "are no yeah your we get can all know don't if at go he up out lmao they got how about now one oh im dont too " +
    "one there good why think when want time u ok okay will gonna see did really then fr bro ngl idk wtf lmfao omg " +
    "tbh yes yea nah nope damn shit fuck fucking man dude bruh thanks thank please sorry hey hi hello yo sup " +
    "would could should some them him her she his their our us more much very well even still back day today " +
    "tomorrow tonight night morning later again never always also maybe because make go going come came said say " +
    "said need feel look let lets play playing game games new right left people thing things something nothing " +
    "anything everything someone everyone here where who which way first last long little big great nice cool " +
    "fun funny crazy wild real true sure love hate wait watch stream steam deck ally controller keyboard discord " +
    "server chat call voice message friend friends home work school job money buy sleep tired hungry eat food " +
    "been were has had does doing done gotta wanna kinda guess mean literally actually probably already pretty " +
    "only than other after before into over off down any many most each few lot lots bad better best worse " +
    "try trying help find give take put keep start stop talk tell ask show use used using thought said making " +
    "made getting got gets went goes happen happened years year week weeks hours hour minutes min sec rn btw " +
    "imo smh tho though cuz cause gg wp ez lag fps pc phone video vid pic link send sent reply bot mod mods " +
    "buggin trash dead deadass bet cap no cap lowkey highkey vibe vibes fire mid goated w l ratio sus based"
).split(" ").filter((w, i, a) => w && a.indexOf(w) === i);
const BASE_RANK = new Map(BASE_WORDS.map((w, i) => [w, i]));

type WordModel = { u: Record<string, number>; b: Record<string, number>; seen: string[]; };
const WORDS_KEY = "hh-words-v1";
let wordModel: WordModel | null = null;
/** The learned words live in Vencord's local database (IndexedDB on this PC; Discord removes localStorage, and plugin
 *  settings can be cloud-synced). Loaded once at start; until then learning goes into an empty model that's merged in. */
function words(): WordModel {
    return wordModel ??= { u: {}, b: {}, seen: [] };
}
async function loadWords() {
    try {
        const saved = await DataStore.get<WordModel>(WORDS_KEY);
        if (saved) mergeSaved(saved);
    } catch { }
    wordsLoaded = true;
    for (const msg of learnQueue.splice(0)) learnMessage(msg);
}
function mergeSaved(saved: WordModel) {
    {
        const m = words();
        for (const [k, v] of Object.entries(saved.u ?? {})) m.u[k] = (m.u[k] ?? 0) + v;
        for (const [k, v] of Object.entries(saved.b ?? {})) m.b[k] = (m.b[k] ?? 0) + v;
        m.seen = [...new Set([...(saved.seen ?? []), ...m.seen])];
    }
}
let wordsDirty = 0;
function saveWords() {
    clearTimeout(wordsDirty);
    wordsDirty = window.setTimeout(() => {
        const m = words();
        // keep it small: the 6000 most used words / 8000 word pairs, the last 4000 messages learned from
        const trim = (o: Record<string, number>, n: number) => {
            const e = Object.entries(o); if (e.length <= n) return o;
            return Object.fromEntries(e.sort((a, b) => b[1] - a[1]).slice(0, n));
        };
        m.u = trim(m.u, 6000); m.b = trim(m.b, 8000); m.seen = m.seen.slice(-4000);
        DataStore.set(WORDS_KEY, m).catch(() => { });
    }, 1500);
}
const tokenize = (text: string) => (text.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").replace(/https?:\/\/\S+|<[^>]+>/g, " ").match(/[a-z0-9']+/g) ?? []).map(w => w.replace(/^'+|'+$/g, "")).filter(w => w && w.length <= 24);
function learnText(text: string) {
    const m = words(), ws = tokenize(text);
    ws.forEach((w, i) => {
        m.u[w] = (m.u[w] ?? 0) + 1;
        if (i) { const k = `${ws[i - 1]} ${w}`; m.b[k] = (m.b[k] ?? 0) + 1; }
    });
    if (ws.length) saveWords();
}
/** Learn one of your own messages (once per message id). */
let wordsLoaded = false;
const learnQueue: any[] = [];
function learnMessage(msg: any) {
    if (!wordsLoaded) { learnQueue.push(msg); return; } // (wait for the saved model, or its "seen" list can't skip repeats)
    try {
        const me = UserStore.getCurrentUser()?.id;
        if (!msg || !me || msg.author?.id !== me || !msg.content || !msg.id) return;
        const m = words();
        if (m.seen.includes(msg.id)) return;
        m.seen.push(msg.id);
        learnText(msg.content);
    } catch { }
}
/** Discord's message events: messages you send, and history loaded in any chat you open. */
const onMessageCreate = (e: any) => learnMessage(e?.message);
const onMessagesLoaded = (e: any) => { for (const msg of e?.messages ?? []) learnMessage(msg); };
/** Learn from your own messages in the channel you're typing in (once per message). */
function learnFromChannel() {
    try {
        const cid = SelectedChannelStore.getChannelId(), me = UserStore.getCurrentUser()?.id;
        if (!cid || !me) return;
        const msgs = (MessageStore.getMessages(cid) as any)?.toArray?.() ?? [];
        const m = words(), seen = new Set(m.seen);
        for (const msg of msgs) if (msg?.author?.id === me && msg.content && !seen.has(msg.id)) learnMessage(msg);
    } catch { }
}

/** Keys next to each other on a Split clock (a slip between them is forgiven when matching words). */
let keyNeighborsCache: Map<string, Set<string>> | null = null;
function keyNeighbors(): Map<string, Set<string>> {
    if (keyNeighborsCache) return keyNeighborsCache;
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string) => { (map.get(a) ?? map.set(a, new Set()).get(a)!).add(b); (map.get(b) ?? map.set(b, new Set()).get(b)!).add(a); };
    for (const half of SPLIT_LETTERS) {
        const at = ([r, c]: [number, number]) => half[r][c];
        CLOCK_CELLS.forEach((cell, i) => link(at(cell), at(CLOCK_CELLS[(i + 1) % 12])));   // neighbouring hours
        for (const inner of [[1, 1], [1, 3]] as [number, number][]) link(at(inner), at([1, 2])); // half tilt ↔ centre
        link(at([1, 1]), at([1, 0])); link(at([1, 3]), at([1, 4]));                            // half tilt ↔ same-side rim
    }
    return keyNeighborsCache = map;
}

/** Up to 3 suggestions for the word being typed (prefix), or the next word after `prev` when nothing is typed yet. */
function suggestWords(prefix: string, prev: string | null): string[] {
    const m = words(), p = prefix.toLowerCase();
    if (!p) {
        if (!prev) return [];
        return Object.entries(m.b).filter(([k]) => k.startsWith(prev + " ")).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.slice(prev.length + 1));
    }
    const scored = new Map<string, number>();
    const consider = (w: string) => {
        if (w === p || w.length < p.length || scored.has(w)) return;
        let slips = 0;
        for (let i = 0; i < p.length && slips <= 1; i++) if (w[i] !== p[i]) slips += keyNeighbors().get(p[i])?.has(w[i]) ? 1 : 9;
        if (slips > 1) return;
        const mine = m.u[w] ?? 0, rank = BASE_RANK.get(w);
        const bigram = prev ? m.b[`${prev} ${w}`] ?? 0 : 0;
        // your own words win: one use already beats most of the built-in list, and more uses keep climbing
        let score = (mine ? 25 + Math.log2(1 + mine) * 25 : 0) + bigram * 40 + (rank !== undefined ? Math.max(0, 400 - rank) / 20 : 0) - (w.length - p.length) * 0.4;
        if (slips) score = score * 0.35 - 1; // a guessed slip ranks below real matches
        scored.set(w, score);
    };
    for (const w of Object.keys(m.u)) consider(w);
    for (const w of BASE_WORDS) consider(w);
    return [...scored.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
}

const escapeSuggestion = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
type DiscordSuggestion = { target: HTMLElement; label: string; };
let discordSuggestions: DiscordSuggestion[] = [];
let autocompleteRoot: HTMLElement | null = null;
const autocompleteMirrors = new Set<HTMLElement>();
const autocompleteChoices = '[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="treeitem"], [role="gridcell"], [role="tab"], button, [role="button"]';
let suggestionObserver: MutationObserver | null = null;
function releaseAutocomplete() {
    for (const root of autocompleteMirrors) root.removeAttribute("data-hh-autocomplete-mirror");
    autocompleteMirrors.clear();
    autocompleteRoot = null; discordSuggestions = [];
}
function readDiscordSuggestions(): DiscordSuggestion[] {
    const editor = kbTarget();
    if (!controllerActive || !kbEl || !editor) { releaseAutocomplete(); return []; }
    const ids = `${editor.getAttribute("aria-controls") ?? ""} ${editor.getAttribute("aria-owns") ?? ""}`.trim().split(/\s+/);
    const linked = ids.map(id => document.getElementById(id)).find(el => el?.matches('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"]') || el?.querySelector(autocompleteChoices));
    const list = (linked ?? editor.closest("form")?.querySelector('[class*="autocomplete_"]')) as HTMLElement | undefined;
    if (!list || !list.isConnected || list.getAttribute("aria-hidden") === "true") { releaseAutocomplete(); return []; }
    const root = list.closest<HTMLElement>('[class*="autocomplete_"]') ?? list;
    if (autocompleteRoot !== root && !isVisible(root)) { releaseAutocomplete(); return []; }
    const containers = new Set<HTMLElement>([list]);
    // Follow native ownership into nested menus, including portaled argument/value pickers.
    for (const container of containers) {
        for (const trigger of container.querySelectorAll<HTMLElement>("[aria-controls], [aria-owns]")) {
            if (trigger.getAttribute("aria-expanded") === "false") continue;
            const owned = `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-owns") ?? ""}`.trim().split(/\s+/);
            for (const id of owned) {
                const popup = document.getElementById(id);
                if (popup && popup !== document.body && popup !== editor && popup.querySelector(autocompleteChoices)
                    && (autocompleteMirrors.has(popup) || isVisible(popup))) containers.add(popup);
            }
        }
    }
    const choices = [...containers].flatMap(container => [...container.querySelectorAll<HTMLElement>(autocompleteChoices)]);
    const mirrors = new Set([root, ...[...containers].filter(container => container !== list)]);
    for (const old of autocompleteMirrors) if (!mirrors.has(old)) { old.removeAttribute("data-hh-autocomplete-mirror"); autocompleteMirrors.delete(old); }
    const categories = [...root.querySelectorAll<HTMLElement>('[role="list"] [role="button"], [role="tablist"] [role="tab"]')];
    const candidates = [...new Set([...choices, ...categories])];
    const rows = candidates.filter(el => !candidates.some(parent => parent !== el && parent.contains(el)))
        .filter(el => el.getAttribute("aria-disabled") !== "true" && el.getAttribute("aria-hidden") !== "true" && !el.closest('[hidden], [inert], [aria-hidden="true"]') && !el.matches(":disabled"))
        .map(target => ({ target, label: (categories.includes(target) ? "Browse: " : "") + (target.getAttribute("aria-label") || target.querySelector('[class*="autocompleteRowHeading"]')?.textContent || target.textContent || "").replace(/\s+/g, " ").trim() }))
        .filter(row => !!row.label);
    if (!rows.length) { releaseAutocomplete(); return []; }
    if (autocompleteRoot !== root) { releaseAutocomplete(); autocompleteRoot = root; }
    for (const popup of mirrors) { popup.setAttribute("data-hh-autocomplete-mirror", ""); autocompleteMirrors.add(popup); }
    return rows;
}
let suggestions: string[] = [];
let suggIndex = 0;
/** The word being typed (just before the cursor) and the word before it. */
function currentWord(): { prefix: string; prev: string | null; } {
    const f = kbTarget();
    if (!f) return { prefix: "", prev: null };
    const text = (f.matches("input, textarea") ? (f as HTMLInputElement).value : f.innerText ?? "").replace(/﻿/g, "").replace(/\n+$/, "");
    const m = /([A-Za-z0-9']*)$/.exec(text)!;
    const before = tokenize(text.slice(0, text.length - m[1].length));
    return { prefix: m[1], prev: before.length && /[A-Za-z0-9']\s*$/.test(text.slice(0, text.length - m[1].length)) ? before[before.length - 1] : null };
}
function updateSuggestions() {
    if (!kbEl) return;
    const { prefix, prev } = currentWord();
    discordSuggestions = readDiscordSuggestions();
    const next = discordSuggestions.length ? discordSuggestions.map(row => row.label) : suggestWords(prefix, prev);
    if (next.join() !== suggestions.join()) suggIndex = 0;
    suggestions = next;
    suggPrefix = prefix;
    const html = suggHtml();
    const heading = kbEl.querySelector(".hh-side-r .hh-side-label");
    if (heading) heading.textContent = discordSuggestions.length ? "Discord suggestions" : "Suggestions";
    // (the grid / wheel show them in a bar above the keys; the split keyboard in its right-hand panel, as a list)
    for (const bar of kbEl.querySelectorAll(".hh-sugg")) if (bar.innerHTML !== html) bar.innerHTML = html;
    const list = kbEl.querySelector(".hh-sugg-list");
    if (list) {
        const keep = (w: string) => suggPrefix && /[A-Z]/.test(suggPrefix[0]) ? w[0].toUpperCase() + w.slice(1) : w;
        const rows = suggestions.length
            ? suggestions.map((w, i) => `<div class="hh-sugg-row ${i === suggIndex ? "sel" : ""}" data-i="${i}"><span>${escapeSuggestion(keep(w))}</span>${i === suggIndex ? badgeHtml("X") : ""}</div>`).join("")
            : `<div class="hh-sugg-empty">Start a word…</div>`;
        if (list.innerHTML !== rows) list.innerHTML = rows;
        list.querySelector(`[data-i="${suggIndex}"]`)?.scrollIntoView({block: "nearest"});
    }
    // live preview of the message (its end), so you don't have to look up at the box
    const pv = kbEl.querySelector(".hh-preview");
    const f = kbTarget();
    if (pv && f) {
        const text = (f.matches("input, textarea") ? (f as HTMLInputElement).value : f.innerText ?? "").replace(/\uFEFF/g, "").replace(/\n+$/, "")
            .replace(/\n*(:[\w~+-]+:)\n*/g, "$1"); // (emoji in the box come out wrapped in line breaks)
        // where the cursor is (so ◀ ▶ visibly move it)
        let at = text.length;
        try {
            if (f.matches("input, textarea")) at = (f as HTMLInputElement).selectionStart ?? at;
            else {
                const sel = window.getSelection();
                if (sel && sel.rangeCount && f.contains(sel.anchorNode)) {
                    const r = document.createRange(); r.selectNodeContents(f); r.setEnd(sel.anchorNode!, sel.anchorOffset);
                    at = Math.min(text.length, r.toString().replace(/\uFEFF/g, "").length);
                }
            }
        } catch { }
        const e2 = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const start = Math.max(0, Math.min(at - 50, text.length - 70));
        const esc = text ? (start > 0 ? "…" : "") + e2(text.slice(start, at)) + `<span class="hh-caret"></span>` + e2(text.slice(at, start + 80)) : "";
        // replying? Discord's own "Replying to…" bar is under the keyboard, so say it here
        let reply = "";
        try {
            const pr = (findStore("PendingReplyStore") as any)?.getPendingReply?.(SelectedChannelStore.getChannelId());
            const a = pr?.message?.author;
            if (a && !f.closest('[role="dialog"]') && !f.closest(ROW.message)) reply = `↩ Replying to <b>${(a.globalName || a.username || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b>`;
        } catch { }
        const rl = kbEl.querySelector<HTMLElement>(".hh-reply-line");
        if (rl && rl.innerHTML !== reply) { rl.innerHTML = reply; rl.hidden = !reply; }
        const html2 = esc || `<span class="hh-caret"></span><span class="hh-preview-ph">${e2(f.getAttribute("aria-label") || f.getAttribute("placeholder") || "Type with the sticks")}</span>`;
        // who's typing (Discord shows this under its box, which the keyboard covers)
        const tl = kbEl.querySelector<HTMLElement>(".hh-typing-line");
        if (tl) { // (only rewritten when it changes, so the dots keep bouncing smoothly)
            const tt = clipOpen ? `${badgeHtml("DPAD")} ▲▼ choose · ${badgeHtml("A")} paste · ${badgeHtml("X")} remove · ${badgeHtml("B")} close`
                : !pickerLayer ? (kbActionIdx >= 0 ? `${badgeHtml("DPAD")} ◀▶ buttons · ${badgeHtml("A")} press · ▼ keys · ${badgeHtml("B")} close` : typingText())
                : pickerSearch ? `sticks type the search · ${badgeHtml("DPAD")} results · ${badgeHtml("A")} pick · ${badgeHtml("B")} done searching`
                : `${badgeHtml("DPAD")} move · ${badgeHtml("A")} pick · ${badgeHtml("Y")} search · ${badgeHtml("LB")}${badgeHtml("RB")} tabs · ${badgeHtml("B")} back to message`;
            if (tl.dataset.t !== tt) { tl.dataset.t = tt; tl.innerHTML = tt ? (pickerLayer || clipOpen || kbActionIdx >= 0 ? tt : `<span class="hh-tdots"><i></i><i></i><i></i></span>${tt}`) : ""; }
        }
        if (pv.innerHTML !== html2) pv.innerHTML = html2;
    }
}
let suggPrefix = "";
function suggHtml() {
    const keep = (w: string) => suggPrefix && /[A-Z]/.test(suggPrefix[0]) ? w[0].toUpperCase() + w.slice(1) : w;
    return suggestions.map((w, i) => `<div class="hh-sugg-chip ${i === suggIndex ? "sel" : ""}" data-i="${i}">${escapeSuggestion(keep(w))}</div>`).join("")
        + (suggestions.length ? `<div class="hh-sugg-hint">${badgeHtml(kbStyle() === "split" ? "X" : "R3")} use${kbStyle() === "split" ? ` ${badgeHtml("DPAD")}▼ next` : ""}</div>` : "");
}
/** Put the chosen suggestion in place of the word being typed, plus a space. */
function acceptSuggestion(i = suggIndex) {
    if (discordSuggestions.length) {
        const row = discordSuggestions[i];
        if (!row?.target.isConnected) { updateSuggestions(); return; }
        const target = row.target.matches('[role="gridcell"], [role="treeitem"]') ? row.target.querySelector<HTMLElement>('button, [role="button"]') ?? row.target : row.target;
        target.click(); // Preserve Discord's native insertion, command selection and argument/submenu transitions.
        suggIndex = 0; scheduleSuggestions();
        return;
    }
    const w = suggestions[i], f = kbTarget();
    if (!w || !f) return;
    const { prefix } = currentWord();
    for (let n = 0; n < prefix.length; n++) kbEdit(f, "deleteContentBackward");
    const cased = prefix.length > 1 && prefix === prefix.toUpperCase() && /[A-Z]/.test(prefix) ? w.toUpperCase()
        : prefix && /[A-Z]/.test(prefix[0]) ? w[0].toUpperCase() + w.slice(1) : w;
    kbInsert(cased + " ");
    kbFeedback("space");
}


// =====================================================================
// Stick calibration (per controller): how far each stick really reaches in every direction, and where it rests.
// The split keyboard scales each direction to that controller's real edge, so "the edge" means the same on any pad.
// Saved in Vencord's local database, keyed by the controller's name.
// =====================================================================
type StickCal = { reach: number[]; center: [number, number]; }; // reach: 36 directions (every 10°), 0 = up, clockwise
/** Learned from the "Aim" step: where this person's centre / half tilt / edge really are, and the angle they use for
 *  each edge key (hour 0 = 12 o'clock … 11). */
type StickAim = { center: number; rim: number; angles: (number | null)[]; };
type PadCal = { L: StickCal; R: StickCal; at: number; aim?: { L: StickAim; R: StickAim; }; };
let activeAim: [StickAim | null, StickAim | null] = [null, null]; // (the controller in use right now)
const CALIB_KEY = "hh-calib-v1";
let calibs: Record<string, PadCal> = {};
let calibLoaded = false;
async function loadCalibs() {
    try { calibs = (await DataStore.get<Record<string, PadCal>>(CALIB_KEY)) ?? {}; } catch { }
    for (const [id, c] of Object.entries(calibs)) if (id !== "__skipped" && c?.aim) { c.aim.L.angles = spreadAngles(c.aim.L.angles); c.aim.R.angles = spreadAngles(c.aim.R.angles); }
    calibLoaded = true;
}
const currentPadId = () => { try { return getPad()?.id ?? ""; } catch { return ""; } };
const calibFor = (id: string): PadCal | null => (calibLoaded && id && id !== "__skipped" && calibs[id]?.L ? calibs[id] : null);
/** A stick position, adjusted for this controller: centre drift removed, and scaled so the real edge in this
 *  direction reads 1.0 (between measured directions it blends the two nearest). */
function calibrate(x: number, y: number, h: 0 | 1, pad: Gamepad): [number, number] {
    const c = calibFor(pad.id);
    if (!c) return [x, y];
    const s = h ? c.R : c.L;
    x -= s.center[0]; y -= s.center[1];
    const r = Math.hypot(x, y);
    if (r < 0.001) return [0, 0];
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    const i = Math.floor(deg / 10) % 36, f = deg / 10 - Math.floor(deg / 10);
    const reach = Math.max(0.6, s.reach[i] * (1 - f) + s.reach[(i + 1) % 36] * f);
    const k = 1 / reach;
    return [x * k, y * k];
}

/** Controllers whose owner said "not now" to calibrating (asked only once per controller). */
const calibSkipped = (id: string) => !!(calibs as any).__skipped?.[id];
function markCalibSkipped(id: string) {
    ((calibs as any).__skipped ??= {})[id] = Date.now();
    DataStore.set(CALIB_KEY, calibs).catch(() => { });
}
/** First time a controller types with the split keyboard: offer calibration. */
function maybeAskCalibration() {
    const id = currentPadId();
    if (!calibLoaded || !id || calibFor(id) || calibSkipped(id) || calibEl) return;
    openCalibration(true);
}

let calibEl: HTMLDivElement | null = null;
let calibFirstTime = false;
/** Three steps: 0 "let go" (measures where each stick rests), 1 "roll the edges" (how far it reaches every way),
 *  2 "try it" (hit lit-up keys on the real split keyboard, already using the new calibration). */
type CalibTarget = { h: 0 | 1; cell: [number, number]; };
/** Every key on both sticks: the 12 edge keys (shuffled), the half-tilt keys and the centre — left stick, then right. */
function calibTargets(): CalibTarget[] {
    const out: CalibTarget[] = [];
    for (const h of [0, 1] as const) {
        const keys: [number, number][] = [...CLOCK_CELLS, [1, 1], [1, 3], [1, 2], ...(splitFive() ? [[3, 0], [3, 1]] as [number, number][] : []), [1, 2]];
        for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
        for (const cell of keys) out.push({ h, cell });
    }
    return out;
}
let CALIB_TARGETS: CalibTarget[] = [];
let calib: {
    step: 0 | 1 | 2; L: number[]; R: number[]; rest: [number, number, number, number][]; stillSince: number;
    turned: [number, number]; lastAng: [number | null, number | null]; // degrees rolled round the edge, per stick
    target: number; results: boolean[]; flash: { ok: boolean; at: number; } | null; done: boolean;
    samples: { h: 0 | 1; cell: [number, number]; x: number; y: number; }[]; learnedHits: number; innerAtEdge: string[];
} | null = null;
function openCalibration(firstTime = false) {
    if (calibEl) return;
    calibFirstTime = firstTime;
    CALIB_TARGETS = calibTargets();
    calib = { step: 0, L: new Array(36).fill(0), R: new Array(36).fill(0), rest: [], stillSince: 0, turned: [0, 0], lastAng: [null, null], target: 0, results: [], flash: null, done: false, samples: [], learnedHits: 0, innerAtEdge: [] };
    calibEl = document.createElement("div");
    calibEl.className = "hh-help hh-calib";
    calibEl.innerHTML = `<div class="hh-help-card hh-calib-card"><div class="hh-brand">${brandHtml}</div>
        <div class="hh-calib-steps"></div><div class="hh-calib-title"></div><div class="hh-calib-sub"></div>
        <div class="hh-calib-body"></div><div class="hh-calib-status"></div></div>`;
    document.body.append(calibEl);
    renderCalibStep();
}
function closeCalibration() {
    calibEl?.remove(); calibEl = null; calib = null;
}
function renderCalibStep() {
    if (!calibEl || !calib) return;
    const b = badgeHtml, skip = `${b("B")} ${calibFirstTime ? "skip (redo any time in controller settings)" : "cancel"}`;
    calibEl.querySelector(".hh-calib-steps")!.innerHTML = ["Let go", "Roll the edges", "Aim"].map((t, i) =>
        `<span class="${i === calib!.step ? "on" : i < calib!.step ? "done" : ""}">${i < calib!.step ? "✓" : i + 1} ${t}</span>`).join("");
    const [title, sub] = [
        [calibFirstTime ? "New controller — let's set it up" : "Let go of both sticks", `Hands off the sticks for a second — this finds where each one rests. ${skip}`],
        ["Roll both sticks around the edge", `Push each stick fully to its outer edge and roll it slowly all the way round — 3 laps each, corners included. Only the outer edge is measured, so keep the stick pressed against it. ${skip}`],
        ["Aim at the highlighted key", `Move the stick as instructed below and press its trigger (${b("LT")} left · ${b("RT")} right). Your stick position isn't shown on purpose, so it learns your natural aim. ${skip}`],
    ][calib.step];
    calibEl.querySelector(".hh-calib-title")!.textContent = title;
    calibEl.querySelector(".hh-calib-sub")!.innerHTML = sub;
    const body = calibEl.querySelector(".hh-calib-body")!;
    if (calib.step === 0) body.innerHTML = `<div class="hh-calib-rest"><div class="hh-calib-bar"><span></span></div></div>`;
    else if (calib.step === 1) body.innerHTML = `<div class="hh-calib-pads"><div><svg class="hh-calib-svg" data-h="0" viewBox="-1.25 -1.25 2.5 2.5"></svg><div class="hh-calib-lbl">LS</div></div><div><svg class="hh-calib-svg" data-h="1" viewBox="-1.25 -1.25 2.5 2.5"></svg><div class="hh-calib-lbl">RS</div></div></div>`;
    else body.innerHTML = `<div class="hh-calib-try"></div>`;
}
/** Step 3: just the key to aim for and which stick — no keyboard and no live feedback, so aim is from memory. */
function renderCalibTarget() {
    if (!calibEl || !calib) return;
    const box = calibEl.querySelector(".hh-calib-try");
    if (!box) return;
    const t = CALIB_TARGETS[calib.target];
    const pulse = calib.flash && performance.now() - calib.flash.at < 160 ? "hh-tap" : "";
    const html = calib.done ? `<div class="hh-aim-done">Done</div>` : (() => {
        const ch = splitSet()[t.h][t.cell[0]][t.cell[1]];
        const where = t.cell[0] === 1 && t.cell[1] === 2 ? "centre" : isInnerCell(t.cell) ? "half tilt" : "edge";
        return `<div class="hh-aim ${pulse}"><div class="hh-aim-stick">${t.h ? "Right stick" : "Left stick"} · ${t.h ? "RT" : "LT"}</div><div class="hh-aim-key">${ch}</div><div class="hh-aim-where">${where}</div></div>`;
    })();
    if (box.innerHTML !== html) box.innerHTML = html;
}
/** The split keyboard's two clocks, drawn inside the calibration card (step 3), with the current target lit up. */
function renderCalibClocks(sel: [[number, number], [number, number]]) {
    if (!calibEl || !calib) return;
    const set = splitSet(), t = CALIB_TARGETS[calib.target];
    const key = (h: 0 | 1, [r, c]: [number, number], style: string, cls = "") => {
        const isT = !calib!.done && t && t.h === h && t.cell[0] === r && t.cell[1] === c;
        const isSel = sel[h][0] === r && sel[h][1] === c;
        return `<div class="hh-ckey ${cls} ${isSel ? "sel" : ""} ${isT ? "hh-target" : ""}" style="${style}">${set[h][r][c]}</div>`;
    };
    const clock = (h: 0 | 1) => `<div class="hh-clock hh-calib-clock"><div class="hh-stick-tag">${h ? "RS" : "LS"}</div>${CLOCK_CELLS.map((cell, i) => {
        const a = i * Math.PI / 6; return key(h, cell, `left:${50 + 40 * Math.sin(a)}%;top:${50 - 40 * Math.cos(a)}%`);
    }).join("")}${key(h, [1, 1], "left:30%;top:50%", "hh-ckey-inner")}${key(h, [1, 3], "left:70%;top:50%", "hh-ckey-inner")}${splitFive() ? key(h, [3, 0], "left:50%;top:30%", "hh-ckey-inner") + key(h, [3, 1], "left:50%;top:70%", "hh-ckey-inner") : ""}${key(h, [1, 2], "left:50%;top:50%", "hh-ckey-center")}</div>`;
    let hint = "";
    if (t && !calib.done) {
        const dirs = ["up", "up-right", "up-right", "right", "down-right", "down-right", "down", "down-left", "down-left", "left", "up-left", "up-left"];
        const stick = t.h ? "Right stick" : "Left stick";
        if (t.cell[0] === 1 && t.cell[1] === 2) hint = `<b>Neutral</b> — leave the ${stick.toLowerCase()} centred`;
        else if (isInnerCell(t.cell)) {
            const d = t.cell[0] === 3 ? (t.cell[1] === 0 ? "up" : "down") : t.cell[1] === 1 ? "left" : "right";
            hint = `<b>Half tilt · ${d}</b> — push the ${stick.toLowerCase()} partway, stopping before the edge`;
        } else {
            const i = CLOCK_CELLS.findIndex(c => c[0] === t.cell[0] && c[1] === t.cell[1]);
            hint = `<b>Full tilt · ${dirs[i]}</b> — push the ${stick.toLowerCase()} all the way to the edge`;
        }
    }
    const html = `<div class="hh-calib-hint">${hint}</div><div class="hh-calib-clocks ${calib.flash && performance.now() - calib.flash.at < 160 ? "hh-tap" : ""}">${clock(0)}${clock(1)}</div>`;
    const box = calibEl.querySelector(".hh-calib-try");
    if (box && box.innerHTML !== html) box.innerHTML = html;
}
let calibDrawAt = 0;
function handleCalibration(pad: Gamepad, jp: (b: Btn) => boolean) {
    if (!calib || !calibEl) return;
    const a = pad.axes, now = performance.now();
    const raw = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0];
    if (jp(Btn.B)) { if (calibFirstTime) markCalibSkipped(pad.id); return closeCalibration(); }
    const status = calibEl.querySelector(".hh-calib-status")!;

    if (calib.step === 0) { // let go: collect resting positions while both sticks stay near the middle
        const still = Math.hypot(raw[0], raw[1]) < 0.3 && Math.hypot(raw[2], raw[3]) < 0.3;
        if (!still) { calib.stillSince = 0; calib.rest = []; }
        else { if (!calib.stillSince) calib.stillSince = now; calib.rest.push(raw as any); }
        const pct = calib.stillSince ? Math.min(1, (now - calib.stillSince) / 1200) : 0;
        (calibEl.querySelector(".hh-calib-bar span") as HTMLElement | null)?.style.setProperty("width", `${Math.round(pct * 100)}%`);
        status.textContent = still ? "Measuring…" : "Waiting for both sticks to be let go";
        if (pct >= 1) { calib.step = 1; renderCalibStep(); }
        return;
    }
    if (calib.step === 1) { // roll the edges
        for (const h of [0, 1] as const) {
            const x = raw[h * 2], y = raw[h * 2 + 1], r = Math.hypot(x, y);
            if (r > 0.5) {
                const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
                const i = Math.round(deg / 10) % 36;
                const arr = h ? calib.R : calib.L;
                arr[i] = Math.max(arr[i], r);
                // laps: add up how far round it has rolled (either direction)
                const last = calib.lastAng[h];
                if (last !== null && r > 0.8) { let dd = Math.abs(deg - last); if (dd > 180) dd = 360 - dd; if (dd < 90) calib.turned[h] += dd; }
                calib.lastAng[h] = deg;
            } else calib.lastAng[h] = null;
        }
        const laps = (h: 0 | 1) => Math.min(3, Math.floor(calib!.turned[h] / 360));
        const cov = (arr: number[]) => arr.filter(v => v > 0.5).length;
        if (now - calibDrawAt > 60) {
            calibDrawAt = now;
            for (const h of [0, 1] as const) {
                const arr = h ? calib.R : calib.L;
                const pts = arr.map((v, i) => v > 0.5 ? `${(Math.sin(i * Math.PI / 18) * v).toFixed(3)},${(-Math.cos(i * Math.PI / 18) * v).toFixed(3)}` : null).filter(Boolean);
                const svg = calibEl.querySelector(`.hh-calib-svg[data-h="${h}"]`);
                if (svg) svg.innerHTML = `<circle r="1" fill="none" stroke="#333" stroke-width=".02"/>`
                    + (pts.length > 2 ? `<polygon points="${pts.join(" ")}" fill="rgb(255 255 255 / .06)" stroke="#ededed" stroke-width=".025"/>` : "")
                    + `<circle cx="${raw[h * 2].toFixed(3)}" cy="${raw[h * 2 + 1].toFixed(3)}" r=".07" fill="#ededed"/>`;
            }
            status.textContent = `LS ${laps(0)}/3 laps · RS ${laps(1)}/3 laps`;
        }
        if (laps(0) >= 3 && laps(1) >= 3 && cov(calib.L) >= 35 && cov(calib.R) >= 35) {
            // save now, so step 3 already types with it
            const fill = (arr: number[]) => arr.map((v, i) => v > 0.5 ? v : Math.max(arr[(i + 35) % 36], arr[(i + 1) % 36], 0.9));
            const rest = calib.rest.slice(-60), avg = (k: number) => rest.length ? rest.reduce((s, p) => s + p[k], 0) / rest.length : 0;
            calibs[pad.id] = { L: { reach: fill(calib.L), center: [avg(0), avg(1)] }, R: { reach: fill(calib.R), center: [avg(2), avg(3)] }, at: Date.now() };
            DataStore.set(CALIB_KEY, calibs).catch(() => { });
            calib.step = 2; renderCalibStep();
        }
        return;
    }
    // step 3: aim at every key; learn this person's centre, edge line and edge-key angles
    const cal = (h: 0 | 1) => calibrate(raw[h * 2], raw[h * 2 + 1], h, pad);
    const sel: [[number, number], [number, number]] = [0, 1].map(h => { const [x, y] = cal(h as 0 | 1); return stickToKey(x, y, undefined, null); }) as any;
    if (!calib.done) {
        const t = CALIB_TARGETS[calib.target];
        for (const [btn, h] of [[Btn.LT, 0], [Btn.RT, 1]] as [Btn, 0 | 1][]) if (jp(btn)) {
            if (h !== t.h) { toast(`That's the ${t.h ? "right" : "left"} stick's key — use ${t.h ? "RT" : "LT"}`, 1200); continue; }
            const ok = sel[h][0] === t.cell[0] && sel[h][1] === t.cell[1];
            const [x, y] = cal(h);
            calib.samples.push({ h, cell: t.cell, x, y });
            calib.results.push(ok); calib.flash = { ok, at: now };
            kbFeedback("key"); // (the same click either way: no hint whether it landed)
            calib.target++;
            if (calib.target >= CALIB_TARGETS.length) { calib.done = true; learnAim(pad.id); }
        }
    }
    // the keyboard with the target lit, but NO marker for where the stick points (so there's nothing to nudge toward)
    renderCalibClocks([[-1, -1], [-1, -1]]);
    const hits = calib.results.filter(Boolean).length, n = CALIB_TARGETS.length;
    if (!calib.done) status.textContent = `${calib.target + 1} / ${n} · ${CALIB_TARGETS[calib.target]?.h ? "right" : "left"} stick`;
    else {
        const tip = calib.innerAtEdge.length >= 2
            ? `<div class="hh-calib-tip">Tip: you pushed ${[...new Set(calib.innerAtEdge)].join(" ")} all the way to the edge — half-tilt keys share a direction with an edge key, so stop partway for them.</div>` : "";
        status.innerHTML = `Before learning ${hits}/${n} · with your aim ${calib.learnedHits}/${n} · ${badgeHtml("A")} done · ${badgeHtml("Y")} redo calibration${tip}`;
        if (jp(Btn.A)) { closeCalibration(); toast("✓ Sticks calibrated and tuned to your aim", 2000); }
        if (jp(Btn.Y)) { const ft = calibFirstTime; closeCalibration(); openCalibration(ft); }
    }
}

/** Keep learned edge-key angles in order with at least 24° between neighbours (a single noisy press can't squeeze a key). */
function spreadAngles(angles: (number | null)[]): (number | null)[] {
    const a = angles.map((v, i) => { if (v == null) return i * 30; let d = v - i * 30; if (d > 180) d -= 360; if (d < -180) d += 360; return (i * 30 + Math.max(-12, Math.min(12, d)) + 360) % 360; });
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < 12; i++) {
        const j = (i + 1) % 12;
        let gap = a[j] - a[i]; if (gap < 0) gap += 360;
        if (gap < 24) { const fix = (24 - gap) / 2; a[i] = (a[i] - fix + 360) % 360; a[j] = (a[j] + fix) % 360; }
    }
    return a.map((v, i) => angles[i] == null && Math.abs(v - i * 30) < 0.5 ? null : v);
}
/** While typing: each edge key typed nudges its learned angle a little toward where the stick really was. */
let aimSaveTimer = 0;
function learnFromTyping(padId: string, h: 0 | 1, cell: [number, number], x: number, y: number) {
    const c = calibFor(padId);
    const aim = c?.aim?.[h ? "R" : "L"];
    if (!aim || Math.hypot(x, y) < aim.rim) return;
    const i = CLOCK_CELLS.findIndex(q => q[0] === cell[0] && q[1] === cell[1]);
    if (i < 0) return;
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    const cur = aim.angles[i] ?? i * 30;
    let d = deg - cur; if (d > 180) d -= 360; if (d < -180) d += 360;
    if (Math.abs(d) > 20) return; // (way off: a slip, not this key's real spot)
    let target = cur + d * 0.08, off = target - i * 30; if (off > 180) off -= 360; if (off < -180) off += 360;
    aim.angles[i] = (i * 30 + Math.max(-12, Math.min(12, off)) + 360) % 360;
    aim.angles = spreadAngles(aim.angles);
    clearTimeout(aimSaveTimer);
    aimSaveTimer = window.setTimeout(() => DataStore.set(CALIB_KEY, calibs).catch(() => { }), 3000);
}
/** From the aim step: where this person's centre / half tilt / edge are, and the angle they use for each edge key. */
function learnAim(padId: string) {
    if (!calib) return;
    const c = calibs[padId];
    if (!c) return;
    const isCenter = (k: [number, number]) => k[0] === 1 && k[1] === 2;
    const isInner = (k: [number, number]) => isInnerCell(k);
    const aimFor = (h: 0 | 1): StickAim => {
        const ss = calib!.samples.filter(p => p.h === h), r = (p: { x: number; y: number; }) => Math.hypot(p.x, p.y);
        const cR = ss.filter(p => isCenter(p.cell)).map(r), iR = ss.filter(p => isInner(p.cell)).map(r), eR = ss.filter(p => !isCenter(p.cell) && !isInner(p.cell)).map(r);
        // the line that best separates two groups of presses (most of them on the right side of it); ties go to the default
        const bestLine = (below: number[], above: number[], lo: number, hi: number, def: number) => {
            if (!below.length || !above.length) return def;
            let best = def, bestScore = -1;
            for (let v = lo; v <= hi + 1e-9; v += 0.01) {
                const score = below.filter(x => x < v).length + above.filter(x => x >= v).length;
                if (score > bestScore || (score === bestScore && Math.abs(v - def) < Math.abs(best - def))) { best = v; bestScore = score; }
            }
            return best;
        };
        const center = bestLine(cR, iR, 0.06, 0.4, CLOCK_CENTER);
        const rim = bestLine(iR, eR, 0.6, 0.98, 0.96);
        // half-tilt keys pushed right to the edge: they can't be told from the edge key in the same direction
        for (const p of ss) if (isInner(p.cell) && r(p) >= rim) calib!.innerAtEdge.push(splitSet()[h][p.cell[0]][p.cell[1]]);
        // edge keys: the angle actually used (kept within 20° of the key's own spot, so the order can't swap)
        const angles = CLOCK_CELLS.map((cell, i) => {
            const p = ss.find(q => q.cell[0] === cell[0] && q.cell[1] === cell[1] && Math.hypot(q.x, q.y) > 0.5);
            if (!p) return null;
            const deg = (Math.atan2(p.x, -p.y) * 180 / Math.PI + 360) % 360;
            let d = deg - i * 30; if (d > 180) d -= 360; if (d < -180) d += 360;
            return (i * 30 + Math.max(-12, Math.min(12, d)) + 360) % 360;
        });
        return { center, rim, angles: spreadAngles(angles) };
    };
    c.aim = { L: aimFor(0), R: aimFor(1) };
    DataStore.set(CALIB_KEY, calibs).catch(() => { });
    // how the same presses score with what it learned
    calib.learnedHits = calib.samples.filter(p => { const k = stickToKey(p.x, p.y, undefined, p.h ? c.aim!.R : c.aim!.L); return k[0] === p.cell[0] && k[1] === p.cell[1]; }).length;
}
// ---------- faster keyboard styles ----------
type KbStyle = "grid" | "split" | "wheel";
const kbStyle = (): KbStyle => (["grid", "split", "wheel"].includes(opt("keyboardMode")) ? opt("keyboardMode") : "grid") as KbStyle;
const caseOf = (ch: string) => (kbShift || kbCaps) && /^[a-z]$/.test(ch) ? ch.toUpperCase() : ch;
/** Type one character from the split / wheel keyboards (a pending "capital next" applies once). */
function kbTypeChar(ch: string) {
    kbInsert(caseOf(ch));
    if (kbShift) kbShift = false;
    renderKeyboard();
    kbFeedback("key");
}

/** Key feedback: the key just typed pops, delete / space pulse the keyboard, and a soft click (made on the fly —
 *  no sound files) if the sound is on. */
let kbAudio: AudioContext | null = null;
let suggTimer = 0;
/** Refresh the suggestions once Discord's editor has drawn the change (it updates the box a moment later). */
function scheduleSuggestions() {
    clearTimeout(suggTimer);
    suggTimer = window.setTimeout(updateSuggestions, 40);
}
function kbFeedback(kind: "key" | "del" | "space") {
    scheduleSuggestions();
    if (kbEl) {
        if (kind === "key") for (const el of kbEl.querySelectorAll<HTMLElement>(".hh-ckey.sel, .hh-key.sel, .hh-petal.sel")) {
            el.classList.remove("hh-pop"); void el.offsetWidth; el.classList.add("hh-pop"); // (restart the animation)
        } else {
            const cls = kind === "del" ? "hh-kb-del" : "hh-kb-space";
            kbEl.classList.remove(cls); void kbEl.offsetWidth; kbEl.classList.add(cls);
        }
    }
    if (!opt("keyboardSound")) return;
    const vol = Math.max(0, Math.min(1, opt<number>("keyboardVolume") / 100));
    if (!vol) return;
    try {
        kbAudio ??= new AudioContext();
        if (kbAudio.state === "suspended") void kbAudio.resume();
        const t = kbAudio.currentTime;
        const [freq, dur, type] = kind === "key" ? [1450 + Math.random() * 220, 0.035, "triangle"]
            : kind === "del" ? [520, 0.05, "triangle"] : [240, 0.07, "sine"];
        const o = kbAudio.createOscillator(), g = kbAudio.createGain();
        o.type = type as OscillatorType;
        o.frequency.setValueAtTime(freq as number, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (dur as number));
        o.connect(g).connect(kbAudio.destination);
        o.start(t); o.stop(t + (dur as number) + 0.02);
    } catch { }
}

// Split: the keyboard in two halves; each stick POINTS at a key on its half (no walking), LB / RB type them.
const SPLIT_LETTERS: [string[][], string[][]] = [
    [["q", "w", "e", "r", "t"], ["a", "s", "d", "f", "g"], ["z", "x", "c", "v", "b"]],
    [["y", "u", "i", "o", "p"], ["h", "j", "k", "l", "'"], ["n", "m", ",", ".", "?"]],
];
const SPLIT_SYMBOLS: [string[][], string[][]] = [
    [["1", "2", "3", "4", "5"], ["!", "@", "#", "$", "%"], ["(", ")", "-", "_", "+"]],
    [["6", "7", "8", "9", "0"], ["^", "&", "*", "=", "/"], [":", ";", "\"", "😂", "👍"]],
];
/** With "more half-tilt keys" (setting): half up / half down are keys too ([3, 0] / [3, 1]); the most used outer letters
 *  move onto them (e t / i o), and their old spots on the edge get punctuation. */
const SPLIT_LETTERS_5: [string[][], string[][]] = [
    [["q", "w", "!", "r", "-"], ["a", "s", "d", "f", "g"], ["z", "x", "c", "v", "b"], ["e", "t"]],
    [["y", "u", "/", ":", "p"], ["h", "j", "k", "l", "'"], ["n", "m", ",", ".", "?"], ["i", "o"]],
];
const SPLIT_SYMBOLS_5: [string[][], string[][]] = [
    [...SPLIT_SYMBOLS[0], ["+", "="]],
    [...SPLIT_SYMBOLS[1], ["@", "#"]],
];
const splitFive = () => !!opt("splitMoreInner");
const splitSet = () => splitFive() ? (kbSym ? SPLIT_SYMBOLS_5 : SPLIT_LETTERS_5) : (kbSym ? SPLIT_SYMBOLS : SPLIT_LETTERS);
/** A half-tilt key (between the centre and the edge): s f / j l, and with the setting also half up / half down. */
const isInnerCell = (c: [number, number]) => (c[0] === 1 && (c[1] === 1 || c[1] === 3)) || c[0] === 3;
let splitPos: [[number, number], [number, number]] = [[1, 2], [1, 2]]; // [row, col] each half
const splitPending: [[number, number] | null, [number, number] | null] = [null, null]; // a key the stick just moved onto
const splitPendingAt = [0, 0];
const SPLIT_SETTLE_MS = 70;  // a half-tilt key needs this long to be selected (see handleSplit)
const SPLIT_HOLD_MS_BY_STYLE: Record<string, number> = { forgiving: 250, balanced: 150, fast: 60 };
const splitHoldMs = () => SPLIT_HOLD_MS_BY_STYLE[opt<string>("splitStyle")] ?? 150;
// (typing style) grace: an aimed-but-not-yet-typed key stays selected this long after letting go (a press a split second
                             // late still counts). Not longer: that made neutral sticky (a small nudge toward s / f looks exactly
                             // like a flick there), and the key should be wherever the stick is when you press.
const SPLIT_INNER_EXIT = 0.08; // once on a half-tilt key (s f / j l), it stays until the stick is really back in the middle:
                               // people push those very lightly (18–30%) and relax a little before pressing
const splitTyped = [true, true]; // has each stick's selected key been typed yet?
const splitLastRim = [false, false]; // was the last key typed with each stick an outer (rim) key?
const splitRolled = [false, false];  // is the selected key a roll (crossed while springing back)?
const SPLIT_ROLL_MS = 220, SPLIT_ROLL_MIN_MS = 15;
/** The Split keyboard as two CLOCKS: each stick is a clock face, and a key is a position on it — so the same
 *  stick position always means the same key, and it matches how a thumb actually moves (it arcs, it doesn't go
 *  in straight rows and columns).
 *    pushed to the rim: the 12 keys around the edge are the 12 hours (equal 30° slices) —
 *        left:  e 12 · r 1 · t 2 · g 3 · b 4 · v 5 · c 6 · x 7 · z 8 · a 9 · q 10 · w 11
 *        right: i 12 · o 1 · p 2 · ' 3 · ? 4 · . 5 · , 6 · m 7 · n 8 · h 9 · y 10 · u 11
 *    half tilt (between the centre and the rim — 15% to 95% when pushed sideways): leaning left = s / j, leaning right = f / l
 *    centred: d / k
 *  Keys are still kept as [row, col] of the 3×5 layouts below (those say which character is where). */
const CLOCK_CELLS: [number, number][] = [ // hour 0 (12 o'clock) … 11, as [row, col] of a 3×5 half
    [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [2, 3], [2, 2], [2, 1], [2, 0], [1, 0], [0, 0], [0, 1],
];
const CLOCK_CENTER = 0.15, CLOCK_RIM = 0.93; // tilt: under CLOCK_CENTER = centred; from CLOCK_RIM = at the rim (a real push to the rim reads 0.98+; a strong half-tilt flick can reach ~0.9)
const CLOCK_RIM_SIDE = 0.95; // pushed sideways (where s f / j l live) the half-tilt zone reaches further: rim pushes there read 0.96+
/** Where the rim starts for this direction: a little further out to the sides, to give s f / j l more room. */
function rimFor(x: number, y: number) {
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    const side = Math.min(deg, 360 - deg, Math.abs(180 - deg)) >= 60;
    // "strict" (setting): outer keys only right at the stick's edge, the inner keys get everything else
    if (opt("splitEdge") !== "normal") return side ? 0.97 : 0.96;
    return side ? CLOCK_RIM_SIDE : CLOCK_RIM;
}
function stickToKey(x: number, y: number, h?: 0 | 1, aimOverride?: StickAim | null): [number, number] {
    const sens = opt<number>("splitSensitivity") || 1;
    const aim = aimOverride !== undefined ? aimOverride : h !== undefined ? activeAim[h] : null;
    const r = Math.hypot(x, y);
    if (r < (aim?.center ?? CLOCK_CENTER) / sens) return [1, 2];
    if (r < (aim?.rim ?? rimFor(x, y)) / sens) {
        // half tilt: left / right — and with the setting, up / down too (four equal quarters)
        if (splitFive() && Math.abs(y) > Math.abs(x)) return [3, y < 0 ? 0 : 1];
        return [1, x < 0 ? 1 : 3];
    }
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360; // 0 = up, clockwise
    // edge keys: 12 equal 30° slices, always (calibration tunes the centre / edge distance, never the side-to-side
    // boundaries — shifting those made some keys narrower than their neighbours)
    return CLOCK_CELLS[Math.round(deg / 30) % 12];
}
/** The panels either side of the keys (split and grid keyboards): the controls on the left, suggestions on the right. */
function kbSidePanels(legend: [Badge, string][], suggHint: string): [string, string] {
    const b = badgeHtml;
    const left = clipOpen ? clipPanelHtml() : `<div class="hh-side hh-side-l"><div class="hh-side-label">Controls</div>
        <div class="hh-legend">${legend.map(([k, t]) => `<div class="hh-legend-row"><span class="hh-legend-btn">${b(k)}</span><span>${t}</span></div>`).join("")}</div></div>`;
    const right = `<div class="hh-side hh-side-r"><div class="hh-side-label">Suggestions</div><div class="hh-sugg-list"></div><div class="hh-side-sub hh-sugg-hint2">${suggHint}</div></div>`;
    return [left, right];
}
/** Move the two highlighted keys without redrawing the keyboard (redrawing on every stick move made it lag). */
function updateSplitSelection() {
    if (!kbEl || !kbEl.querySelector(".hh-split")) return renderKeyboard();
    for (const h of [0, 1] as const) {
        const want = kbEl.querySelector(`[data-k="${h}-${splitPos[h][0]}-${splitPos[h][1]}"]`);
        for (const old of kbEl.querySelectorAll(`.hh-ckey.hh-sel-${h ? "r" : "l"}`)) if (old !== want) old.classList.remove("sel", `hh-sel-${h ? "r" : "l"}`);
        want?.classList.add("sel", `hh-sel-${h ? "r" : "l"}`);
    }
}
function renderSplit() {
    const set = splitSet();
    const keyHtml = (h: 0 | 1, [r, c]: [number, number], style: string, cls = "") =>
        `<div data-k="${h}-${r}-${c}" class="hh-ckey ${cls} ${splitPos[h][0] === r && splitPos[h][1] === c ? `sel hh-sel-${h ? "r" : "l"}` : ""}" style="${style}" data-ch="${set[h][r][c].replace(/"/g, "&quot;")}">${caseOf(set[h][r][c])}</div>`;
    // each half is a clock face: 12 keys round the rim, the half-tilt keys left / right of the centre, the centre key
    const clock = (h: 0 | 1) => {
        const rim = CLOCK_CELLS.map((cell, i) => {
            const a = i * Math.PI / 6;
            return keyHtml(h, cell, `left:${50 + 40 * Math.sin(a)}%;top:${50 - 40 * Math.cos(a)}%`);
        }).join("");
        const inner = keyHtml(h, [1, 1], "left:30%;top:50%", "hh-ckey-inner") + keyHtml(h, [1, 3], "left:70%;top:50%", "hh-ckey-inner")
            + (splitFive() ? keyHtml(h, [3, 0], "left:50%;top:30%", "hh-ckey-inner") + keyHtml(h, [3, 1], "left:50%;top:70%", "hh-ckey-inner") : "");
        // the glowing wedge behind the hour the stick points at (hidden on the half-tilt / centre keys)
        const hour = CLOCK_CELLS.findIndex(c => c[0] === splitPos[h][0] && c[1] === splitPos[h][1]);
        const wedge = `<div class="hh-wedge ${hour < 0 ? "off" : ""}" style="--a:${(hour < 0 ? 0 : hour) * 30}deg"></div>`;
        return `<div class="hh-split-half hh-half-${h ? "r" : "l"}"><div class="hh-split-tag">${badgeHtml(h ? "RT" : "LT")}</div>
            <div class="hh-clock hh-clock-${h ? "r" : "l"}"><div class="hh-stick-tag">${h ? "RS" : "LS"}</div>${wedge}<div class="hh-ticks"></div>${rim}${inner}${keyHtml(h, [1, 2], "left:50%;top:50%", "hh-ckey-center")}</div></div>`;
    };
    const [left, right] = kbSidePanels(
        [["LT", "type left-stick key"], ["RT", "type right-stick key"], ["LB", "delete letter"], ["RB", "space"], ["X", "use suggestion"], ["A", "capital (hold: caps)"], ["Y", "123 / symbols"], ["MENU", "send message"], ["B", "back to box (again: close)"], ["DPAD", "◀▶ move cursor"], ["L3", "keys ⇄ box (GIF…)"], ["R3", "chat only (hide lists)"], ["VIEW", "switch to grid"]],
        `${badgeHtml("DPAD")} ▲▼ pick suggestion`);
    kbEl!.classList.add("hh-kb-lay");
    kbEl!.querySelector(".hh-kb-keys")!.innerHTML = `<div class="hh-split hh-kb-layout">${left}${clock(0)}${clock(1)}${right}</div>`;
    updateSuggestions();
}
/** Typing recorder (Split keyboard): stick positions over time plus every letter / delete / space, kept in memory only
 *  (cleared on reload), read over the debug port to see where typing goes wrong. Stick samples only while they move. */
const TYPING_LOG_MAX = 40000;
const typingLogBuf: any[] = [];
let lastStickSample = "";
function typingLog(e: any) {
    typingLogBuf.push(e);
    if (typingLogBuf.length > TYPING_LOG_MAX) typingLogBuf.splice(0, typingLogBuf.length - TYPING_LOG_MAX);
}
function recordSticks(t: number, lx: number, ly: number, rx: number, ry: number) {
    const k = [lx, ly, rx, ry].map(v => v.toFixed(2)).join(",");
    if (k === lastStickSample) return;
    lastStickSample = k;
    typingLog({ t: Math.round(t), ev: "s", a: k });
}

let splitADownAt = 0, splitAHeldFired = false, splitADown = false;
function handleSplit(pad: Gamepad, jp: (b: Btn) => boolean, pressed: boolean[]) {
    { const c = calibFor(pad.id); activeAim = [c?.aim?.L ?? null, c?.aim?.R ?? null]; }
    // (adjusted for this controller's calibration, if it has one)
    const [lx, ly] = calibrate(pad.axes[0] ?? 0, pad.axes[1] ?? 0, 0, pad), [rx, ry] = calibrate(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 1, pad);
    // settling: a new key only takes over once the stick has rested on it briefly, so keys the stick just passes
    // through (springing back after a letter, sliding over to a half-tilt key) are never the one that gets typed.
    // Pushed out to the rim (edges / corners) it switches at once — the rim holds the thumb there anyway.
    const now = performance.now();
    let changed = false;
    ([[lx, ly], [rx, ry]] as [number, number][]).forEach(([x, y], h) => {
        let raw = stickToKey(x, y, h as 0 | 1);
        // on a half-tilt key and only relaxing toward the middle (not truly centred yet): still that key
        const onInner = isInnerCell(splitPos[h]);
        if (onInner && raw[0] === 1 && raw[1] === 2 && Math.hypot(x, y) >= SPLIT_INNER_EXIT) raw = [splitPos[h][0], splitPos[h][1]];
        const same = (a: [number, number] | null) => !!a && a[0] === raw[0] && a[1] === raw[1];
        if (same(splitPos[h])) { splitPending[h] = null; return; }
        if (!same(splitPending[h])) { splitPending[h] = raw; splitPendingAt[h] = now; }
        // how long the stick has to stay on the new key before it's the selected one (from recorded typing):
        //  · out at the rim: at once
        //  · a half-tilt key (s / f): 70ms — a deliberate flick there lasts ~130ms, letting go of a rim key just
        //    passes through in ~40ms (and mustn't select it)
        //  · back at the centre: at once if the selected key was already typed (you let go: next is d);
        //    a 250ms grace if it wasn't — a press a split second after letting go still types that key
        const atCenter = raw[0] === 1 && raw[1] === 2;
        const isInner = isInnerCell(raw);
        // roll (setting): springing back from an outer key you just typed, crossing s f / j l selects it at once and keeps
        // it for a moment after the centre — so "t, then press as it swings back" types f (recorded: presses land 0–0.2 s
        // after the stick has left f)
        const roll = opt("splitRollThrough") && splitTyped[h] && splitLastRim[h] && isInner;
        const wait = Math.hypot(x, y) >= rimFor(x, y) ? 0
            : atCenter ? (splitTyped[h] ? 0 : splitRolled[h] ? SPLIT_ROLL_MS : splitHoldMs())
            : roll ? SPLIT_ROLL_MIN_MS : SPLIT_SETTLE_MS;
        if (now - splitPendingAt[h] >= wait) {
            splitRolled[h] = roll;
            splitPos[h] = raw; splitPending[h] = null; splitTyped[h] = false; changed = true;
        }
    });
    if (changed) updateSplitSelection();
    recordSticks(now, lx, ly, rx, ry);
    const set = splitSet();
    const keyAt = (h: 0 | 1, k: [number, number]) => set[h][k[0]][k[1]];
    for (const [b, h] of [[Btn.LT, 0], [Btn.RT, 1]] as [Btn, 0 | 1][]) if (held(b, pressed)) {
        let key = splitPos[h];
        // roll: a press while still crossing s f / j l (before it's been selected) counts as that key too
        if (opt("splitRollThrough") && splitTyped[h] && splitLastRim[h]) {
            const [px, py] = h ? [rx, ry] : [lx, ly], under = stickToKey(px, py, h), r = Math.hypot(px, py);
            if (isInnerCell(under) && r >= CLOCK_CENTER && r < rimFor(px, py)) key = under;
        }
        splitLastRim[h] = !(isInnerCell(key) || (key[0] === 1 && key[1] === 2)); // (typed an outer / rim key?)
        splitRolled[h] = false;
        const ch = keyAt(h, key);
        const [x, y] = h ? [rx, ry] : [lx, ly];
        // (for the typing recorder: what was typed, where the stick was, and what it pointed at right then)
        typingLog({ t: now, ev: "type", h, key: ch, x: +x.toFixed(3), y: +y.toFixed(3), under: keyAt(h, stickToKey(x, y, h)), pending: splitPending[h] ? keyAt(h, splitPending[h]!) : null });
        kbTypeChar(ch);
        splitTyped[h] = true;
        learnFromTyping(pad.id, h, key, h ? rx : lx, h ? ry : ly);
    }
    kbCommonButtons(jp, pressed, now);
}
/** The buttons shared by the Split and Grid keyboards: LB delete, RB space, X suggestion, A capital (hold: caps),
 *  Y symbols, D-pad ◀▶ cursor / ▲▼ suggestions. */
function kbCommonButtons(jp: (b: Btn) => boolean, pressed: boolean[], now: number) {
    if (held(Btn.LB, pressed)) { typingLog({ t: now, ev: "del" }); kbPress({ label: "⌫", act: "back" }); }
    if (jp(Btn.X)) { typingLog({ t: now, ev: "sugg", word: suggestions[suggIndex] ?? null }); acceptSuggestion(); }
    if (jp(Btn.Down) && suggestions.length) { suggIndex = (suggIndex + 1) % suggestions.length; updateSuggestions(); }
    if (held(Btn.RB, pressed)) { typingLog({ t: now, ev: "space" }); kbPress({ label: "space", act: "space" }); }
    // A: tap = capital next letter, hold = caps lock on / off
    if (jp(Btn.A)) { splitADownAt = now; splitAHeldFired = false; splitADown = true; }
    if (!splitADown) { /* (an A still held from opening the keyboard: not a capital) */ }
    else if (pressed[Btn.A] && !splitAHeldFired && now - splitADownAt >= 400) {
        splitAHeldFired = true; kbCaps = !kbCaps; kbShift = false; renderKeyboard();
        toast(kbCaps ? "⇪ Caps lock on" : "Caps lock off", 900);
    }
    if (!pressed[Btn.A] && splitADown) { if (!splitAHeldFired) { kbShift = !kbShift; renderKeyboard(); } splitADown = false; }
    if (jp(Btn.Y)) { kbSym = !kbSym; renderKeyboard(); }
    if (held(Btn.Left, pressed)) kbMoveCaret(-1);
    if (held(Btn.Right, pressed)) kbMoveCaret(1);
    if (jp(Btn.Up) && suggestions.length) { suggIndex = (suggIndex - 1 + suggestions.length) % suggestions.length; updateSuggestions(); }
}

// ---------- Grid keyboard, two sticks ----------
// Two highlighted keys: the left stick moves one around the left half of the grid, the right stick the right half
// (hold to keep going). LT types the left one, RT the right one; the other buttons work like the Split keyboard.
let gridPos: [number, number][] = [[2, 3], [2, 6]];
const gridNav = [{ dir: null as Dir | null, since: 0, last: 0 }, { dir: null as Dir | null, since: 0, last: 0 }];
function gridHalf(r: number, c: number): 0 | 1 {
    const row = kbLayout()[r] ?? [];
    let at = 0, total = 0;
    row.forEach((k, i) => { const w = k.w ?? 1; if (i < c) at += w; total += w; });
    return at + (row[c]?.w ?? 1) / 2 < total / 2 ? 0 : 1;
}
function gridMove(h: 0 | 1, dir: Dir) {
    const keys = [...(kbEl?.querySelectorAll<HTMLElement>(".hh-grid .hh-key") ?? [])].filter(k => gridHalf(Number(k.dataset.r), Number(k.dataset.c)) === h);
    const cur = keys.find(k => Number(k.dataset.r) === gridPos[h][0] && Number(k.dataset.c) === gridPos[h][1]);
    if (!cur) { const k0 = keys[0]; if (k0) gridPos[h] = [Number(k0.dataset.r), Number(k0.dataset.c)]; return updateGridSel(); }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = Infinity, next: HTMLElement | null = null;
    for (const k of keys) {
        if (k === cur) continue;
        const b = k.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
        const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
        const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
        if (along <= 4) continue;
        const sc = along + across * 3;
        if (sc < best) { best = sc; next = k; }
    }
    if (next) { gridPos[h] = [Number(next.dataset.r), Number(next.dataset.c)]; updateGridSel(); }
}
function updateGridSel() {
    if (!kbEl) return;
    for (const h of [0, 1] as const) {
        const cls = h ? "hh-gsel-r" : "hh-gsel-l";
        const want = kbEl.querySelector(`.hh-grid .hh-key[data-r="${gridPos[h][0]}"][data-c="${gridPos[h][1]}"]`);
        for (const o of kbEl.querySelectorAll(`.${cls}`)) if (o !== want) o.classList.remove(cls, "sel");
        want?.classList.add(cls, "sel");
    }
}
function handleGrid2(pad: Gamepad, jp: (b: Btn) => boolean, pressed: boolean[]) {
    const now = performance.now(), dz = Math.max(0.35, settings.store.stickDeadzone ?? 0.5);
    ([[pad.axes[0] ?? 0, pad.axes[1] ?? 0], [pad.axes[2] ?? 0, pad.axes[3] ?? 0]] as [number, number][]).forEach(([x, y], h) => {
        const st = gridNav[h];
        const dir: Dir | null = Math.hypot(x, y) < dz ? null : Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
        if (!dir) { st.dir = null; return; }
        if (dir !== st.dir) { st.dir = dir; st.since = st.last = now; gridMove(h as 0 | 1, dir); return; }
        const heldFor = now - st.since, rate = heldFor > 900 ? 70 : 120;
        if (heldFor > 320 && now - st.last >= rate) { st.last = now; gridMove(h as 0 | 1, dir); }
    });
    const rows = kbLayout();
    for (const h of [0, 1] as const) {
        if (!jp(h ? Btn.RT : Btn.LT)) continue;
        const [r, c] = gridPos[h], key = rows[r]?.[c];
        if (!key) continue;
        kbFlashKey(r, c);
        kbPress(key);
    }
    kbCommonButtons(jp, pressed, now);
}
function kbFlashKey(r: number, c: number) {
    const el = kbEl?.querySelector<HTMLElement>(`.hh-grid .hh-key[data-r="${r}"][data-c="${c}"]`);
    if (!el) return;
    el.classList.remove("hh-pop"); void el.offsetWidth; el.classList.add("hh-pop");
}

// Wheel (Steam's "daisywheel"): a stick / the D-pad picks one of 8 groups around a circle, A/B/X/Y type its 4 letters.
// Each group's letters in button order: Y (top), B (right), A (bottom), X (left); groups go clockwise from the top.
const WHEEL_LETTERS = ["abcd", "efgh", "ijkl", "mnop", "qrst", "uvwx", "yz.,", "'?!-"].map(s => [...s]);
const WHEEL_SYMBOLS = [["1", "2", "3", "4"], ["5", "6", "7", "8"], ["9", "0", "@", "#"], ["$", "%", "&", "*"],
    ["(", ")", "_", "+"], ["=", "/", ":", ";"], ["\"", "~", "<", ">"], ["😂", "👍", "❤️", "😭"]];
const WHEEL_BTNS: [Btn, number][] = [[Btn.Y, 0], [Btn.B, 1], [Btn.A, 2], [Btn.X, 3]];
let wheelPetal: number | null = null;
/** 0–7 clockwise from the top, from the left stick or the D-pad (two arrows at once = a diagonal); null = centred. */
function wheelDirection(pad: Gamepad, pressed: boolean[]): number | null {
    let x = (pressed[Btn.Right] ? 1 : 0) - (pressed[Btn.Left] ? 1 : 0), y = (pressed[Btn.Down] ? 1 : 0) - (pressed[Btn.Up] ? 1 : 0);
    if (!x && !y) {
        const [ax = 0, ay = 0] = pad.axes;
        if (Math.hypot(ax, ay) < 0.5) return null;
        x = ax; y = ay;
    }
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360 + 22.5) % 360;
    return Math.floor(deg / 45);
}
function renderWheel() {
    const set = kbSym ? WHEEL_SYMBOLS : WHEEL_LETTERS;
    const slots = ["t", "r", "b", "l"]; // Y top, B right, A bottom, X left
    const diamond = (chars: string[], cls: string, style: string, petal: number | null) =>
        `<div class="hh-petal ${cls}" style="${style}">${chars.map((ch, i) =>
            `<span class="hh-pk hh-pk-${slots[i]}" ${petal !== null ? `data-ch="${ch.replace(/"/g, "&quot;")}"` : ""}>${caseOf(ch)}</span>`).join("")}</div>`;
    const petals = set.map((chars, i) => {
        const a = i * Math.PI / 4;
        return diamond(chars, wheelPetal === i ? "sel" : "", `left:${50 + 29 * Math.sin(a)}%;top:${50 - 36 * Math.cos(a)}%`, i);
    }).join("");
    const center = diamond(["⇧", "✓", "␣", "⌫"], `hh-petal-center ${wheelPetal === null ? "sel" : ""}`, "left:50%;top:50%", null);
    kbEl!.querySelector(".hh-kb-keys")!.innerHTML = `<div class="hh-wheel">${petals}${center}</div>`;
}
function handleWheel(pad: Gamepad, jp: (b: Btn) => boolean, pressed: boolean[]) {
    const p = wheelDirection(pad, pressed);
    if (p !== wheelPetal) { wheelPetal = p; renderKeyboard(); }
    if (p !== null) {
        const set = kbSym ? WHEEL_SYMBOLS : WHEEL_LETTERS;
        for (const [b, slot] of WHEEL_BTNS) if (held(b, pressed)) kbTypeChar(set[p][slot]);
    } else {
        if (held(Btn.A, pressed)) kbPress({ label: "space", act: "space" });
        if (held(Btn.X, pressed)) kbPress({ label: "⌫", act: "back" });
        if (jp(Btn.Y)) { kbShift = !kbShift; renderKeyboard(); }
        if (jp(Btn.B)) backOutOfTyping();
    }
    if (held(Btn.LB, pressed)) kbMoveCaret(-1);
    if (held(Btn.RB, pressed)) kbMoveCaret(1);
    if (jp(Btn.LT)) { kbCaps = !kbCaps; kbShift = false; renderKeyboard(); }
    if (jp(Btn.RT)) { kbSym = !kbSym; renderKeyboard(); }
}
function kbHints(): string {
    const b = badgeHtml;
    const toggle = `<span class="hh-kb-toggle">${b("VIEW")} ${kbStyle() === "split" ? "grid" : "split"}</span>`;
    if (kbStyle() === "split") return `${b("L")}${b("R")} point ${b("LT")}${b("RT")} type ${b("LB")} ⌫ ${b("RB")} space ${b("A")} ⇧ ${b("Y")} 123 ${b("X")} word ${b("DPAD")} ◀▶ cursor ▲ caps ${b("MENU")} send ${b("B")} done ${toggle}`;
    if (kbStyle() === "wheel") return [`${b("L")} pick · ${b("A")}${b("B")}${b("X")}${b("Y")} type`, `centred: ${b("A")} space ${b("X")} ⌫ ${b("Y")} ⇧ ${b("B")} done`, `${b("LT")} caps ${b("RT")} 123 ${b("MENU")} send ${toggle}`].map(l => `<div>${l}</div>`).join("");
    return `${b("A")} type ${b("X")} delete ${b("Y")} space ${b("MENU")} send ${b("LB")}${b("RB")} cursor ${b("LT")} caps ${b("RT")} symbols ${b("B")} done · ${toggle}`;
}

/** ⧉ while the keyboard is up: Split on / off (back to the grid; from the wheel, to Split). Remembered as the setting. */
function kbToggleSplit() {
    (settings.store as any).keyboardMode = kbStyle() === "split" ? "grid" : "split";
    if (!kbEl) return;
    // (only the style classes change: the layout ones — over the message box, Controls column… — stay)
    kbEl.classList.toggle("hh-kb-wheel", kbStyle() === "wheel");
    if (kbStyle() === "wheel") kbEl.classList.remove("hh-kb-lay");
    kbEl.querySelector(".hh-kb-hints")!.innerHTML = kbHints();
    renderKeyboard();
    if (kbOverComposer) layoutKbSide();
    toast(kbStyle() === "split" ? "⌨️ Split keyboard" : "⌨️ Grid keyboard", 1000);
}

function renderKeyboard() {
    if (!kbEl) return;
    if (pickerLayer && !pickerSearch) { // the picker in place of the keys
        kbEl.classList.add("hh-kb-lay");
        kbEl.querySelector(".hh-kb-keys")!.innerHTML = pickerPanelHtml();
        pkSig = ""; pkRefresh();
        return;
    }
    if (pickerLayer && pickerSearch && kbStyle() === "split") { // searching: the clocks, and the results beside them
        renderSplit();
        kbEl.querySelector(".hh-split")?.insertAdjacentHTML("beforeend", pickerPanelHtml());
        pkSig = ""; pkRefresh();
        return;
    }
    if (kbStyle() === "split") return renderSplit();
    if (kbStyle() === "wheel") return renderWheel();
    const rows = kbLayout();
    kbRow = Math.min(kbRow, rows.length - 1);
    kbCol = Math.min(kbCol, rows[kbRow].length - 1);
    const grid = rows.map((row, r) => `<div class="hh-kb-row">${row.map((key, c) =>
        `<div class="hh-key ${key.act ? "hh-key-act" : ""} ${gridPos[0][0] === r && gridPos[0][1] === c ? "sel hh-gsel-l" : ""} ${gridPos[1][0] === r && gridPos[1][1] === c ? "sel hh-gsel-r" : ""} ${key.act === "shift" && (kbShift || kbCaps) ? "on" : ""}" data-r="${r}" data-c="${c}" style="flex:${key.w ?? 1}">${kbLabel(key)}</div>`).join("")}</div>`).join("");
    const [left, right] = kbSidePanels([["L", "left-half key"], ["R", "right-half key"], ["LT", "type left key"], ["RT", "type right key"], ["LB", "delete letter"], ["RB", "space"], ["X", "use suggestion"], ["A", "capital (hold: caps)"], ["Y", "123 / symbols"], ["MENU", "send message"], ["B", "back to box (again: close)"], ["DPAD", "◀▶ move cursor"], ["L3", "keys ⇄ box (GIF…)"], ["VIEW", "switch to split"]],
        `${badgeHtml("DPAD")} ▲▼ pick suggestion`);
    kbEl.classList.add("hh-kb-lay");
    kbEl.querySelector(".hh-kb-keys")!.innerHTML = `<div class="hh-gridwrap hh-kb-layout">${left}<div class="hh-grid">${grid}</div>${right}</div>`;
    updateSuggestions();
}
function kbTarget(): HTMLElement | null {
    if (pickerInput && pickerInput.isConnected) return pickerInput; // (picker open: the sticks type its search)
    if (kbField && kbField.isConnected) return kbField;
    const a = document.activeElement as HTMLElement | null;
    return a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA") ? a : null;
}
/** Edit the box the way its editor listens. Discord's message boxes (Slate) keep their own copy of the text and only
 *  hear `beforeinput`; execCommand changes what's drawn but not that copy, so Enter would send an empty message.
 *  Plain fields (search, settings) don't handle beforeinput, so they get execCommand. */
function kbEdit(f: HTMLElement, inputType: "insertText" | "deleteContentBackward", data?: string) {
    if (document.activeElement !== f) f.focus();
    if (f.isContentEditable) {
        const ev = new InputEvent("beforeinput", { inputType, data: data ?? null, bubbles: true, cancelable: true, composed: true });
        f.dispatchEvent(ev);
        if (ev.defaultPrevented) return;
    }
    document.execCommand(inputType === "insertText" ? "insertText" : "delete", false, data);
}
function kbInsert(text: string) {
    const f = kbTarget();
    if (f) kbEdit(f, "insertText", text);
}
function kbMoveCaret(step: 1 | -1) {
    const f = kbTarget();
    if (!f) return;
    setTimeout(scheduleSuggestions, 0); // (the preview's cursor follows)
    if (document.activeElement !== f) f.focus();
    if (f.tagName === "INPUT" || f.tagName === "TEXTAREA") {
        const i = f as HTMLInputElement;
        const p = Math.max(0, Math.min(i.value.length, (i.selectionStart ?? 0) + step));
        i.setSelectionRange(p, p);
        return;
    }
    const sel = window.getSelection();
    if (!sel) return;
    // make sure the caret is inside the box first (end of the text if it isn't)
    if (!sel.anchorNode || !f.contains(sel.anchorNode)) {
        const r = document.createRange();
        r.selectNodeContents(f); r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
    }
    const before = sel.anchorNode ? `${sel.anchorOffset}` + (sel.anchorNode.textContent ?? "").length : "";
    (sel as any).modify?.("move", step > 0 ? "forward" : "backward", "character");
    // tell the editor the caret moved (Discord's editor keeps its own copy of it)
    document.dispatchEvent(new Event("selectionchange"));
    if (sel.anchorNode && `${sel.anchorOffset}` + (sel.anchorNode.textContent ?? "").length === before) {
        // the browser didn't move it: let the editor do it with an arrow key
        f.dispatchEvent(keyEvent("keydown", step > 0 ? "ArrowRight" : "ArrowLeft"));
        f.dispatchEvent(keyEvent("keyup", step > 0 ? "ArrowRight" : "ArrowLeft"));
    }
}

/** Send the message. Tries, in order, stopping as soon as the box empties (= sent):
 *  1) an "Enter" the way Discord's editor really receives it (a beforeinput "new paragraph"),
 *  2) an Enter key press, 3) Discord's Send button, 4) sending the text directly through Discord, then clearing the box. */
function kbSend(target: HTMLElement | null = kbTarget()) {
    const f = target;
    if (!f) return;
    if (document.activeElement !== f) f.focus();
    const isField = f.tagName === "INPUT" || f.tagName === "TEXTAREA";
    const raw = () => (isField ? (f as HTMLInputElement).value : (f.innerText ?? f.textContent ?? "")).replace(/\uFEFF/g, "");
    const text = () => raw().trim();
    const original = text();
    const originalRaw = raw();
    const uploads = () => [...(f.closest("form")?.querySelectorAll('[data-list-item-id^="attachments___"]') ?? [])];
    const hasAttachments = uploads().length > 0;
    if (!original && !hasAttachments) return;
    const sent = () => !f.isConnected || (text() === "" && (!hasAttachments || uploads().length === 0)); // Discord empties the box when a message goes out
    const inPopout = !!f.closest('[role="dialog"]') || !f.closest('[class*="baseLayer"]') && !!f.closest('[class*="layer_"]');
    // a search box (or any box that isn't a message box): Enter is all ☰ does — its text must never go out as a message
    const isMessageBox = f.matches('[role="textbox"]') && !f.matches('[role="combobox"]') && !!f.closest('form, [role="dialog"]');
    if (!isMessageBox) {
        for (const type of ["keydown", "keypress", "keyup"]) f.dispatchEvent(keyEvent(type, "Enter"));
        debugNote("☰ → enter (not a message box)");
        if (f.matches('[role="combobox"]')) setTimeout(() => { stopTyping(); enterSearchResults(); }, 250);
        return;
    }
    // select everything, let the editor pick up the selection (it listens to selectionchange), then delete it
    const clearBox = () => {
        f.focus(); document.execCommand("selectAll"); document.dispatchEvent(new Event("selectionchange"));
        setTimeout(() => f.isConnected && kbEdit(f, "deleteContentBackward"), 150);
    };
    // a try that only added a new line: take that line back out
    const restore = () => { if (f.isConnected && text() === original && raw() !== originalRaw) kbEdit(f, "deleteContentBackward"); };
    const enterKey: [string, () => void] = ["enter (key)", () => { for (const type of ["keydown", "keypress", "keyup"]) f.dispatchEvent(keyEvent(type, "Enter")); }];
    const enterInput: [string, () => void] = ["enter (beforeinput)", () => {
        f.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertParagraph", bubbles: true, cancelable: true, composed: true }));
    }];
    const sendButton: [string, () => void] = ["send button", () => {
        const btn = [...document.querySelectorAll('[aria-label="Send Message"], [aria-label="Send"]')].find(b => isVisible(b) && (!inPopout || f.closest('[role="dialog"]')?.contains(b))) as HTMLElement | undefined;
        btn?.click();
    }];
    const direct: [string, () => void] = ["direct", () => {
        if (isField || !MessageActions?.sendMessage) return;
        const go = (channelId: string) => {
            MessageActions.sendMessage(channelId, { content: original, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
            clearBox();
        };
        // never from a profile card: guessing the user from its avatars can pick a mutual friend (cards show theirs too)
        if (inPopout) return;
        const c = SelectedChannelStore.getChannelId();
        if (c) go(c);
    }];
    // Enter first: with the text really in the editor, Discord's own Enter handler sends (checked live on the channel box
    // and on a profile card, where it goes to that person's DM). A card gets no direct send (see `direct`).
    const steps = hasAttachments ? [enterKey] : inPopout ? [enterKey, sendButton] : [enterKey, enterInput, sendButton, direct];
    const run = (i: number) => {
        if (i >= steps.length) { restore(); debugNote("send: nothing worked"); return; }
        steps[i][1]();
        const t0 = performance.now();
        const check = () => {
            if (sent()) {
                debugNote(`send: ${steps[i][0]}`);
                // leftovers like an empty new line after sending: clear them
                setTimeout(() => { if (f.isConnected && text() === "" && raw().length > 0) clearBox(); scheduleSuggestions(); }, 250);
                scheduleSuggestions(); // (the keyboard's message preview and suggestions start over)
                if (isMessageBox) {
                    showSentCard(original);
                    if (!inPopout) setTimeout(() => { const sc = chatScroller(); sc?.scrollTo({ top: sc.scrollHeight }); }, 300);
                }
                return;
            }
            if (performance.now() - t0 < 450) return void setTimeout(check, 40);
            restore();     // undo a stray new line before trying the next way
            run(i + 1);
        };
        setTimeout(check, 40);
    };
    run(0);
}
function kbPress(key: Key) {
    const f = kbTarget();
    switch (key.act) {
        case "shift": kbShift = !kbShift; break;
        case "sym": kbSym = !kbSym; kbCol = Math.min(kbCol, kbLayout()[kbRow].length - 1); break;
        case "back": if (f) kbEdit(f, "deleteContentBackward"); kbFeedback("del"); break;
        case "space": kbInsert(" "); kbFeedback("space"); break;
        case "left": kbMoveCaret(-1); break;
        case "right": kbMoveCaret(1); break;
        case "enter": kbSend(); break;
        case "close": stopTyping(); break;
        default:
            if (key.text) {
                kbInsert(kbLabel(key));
                if (kbShift) kbShift = false;
            }
    }
    renderKeyboard();
    if (!key.act && key.text) kbFeedback("key");
}
function kbMove(dir: Dir) {
    const rows = kbLayout();
    if (dir === "left" || dir === "right") {
        const n = rows[kbRow].length;
        kbCol = (kbCol + (dir === "right" ? 1 : -1) + n) % n;
    } else {
        // keep roughly the same horizontal spot when changing rows
        const keyEls = kbEl?.querySelectorAll<HTMLElement>(`.hh-kb-row:nth-child(${kbRow + 1}) .hh-key`);
        const cur = keyEls?.[kbCol]?.getBoundingClientRect();
        const nr = (kbRow + (dir === "down" ? 1 : -1) + rows.length) % rows.length;
        const nextEls = [...(kbEl?.querySelectorAll<HTMLElement>(`.hh-kb-row:nth-child(${nr + 1}) .hh-key`) ?? [])];
        if (cur && nextEls.length) {
            const cx = cur.left + cur.width / 2;
            let best = 0, bd = Infinity;
            nextEls.forEach((el, i) => { const r = el.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - cx); if (d < bd) { bd = d; best = i; } });
            kbCol = best;
        } else kbCol = Math.min(kbCol, rows[nr].length - 1);
        kbRow = nr;
    }
    renderKeyboard();
}
function openKeyboard(field: Element | null) {
    if (!opt("onScreenKeyboard")) return;
    kbField = (field as HTMLElement) ?? null;
    if (kbEl) return;
    kbEl = document.createElement("div");
    kbEl.className = kbStyle() === "wheel" ? "hh-kb hh-kb-wheel" : "hh-kb";
    let h = Math.round(window.innerHeight * opt("keyboardHeight") / 100);
    kbEl.style.height = `${h}px`;
    markMenuStyle();
    kbEl.innerHTML = `<div class="hh-brand">${brandHtml}</div><div class="hh-kb-hints">${kbHints()}</div><div class="hh-sugg"></div><div class="hh-kb-bar"></div><div class="hh-kb-keys"></div>`;
    // touch: tap keys directly (without stealing focus from the text box)
    kbEl.addEventListener("pointerdown", e => { if (!(e.target as Element).closest(".hh-brand a")) e.preventDefault(); });
    kbEl.addEventListener("mousedown", e => { if (!(e.target as Element).closest(".hh-brand a")) e.preventDefault(); });
    kbEl.addEventListener("click", e => {
        if ((e.target as Element).closest(".hh-kb-toggle")) return kbToggleSplit();
        const cr = (e.target as Element).closest<HTMLElement>(".hh-clip-row");
        if (cr) return clipPaste(Number(cr.dataset.c));
        const pt = (e.target as Element).closest<HTMLElement>(".hh-pk-t");
        if (pt) { pkSel = Number(pt.dataset.i); return pkPick(); }
        const tab = (e.target as Element).closest<HTMLElement>(".hh-pk-tab");
        if (tab) { const all = [...tab.parentElement!.children]; const on = all.findIndex(t => t.classList.contains("on")); return pkSwitchTab(all.indexOf(tab) > on ? 1 : -1); }
        const cb = (e.target as Element).closest<HTMLElement>(".hh-cbtn");
        if (cb) return pressComposerButton(Number(cb.dataset.a));
        const chip = (e.target as Element).closest<HTMLElement>(".hh-sugg-chip, .hh-sugg-row");
        if (chip) return acceptSuggestion(Number(chip.dataset.i));
        // split / wheel: each key carries its character
        const chEl = (e.target as Element).closest<HTMLElement>("[data-ch]");
        if (chEl) return kbTypeChar(chEl.dataset.ch!);
        const el = (e.target as Element).closest<HTMLElement>(".hh-key");
        if (!el) return;
        kbRow = Number(el.dataset.r); kbCol = Number(el.dataset.c);
        kbPress(kbLayout()[kbRow][kbCol]);
    });
    document.body.append(kbEl);
    const kb = kbEl;
    requestAnimationFrame(() => { // touch the real screen edges
        const r = kb.getBoundingClientRect();
        if (r.right < window.innerWidth - 1) kb.style.right = `${Math.round(r.right - window.innerWidth)}px`;
        if (r.left > 1) kb.style.left = `${-Math.round(r.left)}px`;
        if (r.bottom < window.innerHeight - 1) kb.style.bottom = `${Math.round(r.bottom - window.innerHeight)}px`;
    });
    learnFromChannel();
    suggestions = []; suggIndex = 0;
    scheduleSuggestions();
    kbRow = 1; kbCol = 0; kbShift = false; kbSym = false; wheelPetal = null; splitPos = [[1, 2], [1, 2]]; splitPending[0] = splitPending[1] = null; splitTyped[0] = splitTyped[1] = true; splitADown = false; // (always open on letters)
    kbOverComposer = !!kbComposer();
    kbActionIdx = -1; // (set to the box's buttons below, once they're drawn, if that's the setting)
    renderKeyboard();
    if (kbOverComposer && opt("keyboardChatOnly")) setChatOnly(true, false); // (first: the layout follows where the box ends up)
    if (kbOverComposer && opt("keyboardStartOn") !== "keys") kbActionIdx = 0; // start on the box's buttons (B / ▼: the keys)
    if (kbOverComposer) h = layoutKbSide();
    if (kbStyle() === "split") setTimeout(maybeAskCalibration, 150);
    // the channel's message box: the keyboard covers it (its text shows on the keyboard instead), and the app moves up
    // only by the rest — so the chat stays visible right down to the keyboard. Anything else: make room for all of it.
    const composer = kbComposer();
    kbOverComposer = !!composer;
    // (measured from where the chat's own scroll area ends, not the box's height: themes add space in between,
    //  which used to leave the newest message hidden under the keyboard)
    const sb = chatScroller()?.getBoundingClientRect().bottom, ct = composer?.getBoundingClientRect().top;
    const chatBottom = sb !== undefined && ct !== undefined ? Math.min(sb, ct) : sb ?? ct;
    const below = chatBottom ? window.innerHeight - chatBottom : composer?.getBoundingClientRect().height ?? 0;
    shiftState.bottom = composer ? Math.max(0, Math.round(h - below)) : h;
    kbEl.classList.toggle("hh-kb-over", kbOverComposer);
    // (the keyboard shows who's typing itself: Discord's own line above the box would be a second one)
    if (kbOverComposer) document.documentElement.setAttribute("data-hh-kb-box", "");
    if (kbOverComposer && opt("keyboardHideTitle")) {
        // (marked here, not found with CSS :has(), which would make the browser re-check the page on every change)
        const bar = document.querySelector('[class*="base_"] > [class*="bar_"]');
        if (bar) { bar.setAttribute("data-hh-titlebar", ""); bar.parentElement!.setAttribute("data-hh-titlegrid", ""); }
        document.documentElement.setAttribute("data-hh-kb-notitle", "");
    }
    if (kbOverComposer && opt("keyboardSlimHeader")) {
        // the chat's header: the box at the top of the chat column, above its messages (whatever the theme calls it)
        const head = kbComposer()?.closest('[class*="chat_"]')?.querySelector('section[class*="title_"], section');
        if (head) { head.setAttribute("data-hh-slimhead", ""); document.documentElement.setAttribute("data-hh-kb-slimhead", ""); }
    }
    applyShift();
    // keep the box you're typing in visible above the keyboard
    if (!composer) setTimeout(() => kbField?.isConnected && kbField.scrollIntoView({ block: "nearest" }), 80);
    else if (replyTargetEl()) keepReplyInView();
    else { const sc = chatScroller(); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80) setTimeout(() => sc.scrollTo({ top: sc.scrollHeight }), 220); }
    liftPopout(h);
}

/** The keyboard's top bar, laid out like Discord's own message box (which the keyboard covers): its buttons on the
 *  left and right (copied from the real ones, whatever they are), "Replying to…" above and "… is typing" below.
 *  Pressing one of those buttons puts the keyboard away and presses the real one (GIF / emoji / sticker pickers…). */
let kbActionIdx = -1;
function composerButtons(): { left: HTMLElement[]; right: HTMLElement[]; } {
    const f = kbField, form = f?.closest("form");
    if (!f || !form) return { left: [], right: [] };
    // (only the typing row's buttons: the "Replying to…" strip above it is shown on the keyboard as text)
    const row = f.closest<HTMLElement>('[class*="scrollableContainer"]') ?? form;
    const btns = [...row.querySelectorAll<HTMLElement>('button, [role="button"]')]
        .filter(b => !b.contains(f) && !b.closest('[role="textbox"]') && b.getClientRects().length && !/cancel|close/i.test(b.getAttribute("aria-label") ?? "")
            && !b.parentElement?.closest('button, [role="button"]'));
    const before = (b: Element) => !!(b.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { left: btns.filter(before), right: btns.filter(b => !before(b)) };
}
function renderComposerBar() {
    const bar = kbEl?.querySelector<HTMLElement>(".hh-kb-bar");
    if (!bar) return;
    bar.hidden = !kbOverComposer;
    if (!kbOverComposer) { bar.innerHTML = ""; return; }
    const { left, right } = composerButtons();
    let n = 0;
    // everything is placed exactly where it is in the real box (same x, width, height, button spots, text size)
    const box = composerBox();
    const bx = bar.getBoundingClientRect(), tb = kbField?.getBoundingClientRect();
    const barH = Math.round(Math.min(box?.height ?? 40, 40)); // (slimmer than Discord's box: more room for the chat)
    // our own clipboard button, at the very end (the real right-hand buttons move over for it)
    const lastR = right[right.length - 1]?.getBoundingClientRect();
    const clipBtn = () => {
        const pad = box && lastR ? box.right - lastR.right : 12, h = Math.min(32, barH - 4);
        return `<div class="hh-cbtn hh-clipbtn ${kbActionIdx === n ? "sel" : ""} ${clipOpen ? "on" : ""}" data-a="${n++}" title="Clipboard" style="right:${pad}px;top:${Math.round((barH - h) / 2)}px;width:32px;height:${h}px">${CLIP_SVG}</div>`;
    };
    const btn = (b: HTMLElement, fromRight: boolean) => {
        const label = b.getAttribute("aria-label") ?? "";
        // (some icons are sprites, not svgs — the emoji button: draw a plain smiley instead)
        const icon = b.querySelector("svg, img")?.outerHTML ?? (/emoji/i.test(label) ? SMILEY_SVG : `<span>${label.slice(0, 1) || "•"}</span>`);
        const r = b.getBoundingClientRect(), y = Math.round((barH - Math.min(r.height, barH - 4)) / 2);
        const x = !box ? "" : fromRight ? `right:${box.right - r.right + CLIP_W}px` : `left:${r.left - box.left}px`;
        return `<div class="hh-cbtn ${kbActionIdx === n ? "sel" : ""}" data-a="${n++}" title="${label.replace(/"/g, "&quot;")}" style="${x};top:${y}px;width:${r.width}px;height:${Math.min(r.height, barH - 4)}px">${icon}</div>`;
    };
    // (with the lists hidden the real box starts further left than the bar can: then the bar starts at the Controls
    //  column and its left buttons / text keep their distance from its left edge, the right buttons from its right edge)
    const x0 = box ? Math.max(box.left, bx.left) : 0;
    const geo = box ? `margin-left:${x0 - bx.left}px;width:${box.right - x0}px;height:${barH}px` : "";
    const tx = box && tb ? `left:${tb.left - box.left}px;right:${box.right - tb.right + CLIP_W}px;font-size:${getComputedStyle(kbField!).fontSize};font-weight:${getComputedStyle(kbField!).fontWeight};line-height:${barH - 2}px` : "";
    bar.innerHTML = `<div class="hh-meta-line" style="${box ? `margin-left:${x0 - bx.left + (tb ? Math.max(0, tb.left - box.left + 4) : 0)}px` : ""}"><span class="hh-reply-line" hidden></span><span class="hh-typing-line"></span></div>
        <div class="hh-cbox" style="${geo}">${left.map(b => btn(b, false)).join("")}<div class="hh-preview hh-preview-bar" style="${tx}"></div>${right.map(b => btn(b, true)).join("")}${clipBtn()}</div>`;
    const repo = kbEl?.querySelector<HTMLElement>(".hh-brand a");
    composerBtnEls = [...left, ...right, CLIP_BTN, ...(repo ? [repo] : [])];
    repo?.toggleAttribute("data-hh-brand-selected", kbActionIdx === composerBtnEls.length - 1);
    kbEl!.classList.toggle("hh-lock-box", kbActionIdx >= 0); // L3: locked onto the box's buttons, not the keys
    scheduleSuggestions(); // (the line above the box says what the buttons do)
    scheduleSuggestions();
}
/** Replying: the message you're answering, if it's loaded. */
function replyTargetEl(): HTMLElement | null {
    try {
        const pr = (findStore("PendingReplyStore") as any)?.getPendingReply?.(SelectedChannelStore.getChannelId());
        return pr?.message?.id ? document.getElementById(`chat-messages-${pr.channel?.id ?? SelectedChannelStore.getChannelId()}-${pr.message.id}`) : null;
    } catch { return null; }
}
/** The chat shrinks for the keyboard (and Discord keeps its bottom pinned), which pushed the message you're replying to
 *  off the top: bring it back just above the keyboard once the layout has settled — never jump to the newest. */
function keepReplyInView() {
    const fix = () => {
        const el = replyTargetEl(), sc = chatScroller();
        if (!el || !sc || !kbEl) return;
        const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
        if (r.top >= b.top + 4 && r.bottom <= b.bottom - 4) return; // already in view
        sc.scrollTop += r.height > b.height ? r.top - b.top - 8 : r.bottom - (b.bottom - 12);
    };
    for (const t of [120, 260, 450]) setTimeout(fix, t);
}
/** The real message box's outline (the keyboard copies its place and size). */
function composerBox(): DOMRect | undefined {
    const form = kbComposer();
    // (the typing row itself: while replying, Discord's box also holds the "Replying to…" strip on top)
    return (kbField?.closest<HTMLElement>('[class*="scrollableContainer"]') ?? form?.querySelector<HTMLElement>('[class*="channelTextArea"]')
        ?? form?.firstElementChild as HTMLElement | null)?.getBoundingClientRect();
}
/** Keyboard over the message box: the Controls fill the space left of the box (where the channel list is), the box
 *  copy sits where the real one is with "… is typing" above it, and the keys go under it. Returns the keyboard height. */
const KB_SIDE_MIN = 395; // the Controls column is never narrower than this
function layoutKbSide(): number {
    const kb = kbEl!, box = composerBox();
    // lists showing: Controls in a column left of the box. Lists hidden (big chat): the box runs the whole width
    // where the real one is, with Controls · keys · suggestions in a row under it.
    const side = (box?.left ?? 0) >= KB_SIDE_MIN;
    kb.classList.toggle("hh-kb-side", side);
    kb.classList.add("hh-kb-over-box");
    setVar(kb, "--hh-bx", `${Math.round(side ? box!.left : Math.max(8, box?.left ?? 8))}px`);
    setVar(kb, "--hh-br", `${Math.round(Math.max(8, window.innerWidth - (box?.right ?? window.innerWidth)))}px`);
    renderComposerBar();
    const bar = kb.querySelector<HTMLElement>(".hh-kb-bar")!, cs = getComputedStyle(bar), ks = getComputedStyle(kb);
    // the setting is the whole keyboard's height; the keys get what the box row leaves (never squashed below 100px)
    const top = parseFloat(ks.paddingTop) + parseFloat(ks.paddingBottom) + bar.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    const h = Math.round(Math.max(window.innerHeight * opt("keyboardHeight") / 100, top + 100));
    kb.style.height = `${h}px`;
    return h;
}
function setVar(el: HTMLElement, k: string, v: string) { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); }

/** "Chat only" (R3 on the keyboard): hides the server and channel lists while typing, so the chat gets the whole width.
 *  On by default (setting "keyboardChatOnly", which R3 flips); the lists come back whenever the keyboard closes. */
function setChatOnly(on: boolean, remember = true) {
    if (remember) settings.store.keyboardChatOnly = on;
    for (const e of document.querySelectorAll("[data-hh-hide]")) e.removeAttribute("data-hh-hide");
    const chat = kbComposer();
    if (on && chat) {
        // each list's outermost box that isn't also around the chat
        for (const l of document.querySelectorAll(`${listSel("guildsnav")}, ${listSel("channels")}, [data-list-id^="private-channels"], [data-hh-list^="private-channels"]`)) {
            let p = l as HTMLElement;
            while (p.parentElement && p.parentElement !== document.body && !p.parentElement.contains(chat)) p = p.parentElement;
            if (p.parentElement && p.parentElement !== document.body && !p.contains(chat)) p.setAttribute("data-hh-hide", "");
        }
    }
    if (kbEl) requestAnimationFrame(() => requestAnimationFrame(() => { if (kbEl && kbOverComposer) layoutKbSide(); }));
}
const SMILEY_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" stroke-linecap="round"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/></svg>`;
let composerBtnEls: HTMLElement[] = [];
// ---------- clipboard (📋 at the end of the keyboard's box) ----------
// The Controls panel turns into a list of what you've copied (newest first): ▲▼ choose, A pastes it where the cursor is.
// Whatever's on the clipboard is added each time the list opens, and copying inside Discord adds to it too.
const CLIP_KEY = "hh-clip-v1";
const CLIP_W = 40;
const CLIP_BTN = document.createElement("div");
CLIP_BTN.setAttribute("aria-label", "Clipboard");
const CLIP_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 10h6M9 14h6M9 18h3" stroke-linecap="round"/></svg>`;
let clipHist: string[] = [];
let clipOpen = false, clipSel = 0, clipSaveTimer = 0;
async function loadClip() { try { const v = await DataStore.get(CLIP_KEY); if (Array.isArray(v)) clipHist = v.filter(x => typeof x === "string"); } catch { } }
function saveClip() { clearTimeout(clipSaveTimer); clipSaveTimer = window.setTimeout(() => void DataStore.set(CLIP_KEY, clipHist), 800); }
function clipAdd(t: string | null | undefined) {
    const v = (t ?? "").replace(/\uFEFF/g, "").trim();
    if (!v || v.length > 4000) return;
    clipHist = [v, ...clipHist.filter(x => x !== v)].slice(0, 25);
    saveClip();
}
async function readClipboard() { try { clipAdd(await navigator.clipboard.readText()); } catch { } }
/** Everything Discord copies (Copy Text / Link / ID…) goes through this: noted on the way. */
let clipWriteOrig: ((t: string) => Promise<void>) | null = null;
function hookClipboardWrites(on: boolean) {
    const cb = navigator.clipboard as any;
    if (!cb) return;
    if (on && !clipWriteOrig) { clipWriteOrig = cb.writeText.bind(cb); cb.writeText = (t: string) => { clipAdd(t); return clipWriteOrig!(t); }; }
    if (!on && clipWriteOrig) { cb.writeText = clipWriteOrig; clipWriteOrig = null; }
}
const onCopy = () => { const sel = window.getSelection()?.toString(); setTimeout(() => { void readClipboard().then(() => { if (sel) clipAdd(sel); }); }, 60); };
function toggleClip(on = !clipOpen) {
    if (!kbEl) return;
    clipOpen = on;
    if (on) {
        kbActionIdx = -1; clipSel = 0;
        void readClipboard().then(() => { if (clipOpen) { renderKeyboard(); renderComposerBar(); } });
    } else kbActionIdx = composerBtnEls.indexOf(CLIP_BTN); // (back on the 📋 button)
    renderKeyboard(); renderComposerBar();
}
function clipPanelHtml(): string {
    return `<div class="hh-side hh-side-l hh-clip"><div class="hh-side-label">Clipboard</div><div class="hh-clip-list">${clipListHtml()}</div></div>`;
}
function clipListHtml(): string {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return clipHist.length ? clipHist.map((t, i) => `<div class="hh-clip-row ${i === clipSel ? "sel" : ""}" data-c="${i}">${esc(t.replace(/\s+/g, " ").slice(0, 140))}</div>`).join("")
        : `<div class="hh-sugg-empty">Nothing copied yet — copy some text (or a link) and it shows up here</div>`;
}
function renderClipList() {
    const l = kbEl?.querySelector<HTMLElement>(".hh-clip-list");
    if (!l) return;
    l.innerHTML = clipListHtml();
    const r = l.querySelector<HTMLElement>(".hh-clip-row.sel");
    if (r) { if (r.offsetTop < l.scrollTop) l.scrollTop = r.offsetTop; else if (r.offsetTop + r.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = r.offsetTop + r.offsetHeight - l.clientHeight; }
}
function clipPaste(i: number) {
    const t = clipHist[i];
    if (!t) return;
    kbField?.focus();
    kbInsert(t);
    clipAdd(t); // (moves it to the top)
    clipOpen = false; kbActionIdx = -1; // (back on the keys, to keep typing)
    renderKeyboard(); renderComposerBar();
}
/** Clipboard list controls; returns true while it's open (nothing else gets the press). */
function handleClip(dirFire: Dir | null, jp: (b: Btn) => boolean): boolean {
    if (!clipOpen) return false;
    const n = clipHist.length;
    if (n && (dirFire === "up" || dirFire === "down")) { clipSel = Math.max(0, Math.min(n - 1, clipSel + (dirFire === "down" ? 1 : -1))); renderClipList(); }
    if (jp(Btn.A)) clipPaste(clipSel);
    if (jp(Btn.X) && n) { clipHist.splice(clipSel, 1); clipSel = Math.min(clipSel, clipHist.length - 1); saveClip(); renderClipList(); }
    if (jp(Btn.B)) toggleClip(false);
    return true;
}

/** B on the keys steps back to the box's buttons (when there are any); B there closes the keyboard. */
function kbBack() {
    if (kbOverComposer && composerBtnEls.length && kbActionIdx < 0) { kbActionIdx = 0; renderComposerBar(); return; }
    backOutOfTyping();
}
function pressComposerButton(i: number) {
    const real = composerBtnEls[i];
    if (real === CLIP_BTN) return toggleClip(true);
    if (!real?.isConnected) return;
    if (real.matches(".hh-brand a")) { real.click(); return; }
    kbActionIdx = -1;
    // GIF / sticker / emoji: their picker opens above the keyboard, which stays up to search it
    if (/\bgifs?\b|sticker|emoji/i.test(real.getAttribute("aria-label") ?? "")) { renderComposerBar(); return openPicker(real); }
    stopTyping(); // (anything else opens its own pop-out, navigated like any other)
    setTimeout(() => real.click(), 60);
}

// ---------- GIF / sticker / emoji picker, inside the keyboard ----------
// The keyboard turns into our own picker panel (same size, same look): tabs on top, the results as a grid. Discord's
// real picker stays open but invisible (it still loads the results, and picking presses its real item); we copy what
// it shows into the grid. Y searches (the clocks come back to type), LB / RB switch tabs, A picks, B goes back.
let pickerLayer: HTMLElement | null = null;
let pickerInput: HTMLElement | null = null;
let pickerOpener: HTMLElement | null = null;
let pickerSearch = false;
type PkItem = { el: HTMLElement; key: string; html: string; };
let pkItems: PkItem[] = [];
let pkSel = 0;
let pkSig = "";
const PICKER_LAYER = '[class*="expressionPickerPosition"]';
const PICKER_RESULTS = '[role="gridcell"], [class*="result_"][role="button"]';
/** Native picker tiles own their nested favorite buttons and media. Select/highlight the whole tile. */
function expressionTile(el: Element): HTMLElement | null {
    const tile = el.closest<HTMLElement>(PICKER_RESULTS);
    return tile?.closest(PICKER_LAYER) ? tile : null;
}
function nativeExpressionPicker(): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>(PICKER_LAYER)]
        .find(layer => !layer.hasAttribute("data-hh-picker") && isVisible(layer)) ?? null;
}
let nativePickerLock: { results: boolean; index: number; } | null = null;
function nativeExpressionResults(layer: HTMLElement): HTMLElement[] {
    return [...layer.querySelectorAll<HTMLElement>(PICKER_RESULTS)].filter(el => isVisible(el) && !isDisabled(el));
}
function keepNativeExpressionFocus(layer: HTMLElement) {
    nativePickerLock ??= { results: false, index: 0 };
    section = layer.querySelector('[role="dialog"]') ?? layer;
    mode = "inside";
    if (alive(focused) && layer.contains(focused) && (!nativePickerLock.results || !!expressionTile(focused))) return;
    if (nativePickerLock.results) {
        const results = nativeExpressionResults(layer);
        const next = results[Math.min(nativePickerLock.index, Math.max(0, results.length - 1))];
        setItem(next ?? null); // loading is still inside this picker; never restore the composer
    } else {
        setItem(layer.querySelector('[role="tab"][aria-selected="true"]') ?? itemsOnTop(section)[0] ?? null);
    }
}
function handleNativeExpressionPicker(layer: HTMLElement, dir: Dir | null, jp: (b: Btn) => boolean, pressed: boolean[], pad: Gamepad) {
    keepNativeExpressionFocus(layer);
    const lock = nativePickerLock!;
    if (dir) {
        const tile = focused && expressionTile(focused);
        const sc = tile && scrollableAncestor(tile);
        const earlier = tile && nearestInDirection(tile, nativeExpressionResults(layer), "up");
        // Scroll back through virtualized rows before crossing into the header at the real top.
        if (dir === "up" && sc && sc.scrollTop > 2 && !earlier)
            sc.scrollBy({ top: -Math.max(80, sc.clientHeight * 0.4), behavior: "auto" });
        else moveInWindow(section!, dir); // freely move across grid, server rail, search and tabs; no outside hop
    }
    if (jp(Btn.A) && focused && layer.contains(focused)) {
        const tile = expressionTile(focused);
        if (tile) { lock.results = true; lock.index = 0; }
        if (focused.matches(TEXT_ENTRY)) startTyping(focused);
        else {
            // Native server/category items can be listitems. Do not run the generic post-click
            // textbox fallback, which would grab the composer behind the picker.
            const target = tile?.matches('[role="gridcell"]') ? tile.querySelector<HTMLElement>('button, [role="button"]') ?? tile : focused;
            (target as HTMLElement).click();
        }
        if (tile) setTimeout(() => { const current = nativeExpressionPicker(); if (current && nativePickerLock) keepNativeExpressionFocus(current); }, 120);
    }
    if (jp(Btn.Y)) { lock.results = false; setItem(layer.querySelector('[role="tab"][aria-selected="true"]')); }
    if (jp(Btn.X)) pressX();
    if (jp(Btn.LB)) switchExpressionTab(layer, -1);
    if (jp(Btn.RB)) switchExpressionTab(layer, 1);
    if (held(Btn.LT, pressed)) scrollExpressionPicker(layer, -1);
    if (held(Btn.RT, pressed)) scrollExpressionPicker(layer, 1);
    const ry = pad.axes[3] ?? 0;
    if (Math.abs(ry) > settings.store.stickDeadzone * 0.6) {
        const sc = scrollableAncestor(layer.querySelector(PICKER_RESULTS));
        if (sc && layer.contains(sc)) sc.scrollTop += ry * settings.store.scrollSpeed;
    }
    if (jp(Btn.B)) {
        const back = expressionBackButton(layer);
        if (back) {
            back.click();
            lock.results = false; lock.index = 0;
            setItem(layer.querySelector('[role="tab"][aria-selected="true"]'));
            bumpChecks();
            return;
        }
        const tab = layer.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";
        const kind = /sticker/i.test(tab) ? /sticker/i : /emoji/i.test(tab) ? /emoji/i : /\bgifs?\b/i;
        const opener = [...document.querySelectorAll<HTMLElement>('form button, form [role="button"]')].find(button => kind.test(button.getAttribute("aria-label") ?? ""));
        if (opener) opener.click(); else closeWindow();
        if (!nativeExpressionPicker()) nativePickerLock = null;
        bumpChecks();
    }
}
function expressionBackButton(layer: HTMLElement): HTMLElement | undefined {
    return [...layer.querySelectorAll<HTMLElement>('button, [role="button"]')]
        .find(button => /^(back|go back)$/i.test(button.getAttribute("aria-label") ?? "") && isVisible(button));
}
function switchExpressionTab(layer: HTMLElement, step: 1 | -1) {
    const tabs = [...layer.querySelectorAll<HTMLElement>('[role="tab"]')].filter(isVisible);
    if (!tabs.length) return;
    const at = tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true");
    const next = tabs[(Math.max(0, at) + step + tabs.length) % tabs.length];
    next.click();
    if (nativePickerLock) { nativePickerLock.results = false; nativePickerLock.index = 0; }
    section = layer.querySelector('[role="dialog"]') ?? layer; mode = "inside";
    setItem(next); bumpChecks();
}
function scrollExpressionPicker(layer: HTMLElement, step: 1 | -1) {
    const item = focused && expressionTile(focused) && layer.contains(focused) ? focused : layer.querySelector(PICKER_RESULTS);
    const sc = scrollableAncestor(item);
    if (sc && layer.contains(sc)) sc.scrollBy({ top: step * Math.max(80, sc.clientHeight * 0.6), behavior: "auto" });
}
function openPicker(real: HTMLElement) {
    pickerOpener = real;
    real.click();
    let tries = 0;
    const wait = () => {
        const layer = document.querySelector<HTMLElement>(PICKER_LAYER);
        if (!layer) { if (++tries < 20) setTimeout(wait, 50); return; }
        pickerLayer = layer;
        layer.setAttribute("data-hh-picker", "");
        document.documentElement.setAttribute("data-hh-picker-on", "");
        pickerInput = layer.querySelector<HTMLElement>("input");
        pickerSearch = false; pkItems = []; pkSel = 0; pkSig = "";
        kbEl?.classList.add("hh-kb-picking");
        renderKeyboard();
        setTimeout(() => { pkRefresh(true); scheduleSuggestions(); }, 150);
    };
    wait();
}
function closePicker(escape = true) {
    // (pressing its button again closes it — Escape in the search box only clears the search)
    if (escape && pickerLayer?.isConnected) {
        if (pickerOpener?.isConnected) pickerOpener.click();
        else { const t = pickerInput ?? document.body; t.dispatchEvent(keyEvent("keydown", "Escape")); t.dispatchEvent(keyEvent("keyup", "Escape")); }
    }
    pickerOpener = null;
    pickerLayer?.removeAttribute("data-hh-picker");
    kbEl?.classList.remove("hh-kb-picking");
    document.documentElement.removeAttribute("data-hh-picker-on");
    pickerLayer = pickerInput = null; pickerSearch = false; pkItems = []; pkSig = "";
    if (kbEl) { kbField?.focus(); renderKeyboard(); scheduleSuggestions(); }
}
const pkEsc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
function pkTab(): string { return pickerLayer?.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? ""; }
/** What Discord's picker is showing right now, as our tiles. */
function pkCollect(): PkItem[] {
    if (!pickerLayer) return [];
    const all = [...pickerLayer.querySelectorAll<HTMLElement>(PICKER_RESULTS)].filter(e => e.getClientRects().length);
    const els = all.filter(e => !all.some(o => o !== e && e.contains(o)));
    return els.map((el, i) => {
        const media = el.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
        const src = media ? (media as any).currentSrc || media.getAttribute("src") || "" : "";
        const label = (el.getAttribute("aria-label") || el.querySelector("[aria-label]")?.getAttribute("aria-label") || el.textContent || "").trim();
        const text = el.matches('[class*="result_"]') ? (el.textContent ?? "").trim() : "";
        const sur = el.querySelector("[data-surrogates]")?.getAttribute("data-surrogates");
        const pic = sur && !el.querySelector("img") ? `<span class="hh-pk-emo">${pkEsc(sur)}</span>` // (Discord draws these from a sprite sheet)
            : !src ? `<span class="hh-pk-name">${pkEsc(label.replace(/^Sticker,\s*/, "").split(",")[0])}</span>`
            : media!.tagName === "VIDEO" ? `<video src="${pkEsc(src)}" autoplay muted loop playsinline></video>` : `<img src="${pkEsc(src)}" alt="">`;
        return { el, key: src || label || String(i), html: `${pic}${text ? `<span class="hh-pk-label">${pkEsc(text)}</span>` : ""}` };
    });
}
/** Copy the picker's results into our grid (only redrawn when they change), keeping the same one selected. */
function pkRefresh(reset = false) {
    if (!kbEl || !pickerLayer) return;
    const items = pkCollect();
    const sig = pkTab() + "|" + items.map(i => i.key).join("|");
    if (sig === pkSig && !reset) { pkItems = items; return; }
    const keepKey = !reset ? pkItems[pkSel]?.key : undefined;
    pkItems = items; pkSig = sig;
    const at = keepKey ? items.findIndex(i => i.key === keepKey) : -1;
    pkSel = at >= 0 ? at : Math.min(reset ? 0 : pkSel, Math.max(0, items.length - 1));
    const grid = kbEl.querySelector<HTMLElement>(".hh-pk-grid");
    if (!grid) return;
    grid.className = `hh-pk-grid hh-pk-${pkTab().toLowerCase().replace(/[^a-z]/g, "") || "x"}`;
    grid.innerHTML = items.length ? items.map((it, i) => `<div class="hh-pk-t ${i === pkSel ? "sel" : ""}" data-i="${i}">${it.html}</div>`).join("")
        : `<div class="hh-pk-empty">${pickerSearch ? "Nothing found" : "Loading…"}</div>`;
    const tabs = kbEl.querySelector(".hh-pk-tabs-list");
    if (tabs) {
        const t = [...pickerLayer.querySelectorAll('[role="tab"]')].map(tb => `<span class="hh-pk-tab ${tb.getAttribute("aria-selected") === "true" ? "on" : ""}">${pkEsc(tb.textContent?.trim() ?? "")}</span>`).join("");
        if (tabs.innerHTML !== t) tabs.innerHTML = t;
    }
    pkShowSel();
}
function pkShowSel() {
    const grid = kbEl?.querySelector(".hh-pk-grid");
    if (!grid) return;
    for (const t of grid.querySelectorAll(".hh-pk-t.sel")) t.classList.remove("sel");
    const el = grid.querySelector<HTMLElement>(`.hh-pk-t[data-i="${pkSel}"]`);
    el?.classList.add("sel");
    // (only the grid scrolls: scrollIntoView would also shift the keyboard itself)
    if (el) {
        const g = grid as HTMLElement, gr = g.getBoundingClientRect(), r = el.getBoundingClientRect();
        if (r.top < gr.top) g.scrollTop -= gr.top - r.top + 4;
        else if (r.bottom > gr.bottom) g.scrollTop += r.bottom - gr.bottom + 4;
    }
    if (kbEl && (kbEl.scrollTop || kbEl.scrollLeft)) { kbEl.scrollTop = 0; kbEl.scrollLeft = 0; }
}
/** Discord's results list (to load more as you go further down). */
function pkScroller(): HTMLElement | null {
    const first = pickerLayer?.querySelector(PICKER_RESULTS);
    for (let n = first?.parentElement; n && n !== pickerLayer; n = n.parentElement)
        if (n.scrollHeight > n.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
    return null;
}
function pkMove(dir: Dir) {
    const grid = kbEl?.querySelector(".hh-pk-grid");
    const tiles = [...(grid?.querySelectorAll<HTMLElement>(".hh-pk-t") ?? [])];
    const cur = tiles[pkSel];
    if (!cur) return;
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = Infinity, next = -1;
    tiles.forEach((e, i) => {
        if (i === pkSel) return;
        const b = e.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
        const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
        const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
        if (along <= 4) return;
        const score = along + across * 2.5;
        if (score < best) { best = score; next = i; }
    });
    const sc = pkScroller();
    if (next < 0) {
        // at the end of what's loaded: have Discord load more (it only draws what's on screen)
        if (sc && (dir === "down" || dir === "up")) { sc.scrollTop += (dir === "down" ? 1 : -1) * sc.clientHeight * 0.6; setTimeout(() => pkRefresh(), 180); }
        return;
    }
    pkSel = next;
    pkShowSel();
    // getting near the end: load the next part early
    if (sc && dir === "down" && pkSel >= tiles.length - 8) { sc.scrollTop += sc.clientHeight * 0.5; setTimeout(() => pkRefresh(), 180); }
}
function pkPick() {
    const it = pkItems[pkSel];
    if (!it?.el.isConnected) return pkRefresh(true);
    // GIF results contain an Add to Favorites button; picking the GIF must click the tile itself.
    (it.el.matches('[role="button"]') ? it.el : it.el.querySelector<HTMLElement>("button, [role='button']") ?? it.el).click();
    // a category (GIF "Trending" / a search term): new results, start at the top of them
    setTimeout(() => { if (pickerLayer?.isConnected) pkRefresh(true); }, 300);
}
function pkSwitchTab(step: 1 | -1) {
    const tabs = [...(pickerLayer?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = tabs.findIndex(t => t.getAttribute("aria-selected") === "true");
    tabs[(at + step + tabs.length) % tabs.length]?.click();
    setTimeout(() => { pickerInput = pickerLayer?.querySelector("input") ?? null; pkRefresh(true); scheduleSuggestions(); }, 250);
}
/** Our picker panel, in place of the keys (in search mode: beside the two clocks, which type the search). */
function pickerPanelHtml() {
    return `<div class="hh-pk"><div class="hh-pk-tabs">${badgeHtml("LB")}<span class="hh-pk-tabs-list"></span>${badgeHtml("RB")}</div><div class="hh-pk-grid"></div></div>`;
}
/** Picker controls while it's open; returns true when it handled the press (the sticks only type in search mode). */
let pkJustSearched = false;
function handlePicker(jp: (b: Btn) => boolean, pressed: boolean[]): boolean {
    pkJustSearched = false;
    if (!pickerLayer) return false;
    if (!pickerLayer.isConnected) { closePicker(false); return false; } // (picked something / closed by Discord)
    if (frame % 12 === 0) pkRefresh();
    const d: Dir | null = held(Btn.Up, pressed) ? "up" : held(Btn.Down, pressed) ? "down" : held(Btn.Left, pressed) ? "left" : held(Btn.Right, pressed) ? "right" : null;
    if (d) pkMove(d);
    if (jp(Btn.A)) pkPick();
    if (!pickerSearch) {
        if (jp(Btn.LB)) pkSwitchTab(-1);
        if (jp(Btn.RB)) pkSwitchTab(1);
        if (jp(Btn.Y)) { pickerSearch = true; pkJustSearched = true; kbSym = false; pickerInput?.focus(); renderKeyboard(); setTimeout(() => pkRefresh(true), 60); }
        if (jp(Btn.B)) {
            const back = expressionBackButton(pickerLayer);
            if (back) { back.click(); setTimeout(() => pkRefresh(true), 150); }
            else closePicker();
        }
    } else if (jp(Btn.B)) { pickerSearch = false; renderKeyboard(); setTimeout(() => pkRefresh(true), 60); }
    return true;
}
function typingText(): string {
    try {
        const cid = SelectedChannelStore.getChannelId(), me = UserStore.getCurrentUser()?.id;
        const users = Object.keys((findStore("TypingStore") as any)?.getTypingUsers?.(cid) ?? {}).filter(id => id !== me);
        if (!users.length) return "";
        const name = (id: string) => { const u = UserStore.getUser(id) as any; return `<b>${(u?.globalName || u?.username || "Someone").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</b>`; };
        return users.length === 1 ? `${name(users[0])} is typing…` : users.length === 2 ? `${name(users[0])} and ${name(users[1])} are typing…` : "<b>Several people</b> are typing…";
    } catch { return ""; }
}
const onTyping = () => { if (kbEl) scheduleSuggestions(); };

/** The channel's own message box area (the whole bar at the bottom of the chat), if that's what you're typing in. */
let kbOverComposer = false;
function kbComposer(): HTMLElement | null {
    const f = kbField;
    if (!f || f.closest('[role="dialog"]') || f.matches('[role="combobox"]') || f.closest(ROW.message)) return null;
    const form = f.closest("form");
    return form && form.closest('[class*="baseLayer"]') ? form as HTMLElement : null;
}

/** Pop-outs (profile cards…) float above the app, so shrinking the app doesn't move them: lift them over the keyboard. */
let lifted: HTMLElement | null = null;
function liftPopout(kbHeight: number) {
    dropPopout();
    const f = kbField;
    if (!f) return;
    const pop = (f.closest('[role="dialog"]') ?? f.closest('[class*="layer_"]:not([class*="baseLayer"])')) as HTMLElement | null;
    if (!pop || pop.closest('[class*="baseLayer"]')) return;
    const kbTop = window.innerHeight - kbHeight;
    const pr = pop.getBoundingClientRect(), fr = f.getBoundingClientRect();
    const needField = fr.bottom - (kbTop - 16);          // the box itself must clear the keyboard
    const needAll = pr.bottom - (kbTop - 12);             // ideally the whole card does
    const room = pr.top - 8;                              // but don't push it off the top
    const lift = Math.max(needField, Math.min(needAll, room));
    if (lift <= 0) return;
    pop.style.transition = "translate 180ms cubic-bezier(.2,.8,.2,1)";
    pop.style.translate = `0 ${-Math.round(lift)}px`;
    lifted = pop;
}
function dropPopout() {
    if (!lifted) return;
    lifted.style.translate = "";
    lifted = null;
}
function closeKeyboard() {
    releaseAutocomplete();
    if (!kbEl) return;
    const el = kbEl;
    if (pickerLayer) closePicker();
    clipOpen = false;
    if (document.querySelector("[data-hh-hide]")) setChatOnly(false, false);
    document.documentElement.removeAttribute("data-hh-kb-box");
    document.documentElement.removeAttribute("data-hh-kb-notitle");
    document.documentElement.removeAttribute("data-hh-kb-slimhead");
    kbEl = null; kbField = null;
    el.classList.add("hh-kb-out");
    setTimeout(() => el.remove(), 180);
    shiftState.bottom = 0;
    applyShift();
    dropPopout();
}
/** Hold-to-repeat for keyboard buttons: fires on press, then (after a short wait) repeatedly, speeding up the longer you hold. */
const holdState = new Map<Btn, { since: number; last: number; }>();
function held(b: Btn, pressed: boolean[]): boolean {
    const now = performance.now();
    if (!pressed[b]) { holdState.delete(b); return false; }
    const st = holdState.get(b);
    if (!st) { holdState.set(b, { since: now, last: now }); return !prevPressed[b]; } // (a press still held from before the keyboard opened doesn't type)
    const heldFor = now - st.since;
    if (heldFor < 380) return false;
    const rate = heldFor > 1400 ? 30 : heldFor > 800 ? 55 : 85;
    if (now - st.last < rate) return false;
    st.last = now;
    return true;
}

function kbFlashSend() {
    const keys = [...(kbEl?.querySelectorAll<HTMLElement>(".hh-key") ?? [])];
    const send = keys.find(k => k.textContent?.includes("Send"));
    if (!send) return;
    send.classList.add("hh-key-flash");
    setTimeout(() => send.classList.remove("hh-key-flash"), 220);
}

function handleKeyboard(dirFire: Dir | null, jp: (b: Btn) => boolean, pressed: boolean[], pad: Gamepad) {
    if (discordSuggestions.length && jp(Btn.B)) {
        const editor = kbTarget();
        if (editor) pressKey("Escape", editor);
        releaseAutocomplete(); scheduleSuggestions();
        return;
    }
    // a GIF / sticker / emoji picker is open: the D-pad, A and B are its; the sticks still type (its search)
    if (pickerLayer && handlePicker(jp, pressed)) {
        if (!pickerSearch || pkJustSearched) return; // (the Y that started searching isn't also "123")
        const mine = [Btn.Up, Btn.Down, Btn.Left, Btn.Right, Btn.A, Btn.B, Btn.Menu, Btn.X, Btn.L3, Btn.R3, Btn.View];
        const jp2 = (b: Btn) => !mine.includes(b) && jp(b);
        const pressed2 = pressed.map((p, i) => p && !mine.includes(i));
        if (kbStyle() === "split") handleSplit(pad, jp2, pressed2);
        else if (held(Btn.LB, pressed)) kbPress({ label: "⌫", act: "back" });
        return;
    }
    if (handleClip(dirFire, jp)) return;
    // the same in every style: ☰ sends, B is done (the wheel uses B for a letter while a group is picked)
    if (jp(Btn.Menu)) { kbFlashSend(); debugNote("☰ → send"); kbSend(); }
    if (jp(Btn.View)) return kbToggleSplit();
    if (kbOverComposer && composerBtnEls.length) {
        if (jp(Btn.L3)) { kbActionIdx = kbActionIdx < 0 ? 0 : -1; renderComposerBar(); return; }
        if (kbActionIdx >= 0) {
            if (dirFire === "left" || dirFire === "right") { kbActionIdx = (kbActionIdx + (dirFire === "right" ? 1 : -1) + composerBtnEls.length) % composerBtnEls.length; renderComposerBar(); }
            if (dirFire === "up" || dirFire === "down") { kbActionIdx = -1; renderComposerBar(); } // (back down to the keys)
            if (jp(Btn.A)) pressComposerButton(kbActionIdx);
            if (jp(Btn.B)) { kbActionIdx = -1; backOutOfTyping(); } // (B on the box: done — closes the keyboard)
            return;
        }
    }
    if (jp(Btn.R3) && kbStyle() === "wheel") acceptSuggestion(0);
    if (jp(Btn.R3) && kbStyle() !== "wheel" && kbOverComposer) { setChatOnly(!opt("keyboardChatOnly")); return; }
    if (kbStyle() === "split") { handleSplit(pad, jp, pressed); if (jp(Btn.B)) kbBack(); return; }
    if (kbStyle() === "wheel") return handleWheel(pad, jp, pressed);
    if (kbStyle() === "grid") { handleGrid2(pad, jp, pressed); if (jp(Btn.B)) kbBack(); return; }
    if (dirFire) kbMove(dirFire);
    if (held(Btn.A, pressed)) kbPress(kbLayout()[kbRow][kbCol]);
    if (held(Btn.X, pressed)) kbPress({ label: "⌫", act: "back" });
    if (held(Btn.Y, pressed)) kbPress({ label: "space", act: "space" });
    if (held(Btn.LB, pressed)) kbMoveCaret(-1);
    if (held(Btn.RB, pressed)) kbMoveCaret(1);
    if (jp(Btn.LT)) { kbCaps = !kbCaps; kbShift = false; renderKeyboard(); }
    if (jp(Btn.RT)) { kbSym = !kbSym; renderKeyboard(); }
    if (jp(Btn.B)) kbBack();
}

const CSS_EXTRA = `
/* ---- making room ---- */
html[data-hh-shift="shrink"] [class*="layers_"] > [class*="baseLayer"],
html[data-hh-shift="shrink"] #app-mount [class*="baseLayer"]:not([class*="layers_"] > *) {
  left: var(--hh-shift-l, 0px) !important; right: var(--hh-shift-r, 0px) !important; bottom: var(--hh-shift-b, 0px) !important;
  width: auto !important; height: auto !important;
}
/* things a theme pins to the screen edge move over with the app (no gap left behind) */
html[data-hh-shift="shrink"] [data-hh-pinned="r"] { transform: translateX(calc(-1 * var(--hh-shift-r, 0px))) !important; }
html[data-hh-shift="shrink"] [data-hh-pinned="l"] { transform: translateX(var(--hh-shift-l, 0px)) !important; }
html[data-hh-shift="shrink"] [data-hh-pinned] { bottom: calc(var(--dplus-spacing-app, 0px) + var(--hh-shift-b, 0px)) !important; }
html[data-hh-shift="slide"] [data-hh-pinned] {
  transform: translate(calc(var(--hh-shift-l, 0px) - var(--hh-shift-r, 0px)), calc(-1 * var(--hh-shift-b, 0px))) !important;
}
html[data-hh-shift="slide"] [class*="layers_"] > [class*="baseLayer"] {
  transform: translate(calc(var(--hh-shift-l, 0px) - var(--hh-shift-r, 0px)), calc(-1 * var(--hh-shift-b, 0px))) !important;
  transition: transform 170ms cubic-bezier(.2,.8,.2,1);
}

/* ---- side-drawer menus (beats any theme's menu placement) ---- */
:root[data-hh-drawer-on] [data-hh-unclip] { overflow: visible !important; contain: none !important; clip-path: none !important; }
:root[data-hh-drawer-on] [data-hh-drawer][data-hh-drawer]:is(#hh-never, *) {
  position: fixed !important; top: calc(0px - var(--hh-dn-t, 0px)) !important; bottom: calc(0px - var(--hh-dn-b, 0px)) !important; height: auto !important;
  width: var(--hh-dw) !important; max-width: var(--hh-dw) !important; transform: none !important; margin: 0 !important;
  z-index: 1002 !important; display: flex !important; flex-direction: column !important;
  /* Discord's menu positioning hides the menu when what you held moves (the app shrinks for the drawer): it's ours now */
  visibility: visible !important;
  background: var(--background-floating, #111214); box-shadow: 0 0 48px rgb(0 0 0 / .55);
}
:root[data-hh-drawer-on] [data-hh-drawer="left"][data-hh-drawer]:is(#hh-never, *) { left: calc(0px - var(--hh-dn-l, 0px)) !important; right: auto !important; }
:root[data-hh-drawer-on] [data-hh-drawer="right"][data-hh-drawer]:is(#hh-never, *) { right: calc(0px - var(--hh-dn-r, 0px)) !important; left: auto !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) > *:is(#hh-never, *) { max-height: 100vh !important; height: 100% !important; width: 100% !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"]:is(#hh-never, *) {
  width: 100% !important; max-width: none !important; min-width: 0 !important; height: 100% !important; max-height: 100vh !important;
  border-radius: 0 !important; box-sizing: border-box !important; overflow-y: auto !important; padding-top: 10px !important;
  background: var(--background-floating, #111214) !important; /* solid: a sub-menu opens beside the drawer, over the app */
  animation: hh-drawer-in-right 170ms cubic-bezier(.2,.8,.2,1);
}
:root[data-hh-drawer-on] [data-hh-drawer="left"] [role="menu"]:is(#hh-never, *) { animation-name: hh-drawer-in-left; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [class*="scroller"]:is(#hh-never, *) { max-height: none !important; height: auto !important; }
/* clean list: one option per row, all the same height, groups split by a thin line, quick reactions in one row on top */
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-groups]:is(#hh-never, *) {
  display: flex !important; flex-direction: column !important; gap: 0 !important; padding: 6px 8px 16px !important;
  grid-template-columns: none !important; background: transparent !important;
}
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [role="group"]:is(#hh-never, *) {
  display: flex !important; flex-direction: column !important; gap: 8px !important;
  padding: 10px 0 !important; margin: 0 !important; border-bottom: 1px solid rgb(255 255 255 / .07) !important;
}
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [role="group"]:last-child:is(#hh-never, *) { border-bottom: 0 !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji-row]:is(#hh-never, *) {
  flex-direction: row !important; flex-wrap: wrap !important; gap: 8px !important; order: -10 !important;
}
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji-row] > *:not([data-hh-emoji]):is(#hh-never, *) { flex: 1 1 100% !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji]:is(#hh-never, *) {
  flex: 1 1 calc(50% - 4px) !important; min-width: 0 !important; justify-content: center !important; padding: 0 !important;
  min-height: 76px !important; background: rgb(255 255 255 / .07) !important; border-radius: 16px !important;
}
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji] img:is(#hh-never, *) { width: 38px !important; height: 38px !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] :is([role="separator"], [class*="separator_"]):is(#hh-never, *) { display: none !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]):is(#hh-never, *) {
  min-height: 64px !important; height: auto !important; width: auto !important; margin: 0 !important; box-sizing: border-box !important;
  display: flex !important; align-items: center !important; padding: 0 18px !important; border-radius: 14px !important;
  font-size: 17px !important; font-weight: 600 !important; background: rgb(255 255 255 / .05); gap: 14px !important;
}
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]) svg:is(#hh-never, *) { width: 24px !important; height: 24px !important; flex: none !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]) *:is(#hh-never, *) {
  white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
}
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] > *:is(#hh-never, *) { background: transparent !important; }
/* a row with a volume slider: label on top, the slider full width below it (one line would crush the slider) */
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menuitem"][data-hh-slideritem]:is(#hh-never, *) {
  flex-direction: column !important; align-items: stretch !important; justify-content: center !important;
  gap: 8px !important; padding: 12px 18px !important; min-height: 88px !important;
}
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menuitem"][data-hh-slideritem] *:is(#hh-never, *) { overflow: visible !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menuitem"] [data-hh-sliderwrap]:is(#hh-never, *) { width: 100% !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menuitem"] [role="slider"]:is(#hh-never, *) { width: 100% !important; }
/* the things you do most come first in their group */
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [id$="-reply"]:is(#hh-never, *) { order: -3 !important; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [id$="-edit"]:is(#hh-never, *) { order: -2 !important; }
/* ---- menu look: "blend" (default) sits between the plugin's big rows and Discord's own menus; "discord" is Discord's ---- */
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [role="group"]:is(#hh-never, *) {
  gap: 2px !important; padding: 6px 0 !important; border-bottom: 1px solid var(--background-modifier-accent, rgb(255 255 255 / .08)) !important; }
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]):is(#hh-never, *) {
  min-height: 48px !important; padding: 0 14px !important; border-radius: 8px !important; font-size: 16px !important; font-weight: 500 !important;
  background: transparent !important; gap: 12px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]) svg:is(#hh-never, *) { width: 20px !important; height: 20px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"])[data-hh-focus]:is(#hh-never, *) {
  background: var(--background-modifier-selected, rgb(78 80 88 / .6)) !important; color: var(--interactive-active, var(--text-strong, #fff)) !important;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / .75) !important; }
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji]:is(#hh-never, *) {
  flex: 1 1 calc(25% - 6px) !important; min-height: 56px !important; border-radius: 10px !important; background: rgb(255 255 255 / .05) !important; }
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji] img:is(#hh-never, *) { width: 30px !important; height: 30px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menuitem"][data-hh-slideritem]:is(#hh-never, *) { min-height: 72px !important; padding: 10px 14px !important; }
:root[data-hh-menu-style="blend"] .hh-ring.hh-menu { visibility: hidden; } /* (the row's own Discord-coloured highlight shows it) */
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji]:is(#hh-never, *) { background: var(--background-modifier-hover, rgb(255 255 255 / .05)) !important; }
:root[data-hh-drawer-on][data-hh-menu-style="blend"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji][data-hh-focus]:is(#hh-never, *) { box-shadow: inset 0 0 0 2px var(--hh-accent) !important; }

:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-groups]:is(#hh-never, *) { padding: 6px 8px 12px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [role="group"]:is(#hh-never, *) { gap: 0 !important; padding: 4px 0 !important;
  border-bottom: 1px solid var(--background-modifier-accent, rgb(255 255 255 / .08)) !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]):is(#hh-never, *) {
  min-height: 34px !important; padding: 6px 8px !important; border-radius: 4px !important; font-size: 14px !important; font-weight: 500 !important;
  background: transparent !important; gap: 8px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]) svg:is(#hh-never, *) { width: 18px !important; height: 18px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"])[data-hh-focus]:is(#hh-never, *) {
  background: var(--brand-500, #5865f2) !important; color: #fff !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"])[data-hh-focus] *:is(#hh-never, *) { color: #fff !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji]:is(#hh-never, *) {
  flex: 0 0 auto !important; min-height: 40px !important; min-width: 40px !important; border-radius: 8px !important; background: transparent !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji] img:is(#hh-never, *) { width: 24px !important; height: 24px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menuitem"][data-hh-slideritem]:is(#hh-never, *) { min-height: 60px !important; padding: 8px !important; }
:root[data-hh-menu-style="discord"] .hh-ring.hh-menu { visibility: hidden; }

/* "handheld": the keyboard's look — pure black, 1px #333 hairlines, crisp white, the selected row filled white */
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] [data-hh-drawer][data-hh-drawer]:is(#hh-never, *),
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"]:is(#hh-never, *) { background: #000 !important; box-shadow: none !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] [data-hh-drawer="left"][data-hh-drawer]:is(#hh-never, *) { border-right: 1px solid #333 !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] [data-hh-drawer="right"][data-hh-drawer]:is(#hh-never, *) { border-left: 1px solid #333 !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [role="group"]:is(#hh-never, *) { border-bottom-color: #222 !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]):is(#hh-never, *) {
  background: #0a0a0a !important; border: 1px solid #333 !important; border-radius: 10px !important; color: #ededed !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji]:is(#hh-never, *) { background: #0a0a0a !important; border: 1px solid #333 !important; border-radius: 10px !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"])[data-hh-focus]:is(#hh-never, *) {
  background: #ededed !important; border-color: #ededed !important; color: #000 !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] :is([data-hh-drawer], [data-hh-subdrawer]) :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"])[data-hh-focus] *:is(#hh-never, *) { color: #000 !important; }
:root[data-hh-menu-style="handheld"] .hh-ring.hh-menu { visibility: hidden; }
:root[data-hh-menu-style="handheld"] .hh-panel-card { background: #000; border: 1px solid #333; border-radius: 16px; box-shadow: 0 24px 60px rgb(0 0 0 / .6); }
:root[data-hh-menu-style="handheld"] .hh-prow { background: #0a0a0a; border: 1px solid #333; border-radius: 10px; color: #ededed; }
:root[data-hh-menu-style="handheld"] .hh-prow.sel { background: #ededed; border-color: #ededed; color: #000; }
:root[data-hh-menu-style="handheld"] .hh-prow.sel :is(.hh-choice, .hh-pslider-val, .hh-choice *) { color: #000 !important; }
:root[data-hh-menu-style="handheld"] .hh-prow.sel .hh-pslider-bar { background: rgb(0 0 0 / .15); }
:root[data-hh-menu-style="handheld"] .hh-prow.sel .hh-pslider-bar span { background: #000; }

/* clipboard list (in place of the Controls) */
.hh-clip { min-width: 0; }
.hh-clip-list { flex: 1 1 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; scrollbar-width: none; }
.hh-clip-row { flex: none; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--v-line); color: var(--v-fg); font: 500 12px var(--v-font);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.hh-clip-row.sel { background: var(--v-sel); border-color: var(--v-sel); color: var(--v-sel-fg); }
.hh-clipbtn.on { color: var(--v-fg); }
/* adjust mode: the slider / handle being changed */
[data-hh-adjust]:is(#hh-never, *) { outline: 3px solid var(--hh-accent) !important; outline-offset: 2px !important; } /* (outline only: moving it would break Discord's own layout) */
.hh-adjust-label { z-index: 100003; font-size: 12px; }
.hh-adjust-label b { color: var(--v-fg); font-weight: 700; }
/* button hints bar */
.hh-hints { position: fixed; z-index: 100001; display: flex; gap: 7px; align-items: center; padding: 2px 7px; border-radius: 6px; pointer-events: none;
  background: color-mix(in srgb, var(--v-bg) 88%, transparent); border: 1px solid var(--v-line); color: var(--v-fg); font: 500 10.5px var(--v-font);
  transition: opacity 200ms ease; backdrop-filter: blur(6px); }
.hh-hints.off { opacity: 0; }
.hh-hint { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.hh-hints.hh-hints-top { padding: 0 6px; z-index: 100002; overflow: hidden; box-sizing: border-box; }
[data-hh-title-shift] { justify-content: flex-start !important; padding-left: var(--hh-title-pad) !important; transition: padding-left 150ms ease; }
/* button colours: per controller, plain, or the highlight colour — everywhere (beats the keyboard's own plain badges) */
:root[data-hh-btns$=" brand"] .hh-face:is(#hh-never, *), :root[data-hh-btns$=" auto"] .hh-help .hh-face:is(#hh-never, *) { color: #fff !important; border-color: rgb(255 255 255 / .18) !important; }
:root[data-hh-btns$=" brand"]:is([data-hh-btns^="xbox"]) .hh-face-A:is(#hh-never, *) { background: #2fb344 !important; }
:root[data-hh-btns$=" brand"]:is([data-hh-btns^="xbox"]) .hh-face-B:is(#hh-never, *) { background: #d63939 !important; }
:root[data-hh-btns$=" brand"]:is([data-hh-btns^="xbox"]) .hh-face-X:is(#hh-never, *) { background: #2f7bd6 !important; }
:root[data-hh-btns$=" brand"]:is([data-hh-btns^="xbox"]) .hh-face-Y:is(#hh-never, *) { background: #e3a008 !important; color: #1d1d1d !important; }
:root[data-hh-btns^="playstation"] .hh-face:is(#hh-never, *) { background: #1f2024 !important; font-size: 15px; }
:root[data-hh-btns^="playstation"]:not([data-hh-btns$=" plain"]):not([data-hh-btns$=" accent"]) .hh-face-A.hh-face:is(#hh-never, *) { color: #7aa7f0 !important; }
:root[data-hh-btns^="playstation"]:not([data-hh-btns$=" plain"]):not([data-hh-btns$=" accent"]) .hh-face-B.hh-face:is(#hh-never, *) { color: #f0717c !important; }
:root[data-hh-btns^="playstation"]:not([data-hh-btns$=" plain"]):not([data-hh-btns$=" accent"]) .hh-face-X.hh-face:is(#hh-never, *) { color: #e597d2 !important; }
:root[data-hh-btns^="playstation"]:not([data-hh-btns$=" plain"]):not([data-hh-btns$=" accent"]) .hh-face-Y.hh-face:is(#hh-never, *) { color: #4fd1b0 !important; }
:root[data-hh-btns^="nintendo"] .hh-face:is(#hh-never, *) { background: #2c2d31 !important; color: #fff !important; }
:root[data-hh-btns$=" plain"] .hh-badge:is(#hh-never, *) { background: #1a1b1e !important; color: #ededed !important; border-color: #444 !important; }
:root[data-hh-btns$=" accent"] .hh-badge:is(#hh-never, *) { background: color-mix(in srgb, var(--hh-accent) 85%, #000) !important; color: #fff !important; border-color: var(--hh-accent) !important; }
.hh-hint > span:last-child { color: var(--v-dim); }
.hh-hints .hh-badge { transform: none; margin: 0; height: 18px; min-width: 18px; padding: 0 4px; font-size: 10px !important;
  background: var(--v-panel) !important; color: var(--v-fg) !important;
  border: 1px solid var(--v-line-2) !important; box-shadow: none !important; }
.hh-hints .hh-badge.hh-face { width: 18px; padding: 0; }
.hh-hints .hh-badge > svg { width: 12px; height: 12px; }
/* the keyboard in the Blend / Discord styles */
:root[data-hh-menu-style="blend"] :is(.hh-kb, .hh-hints) { --v-bg: var(--background-floating, var(--background-base-lowest, #111214));
  --v-panel: var(--background-modifier-hover, rgb(255 255 255 / .04)); --v-key: transparent;
  --v-line: var(--background-modifier-accent, rgb(255 255 255 / .1)); --v-line-2: var(--background-modifier-accent, rgb(255 255 255 / .14));
  --v-fg: var(--text-normal, var(--text-default, #dbdee1)); --v-mute: var(--text-muted, #949ba4); --v-dim: var(--text-muted, #949ba4);
  --v-sel: var(--header-primary, var(--text-strong, #f2f3f5)); --v-sel-fg: var(--background-floating, #111214); }
:root[data-hh-menu-style="discord"] :is(.hh-kb, .hh-hints) { --v-bg: var(--background-secondary, var(--background-base-lower, #2b2d31));
  --v-panel: var(--channeltextarea-background, var(--background-tertiary, #383a40)); --v-key: var(--background-modifier-accent, rgb(255 255 255 / .06));
  --v-line: transparent; --v-line-2: rgb(255 255 255 / .08);
  --v-fg: var(--text-normal, var(--text-default, #dbdee1)); --v-mute: var(--text-muted, #949ba4); --v-dim: var(--interactive-normal, #b5bac1);
  --v-sel: var(--brand-500, #5865f2); --v-sel-fg: #fff; --v-mono: var(--font-primary, "gg sans", sans-serif); --v-font: var(--font-primary, "gg sans", "Noto Sans", sans-serif); }
:root[data-hh-menu-style="discord"] .hh-kb.hh-kb-lay .hh-clock { background: rgb(0 0 0 / .12); }
:root[data-hh-menu-style="discord"] .hh-kb.hh-kb-lay :is(.hh-side-label, .hh-side-sub, .hh-brand) { letter-spacing: .02em; }

/* the plugin's own settings pop-up follows the same look */
:root[data-hh-menu-style="blend"] .hh-panel-rows { gap: 2px; }
:root[data-hh-menu-style="blend"] .hh-prow { background: transparent; border: 0; border-radius: 8px; padding: 10px 14px; }
:root[data-hh-menu-style="blend"] .hh-prow.sel { background: var(--background-modifier-selected, rgb(78 80 88 / .6)); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .75); }
:root[data-hh-menu-style="blend"] .hh-panel-card, :root[data-hh-menu-style="discord"] .hh-panel-card {
  background: var(--background-floating, var(--background-base-lowest, #111214)); border: 1px solid var(--border-subtle, rgb(255 255 255 / .08));
  border-radius: 12px; box-shadow: var(--shadow-high, 0 12px 40px rgb(0 0 0 / .5)); }
:root[data-hh-menu-style="blend"] .hh-panel-card .hh-help-title, :root[data-hh-menu-style="discord"] .hh-panel-card .hh-help-title { font-size: 22px; font-weight: 700; }
:root[data-hh-menu-style="blend"] .hh-prow-label { font-weight: 500; }
:root[data-hh-menu-style="discord"] .hh-panel-rows { gap: 0; }
:root[data-hh-menu-style="discord"] .hh-prow { background: transparent; border: 0; border-radius: 4px; padding: 6px 8px; min-height: 28px; }
:root[data-hh-menu-style="discord"] .hh-prow.sel { background: var(--brand-500, #5865f2); color: #fff; }
:root[data-hh-menu-style="discord"] .hh-prow.sel :is(.hh-choice, .hh-pslider-val, .hh-choice *) { color: #fff !important; }
:root[data-hh-menu-style="discord"] .hh-prow.sel .hh-pslider-bar span { background: #fff; }
:root[data-hh-menu-style="discord"] .hh-prow-label { font-size: 14px; font-weight: 500; }
/* the quick reactions show which one is selected in every style */
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji][data-hh-focus]:is(#hh-never, *) { background: #ededed !important; border-color: #ededed !important; }
:root[data-hh-drawer-on][data-hh-menu-style="discord"] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"] [data-hh-emoji][data-hh-focus]:is(#hh-never, *) { background: var(--brand-500, #5865f2) !important; }
/* the sub-menu column beside the drawer (and the drawer narrowed for it) */
:root[data-hh-drawer-on][data-hh-sub] [data-hh-drawer][data-hh-drawer]:is(#hh-never, *) { width: var(--hh-dws) !important; max-width: var(--hh-dws) !important; }
:root[data-hh-drawer-on] [data-hh-subdrawer][data-hh-subdrawer]:is(#hh-never, *) {
  position: fixed !important; top: 0 !important; bottom: 0 !important; height: auto !important; width: var(--hh-subw) !important; max-width: var(--hh-subw) !important;
  transform: none !important; margin: 0 !important; z-index: 1003 !important; display: flex !important; flex-direction: column !important; visibility: visible !important;
  background: var(--background-floating, #111214); box-shadow: 0 0 32px rgb(0 0 0 / .45); }
:root[data-hh-drawer-on] [data-hh-subdrawer="left"][data-hh-subdrawer]:is(#hh-never, *) { left: var(--hh-dws) !important; right: auto !important; }
:root[data-hh-drawer-on] [data-hh-subdrawer="right"][data-hh-subdrawer]:is(#hh-never, *) { right: var(--hh-dws) !important; left: auto !important; }
:root[data-hh-drawer-on] [data-hh-subdrawer] [role="menu"]:is(#hh-never, *) { animation: hh-fade-in 120ms ease-out !important; }
:root[data-hh-drawer-on] [data-hh-subdrawer] > *:is(#hh-never, *) { padding: 0 !important; box-sizing: border-box !important; }
:root[data-hh-drawer-on][data-hh-menu-style="handheld"] [data-hh-subdrawer][data-hh-subdrawer]:is(#hh-never, *) { background: #000 !important; box-shadow: none !important; border-left: 1px solid #333 !important; border-right: 1px solid #333 !important; }
@keyframes hh-drawer-in-right { from { transform: translateX(100%); } to { transform: none; } }
@keyframes hh-drawer-in-left { from { transform: translateX(-100%); } to { transform: none; } }

/* ---- controller settings panel ---- */
.hh-panel-card { width: min(720px, 94vw); max-height: 86vh; display: flex; flex-direction: column; }
.hh-panel-rows { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 4px 2px; }
.hh-prow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border-radius: 12px;
  background: rgb(255 255 255 / .03); border: 2px solid transparent; cursor: pointer; min-height: 30px; }
.hh-prow.sel { border-color: var(--hh-accent); background: color-mix(in srgb, var(--hh-accent) 10%, transparent); }
.hh-prow-label { font-size: 15px; font-weight: 600; }
.hh-cat-desc { font-size: 13px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hh-crumb { opacity: .6; font-weight: 600; }
.hh-switch { width: 46px; height: 26px; border-radius: 13px; background: rgb(255 255 255 / .18); position: relative; flex: none; transition: background 120ms; }
.hh-switch span { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform 120ms; }
.hh-switch.on { background: #23a55a; } .hh-switch.on span { transform: translateX(20px); }
.hh-choice { font-weight: 700; color: var(--hh-accent); white-space: nowrap; display: inline-flex; align-items: center; gap: 8px; }
.hh-swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgb(255 255 255 / .5); display: inline-block; }
.hh-pslider { display: flex; align-items: center; gap: 10px; flex: none; }
.hh-pslider-bar { width: 160px; height: 8px; border-radius: 4px; background: rgb(255 255 255 / .15); overflow: hidden; }
.hh-pslider-bar span { display: block; height: 100%; background: var(--hh-accent); }
.hh-pslider-val { min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; opacity: .85; }

/* ---- on-screen keyboard ---- */
.hh-kb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 100003; box-sizing: border-box; padding: 8px 10px 10px;
  display: flex; flex-direction: column; gap: 6px; background: var(--background-floating, #111214);
  border-top: 2px solid color-mix(in srgb, var(--hh-accent) 60%, transparent); box-shadow: 0 -10px 40px rgb(0 0 0 / .5);
  animation: hh-kb-in 180ms cubic-bezier(.2,.8,.2,1); touch-action: manipulation; user-select: none; }
.hh-kb.hh-kb-out { animation: hh-kb-out 170ms ease forwards; }
.hh-kb-hints { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px 8px; font-size: 12px; opacity: .8; color: var(--text-normal, #dbdee1); white-space: nowrap; overflow: hidden; flex: none; } /* one line: wrapping would squash the keys */
.hh-kb-hints .hh-badge { transform: scale(.8); margin: 0 -3px; }
.hh-kb-keys { flex: 1; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.hh-kb-row { flex: 1; display: flex; gap: 6px; min-height: 0; }
.hh-key { display: flex; align-items: center; justify-content: center; border-radius: 10px; min-width: 0;
  background: rgb(255 255 255 / .07); color: var(--text-normal, #dbdee1); font-size: clamp(14px, 2.6vh, 24px); font-weight: 600;
  border: 2px solid transparent; cursor: pointer; transition: background 60ms; }
.hh-key:active { background: rgb(255 255 255 / .2); }
.hh-key-act { background: rgb(255 255 255 / .12); font-size: clamp(12px, 2vh, 18px); }
.hh-key.hh-key-flash { background: #23a55a !important; color: #fff; }
.hh-key.on { background: color-mix(in srgb, var(--hh-accent) 45%, transparent); }
.hh-key.sel { border-color: var(--hh-kb-accent, var(--hh-accent)); background: color-mix(in srgb, var(--hh-kb-accent, var(--hh-accent)) 25%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--hh-kb-accent, var(--hh-accent)) 40%, transparent); }
/* split keyboard — styled like the side menus: Discord's own surfaces, soft rounded tiles, the accent ring for selection */
.hh-split { display: flex; justify-content: center; align-items: stretch; gap: 12px; height: 100%; }
.hh-split-half { flex: none; height: 100%; display: flex; align-items: center; }
.hh-split-tag { display: none; }
/* the clocks: the original layout, drawn as minimal outlines — a thin ring, an outlined inner circle (centre / half
   tilt), outlined keys, and the selected key outlined + lettered in its stick's colour (blue left, orange right) */
.hh-clock { --c: #f2f2f2; position: relative; height: 100%; aspect-ratio: 1; container-type: size; border-radius: 50%;
  background: radial-gradient(circle, transparent 0 32.6%, rgb(255 255 255 / .16) 32.8% 33.4%, transparent 33.6%);
  box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / .16); }
.hh-clock-r { --c: #f2f2f2; }
.hh-ticks, .hh-wedge { display: none; }
.hh-ckey { position: absolute; width: 18%; height: 18%; transform: translate(-50%, -50%); display: flex; align-items: center;
  justify-content: center; border-radius: 30%; background: transparent; border: 1.5px solid rgb(255 255 255 / .2);
  color: var(--text-normal, #dbdee1); font-weight: 600; font-size: 10.5cqh; cursor: pointer; box-sizing: border-box;
  transition: transform 80ms ease, border-color 80ms ease, color 80ms ease, background 80ms ease; }
.hh-ckey-inner { border-color: rgb(255 255 255 / .26); }
.hh-ckey-center { width: 15%; height: 15%; border-style: dashed; border-color: rgb(255 255 255 / .2); }
.hh-ckey.sel { border: 1.5px solid #fff; color: #0b0b0c; background: #f2f2f2; font-weight: 800; z-index: 2; }
/* side panels */
.hh-side { flex: 1 1 0; min-width: 230px; max-width: 400px; display: flex; flex-direction: column; gap: 6px; padding: 2px 6px; overflow: hidden; }
.hh-side-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted, #949ba4);
  display: flex; align-items: center; justify-content: space-between; }
.hh-side-sub { text-transform: none; letter-spacing: 0; font-weight: 500; display: flex; align-items: center; gap: 2px; }
.hh-side .hh-badge { transform: scale(.62); margin: -7px -6px; }
.hh-preview { flex: 1 1 auto; min-height: 40px; max-height: 50%; overflow: hidden; padding: 10px 14px; border-radius: 14px; background: rgb(255 255 255 / .05);
  font-size: 17px; font-weight: 600; line-height: 1.3; color: var(--header-primary, #f2f3f5); word-break: break-word; }
.hh-preview-ph { color: var(--text-muted, #949ba4); font-weight: 500; }
.hh-caret { display: inline-block; width: 2px; height: 1.1em; margin-left: 1px; vertical-align: -3px; background: var(--hh-kb-accent, var(--hh-accent));
  animation: hh-blink 1s steps(1) infinite; }
@keyframes hh-blink { 50% { opacity: 0; } }
.hh-legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 8px; font-size: 11.5px; color: var(--text-normal, #dbdee1); }
.hh-legend-row { display: flex; align-items: center; gap: 5px; white-space: nowrap; height: 24px; min-width: 0; }
.hh-legend-row span:last-child { overflow: hidden; text-overflow: ellipsis; }
.hh-legend-btn { flex: none; width: 22px; height: 24px; display: flex; align-items: center; justify-content: center; }
.hh-side .hh-legend-btn .hh-badge { transform: scale(.6); margin: -8px; }
.hh-sugg-list { display: flex; flex-direction: column; gap: 5px; min-height: 0; overflow-y: auto; }
[data-hh-autocomplete-mirror] { visibility: hidden !important; pointer-events: none !important; }
.hh-sugg-row { display: flex; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 14px; border-radius: 14px;
  background: transparent; border: 1.5px solid rgb(255 255 255 / .18); font-size: 17px; font-weight: 600; color: var(--text-normal, #dbdee1);
  cursor: pointer; box-sizing: border-box; }
.hh-sugg-row.sel { border: 1.5px solid #fff; background: #f2f2f2; color: #0b0b0c; }
.hh-sugg-empty { padding: 12px 14px; border-radius: 14px; border: 1.5px dashed rgb(255 255 255 / .14); color: var(--text-muted, #949ba4); font-size: 14px; }
.hh-side-foot { margin-top: auto; font-size: 13px; color: var(--text-muted, #949ba4); display: flex; align-items: center; gap: 4px; }
/* split mode: the panels carry the hints and suggestions, so the top rows go */
.hh-kb.hh-kb-lay .hh-kb-hints, .hh-kb.hh-kb-lay .hh-sugg { display: none; }
/* split keyboard: Vercel-like — pure black, 1px #333 hairlines, crisp white, small mono uppercase labels,
   <kbd>-style button hints, and a solid white "primary" selection */
/* the keyboard's colours (Handheld look); the Blend / Discord pop-up styles swap them, see below */
.hh-kb, .hh-hints { --v-bg: #000; --v-panel: #0a0a0a; --v-key: #000; --v-sel: #ededed; --v-sel-fg: #000; --v-dim: #a1a1a1;
  --v-line: #333; --v-line-2: #444; --v-fg: #ededed; --v-mute: #888; --v-font: "Geist", "Inter", -apple-system, "Segoe UI", system-ui, sans-serif; }
.hh-kb.hh-kb-lay {
  --v-mono: "Geist Mono", ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  font-family: var(--v-font);
  padding: 12px 16px; background: var(--v-bg) !important; border-top: 1px solid var(--v-line) !important; box-shadow: none !important; }
.hh-kb.hh-kb-lay .hh-badge { background: var(--v-panel) !important; color: var(--v-fg) !important; border: 1px solid var(--v-line-2) !important;
  border-bottom-width: 2px !important; box-shadow: none !important; border-radius: 5px !important; font-family: var(--v-mono) !important; font-weight: 500 !important; }
.hh-kb.hh-kb-lay .hh-side-label { color: var(--v-mute); font-family: var(--v-mono); font-weight: 500; font-size: 11px; letter-spacing: .08em; }
.hh-kb.hh-kb-lay .hh-legend { color: var(--v-fg); font-size: 13px; }
.hh-kb.hh-kb-lay .hh-legend-row span:last-child { color: var(--v-dim); }
.hh-kb.hh-kb-lay .hh-clock { box-shadow: inset 0 0 0 1px var(--v-line);
  background: radial-gradient(circle, transparent 0 32.8%, var(--v-line) 33% 33.3%, transparent 33.5%); }
.hh-kb.hh-kb-lay .hh-ckey { border: 1px solid var(--v-line); border-radius: 8px; color: var(--v-fg); font-weight: 500; background: var(--v-key); }
.hh-kb.hh-kb-lay .hh-ckey-inner { border-color: var(--v-line-2); }
.hh-kb.hh-kb-lay .hh-ckey-center { border: 1px dashed var(--v-line-2); background: transparent; }
.hh-kb.hh-kb-lay .hh-ckey.sel { background: var(--v-sel); border-color: var(--v-sel); color: var(--v-sel-fg); font-weight: 600; }
.hh-kb.hh-kb-lay .hh-sugg-row { border: 1px solid var(--v-line); border-radius: 8px; background: var(--v-key); color: var(--v-fg); font-weight: 500; font-size: 15px; min-height: 32px; }
.hh-kb.hh-kb-lay .hh-sugg-row.sel { background: var(--v-sel); border-color: var(--v-sel); color: var(--v-sel-fg); }
.hh-kb.hh-kb-lay .hh-sugg-row.sel .hh-badge { background: #fff !important; color: #000 !important; border-color: #bbb !important; }
.hh-kb.hh-kb-lay .hh-sugg-empty { border: 1px dashed var(--v-line); border-radius: 8px; color: var(--v-mute); font-family: var(--v-mono); font-size: 12px; }
.hh-kb.hh-kb-lay .hh-side-sub { color: var(--v-mute); font-family: var(--v-mono); font-size: 11px; }
.hh-side-r { padding-top: 18px; }
/* the held message (menu open) and the one you're replying to: outlined in the plugin's highlight colour */
li[id^="chat-messages-"][data-hh-held] > [class*="message_"]:is(#hh-never, *), li[id^="chat-messages-"][data-hh-replying] > [class*="message_"]:is(#hh-never, *),
[data-list-item-id^="channels___"][data-hh-held]:is(#hh-never, *) {
  outline: 3px solid var(--hh-accent) !important; outline-offset: -3px !important; }
[data-hh-heldring]:is(#hh-never, *) { outline: 3px solid var(--hh-accent) !important; outline-offset: 2px !important; border-radius: 6px; }
[data-hh-heldring="round"]:is(#hh-never, *) { border-radius: 16px !important; }
[data-list-item-id^="guildsnav___"][data-hh-held]:is(#hh-never, *) { outline: 3px solid var(--hh-accent) !important; outline-offset: 2px !important; border-radius: 16px !important; }
li[id^="chat-messages-"][data-hh-replying] > [class*="message_"]:is(#hh-never, *) { background: color-mix(in srgb, var(--hh-accent) 10%, transparent) !important; }
/* keyboard top bar: like Discord's message box */
.hh-kb-bar { flex: none; display: flex; flex-direction: column; gap: 3px; margin: 12px 0 6px; }
.hh-meta-line { display: flex; gap: 14px; align-items: baseline; min-height: 15px; overflow: hidden; white-space: nowrap; }
[data-hh-hide] { display: none !important; }
:root[data-hh-kb-box] form [class*="typing_"][class*="base_"] { visibility: hidden !important; }
:root[data-hh-probing] [role="menu"] { visibility: hidden !important; } /* (the test right-click's menu: never shown) */
/* the GIF / sticker / emoji picker over the chat, right above the keyboard */
:root[data-hh-picker-on] [data-hh-picker][data-hh-picker] { position: fixed !important; inset: 0 !important;
  width: auto !important; height: auto !important; transform: none !important; display: flex !important; opacity: 0 !important; pointer-events: none !important; }
/* our picker panel (in the keyboard) */
.hh-pk { flex: 1 1 0; min-width: 0; min-height: 0; width: 100%; display: flex; flex-direction: column; gap: 6px; }
.hh-split > .hh-pk, .hh-kb-keys > .hh-pk { position: relative !important; left: auto !important; top: auto !important; transform: none !important; height: 100%; flex: 1 1 auto; }
.hh-pk-tabs { flex: none; display: flex; align-items: center; gap: 6px; }
.hh-pk-tabs .hh-badge { transform: scale(.7); margin: -4px; }
.hh-pk-tabs-list { display: flex; gap: 4px; }
.hh-pk-tab { padding: 3px 12px; border-radius: 6px; border: 1px solid var(--v-line); color: var(--v-mute); font: 600 13px var(--v-font); }
.hh-pk-tab.on { background: var(--v-sel); border-color: var(--v-sel); color: var(--v-sel-fg); }
/* (a grid whose columns stretch to fill the row exactly: even edges on both sides, whatever the width) */
.hh-pk-grid { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; align-content: start; gap: 6px; padding: 2px;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); scrollbar-width: none; }
.hh-pk-grid.hh-pk-stickers { grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); }
.hh-pk-grid.hh-pk-emoji { grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 2px; }
.hh-pk-grid > .hh-pk-empty { grid-column: 1 / -1; }
.hh-pk-t { position: relative !important; left: auto !important; top: auto !important; transform: none !important; flex: none; border-radius: 8px; overflow: hidden; background: var(--v-panel); border: 1px solid var(--v-line);
  display: flex; align-items: center; justify-content: center; cursor: pointer; }
.hh-pk-t img, .hh-pk-t video { width: 100%; height: 100%; object-fit: cover; display: block; }
.hh-pk-t.sel { border-color: var(--hh-kb-accent, var(--hh-accent)); box-shadow: 0 0 0 2px var(--hh-kb-accent, var(--hh-accent)); }
.hh-pk-t { width: auto !important; }
.hh-pk-gifs .hh-pk-t { height: 88px; }
.hh-pk-stickers .hh-pk-t { height: 76px; }
.hh-pk-stickers .hh-pk-t img { object-fit: contain; }
.hh-pk-emoji .hh-pk-t { height: 40px; background: transparent; border-color: transparent; }
.hh-pk-emoji .hh-pk-t img { width: 28px; height: 28px; object-fit: contain; }
.hh-pk-label { position: absolute; inset: auto 0 0 0; padding: 3px 6px; font: 600 12px var(--v-font); color: #fff; background: linear-gradient(transparent, rgb(0 0 0 / .75)); text-align: center; }
.hh-pk-emo { font-size: 26px; line-height: 1; }
.hh-pk-name { font: 500 11px var(--v-font); color: var(--v-fg); padding: 4px; text-align: center; }
.hh-pk-empty { color: var(--v-mute); font: 500 13px var(--v-font); padding: 10px; }
/* the keyboard while the picker is docked in it: just the clocks (to search), the picker takes the rest */
.hh-kb.hh-kb-picking :is(.hh-side-l, .hh-side-r) { display: none !important; }
.hh-kb.hh-kb-picking :is(.hh-split, .hh-gridwrap) { justify-content: flex-start !important; }
:root[data-hh-picker-on] [data-hh-picker] :is([class*="positionContainer"], [class*="drawerSizingWrapper"], [class*="contentWrapper"]) {
  position: relative !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; inset: auto !important; transform: none !important; }
:root[data-hh-picker-on] [data-hh-picker] [class*="resizeHandle"] { display: none !important; }
:root[data-hh-picker-on] [data-hh-pick] { position: relative !important; border-radius: 8px !important;
  background-color: color-mix(in srgb, var(--hh-accent) 18%, transparent) !important; }
/* (drawn on top: GIF pictures would cover a normal outline) */
:root[data-hh-picker-on] [data-hh-pick]::after { content: ""; position: absolute; inset: 0; z-index: 10; pointer-events: none;
  border: 3px solid var(--hh-accent); border-radius: 8px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .4); }
/* keyboard up: Discord's top bar goes, and its row in the page grid with it (so the channel header moves to the top) */
:root[data-hh-kb-notitle] [data-hh-titlebar] { display: none !important; }
:root[data-hh-kb-slimhead] [data-hh-slimhead] { height: 24px !important; min-height: 0 !important; padding: 0 12px !important; justify-content: center !important; }
:root[data-hh-kb-slimhead] [data-hh-slimhead] > * { min-height: 0 !important; height: 24px !important; justify-content: center !important; }
/* only the name and description stay (the buttons can't be reached while typing anyway) */
:root[data-hh-kb-slimhead] [data-hh-slimhead] :is([class*="toolbar"], [class*="search"], [class*="channelIcon"], [class*="iconWrapper"]) { display: none !important; }
:root[data-hh-kb-slimhead] [data-hh-slimhead] [class*="upperContainer"] { justify-content: center !important; width: 100%; }
:root[data-hh-kb-slimhead] [data-hh-slimhead] [class*="children"] { flex: 0 1 auto !important; justify-content: center !important; min-width: 0; max-width: 100%; }
:root[data-hh-kb-slimhead] [data-hh-slimhead] :is(h1, h1 *, [class*="title"], [class*="title"] *) { font-size: 13px !important; line-height: 16px !important; }
:root[data-hh-kb-slimhead] [data-hh-slimhead] [class*="avatar"] { width: 16px !important; height: 16px !important; }
:root[data-hh-kb-slimhead] [data-hh-slimhead] [class*="topic"] { font-size: 12px !important; line-height: 16px !important; opacity: .7; }
:root[data-hh-kb-notitle] [data-hh-titlegrid] { grid-template-rows: [top] 0px [titleBarEnd] min-content [noticeEnd] 1fr [end] !important; }
.hh-kb.hh-lock-box .hh-cbox { border-color: var(--v-fg); }
.hh-kb.hh-lock-box :is(.hh-split-half, .hh-grid, .hh-side-r) { opacity: .35; transition: opacity 120ms; }
/* keyboard over the message box: Controls column on the left, box + keys on the right */
.hh-kb.hh-kb-lay.hh-kb-over-box { padding-left: var(--hh-bx); padding-right: var(--hh-br); }
/* the Controls list shrinks its rows to whatever height the keyboard has */
.hh-kb.hh-kb-over-box .hh-side-l { min-height: 0; container-type: size; }
.hh-kb.hh-kb-over-box .hh-legend { flex: 1 1 0; min-height: 0; grid-auto-rows: minmax(0, 1fr); overflow: hidden;
  font-size: clamp(10px, calc((100cqh - 24px) / 7 * .74), 14px) !important; }
.hh-kb.hh-kb-over-box .hh-legend-row { height: auto; min-height: 0; overflow: hidden; }
.hh-kb.hh-kb-over-box .hh-legend-btn { height: 100%; }
.hh-kb.hh-kb-lay.hh-kb-over-box { padding-top: 6px; }
.hh-kb.hh-kb-over-box .hh-kb-bar { margin-top: 0; }
.hh-kb.hh-kb-over-box .hh-meta-line { padding-right: 270px; min-height: 17px; } /* (shares its row with the brand label) */
/* big chat: suggestions under the start of the box (where your words are), keys in the middle, Controls on the right */
.hh-kb.hh-kb-over-box:not(.hh-kb-side) .hh-side-r { order: -1; padding: 0; flex: 0 1 260px; max-width: 260px; }
.hh-kb.hh-kb-over-box:not(.hh-kb-side) .hh-side-l { order: 5; padding-right: 0; flex: 0 1 390px; }
.hh-kb.hh-kb-over-box:not(.hh-kb-side) :is(.hh-split, .hh-gridwrap) { justify-content: flex-start; gap: 14px; }
.hh-kb.hh-kb-over-box:not(.hh-kb-side) .hh-side-l { margin-left: auto; }
.hh-kb.hh-kb-side .hh-side-l { position: absolute; left: 16px; top: 8px; bottom: 10px; width: calc(var(--hh-bx) - 36px); max-width: none; min-width: 0; padding: 0; }
.hh-kb.hh-kb-side .hh-split, .hh-kb.hh-kb-side .hh-gridwrap { justify-content: flex-start; gap: 10px; }
.hh-kb.hh-kb-side .hh-side-r { min-width: 140px; padding-top: 0; }
.hh-kb-bar[hidden] { display: none !important; }
.hh-cbox { position: relative; flex: none; box-sizing: border-box; border-radius: 8px; background: var(--v-panel); border: 1px solid var(--v-line); }
.hh-cbtn { position: absolute; display: flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--v-dim); cursor: pointer; }
.hh-cbtn svg, .hh-cbtn img { width: 20px !important; height: 20px !important; color: inherit !important; }
.hh-cbtn svg [fill]:not([fill="none"]) { fill: currentColor !important; }
.hh-cbtn svg [stroke]:not([stroke="none"]) { stroke: currentColor !important; }
.hh-cbtn img { filter: grayscale(1) brightness(1.4); }
.hh-cbtn.sel { background: var(--v-sel); color: var(--v-sel-fg); }
.hh-preview-bar { position: absolute; top: 0; bottom: 0; display: block; box-sizing: border-box; padding: 0 4px; color: var(--v-fg);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: none !important; border: 0 !important; border-radius: 0 !important; max-height: none; min-height: 0; }
.hh-typing-line { overflow: hidden; text-overflow: ellipsis; font: 500 12px var(--v-font); color: var(--v-mute); }
.hh-typing-line b { color: var(--v-fg); font-weight: 600; }
.hh-typing-line .hh-badge { transform: scale(.55); margin: -8px -5px; vertical-align: middle; }
.hh-tdots { display: inline-flex; gap: 3px; margin-right: 7px; vertical-align: middle; transform: translateY(-1px); }
.hh-tdots i { width: 5px; height: 5px; border-radius: 50%; background: var(--v-fg); animation: hh-tdot 1.2s ease-in-out infinite; }
.hh-tdots i:nth-child(2) { animation-delay: .15s; } .hh-tdots i:nth-child(3) { animation-delay: .3s; }
@keyframes hh-tdot { 0%, 60%, 100% { opacity: .3; transform: none; } 30% { opacity: 1; transform: translateY(-3px); } }
/* stick calibration screen */
.hh-calib { z-index: 100006 !important; } /* above the on-screen keyboard */
.hh-calib-card { width: min(640px, 92vw); max-height: 94vh; padding: 18px 24px 16px !important; background: #000 !important; border: 1px solid #333 !important; position: relative; }
.hh-calib-title { font-size: 20px; font-weight: 600; color: #ededed; margin-bottom: 6px; }
.hh-calib-sub { font-size: 14px; line-height: 1.6; color: #a1a1a1; }
.hh-calib-sub .hh-badge { transform: scale(.7); margin: -6px -4px; }
.hh-calib-pads { display: flex; justify-content: center; gap: 40px; margin-top: 10px; }
.hh-calib-svg { width: min(220px, 34vw, 42vh); aspect-ratio: 1; }
.hh-calib-pads-label { display: flex; justify-content: center; gap: calc(min(220px, 34vw, 42vh) + 10px); font: 500 11px "Geist Mono", ui-monospace, monospace; letter-spacing: .14em; color: #888; margin-top: 6px; }
.hh-calib-steps { display: flex; gap: 14px; margin: 4px 0 10px; font: 500 11px "Geist Mono", ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: #555; }
.hh-calib-steps .on { color: #ededed; } .hh-calib-steps .done { color: #888; }
.hh-calib-body { margin-top: 10px; }
.hh-calib-rest { display: flex; justify-content: center; padding: 30px 0; }
.hh-calib-bar { width: 60%; height: 4px; border-radius: 2px; background: #222; overflow: hidden; }
.hh-calib-bar span { display: block; height: 100%; width: 0; background: #ededed; transition: width 80ms linear; }
.hh-calib-lbl { text-align: center; font: 500 11px "Geist Mono", ui-monospace, monospace; letter-spacing: .14em; color: #888; margin-top: 6px; }
.hh-calib-clocks { display: flex; justify-content: center; gap: 14px; height: min(230px, 40vh); border-radius: 12px; transition: box-shadow 150ms; }
.hh-calib-clocks.hh-tap { box-shadow: 0 0 0 1px #555; }
.hh-calib-clock { box-shadow: inset 0 0 0 1px #333; background: radial-gradient(circle, transparent 0 32.8%, #333 33% 33.3%, transparent 33.5%); }
.hh-calib-clock .hh-ckey { border: 1px solid #333; border-radius: 8px; color: #ededed; font-weight: 500; background: #000; }
.hh-calib-clock .hh-ckey.sel { background: #ededed; color: #000; border-color: #ededed; }
.hh-calib-clock .hh-ckey.hh-target { background: #ededed; color: #000; border: 1px solid #ededed; z-index: 3;
  box-shadow: 0 0 0 3px #000, 0 0 0 5px #ededed; animation: hh-target 900ms ease-in-out infinite; }
.hh-calib-clock .hh-ckey.hh-target.sel { border-style: solid; }
@keyframes hh-target { 50% { transform: translate(-50%, -50%) scale(1.14); } }
.hh-aim { display: flex; flex-direction: column; align-items: center; justify-content: center; height: min(230px, 40vh); gap: 4px; }
.hh-aim-stick { font: 500 12px "Geist Mono", ui-monospace, monospace; letter-spacing: .16em; text-transform: uppercase; color: #888; }
.hh-aim-key { font-size: min(120px, 22vh); font-weight: 600; line-height: 1; color: #ededed; transition: transform 90ms ease; }
.hh-aim.hh-tap .hh-aim-key { transform: scale(.88); }
.hh-aim-where { font: 500 11px "Geist Mono", ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #555; }
.hh-aim-done { display: flex; align-items: center; justify-content: center; height: min(230px, 40vh); font-size: 40px; font-weight: 600; color: #ededed; }
.hh-calib-tip { margin-top: 8px; color: #a1a1a1; font-family: "Geist", "Inter", system-ui, sans-serif; font-size: 13px; }
.hh-calib-hint { text-align: center; min-height: 20px; margin-bottom: 8px; font-size: 14px; color: #a1a1a1; }
.hh-calib-hint b { color: #ededed; font-weight: 600; }
.hh-padcard { position: fixed; top: 14px; right: 14px; z-index: 100008; display: flex; gap: 12px; align-items: flex-start; min-width: 240px; max-width: 340px;
  padding: 12px 16px; border-radius: 12px; background: #000; border: 1px solid #333; box-shadow: 0 10px 30px rgb(0 0 0 / .5); pointer-events: none;
  font-family: "Geist", "Inter", system-ui, sans-serif; animation: hh-padcard-in 220ms cubic-bezier(.2,.8,.2,1); }
.hh-padcard.hh-padcard-out { animation: hh-padcard-out 220ms ease forwards; }
.hh-padcard-dot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: #3fb950; box-shadow: 0 0 0 3px rgb(63 185 80 / .2); flex: none; }
.hh-padcard-off .hh-padcard-dot { background: #888; box-shadow: 0 0 0 3px rgb(136 136 136 / .2); }
.hh-padcard-title { font-size: 14px; font-weight: 600; color: #ededed; }
.hh-padcard-name { font-size: 13px; color: #a1a1a1; margin-top: 2px; }
.hh-padcard-sub { font: 500 11px "Geist Mono", ui-monospace, monospace; letter-spacing: .06em; color: #666; margin-top: 6px; text-transform: uppercase; }
@keyframes hh-padcard-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@keyframes hh-padcard-out { to { opacity: 0; transform: translateY(-8px); } }
.hh-restart .hh-badge { transform: scale(.7); margin: -6px -4px; }
.hh-calib-status { text-align: center; margin-top: 12px; font: 500 12px "Geist Mono", ui-monospace, monospace; color: #888; }
/* which stick each clock is: LS in the left clock's top-right corner, RS in the right clock's top-left (the inner corners) */
.hh-stick-tag { position: absolute; top: 2%; right: 3%; z-index: 3; pointer-events: none;
  font: 500 11px/1 "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .14em; color: #888; }
.hh-clock-r .hh-stick-tag { right: auto; left: 3%; }
.hh-reply-line { flex: none; font: 500 11px/1.2 "Geist Mono", ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase;
  color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hh-reply-line b { color: var(--v-fg); font-weight: 600; text-transform: none; letter-spacing: 0; font-family: "Geist", "Inter", system-ui, sans-serif; font-size: 13px; }
.hh-preview-line { flex: none; min-height: 0; max-height: 46px; padding: 6px 10px; font-size: 14px; line-height: 1.25; border-radius: 8px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hh-kb.hh-kb-lay .hh-preview-line { background: var(--v-panel); border: 1px solid var(--v-line); color: var(--v-fg); }
.hh-kb.hh-kb-over .hh-legend-row { height: 21px; }
/* Fit glyphs inside their actual row boxes instead of scaling oversized badges with negative margins. */
.hh-kb .hh-side .hh-legend-btn .hh-badge { transform: none; margin: 0; height: calc(100% - .2em); max-height: 100%; min-height: 0; min-width: 1.8em; width: 1.8em; padding: 0; font-size: .75em; box-sizing: border-box; }
.hh-kb .hh-side .hh-legend-btn .hh-badge > svg { width: 1.2em; height: 1.2em; }
.hh-side-l { flex-grow: 2; max-width: 460px; }
.hh-split .hh-side-r { min-width: 190px; }
.hh-sugg-hint2 { margin-top: 2px; }
.hh-gridwrap .hh-side-l { flex-grow: 1.7; min-width: 290px; }
.hh-gridwrap .hh-side-r { min-width: 190px; }
/* grid keyboard in the same style: keys as hairline tiles, the selected one solid white */
.hh-gridwrap { display: flex; align-items: stretch; gap: 12px; height: 100%; }
.hh-grid { flex: 1 1 420px; min-width: 0; max-width: 500px; display: flex; flex-direction: column; gap: 5px; }
.hh-kb.hh-kb-lay .hh-key { background: var(--v-key); border: 1px solid var(--v-line); border-radius: 8px; color: var(--v-fg); font-weight: 500;
  font-size: clamp(13px, 2.6vh, 20px); transition: background 70ms, color 70ms, border-color 70ms; }
.hh-kb.hh-kb-lay .hh-key-act { color: var(--v-mute); font-family: var(--v-mono); font-size: clamp(11px, 1.9vh, 14px); }
.hh-kb.hh-kb-lay .hh-key.on { border-color: var(--v-fg); color: var(--v-fg); }
.hh-kb.hh-kb-lay .hh-key.hh-gsel-l.hh-gsel-r { box-shadow: inset 0 0 0 2px var(--v-sel-fg); }
.hh-kb.hh-kb-lay .hh-key.sel { background: var(--v-sel); border-color: var(--v-sel); color: var(--v-sel-fg); font-weight: 600; box-shadow: none; }
.hh-kb.hh-kb-lay .hh-key.hh-key-flash { background: #fff !important; color: #000; }
.hh-kb.hh-kb-lay .hh-key.hh-pop { animation: hh-key-pop-v 200ms ease-out; }
@keyframes hh-key-pop-v { 0% { transform: scale(1.1); background: #fff; color: #000; } 100% { transform: none; } }
/* the plugin's small label, top-right of each pop-up (keyboard, menus, guide, settings) */
.hh-brand { position: absolute; top: 8px; right: 12px; z-index: 5; pointer-events: none; font-family: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--text-muted, var(--text-secondary, currentColor)); white-space: nowrap; }
.hh-brand a { pointer-events: auto; color: inherit; text-decoration: none; }
.hh-brand a:hover { color: var(--hh-accent); text-decoration: underline; }
.hh-brand a[data-hh-brand-selected] { outline: 3px solid var(--hh-accent); outline-offset: 4px; border-radius: 3px; }
.hh-brand a:focus-visible { outline: 2px solid var(--hh-accent); outline-offset: 2px; }
.hh-brand::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%; background: currentColor; vertical-align: 1px; }
.hh-help-card { position: relative; }
:root[data-hh-drawer-on] :is([data-hh-drawer], [data-hh-subdrawer]) [role="menu"]:is(#hh-never, *) { padding-top: 30px !important; }
[data-hh-drawer="left"] > .hh-brand { right: auto; left: 14px; }
[data-hh-drawer] > .hh-brand { top: 10px; }
.hh-sugg-chip { background: rgb(255 255 255 / .07); }
/* a key just typed: a quick pop */
.hh-ckey.hh-pop { animation: hh-ckey-pop 240ms cubic-bezier(.2, .9, .3, 1.2); }
@keyframes hh-ckey-pop {
  0% { transform: translate(-50%, -50%) scale(1.18); background: #fff; color: #000; box-shadow: 0 0 0 4px rgb(255 255 255 / .15); }
  100% { transform: translate(-50%, -50%); } }
.hh-key.hh-pop { animation: hh-key-pop 200ms ease-out; }
@keyframes hh-key-pop { 0% { transform: scale(1.12); background: var(--hh-kb-accent, var(--hh-accent)); color: #fff; } 100% { transform: none; } }
.hh-petal.hh-pop { animation: hh-petal-pop 220ms ease-out; }
@keyframes hh-petal-pop { 0% { transform: translate(-50%, -50%) scale(1.3); } 100% { transform: translate(-50%, -50%) scale(1.1); } }
/* delete / space: a short pulse along the keyboard's top edge */
.hh-kb.hh-kb-del { animation: hh-kb-del 220ms ease-out; }
.hh-kb.hh-kb-space { animation: hh-kb-space 220ms ease-out; }
@keyframes hh-kb-del { 0% { border-top-color: #f23f43; box-shadow: 0 -10px 40px rgb(0 0 0 / .5), 0 -2px 18px rgb(242 63 67 / .55); } }
@keyframes hh-kb-space { 0% { border-top-color: #fff; box-shadow: 0 -10px 40px rgb(0 0 0 / .5), 0 -2px 18px rgb(255 255 255 / .35); } }
/* word suggestions: a row of chips above the keys — or, on the split keyboard, a column between the two clocks */
.hh-sugg-mid { flex: none; width: clamp(90px, 13vw, 170px); display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 8px; }
.hh-sugg-mid .hh-sugg-chip { text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hh-sugg-mid .hh-sugg-hint { justify-content: center; }
.hh-sugg { flex: none; height: 24px; display: flex; align-items: center; justify-content: center; gap: 10px; }
.hh-sugg-chip { padding: 4px 16px; border-radius: 999px; background: rgb(255 255 255 / .08); color: var(--text-normal, #dbdee1);
  font-weight: 700; font-size: 14px; cursor: pointer; border: 2px solid transparent; transition: background 90ms ease; padding-block: 1px; }
.hh-sugg-chip.sel { border-color: var(--hh-kb-accent, var(--hh-accent)); background: color-mix(in srgb, var(--hh-kb-accent, var(--hh-accent)) 22%, transparent); }
.hh-sugg-hint { font-size: 11px; opacity: .55; display: flex; align-items: center; gap: 3px; color: var(--text-normal, #dbdee1); }
.hh-sugg-hint .hh-badge { transform: scale(.7); margin: 0 -4px; }
.hh-kb-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 8px; background: rgb(255 255 255 / .1); cursor: pointer; font-weight: 700; }
.hh-key.hh-sel-l { border-color: #3ba5ff; background: rgb(59 165 255 / .3); box-shadow: 0 0 14px rgb(59 165 255 / .45); }
.hh-key.hh-sel-r { border-color: #ff9f43; background: rgb(255 159 67 / .3); box-shadow: 0 0 14px rgb(255 159 67 / .45); }
/* wheel keyboard: 8 groups around a circle; each letter sits where its button is (Y top, B right, A bottom, X left) */
.hh-kb.hh-kb-wheel { flex-direction: row; align-items: stretch; }
.hh-kb.hh-kb-wheel .hh-kb-hints { flex-direction: column; flex-wrap: nowrap; align-items: flex-start; justify-content: center; width: 30%; gap: 2px; font-size: 11px; }
.hh-kb.hh-kb-wheel .hh-kb-hints .hh-badge { transform: scale(.72); margin: -3px -2px; }
.hh-kb.hh-kb-wheel .hh-kb-keys { align-items: center; }
.hh-wheel { position: relative; flex: 1; min-height: 0; aspect-ratio: 2; max-width: 100%; align-self: center; container-type: size; } /* the groups sit on an oval twice as wide as tall: the keyboard is wide and short */
.hh-petal { position: absolute; height: 28%; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%;
  background: rgb(255 255 255 / .06); border: 2px solid transparent; transition: transform 70ms ease, background 70ms ease; }
.hh-petal.sel { border-color: var(--hh-kb-accent, var(--hh-accent)); background: color-mix(in srgb, var(--hh-kb-accent, var(--hh-accent)) 28%, transparent); transform: translate(-50%, -50%) scale(1.1); z-index: 1; }
.hh-petal-center { height: 32%; }
.hh-pk { position: absolute; font-weight: 800; font-size: 8.5cqh; line-height: 1; cursor: pointer; } /* (scales with the wheel) */
.hh-petal-center .hh-pk { font-size: 7.5cqh; }
.hh-pk-t { top: 9%; left: 50%; transform: translateX(-50%); color: #f2c84b; }
.hh-pk-r { right: 10%; top: 50%; transform: translateY(-50%); color: #ff6b6b; }
.hh-pk-b { bottom: 9%; left: 50%; transform: translateX(-50%); color: #4cd964; }
.hh-pk-l { left: 10%; top: 50%; transform: translateY(-50%); color: #5aa9ff; }
@keyframes hh-kb-in { from { transform: translateY(100%); } to { transform: none; } }
@keyframes hh-kb-out { to { transform: translateY(100%); } }
`;

// Input modality is explicit: controller presentation never persists after real mouse/keyboard input.
let controllerActive = false;
let lastControllerActivity = "";
function controllerActivity(pad: Gamepad): string {
    return pad.buttons.map(b => b.pressed || b.value > .5 ? "1" : "0").join("") + ":" + stickDir(pad)
        + ":" + (Math.abs(pad.axes[2] ?? 0) > settings.store.stickDeadzone ? Math.sign(pad.axes[2]) : 0)
        + ":" + (Math.abs(pad.axes[3] ?? 0) > settings.store.stickDeadzone ? Math.sign(pad.axes[3]) : 0);
}
function activateController() {
    controllerActive = true;
    (window as any).__hhControllerActive = true;
    if (styleEl) styleEl.disabled = false;
    if (varsEl) varsEl.disabled = false;
    for (const el of document.querySelectorAll<HTMLElement>(".hh-ring,.hh-frame,.hh-hints,.hh-debug")) el.hidden = false;
    bumpChecks();
}
function usePointerKeyboard() {
    extTransitions = []; sampledExtPad = extPad;
    const pad = getPad();
    if (pad) { lastControllerActivity = controllerActivity(pad); prevPressed = pad.buttons.map(b => b.pressed || b.value > .5); }
    if (!controllerActive) return;
    controllerActive = false;
    (window as any).__hhControllerActive = false;
    // Hide first so closing animations cannot leave glyphs or unstyled UI behind.
    for (const el of document.querySelectorAll<HTMLElement>(".hh-ring,.hh-frame,.hh-hints,.hh-debug,.hh-toast,.hh-kb,.hh-help,.hh-panel,.hh-padcard")) el.hidden = true;
    closeKeyboard(); closeDrawer(); toggleHelp(false); togglePanel(false);
    calibEl?.remove(); calibEl = null; calib = null;
    adjustMode = false; typingMode = false; heldDir = null; holdState.clear();
    setItem(null); section = null; sectionKey = ""; mode = "sections"; innerMsg = null; returnStack = [];
    nativePickerLock = null;
    for (const el of document.querySelectorAll("[data-hh-held]")) el.removeAttribute("data-hh-held");
    composerSendEl?.remove(); composerSendEl = null;
    document.documentElement.removeAttribute("data-hh-server-area-picking");
    document.documentElement.removeAttribute("data-hh-btns");
    document.documentElement.removeAttribute("data-hh-menu-style");
    shiftTitle(false);
    if (styleEl) styleEl.disabled = true;
    if (varsEl) varsEl.disabled = true;
    lastPadUse = -Infinity;
}
const onPointerDown = (e: PointerEvent) => { if (e.isTrusted) usePointerKeyboard(); };
const onPointerMove = (e: PointerEvent) => { if (e.isTrusted && (e.movementX || e.movementY)) usePointerKeyboard(); };
const onKeyboardInput = (e: KeyboardEvent) => { if (e.isTrusted) usePointerKeyboard(); };
const onWheelInput = (e: WheelEvent) => { if (e.isTrusted && (e.deltaX || e.deltaY)) usePointerKeyboard(); };

export default definePlugin({
    name: "HandheldControls",
    enabledByDefault: true,
    description: "Navigate Discord with a controller (built for the ROG Ally X). Works with any theme.",
    authors: [{ name: "Ahmad", id: 0n }],
    settings,

    start() {
        styleEl = document.createElement("style");
        styleEl.id = "hh-controls-style";
        styleEl.textContent = CSS + CSS_EXTRA;
        document.head.append(styleEl);
        controllerActive = false; (window as any).__hhControllerActive = false;
        styleEl.disabled = true;
        applyColors();
        void loadWords();
        void loadCalibs();
        void loadCtx();
        void loadClip();
        document.addEventListener("copy", onCopy, true);
        hookClipboardWrites(true);
        installScreenSwap(true);
        for (const t of ["pointerdown", "keydown", "contextmenu", "click"]) document.addEventListener(t, bumpChecks, true);
        window.addEventListener("gamepadconnected", onPadConnected);
        window.addEventListener("gamepaddisconnected", onPadDisconnected);
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        for (const t of ["TYPING_START", "TYPING_STOP"]) FluxDispatcher.subscribe(t, onTyping);
        for (const t of ["CREATE_PENDING_REPLY", "DELETE_PENDING_REPLY", "CHANNEL_SELECT"]) FluxDispatcher.subscribe(t, onReplyChange);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", onMessagesLoaded);
        // what's already loaded right now (every chat Discord has in memory)
        setTimeout(() => {
            try {
                const loaded = findByProps("_channelMessages")?._channelMessages ?? {}; // Discord's per-chat message lists
                for (const cid of Object.keys(loaded)) onMessagesLoaded({ messages: (MessageStore.getMessages(cid) as any)?.toArray?.() });
            } catch { }
        }, 3000);
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("keydown", onKeyboardInput, true);
        document.addEventListener("wheel", onWheelInput, true);
        document.addEventListener("contextmenu", onContextMenuCapture, true);
        document.addEventListener("keydown", onBackKey, true);
        watchMenusEarly();
        suggestionObserver = new MutationObserver(muts => {
            if (controllerActive && kbEl && muts.some(m => !(m.target instanceof Element ? m.target : m.target.parentElement)?.closest(".hh-kb"))) updateSuggestions();
        });
        suggestionObserver.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-controls", "aria-owns", "aria-selected"]});
        document.addEventListener("click", onMenuClickCapture, true);
        prevPressed = []; extTransitions = []; sampledExtPad = extPad;
        if ((settings.store.prefsVersion ?? 0) < 2) {
            settings.store.drawerSide = "right";
            settings.store.drawerWidth = 290;
            settings.store.prefsVersion = 2;
        }
        if ((settings.store.prefsVersion ?? 0) < 3) { // bigger, finger-friendly side menus
            settings.store.drawerWidth = 360;
            settings.store.prefsVersion = 3;
        }
        if ((settings.store.prefsVersion ?? 0) < 4) { // menus open over the server / channel lists, wherever the theme puts them
            (settings.store as any).drawerSide = "lists";
            settings.store.prefsVersion = 4;
        }
        if ((settings.store.prefsVersion ?? 0) < 5) { // keyboard height now means the whole keyboard (message box included)
            (settings.store as any).keyboardHeight = 45;
            settings.store.prefsVersion = 5;
        }
        raf = requestAnimationFrame(tick);
        setTimeout(() => toast(`🎮 Handheld Controls ${VERSION} loaded`, 2500), 1500);
        // read-only peek at the navigation state, for live testing over the debug port
        (window as any).__hhState = () => ({
            version: VERSION, controllerActive, hintsOff: { panel: !!panelEl, help: !!helpEl, calib: !!calibEl, padIdle: Math.round(performance.now() - lastPadUse), pad: !!getPad() }, mode, typing: typingMode, keyboard: !!kbEl, menu: !!openMenu(), windows: overlayCount(),
            section: describe(section), item: describe(focused), inMessage: !!innerMsg, log: [...debugLog],
            sections: listSections().map(describe),
            items: alive(section) ? (listRows(section) ?? itemsOnTop(section)).slice(0, 40).map(e => describe(e) + " " + (e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24)) : [],
        });
        // the typing recorder (Split keyboard), for live debugging of typing mistakes
        (window as any).__hhTypingLog = typingLogBuf;
        // which section each item counts as (raw, then widened): for live debugging of section splits
        (window as any).__hhItemSections = () => itemsOnTop().slice(0, 80).map(e =>
            `${describe(e).slice(0, 70)}  →  ${describe(sectionOf(e)).slice(0, 60)}  ⇒  ${describe(widen(sectionOf(e))).slice(0, 40)}`);
    },

    stop() {
        cancelAnimationFrame(raf);
        suggestionObserver?.disconnect(); suggestionObserver = null; releaseAutocomplete();
        controllerStatusEl?.remove(); controllerStatusEl = null;
        menuObserver?.disconnect(); menuObserver = null;
        document.removeEventListener("keydown", onBackKey, true);
        document.removeEventListener("copy", onCopy, true);
        hookClipboardWrites(false);
        installScreenSwap(false);
        delete (window as any).__hhState;
        delete (window as any).__hhItemSections;
        delete (window as any).__hhTypingLog;
        for (const t of ["pointerdown", "keydown", "contextmenu", "click"]) document.removeEventListener(t, bumpChecks, true);
        window.removeEventListener("gamepadconnected", onPadConnected);
        window.removeEventListener("gamepaddisconnected", onPadDisconnected);
        padCardEl?.remove(); padCardEl = null;
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        for (const t of ["TYPING_START", "TYPING_STOP"]) FluxDispatcher.unsubscribe(t, onTyping);
        for (const t of ["CREATE_PENDING_REPLY", "DELETE_PENDING_REPLY", "CHANNEL_SELECT"]) FluxDispatcher.unsubscribe(t, onReplyChange);
        replyMarked?.removeAttribute("data-hh-replying"); replyMarked = null;
        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", onMessagesLoaded);
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointermove", onPointerMove, true);
        document.removeEventListener("keydown", onKeyboardInput, true);
        document.removeEventListener("wheel", onWheelInput, true);
        document.removeEventListener("contextmenu", onContextMenuCapture, true);
        document.removeEventListener("click", onMenuClickCapture, true);
        closeDrawer();
        closeKeyboard();
        togglePanel(false);
        setItem(null);
        section = null;
        returnStack = [];
        toggleHelp(false);
        document.documentElement.removeAttribute("data-hh-server-area-picking");
        for (const el of discovered) el.removeAttribute("data-hh-discovered");
        discovered.clear(); discoveredAt = -Infinity;
        for (const uploads of document.querySelectorAll<HTMLElement>('form [data-list-id="attachments"]')) uploads.style.removeProperty("--hh-upload-height");
        composerSendEl?.remove(); composerSendEl = null;
        ringEl?.remove(); ringEl = null;
        frameEl?.remove(); frameEl = null;
        styleEl?.remove(); styleEl = null;
        varsEl?.remove(); varsEl = null; rootVars.clear();
        toastEl?.remove(); toastEl = null;
        debugEl?.remove(); debugEl = null;
    },
});
