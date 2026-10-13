"""Build native, self-contained installer ZIPs. Requires Go, Python, and built plugin payloads."""
import argparse
import hashlib
import json
import os
import platform as system_platform
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {
    "Windows-x64": ("windows", "amd64", "VencordInstallerCli.exe", "15268aba25625797bf562187dd87ddadf42882e079c7b6192880ad3e83353ef5"),
    "Linux-x64": ("linux", "amd64", "VencordInstallerCli-linux", "52642c8521a866ad241c10337144a4f513672c54b9c86a8169954785054c815d"),
    "macOS-Intel": ("darwin", "amd64", "VencordInstallerCli-darwin", "f4c77a9dddd4a12deaae270b3dadfda25969dfcfa141cc2354cafe6344044b75"),
    "macOS-AppleSilicon": ("darwin", "arm64", "VencordInstallerCli-darwin", "f4c77a9dddd4a12deaae270b3dadfda25969dfcfa141cc2354cafe6344044b75"),
}
REVISION = "b52ed365cf2ea64a5019b419291a2d9d4d76852d"

def download(url, path, expected=None):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        if expected and hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError(f"Download verification failed: {path.name}")
        path.write_bytes(data)
    if expected and hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"Cached download verification failed: {path.name}")

def make_zip(directory, archive):
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                output.write(path, Path(directory.name) / path.relative_to(directory))

def package(name, go, vencord):
    platform, arch, asset, checksum = TARGETS[name]
    directory = ROOT / ".build" / "bundles" / f"HandheldControls-{name}"
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    for required in ["patcher.js", "preload.js", "renderer.js"]:
        if not (vencord / "dist" / required).is_file():
            raise RuntimeError(f"Build Vencord first; missing {required}")
    payload = directory / "payload"
    (payload / "vencord" / "dist").mkdir(parents=True)
    for path in (vencord / "dist").iterdir():
        if path.is_file() and path.suffix in [".js", ".css", ".txt"]:
            shutil.copy2(path, payload / "vencord" / "dist" / path.name)
    shutil.copytree(ROOT / "dist" / "betterdiscord", payload / "betterdiscord")
    cache = ROOT / ".build" / "installers" / "v1.4.2" / asset
    download(f"https://github.com/Vencord/Installer/releases/download/v1.4.2/{asset}", cache, checksum)
    native = directory / "native"
    native.mkdir()
    shutil.copy2(cache, native / asset)
    (native / asset).chmod(0o755)
    executable = directory / ("HandheldControls-Installer.exe" if platform == "windows" else "HandheldControls-Installer")
    environment = dict(os.environ, GOOS=platform, GOARCH=arch, CGO_ENABLED="0")
    subprocess.run([go, "build", "-trimpath", "-ldflags=-s -w", "-o", str(executable), "."], cwd=ROOT / "installer", env=environment, check=True)
    executable.chmod(0o755)
    if platform == "darwin":
        launcher = directory / "Install.command"
        launcher.write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec ./HandheldControls-Installer\n')
        launcher.chmod(0o755)
    elif platform == "linux":
        launcher = directory / "Install.sh"
        launcher.write_text('''#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -t 0 ]; then exec ./HandheldControls-Installer; fi
for terminal in konsole gnome-terminal x-terminal-emulator xterm; do
    if command -v "$terminal" >/dev/null 2>&1; then
        if [ "$terminal" = gnome-terminal ]; then exec "$terminal" --wait -- "$PWD/HandheldControls-Installer"; fi
        exec "$terminal" -e "$PWD/HandheldControls-Installer"
    fi
done
echo "Open this folder in a terminal and run ./HandheldControls-Installer"
exit 1
''')
        launcher.chmod(0o755)
        desktop = directory / "Install.desktop"
        command = r'sh -c "cd \"\$(dirname \"\$1\")\"; exec ./Install.sh" sh %k'
        escaped = command.replace("\\", "\\\\")
        desktop.write_text("[Desktop Entry]\nType=Application\nName=Handheld Controls Installer\nTerminal=true\nExec=" + escaped + "\nIcon=input-gaming\n")
        desktop.chmod(0o755)
    source = directory / "source"
    source.mkdir()
    subprocess.run(["git", "archive", "--format=zip", f"--output={source / 'Vencord-source.zip'}", REVISION], cwd=vencord, check=True)
    shutil.copytree(ROOT / "plugins", source / "plugins")
    shutil.copytree(ROOT / "betterdiscord", source / "betterdiscord")
    shutil.copytree(ROOT / "installer", source / "installer", ignore=shutil.ignore_patterns("*.exe", "HandheldControls-Installer"))
    shutil.copytree(ROOT / "scripts", source / "scripts", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name_ in ["package.json", "package-lock.json"]:
        shutil.copy2(ROOT / name_, source / name_)
    installer_source = ROOT / ".build" / "sources" / "VencordInstaller-v1.4.2.zip"
    download("https://codeload.github.com/Vencord/Installer/zip/refs/tags/v1.4.2", installer_source)
    shutil.copy2(installer_source, source / "VencordInstaller-source.zip")
    shutil.copy2(ROOT / "LICENSE", directory / "LICENSE")
    shutil.copy2(ROOT / "docs" / "downloadable-installers.md", directory / "START-HERE.txt")
    manifest = {"version": json.loads((ROOT / "package.json").read_text())["version"], "installer": f"native/{asset}", "files": {}}
    for path in sorted(directory.rglob("*")):
        if path.is_file() and path.relative_to(directory).parts[0] in ["payload", "native"]:
            manifest["files"][path.relative_to(directory).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
    if platform == {"Windows": "windows", "Linux": "linux", "Darwin": "darwin"}.get(system_platform.system()):
        # Cross-built binaries can only be checked on a compatible CPU/runtime.
        machine = system_platform.machine().lower()
        if (arch == "amd64" and machine in ["amd64", "x86_64"]) or (arch == "arm64" and machine in ["arm64", "aarch64"]):
            subprocess.run([str(executable), "--check"], check=True)
    releases = ROOT / "dist" / "installers"
    releases.mkdir(parents=True, exist_ok=True)
    archive = releases / f"HandheldControls-{name}.zip"
    make_zip(directory, archive)
    print(archive)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=[*TARGETS, "all"], default="all")
    parser.add_argument("--go", default="go")
    parser.add_argument("--vencord", type=Path, default=ROOT / ".build" / "Vencord")
    options = parser.parse_args()
    for target in TARGETS if options.target == "all" else [options.target]:
        package(target, str(Path(options.go).resolve()) if Path(options.go).exists() else options.go, options.vencord.resolve())
    output = ROOT / "dist" / "installers"
    (output / "SHA256SUMS.txt").write_text("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in sorted(output.glob("*.zip"))))
