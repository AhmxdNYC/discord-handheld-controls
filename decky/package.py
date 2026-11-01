# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import shutil
import zipfile
root = Path(__file__).resolve().parent
output = root.parent / "dist/decky/HandheldControls-Decky.zip"
if not (root / "dist/index.js").exists():
    raise SystemExit("Run npm run build first")
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for file, name in [(root / "dist/index.js", "dist/index.js"), (root / "main.py", "main.py"),
                       (root / "plugin.json", "plugin.json"), (root / "package.json", "package.json"),
                       (root.parent / "LICENSE", "LICENSE"),
                       (root.parent / "docs/decky.md", "README.md")]:
        archive.write(file, "discord-handheld-controls/" + name)
print(output)
