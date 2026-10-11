// SPDX-License-Identifier: GPL-3.0-or-later
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type manifest struct {
	Version   string            `json:"version"`
	Installer string            `json:"installer"`
	Files     map[string]string `json:"files"`
}
type installation struct {
	Directory string            `json:"directory"`
	Hashes    map[string]string `json:"hashes"`
}

var pluginNames = []string{"HandheldControls.plugin.js", "HeldIndicator.plugin.js", "GamepadDebug.plugin.js"}

func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func safePath(root, relative string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(relative))
	if relative == "" || strings.HasPrefix(relative, "/") || strings.HasPrefix(relative, "\\") || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.Contains(clean, ":") {
		return "", fmt.Errorf("invalid bundle path: %s", relative)
	}
	return filepath.Join(root, clean), nil
}
func verifyBundle(root string) (manifest, error) {
	var m manifest
	data, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return m, err
	}
	if err = json.Unmarshal(data, &m); err != nil {
		return m, err
	}
	required := []string{"payload/vencord/dist/patcher.js", "payload/vencord/dist/preload.js", "payload/vencord/dist/renderer.js"}
	for _, name := range pluginNames {
		required = append(required, "payload/betterdiscord/"+name)
	}
	if !strings.HasPrefix(m.Installer, "native/") {
		return m, errors.New("bundle is missing its native installer")
	}
	required = append(required, m.Installer)
	for _, name := range required {
		if _, ok := m.Files[name]; !ok {
			return m, fmt.Errorf("bundle manifest is missing %s", name)
		}
	}
	for name, expected := range m.Files {
		path, err := safePath(root, name)
		if err != nil {
			return m, err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return m, err
		}
		if digest(data) != expected {
			return m, fmt.Errorf("bundle verification failed: %s; extract a fresh download", name)
		}
	}
	return m, nil
}
func writeFile(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".hh-install-*")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	if _, err = temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err = temporary.Chmod(mode); err != nil {
		temporary.Close()
		return err
	}
	if err = temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporary.Name(), path)
}
func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("symlinks are not accepted in the payload")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return writeFile(target, data, 0644)
	})
}
func deployVencord(root, state string) (string, error) {
	target := filepath.Join(state, "vencord")
	dist := filepath.Join(target, "dist")
	stage := filepath.Join(target, ".dist-new")
	if err := os.RemoveAll(stage); err != nil {
		return "", err
	}
	if err := copyTree(filepath.Join(root, "payload", "vencord", "dist"), stage); err != nil {
		return "", err
	}
	backup := filepath.Join(state, "backups", "vencord-"+time.Now().Format("20060102-150405.000000000"))
	if _, err := os.Stat(dist); err == nil {
		if err := os.MkdirAll(filepath.Dir(backup), 0755); err != nil {
			return "", err
		}
		if err := os.Rename(dist, backup); err != nil {
			return "", err
		}
		if err := os.Rename(stage, dist); err != nil {
			restoreErr := os.Rename(backup, dist)
			return "", fmt.Errorf("could not deploy build: %v; rollback: %v", err, restoreErr)
		}
	} else if !os.IsNotExist(err) {
		return "", err
	} else if err := os.Rename(stage, dist); err != nil {
		return "", err
	}
	return target, nil
}
func defaultPlugins(platform, home, appdata, xdg string) (string, error) {
	switch platform {
	case "windows":
		if appdata == "" {
			return "", errors.New("APPDATA missing; select a custom BetterDiscord plugin folder")
		}
		return filepath.Join(appdata, "BetterDiscord", "plugins"), nil
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "BetterDiscord", "plugins"), nil
	case "linux":
		if xdg == "" {
			xdg = filepath.Join(home, ".config")
		}
		return filepath.Join(xdg, "BetterDiscord", "plugins"), nil
	}
	return "", errors.New("unsupported platform")
}
func installBetterDiscord(root, state, directory string, remove bool) error {
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("BetterDiscord plugin folder not found: %s; install BetterDiscord first or choose its Open Plugins Folder path", directory)
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		return err
	}
	recordPath := filepath.Join(state, "betterdiscord", digest([]byte(directory))+".json")
	if remove {
		var record installation
		data, err := os.ReadFile(recordPath)
		if err != nil {
			return errors.New("no native installer record for this folder; disable/remove the plugins through BetterDiscord")
		}
		if err := json.Unmarshal(data, &record); err != nil {
			return err
		}
		for _, name := range pluginNames {
			data, err := os.ReadFile(filepath.Join(directory, name))
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return err
			}
			if digest(data) != record.Hashes[name] {
				return fmt.Errorf("refusing to remove edited plugin: %s", name)
			}
		}
		for _, name := range pluginNames {
			if err := os.Remove(filepath.Join(directory, name)); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return os.Remove(recordPath)
	}
	sources := map[string][]byte{}
	for _, name := range pluginNames {
		data, err := os.ReadFile(filepath.Join(root, "payload", "betterdiscord", name))
		if err != nil {
			return err
		}
		sources[name] = data
	}
	backup := filepath.Join(state, "backups", "betterdiscord-"+time.Now().Format("20060102-150405.000000000"))
	for _, name := range pluginNames {
		data, err := os.ReadFile(filepath.Join(directory, name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if digest(data) != digest(sources[name]) {
			if err := writeFile(filepath.Join(backup, name), data, 0644); err != nil {
				return err
			}
		}
	}
	record := installation{Directory: directory, Hashes: map[string]string{}}
	for _, name := range pluginNames {
		if err := writeFile(filepath.Join(directory, name), sources[name], 0644); err != nil {
			return err
		}
		record.Hashes[name] = digest(sources[name])
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(recordPath, data, 0644)
}
func runNative(binary, target, action, branch, location string) error {
	args := []string{"--" + action}
	if branch != "" {
		args = append(args, "--branch", branch)
	}
	if location != "" {
		args = append(args, "--location", location)
	}
	command := exec.Command(binary, args...)
	command.Env = append(os.Environ(), "VENCORD_USER_DATA_DIR="+target, "VENCORD_DEV_INSTALL=1")
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	if runtime.GOOS != "windows" {
		if err := os.Chmod(binary, 0755); err != nil {
			return err
		}
	}
	if err := command.Run(); err != nil {
		return fmt.Errorf("Discord installer failed: %w", err)
	}
	return nil
}
func prompt(reader *bufio.Reader, text string) (string, error) {
	fmt.Print(text)
	line, err := reader.ReadString('\n')
	if err != nil && !(errors.Is(err, io.EOF) && len(line) > 0) {
		return "", err
	}
	return strings.TrimSpace(line), nil
}
func main() {
	check := flag.Bool("check", false, "Verify bundle without installing")
	client := flag.String("client", "", "discord, vencord, betterdiscord or vesktop")
	action := flag.String("action", "install", "install or uninstall")
	branch := flag.String("branch", "", "stable, ptb, canary or auto")
	location := flag.String("location", "", "custom Discord installation")
	plugins := flag.String("plugins-dir", "", "custom BetterDiscord plugins folder")
	flag.Parse()
	executable, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	root := filepath.Dir(executable)
	m, err := verifyBundle(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *check {
		fmt.Println("Bundle verified:", m.Version)
		return
	}
	reader := bufio.NewReader(os.Stdin)
	interactive := *client == ""
	fmt.Println("Handheld Controls Installer", m.Version)
	if interactive {
		fmt.Println("\n1  Install in regular Discord / Vencord\n2  Install in BetterDiscord\n3  Prepare Vesktop build\n4  Restore regular Discord (remove Vencord)\n5  Remove BetterDiscord controller plugins\n0  Exit")
		choice, inputErr := prompt(reader, "\nChoose a number: ")
		err = inputErr
		if err == nil {
			switch choice {
			case "0":
				return
			case "1":
				*client = "discord"
			case "2":
				*client = "betterdiscord"
			case "3":
				*client = "vesktop"
			case "4":
				*client, *action = "discord", "uninstall"
			case "5":
				*client, *action = "betterdiscord", "uninstall"
			default:
				err = errors.New("choose a number from 0 to 5")
			}
		}
	}
	if err == nil {
		err = perform(root, m, *client, *action, *branch, *location, *plugins, reader, interactive)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "\nInstallation did not complete:", err)
	}
	if interactive {
		_, _ = prompt(reader, "\nPress Enter to close.")
	}
	if err != nil {
		os.Exit(1)
	}
}
func perform(root string, m manifest, client, action, branch, location, plugins string, reader *bufio.Reader, interactive bool) error {
	if action != "install" && action != "uninstall" {
		return errors.New("action must be install or uninstall")
	}
	if branch != "" && branch != "stable" && branch != "ptb" && branch != "canary" && branch != "auto" {
		return errors.New("invalid Discord channel")
	}
	if branch != "" && location != "" {
		return errors.New("choose branch or location, not both")
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	state := filepath.Join(config, "DiscordHandheldControls")
	switch client {
	case "betterdiscord":
		if branch != "" || location != "" {
			return errors.New("BetterDiscord uses its plugins folder, not Discord install selectors")
		}
		if plugins == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return err
			}
			plugins, err = defaultPlugins(runtime.GOOS, home, os.Getenv("APPDATA"), os.Getenv("XDG_CONFIG_HOME"))
			if err != nil {
				return err
			}
		}
		if interactive {
			fmt.Println("\nBetterDiscord plugin folder:", plugins)
			custom, err := prompt(reader, "Enter a different folder, or press Enter to use this one: ")
			if err != nil {
				return err
			}
			if custom != "" {
				plugins = strings.Trim(custom, "\"")
			}
		}
		if err := installBetterDiscord(root, state, plugins, action == "uninstall"); err != nil {
			return err
		}
		if action == "install" {
			fmt.Println("\nInstalled. Enable HandheldControls in Settings > BetterDiscord > Plugins.")
		} else {
			fmt.Println("Removed controller plugins. Saved settings and BetterDiscord remain.")
		}
	case "discord", "vencord":
		if plugins != "" {
			return errors.New("plugin folder applies to BetterDiscord only")
		}
		target := filepath.Join(state, "vencord")
		if action == "install" {
			fmt.Println("\nFully quit Discord. This installs the bundled Vencord build with controller plugins.")
			fmt.Println("If you use other custom Vencord plugins, use the source setup with your existing checkout to preserve them.")
			if interactive {
				value, err := prompt(reader, "Press Enter to continue, or type cancel: ")
				if err != nil {
					return err
				}
				if value != "" {
					return errors.New("cancelled")
				}
			}
			target, err = deployVencord(root, state)
			if err != nil {
				return err
			}
		}
		binary, err := safePath(root, m.Installer)
		if err != nil {
			return err
		}
		if err := runNative(binary, target, action, branch, location); err != nil {
			return err
		}
		if action == "install" {
			fmt.Println("\nRestart Discord. Enable HandheldControls in Settings > Vencord > Plugins, then restart again.")
		} else {
			fmt.Println("Discord restored. Restart it.")
		}
	case "vesktop":
		if action != "install" || branch != "" || location != "" || plugins != "" {
			return errors.New("Vesktop supports preparing a custom build folder only")
		}
		target, err := deployVencord(root, state)
		if err != nil {
			return err
		}
		fmt.Println("\nIn Vesktop Settings > Developer Settings > Vencord Location, choose:")
		fmt.Println(filepath.Join(target, "dist"))
		fmt.Println("Restart Vesktop and enable HandheldControls. Flatpak may need access to this folder.")
	default:
		return errors.New("client must be discord, vencord, betterdiscord or vesktop")
	}
	fmt.Println("\nInstalled files are kept in:", state)
	return nil
}
