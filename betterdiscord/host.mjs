// GPL-3.0-or-later. Host adapter for the shared controller plugin.
const pluginName = "HandheldControls";
export const OptionType = Object.freeze({ BOOLEAN: "boolean", STRING: "string", NUMBER: "number", SELECT: "select", SLIDER: "slider" });
function api() {
    if (!globalThis.BdApi?.Webpack || !globalThis.BdApi?.Data) throw new Error("HandheldControls requires BetterDiscord's BdApi");
    return globalThis.BdApi;
}
export async function get(key) { return api().Data.load(pluginName, key); }
export async function set(key, value) { api().Data.save(pluginName, key, value); }
export function findStore(name) { return api().Webpack.getStore(name); }
export function findByProps(...keys) { return api().Webpack.getByKeys(...keys, { searchExports: true }); }
export function lazy(resolve, label) {
    let resolved;
    return new Proxy({}, {
        get(_target, key) {
            resolved ??= resolve();
            if (!resolved) throw new Error(`Discord module unavailable: ${label}. Update BetterDiscord or report your Discord version.`);
            const value = resolved[key];
            return typeof value === "function" ? value.bind(resolved) : value;
        }
    });
}
export function findByPropsLazy(...keys) { return lazy(() => findByProps(...keys), keys.join(", ")); }
const store = name => lazy(() => findStore(name), name);
export const ChannelStore = store("ChannelStore");
export const MessageStore = store("MessageStore");
export const SelectedChannelStore = store("SelectedChannelStore");
export const SelectedGuildStore = store("SelectedGuildStore");
export const SortedGuildStore = store("SortedGuildStore");
export const UserStore = store("UserStore");
export const FluxDispatcher = findByPropsLazy("dispatch", "subscribe", "unsubscribe");
export const SettingsRouter = findByPropsLazy("openUserSettings", "USER_SETTINGS_MODAL_KEY");

// Match navigation function source when Discord mangles export names.
// Search strings follow Vencord's GPL-licensed common/utils.ts discovery rules.
export const NavigationRouter = lazy(() => {
    const direct = findByProps("transitionTo", "transitionToGuild");
    if (direct) return direct;
    const router = {};
    for (const [key, text] of Object.entries({ transitionTo: "transitionTo -", transitionToGuild: "transitionToGuild -", back: "goBack()", forward: "goForward()" })) {
        const fn = api().Webpack.getModule(value => typeof value === "function" && Function.prototype.toString.call(value).includes(text), { searchExports: true });
        if (fn) router[key] = fn;
    }
    return router.transitionTo && router.transitionToGuild ? router : undefined;
}, "NavigationRouter");

export function definePluginSettings(definition) {
    let store;
    function load() {
        const defaults = {};
        for (const [key, option] of Object.entries(definition)) {
            defaults[key] = option.default ?? (option.type === OptionType.SELECT ? (option.options.find(x => x.default) ?? option.options[0])?.value : undefined);
        }
        const saved = api().Data.load(pluginName, "settings");
        store = new Proxy({ ...defaults, ...(saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}) }, {
            set(target, key, value) {
                target[key] = value;
                api().Data.save(pluginName, "settings", { ...target });
                return true;
            }
        });
        return store;
    }
    return { definition, get store() { return store ?? load(); } };
}

function settingsPanel(settings) {
    const panel = document.createElement("div");
    panel.style.cssText = "padding:16px;color:var(--text-normal);display:grid;gap:14px";
    const hint = document.createElement("p");
    hint.textContent = "Controller settings also appear in the in-app Menu panel. Restart the plugin after changing appearance settings here.";
    panel.append(hint);
    for (const [key, option] of Object.entries(settings.definition)) {
        if (option.hidden || key === "gameModeScale") continue;
        const label = document.createElement("label");
        label.style.cssText = "display:grid;gap:6px";
        const text = document.createElement("span"); text.textContent = option.description;
        label.append(text);
        let input;
        if (option.type === OptionType.SELECT) {
            input = document.createElement("select");
            option.options.forEach((choice, i) => {
                const element = document.createElement("option");
                element.value = String(i); element.textContent = choice.label;
                element.selected = choice.value === settings.store[key]; input.append(element);
            });
            input.addEventListener("change", () => { settings.store[key] = option.options[Number(input.value)].value; });
        } else {
            input = document.createElement("input");
            input.type = option.type === OptionType.BOOLEAN ? "checkbox" : [OptionType.NUMBER, OptionType.SLIDER].includes(option.type) ? "number" : "text";
            if (input.type === "checkbox") input.checked = Boolean(settings.store[key]);
            else input.value = String(settings.store[key] ?? "");
            if (option.markers?.length) { input.min = String(Math.min(...option.markers)); input.max = String(Math.max(...option.markers)); }
            input.step = "any";
            input.addEventListener("change", () => {
                if (input.type === "number" && (!input.value || !input.checkValidity() || !Number.isFinite(input.valueAsNumber))) return;
                settings.store[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? input.valueAsNumber : input.value;
            });
        }
        label.append(input); panel.append(label);
    }
    return panel;
}

export default function definePlugin(plugin) {
    return class {
        started = false;
        getName() { return plugin.name; }
        getAuthor() { return "Ahmad (AhmxdNYC)"; }
        getVersion() { return "6.31.0"; }
        getDescription() { return plugin.description; }
        start() {
            if (this.started) return;
            if (plugin.settings) {
                // Fail before creating overlays/listeners if essential modules are unavailable.
                for (const [module, method] of [[FluxDispatcher, "subscribe"], [SelectedChannelStore, "getChannelId"], [SelectedGuildStore, "getGuildId"], [MessageStore, "getMessages"], [UserStore, "getCurrentUser"], [SortedGuildStore, "getFlattenedGuildIds"], [NavigationRouter, "transitionTo"]]) {
                    if (typeof module[method] !== "function") throw new Error(`Discord method unavailable: ${method}`);
                }
            }
            try { plugin.start(); this.started = true; }
            catch (error) { try { plugin.stop(); } catch { /* Preserve the startup error. */ } throw error; }
        }
        stop() { if (this.started) { this.started = false; plugin.stop(); } }
        getSettingsPanel() {
            return plugin.settings ? settingsPanel(plugin.settings) : document.createElement("div");
        }
    };
}
