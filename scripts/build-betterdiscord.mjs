import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = join(root, "betterdiscord", "host.mjs");
const output = join(root, "dist", "betterdiscord");
mkdirSync(output, { recursive: true });
for (const [source, name] of [["handheldControls", "HandheldControls"], ["heldIndicator", "HeldIndicator"], ["gamepadDebug", "GamepadDebug"]]) {
    await build({
        entryPoints: [join(root, "plugins", `${source}.ts`)],
        outfile: join(output, `${name}.plugin.js`),
        bundle: true, platform: "browser", format: "cjs", target: "es2022",
        alias: { "@api/DataStore": host, "@api/Settings": host, "@utils/types": host, "@webpack/common": host, "@webpack": host },
        banner: { js: `/**\n * @name ${name}\n * @author Ahmad (AhmxdNYC)\n * @version 6.29.0\n * @description Controller support companion for Discord. GPL-3.0-or-later.\n * @source https://github.com/AhmxdNYC/discord-handheld-controls\n */` },
        footer: { js: "module.exports = module.exports.default;" },
        legalComments: "inline"
    });
    console.log(`Built ${name}.plugin.js`);
}
