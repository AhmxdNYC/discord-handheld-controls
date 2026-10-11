# Controller support in regular Discord

The existing plugin depends on Vencord's settings API, DataStore, webpack module discovery, Flux dispatcher and Discord stores. Its navigation, focus overlays and keyboards run in the renderer and read `navigator.getGamepads()`. Most of this can run through Vencord in the official Discord client without rewriting the controller system.

The initial injector is a wrapper around Vencord's maintained installer: `scripts/setup.mjs --inject` stages the three plugins, builds Vencord and invokes its development installer. Vencord handles client discovery and patching; this repository does not implement a second app.asar patcher. Manual install/uninstall remains available through `pnpm inject` / `pnpm uninject` in the checkout.

The source was type-checked and built against Vencord revision `b52ed365cf2ea64a5019b419291a2d9d4d76852d`. This verifies compile-time integration, not a live official Discord session. Test actual gamepad detection, navigation, menu handling, split-keyboard entry, clipboard behavior and cleanup before describing official-client support as verified.

Vesktop branding remains in parts of the current UI. Game Mode size and restart expect `VesktopNative` and the included Vesktop launcher. Gamescope sharing expects the optional bridge and virtual camera. Those integrations need client-specific adapters; they should not be advertised as regular-Discord features.

A standalone controller-only injector is possible, but would require extracting a host interface for persistence, settings, navigation, voice controls and Discord module access, then maintaining an Electron preload/bootstrap with rollback for each supported client install format. Reusing Vencord supplies those pieces now and avoids maintaining a separate Discord patcher. A useful next iteration is a friendly installer UI around the existing wrapper, with client selection, build progress and restore support.

Reference: [Vencord custom-build installation](https://docs.vencord.dev/installing/).
