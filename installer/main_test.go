package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) (string, manifest) {
	t.Helper()
	root := t.TempDir()
	m := manifest{Version: "test", Installer: "native/installer", Files: map[string]string{}}
	names := []string{m.Installer, "payload/vencord/dist/patcher.js", "payload/vencord/dist/preload.js", "payload/vencord/dist/renderer.js"}
	for _, name := range pluginNames {
		names = append(names, "payload/betterdiscord/"+name)
	}
	for _, name := range names {
		content := []byte("test: " + name)
		if err := writeFile(filepath.Join(root, filepath.FromSlash(name)), content, 0644); err != nil {
			t.Fatal(err)
		}
		m.Files[name] = digest(content)
	}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(root, "manifest.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	return root, m
}
func TestBundleVerification(t *testing.T) {
	root, m := fixture(t)
	if _, err := verifyBundle(root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(m.Installer)), []byte("tampered"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyBundle(root); err == nil {
		t.Fatal("tampered installer accepted")
	}
}
func TestUnsafeBundlePaths(t *testing.T) {
	for _, path := range []string{"", "../outside", "a/../../outside", "/tmp/outside", "C:/outside"} {
		if _, err := safePath(t.TempDir(), path); err == nil {
			t.Fatalf("unsafe path accepted: %s", path)
		}
	}
}
func TestPersistentVencordDeploymentAndBackup(t *testing.T) {
	root, _ := fixture(t)
	state := t.TempDir()
	target, err := deployVencord(root, state)
	if err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(target, "dist", "patcher.js")
	if err := os.WriteFile(old, []byte("old build"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := deployVencord(root, state); err != nil {
		t.Fatal(err)
	}
	backups, err := filepath.Glob(filepath.Join(state, "backups", "vencord-*", "patcher.js"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("backup missing: %v", backups)
	}
	content, err := os.ReadFile(backups[0])
	if err != nil || string(content) != "old build" {
		t.Fatal("backup did not preserve build")
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.ReadFile(old); err != nil {
		t.Fatal("installed build depends on download folder")
	}
}
func TestBetterDiscordInstallUpdateAndProtectedRemoval(t *testing.T) {
	root, _ := fixture(t)
	state, plugins := t.TempDir(), t.TempDir()
	if err := installBetterDiscord(root, state, plugins, false); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(plugins, pluginNames[0])
	if err := os.WriteFile(file, []byte("local edits"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := installBetterDiscord(root, state, plugins, true); err == nil || !strings.Contains(err.Error(), "edited") {
		t.Fatal("edited plugin removed")
	}
	if _, err := os.Stat(filepath.Join(plugins, pluginNames[1])); err != nil {
		t.Fatal("partial removal")
	}
	if err := installBetterDiscord(root, state, plugins, false); err != nil {
		t.Fatal(err)
	}
	backups, _ := filepath.Glob(filepath.Join(state, "backups", "betterdiscord-*", pluginNames[0]))
	if len(backups) != 1 {
		t.Fatal("edited plugin not backed up")
	}
	if err := installBetterDiscord(root, state, plugins, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("plugin not removed")
	}
}
func TestMissingBetterDiscordFolderDoesNotCreateFakeInstallation(t *testing.T) {
	root, _ := fixture(t)
	plugins := filepath.Join(t.TempDir(), "missing")
	if err := installBetterDiscord(root, t.TempDir(), plugins, false); err == nil {
		t.Fatal("missing folder accepted")
	}
	if _, err := os.Stat(plugins); !os.IsNotExist(err) {
		t.Fatal("unused plugin directory created")
	}
}

func TestBetterDiscordEnablePreservesOtherPlugins(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "BetterDiscord", "plugins")
	for _, channel := range []string{"stable", "ptb", "canary"} {
		file := filepath.Join(filepath.Dir(directory), "data", channel, "plugins.json")
		if err := writeFile(file, []byte(`{"OtherPlugin":true,"GamepadDebug":false,"HandheldControls":false}`), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := enableBetterDiscord(directory); err != nil {
		t.Fatal(err)
	}
	for _, channel := range []string{"stable", "ptb", "canary"} {
		data, err := os.ReadFile(filepath.Join(filepath.Dir(directory), "data", channel, "plugins.json"))
		if err != nil {
			t.Fatal(err)
		}
		var saved map[string]bool
		if err := json.Unmarshal(data, &saved); err != nil {
			t.Fatal(err)
		}
		if !saved["HandheldControls"] || !saved["OtherPlugin"] || saved["GamepadDebug"] {
			t.Fatalf("unexpected plugin settings: %v", saved)
		}
	}
}
