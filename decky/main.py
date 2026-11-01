# SPDX-License-Identifier: GPL-3.0-or-later
"""Decky backend. Filesystem work is deliberately separate from Decky imports."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shlex
import shutil
import ssl
import stat
import subprocess
import tempfile
import urllib.request
import zipfile

VERSION = "6.34.0"
APP = "dev.vencord.Vesktop"
ARCHIVE_SHA256 = "0b97eb47b2fc5953a28aa4cac1e3a88158bb4fa65c68e79996cba6d766ac9c5e"
ARCHIVE_URL = f"https://github.com/AhmxdNYC/discord-handheld-controls/releases/download/v{VERSION}/HandheldControls-Linux-x64.zip"
MAX_DOWNLOAD = 64 * 1024 * 1024
MAX_EXPANDED = 160 * 1024 * 1024


def read_json(path):
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"Expected an object in {path.name}; no changes were made")
    return data


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(data, stream, indent=2)
        stream.write("\n")
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def verified_payload(data, expected=ARCHIVE_SHA256):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Release archive checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        total = 0
        members = {}
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in entry.filename or ":" in entry.filename:
                raise ValueError("Unsafe archive path")
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Archive symlinks are not allowed")
            total += entry.file_size
            if total > MAX_EXPANDED:
                raise ValueError("Archive exceeds expanded size limit")
            if entry.filename in members:
                raise ValueError("Duplicate archive entry")
            members[entry.filename] = entry
        prefix = "HandheldControls-Linux-x64/"
        manifest = json.loads(archive.read(prefix + "manifest.json"))
        if manifest.get("version") != VERSION:
            raise ValueError("Release manifest version mismatch")
        payload = {}
        for name, checksum in manifest.get("files", {}).items():
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
                raise ValueError("Unsafe manifest path")
            content = archive.read(prefix + name)
            if hashlib.sha256(content).hexdigest() != checksum:
                raise ValueError(f"Payload checksum mismatch: {name}")
            if name.startswith("payload/vencord/dist/"):
                relative = name.removeprefix("payload/vencord/dist/")
                if "/" in relative or not relative:
                    raise ValueError("Unexpected nested dist file")
                payload[relative] = content
        if not {"renderer.js", "preload.js", "patcher.js"}.issubset(payload):
            raise ValueError("Missing required Vencord files")
        return payload


CA_BUNDLES = ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem", "/etc/ssl/ca-bundle.pem"]


def _ssl_context(bundles=None):
    """Decky's frozen Python has no default CA path: fall back to the system bundle (or certifi). Verification stays on."""
    context = ssl.create_default_context()
    if context.cert_store_stats()["x509_ca"] == 0:
        candidates = list(CA_BUNDLES if bundles is None else bundles)
        try:
            import certifi
            candidates.append(certifi.where())
        except ImportError:
            pass
        for path in candidates:
            if os.path.isfile(path):
                context.load_verify_locations(cafile=path)
                break
    return context


class Installer:
    def __init__(self, home, run=subprocess.run):
        self.home = Path(home).resolve()
        self.run = run
        self.root = self.home / ".local/share/discord-handheld-controls-decky"
        self.record = self.root / "installation.json"
        self.launcher = self.root / "launch-vesktop.sh"

    def config(self):
        # Flatpak data is accessible to Vesktop without broad filesystem grants.
        flatpak = self.home / ".var/app" / APP / "config/vesktop"
        native = self.home / ".config/vesktop"
        if self.flatpak_present():
            return flatpak, "flatpak"
        if shutil.which("vesktop"):
            return native, "native"
        return flatpak, "missing"

    def flatpak_present(self):
        if not shutil.which("flatpak"):
            return False
        result = self.run(["flatpak", "info", APP], capture_output=True, text=True, timeout=30)
        return result.returncode == 0

    def assert_user(self):
        if self.home.stat().st_uid != os.getuid() or os.getuid() == 0:
            raise RuntimeError("Run this Decky plugin without the _root flag as the desktop user")
        if platform.machine().lower() not in ("x86_64", "amd64"):
            raise RuntimeError("This release supports Linux x86-64 (Steam Deck and Bazzite)")

    def assert_managed_paths(self, config):
        # Never follow a user-edited symlink into unrelated data.
        for path in (Path(config), self.root):
            relative = path.relative_to(self.home)
            current = self.home
            for part in relative.parts:
                current /= part
                if current.is_symlink():
                    raise RuntimeError("Symlinked installation directories are not supported")
        for path in (Path(config) / "handheld-controls-decky", Path(config) / "handheld-controls-decky/dist", Path(config) / "handheld-controls-decky/dist.previous"):
            if path.is_symlink():
                raise RuntimeError("Symlinked payload directories are not supported")

    def assert_closed(self):
        # Read-only process inspection: never kill the user's Discord session.
        result = self.run(["pgrep", "-u", str(os.getuid()), "-x", r"(vesktop|vesktop\.bin|Vesktop)"], capture_output=True, timeout=10)
        if result.returncode == 0:
            raise RuntimeError("Fully close Vesktop, including its tray icon, before changing its installation")
        if result.returncode != 1:
            raise RuntimeError("Could not determine whether Vesktop is closed")

    def status(self):
        config, kind = self.config()
        saved = read_json(self.record)
        return {"installed": bool(saved.get("version")), "version": saved.get("version"),
                "available": VERSION, "vesktop": kind, "shortcutId": saved.get("shortcutId"),
                "launcher": str(self.launcher), "directory": str(self.root),
                "message": "Close Vesktop before Install, Update, Repair, or Remove.",
                "customBuild": read_json(config / "state.json").get("vencordDir") if not saved else None}

    def download(self):
        request = urllib.request.Request(ARCHIVE_URL, headers={"User-Agent": "HandheldControls-Decky"})
        with urllib.request.urlopen(request, timeout=120, context=_ssl_context()) as response:
            data = response.read(MAX_DOWNLOAD + 1)
        if len(data) > MAX_DOWNLOAD:
            raise ValueError("Release download exceeds size limit")
        return verified_payload(data)

    def install(self):
        self.assert_user()
        self.assert_closed()
        config, kind = self.config()
        if kind == "missing":
            raise RuntimeError("Install Vesktop first using the separate Install Vesktop button")
        self.assert_managed_paths(config)
        payload = self.download()  # Verify before making any filesystem changes.
        state_path = config / "state.json"
        current = read_json(state_path)
        saved = read_json(self.record)
        target = config / "handheld-controls-decky/dist"
        self.root.mkdir(parents=True, exist_ok=True)
        if not saved:
            saved = {"config": str(config), "previousVencordDir": current.get("vencordDir"),
                     "hadVencordDir": "vencordDir" in current}
            if state_path.exists():
                shutil.copy2(state_path, self.root / "state.before-install.json")
        elif saved.get("config") != str(config):
            raise RuntimeError("Vesktop configuration location changed; remove the previous installation first")
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".new-", dir=target.parent))
        backup = target.parent / "dist.previous"
        old_state = dict(current)
        old_launcher = self.launcher.read_bytes() if self.launcher.exists() else None
        old_record = self.record.read_bytes() if self.record.exists() else None
        deployed = False
        try:
            # Vesktop's isValidVencordInstall() needs package.json; without it Vesktop replaces the folder with upstream Vencord.
            payload.setdefault("package.json", b"{}")
            for name, content in payload.items():
                (stage / name).write_bytes(content)
            if backup.exists():
                shutil.rmtree(backup)
            if target.exists():
                target.rename(backup)
            stage.rename(target)
            deployed = True
            current["vencordDir"] = str(target)
            atomic_json(state_path, current)
            command = "flatpak run " + APP if kind == "flatpak" else shlex.quote(shutil.which("vesktop"))
            temporary_launcher = self.root / ".launcher-new"
            temporary_launcher.write_text("#!/bin/sh\nexec " + command + ' "$@"\n')
            temporary_launcher.chmod(0o755)
            temporary_launcher.replace(self.launcher)
            saved["launcherHash"] = hashlib.sha256(self.launcher.read_bytes()).hexdigest()
            saved["version"] = VERSION
            saved["hashes"] = {name: hashlib.sha256(content).hexdigest() for name, content in payload.items()}
            atomic_json(self.record, saved)
        except Exception:
            if deployed:
                shutil.rmtree(target)
                atomic_json(state_path, old_state)
            if backup.exists() and not target.exists():
                backup.rename(target)
            for path, old_data in [(self.launcher, old_launcher), (self.record, old_record)]:
                if old_data is None:
                    path.unlink(missing_ok=True)
                else:
                    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as rollback:
                        rollback.write(old_data)
                        rollback_path = Path(rollback.name)
                    rollback_path.chmod(0o755 if path == self.launcher else 0o600)
                    rollback_path.replace(path)
            raise
        finally:
            if stage.exists():
                shutil.rmtree(stage)
        return self.status()

    def install_vesktop(self):
        self.assert_user()
        if not shutil.which("flatpak"):
            raise RuntimeError("Flatpak is required; install it using your operating system first")
        # No root/system install and no remote changes. Use an existing Flathub remote.
        self.run(["flatpak", "install", "--user", "--noninteractive", "-y", "flathub", APP],
                 check=True, capture_output=True, timeout=900)
        return self.status()

    def remove(self):
        self.assert_user()
        self.assert_closed()
        saved = read_json(self.record)
        if not saved:
            return self.status()
        config = Path(saved["config"])
        allowed = [self.home / ".config/vesktop", self.home / ".var/app" / APP / "config/vesktop"]
        if config not in allowed:
            raise RuntimeError("Invalid saved configuration path")
        self.assert_managed_paths(config)
        state_path = config / "state.json"
        current = read_json(state_path)
        target = config / "handheld-controls-decky/dist"
        # Refuse to delete edits. Extra files and backups are always kept.
        for name, checksum in saved.get("hashes", {}).items():
            if PurePosixPath(name).name != name or name in (".", ".."):
                raise RuntimeError("Invalid recorded payload path")
            path = target / name
            if path.exists() and (path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != checksum):
                raise RuntimeError(f"Managed file was edited; preserve or move it before Remove: {name}")
        if self.launcher.exists() and (self.launcher.is_symlink() or hashlib.sha256(self.launcher.read_bytes()).hexdigest() != saved.get("launcherHash")):
            raise RuntimeError("Launcher was edited; preserve or move it before Remove")
        if current.get("vencordDir") == str(target):
            if saved.get("hadVencordDir"):
                current["vencordDir"] = saved.get("previousVencordDir")
            else:
                current.pop("vencordDir", None)
            atomic_json(state_path, current)
        # Preserve unrelated settings and never uninstall Vesktop itself.
        for name in saved.get("hashes", {}):
            (target / name).unlink(missing_ok=True)
        if target.exists() and not any(target.iterdir()):
            target.rmdir()
        if target.parent.exists() and not any(target.parent.iterdir()):
            target.parent.rmdir()
        self.launcher.unlink(missing_ok=True)
        self.record.unlink(missing_ok=True)
        return self.status()

    def save_shortcut(self, app_id):
        if not isinstance(app_id, int) or app_id <= 0:
            raise ValueError("Invalid Steam shortcut ID")
        saved = read_json(self.record)
        if not saved:
            raise RuntimeError("Install Handheld Controls before adding its Steam shortcut")
        saved["shortcutId"] = app_id
        atomic_json(self.record, saved)
        return self.status()


class Plugin:
    async def _main(self):
        import decky
        self.installer = Installer(decky.DECKY_USER_HOME)
        self.lock = asyncio.Lock()

    async def status(self):
        return await asyncio.to_thread(self.installer.status)

    async def perform(self, action):
        actions = {"install": self.installer.install, "update": self.installer.install,
                   "repair": self.installer.install, "remove": self.installer.remove,
                   "install_vesktop": self.installer.install_vesktop}
        if action not in actions:
            raise ValueError("Unknown installer action")
        async with self.lock:
            return await asyncio.to_thread(actions[action])

    async def save_shortcut(self, app_id):
        async with self.lock:
            return await asyncio.to_thread(self.installer.save_shortcut, app_id)

    async def _unload(self):
        pass

    async def _uninstall(self):
        # Explicit Remove in UI owns changes; unloading never destroys an installation.
        pass
