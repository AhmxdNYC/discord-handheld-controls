// SPDX-License-Identifier: GPL-3.0-or-later
import { ButtonItem, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { FaGamepad } from "react-icons/fa";

type Status = { installed: boolean; version?: string; available: string; vesktop: string; shortcutId?: number; launcher: string; directory: string; message: string; customBuild?: string };
const status = callable<[], Status>("status");
const perform = callable<[action: string], Status>("perform");
const saveShortcut = callable<[appId: number], Status>("save_shortcut");
// Steam's client API is available inside Decky's Steam frontend.
declare const SteamClient: { Apps: { AddShortcut(name: string, executable: string, directory: string, options: string): Promise<number>; RemoveShortcut(appId: number): void } };

function Content() {
  const [info, setInfo] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking installation…");
  useEffect(() => { status().then(result => { setInfo(result); setMessage("Ready."); }).catch(error => setMessage(String(error))); }, []);
  const run = async (action: string) => {
    setBusy(true);
    setMessage("Working…");
    try {
      // Preserve the shortcut on backend failure; remove it after successful uninstall.
      const previous = info;
      const next = await perform(action);
      setInfo(next);
      if (action === "remove" && previous?.shortcutId) SteamClient.Apps.RemoveShortcut(previous.shortcutId);
      setMessage(action === "remove" ? "Removed. Vesktop and your settings were kept." : "Done. Launch Vesktop after this completes.");
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  const addShortcut = async () => {
    if (!info?.installed) return;
    setBusy(true);
    try {
      if (info.shortcutId) {
        setMessage("A Steam shortcut is already recorded. Remove it through Steam before creating another.");
        return;
      }
      const id = await SteamClient.Apps.AddShortcut("Discord — Handheld Controls", `"${info.launcher}"`, `"${info.directory}"`, "");
      try { setInfo(await saveShortcut(id)); }
      catch (error) { SteamClient.Apps.RemoveShortcut(id); throw error; }
      setMessage("Discord — Handheld Controls is in your Steam library.");
      toaster.toast({ title: "Handheld Controls", body: "Steam shortcut ready" });
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  return <PanelSection title="Vesktop controller support">
    <PanelSectionRow><div>{info ? `Vesktop: ${info.vesktop}. Controls: ${info.version ?? "not installed"}. Available: ${info.available}.` : message}</div></PanelSectionRow>
    <PanelSectionRow><div>{info?.message}</div></PanelSectionRow>
    {info?.customBuild && <PanelSectionRow><div>Installing replaces your custom Vencord build. Remove restores its original location. Other custom plugins in that build may be unavailable while this build is selected.</div></PanelSectionRow>}
    {info?.vesktop === "missing" && <PanelSectionRow><ButtonItem disabled={busy} onClick={() => run("install_vesktop")}>Install Vesktop</ButtonItem></PanelSectionRow>}
    <PanelSectionRow><ButtonItem disabled={busy || !info || info.vesktop === "missing"} onClick={() => run(info?.installed ? "update" : "install")}>{info?.installed ? "Update controls" : "Install controls"}</ButtonItem></PanelSectionRow>
    {info?.installed && <>
      <PanelSectionRow><ButtonItem disabled={busy} onClick={() => run("repair")}>Repair controls</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem disabled={busy || !!info.shortcutId} onClick={addShortcut}>{info.shortcutId ? "Added to Steam" : "Add to Steam library"}</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem disabled={busy} onClick={() => run("remove")}>Remove controls and shortcut</ButtonItem></PanelSectionRow>
    </>}
    <PanelSectionRow><div>{message}</div></PanelSectionRow>
  </PanelSection>;
}
export default definePlugin(() => ({ name: "Discord Handheld Controls", titleView: <div className={staticClasses.Title}>Handheld Controls</div>, content: <Content />, icon: <FaGamepad />, onDismount() {} }));
