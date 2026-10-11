# Controller support in regular Discord

The existing plugin depends on Vencord's settings API, DataStore, webpack module discovery, Flux dispatcher and Discord stores. Its navigation, focus overlays and keyboards run in the renderer and read `navigator.getGamepads()`. Most of this can run through Vencord in the official Discord client without rewriting the controller system.

The injector runs on Windows, macOS and Linux: `scripts/setup.mjs --inject` stages the three plugins, builds Vencord and invokes the corresponding native Vencord Installer binary in development mode. The wrapper downloads a pinned installer release, checks its SHA-256 digest and propagates its exit status. `scripts/inject.mjs` also supports uninstall and channel/custom-location selection without rebuilding. Vencord handles client discovery and patching; this repository does not implement a second app.asar patcher. Manual install/uninstall remains available through `pnpm inject` / `pnpm uninject` in the checkout.

The source was type-checked and built against Vencord revision `b52ed365cf2ea64a5019b419291a2d9d4d76852d`. This verifies compile-time integration, not a live official Discord session. Test actual gamepad detection, navigation, menu handling, split-keyboard entry, clipboard behavior and cleanup before describing official-client support as verified.

The UI currently retains some Vesktop branding. Game Mode size and restart expect `VesktopNative` and the included Vesktop launcher. Gamescope sharing expects the optional bridge and virtual camera. Those integrations need client-specific adapters; they should not be advertised as regular-Discord features.

A standalone controller-only injector is possible, but would require extracting a host interface for persistence, settings, navigation, voice controls and Discord module access, then maintaining an Electron preload/bootstrap with rollback for each supported client install format. Reusing Vencord supplies those pieces now and avoids maintaining a separate Discord patcher. The wrapper now includes client/channel selection and restore support. A future graphical frontend can expose the same operations without requiring terminal use.

Reference: [Vencord custom-build installation](https://docs.vencord.dev/installing/).
