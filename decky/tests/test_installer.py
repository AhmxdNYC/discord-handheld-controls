# SPDX-License-Identifier: GPL-3.0-or-later
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("backend", Path(__file__).resolve().parents[1] / "main.py")
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


def bundle(extra=None, manifest_edit=None):
    files = {f"payload/vencord/dist/{name}": name.encode() for name in ["renderer.js", "preload.js", "patcher.js"]}
    manifest = {"version": backend.VERSION, "files": {name: hashlib.sha256(value).hexdigest() for name, value in files.items()}}
    if manifest_edit:
        manifest_edit(manifest)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        prefix = "HandheldControls-Linux-x64/"
        for name, value in files.items():
            archive.writestr(prefix + name, value)
        archive.writestr(prefix + "manifest.json", json.dumps(manifest))
        if extra:
            archive.writestr(*extra)
    data = stream.getvalue()
    return data, hashlib.sha256(data).hexdigest()


class VerificationTests(unittest.TestCase):
    def test_valid_release(self):
        data, checksum = bundle()
        self.assertEqual(set(backend.verified_payload(data, checksum)), {"renderer.js", "preload.js", "patcher.js"})

    def test_wrong_download_checksum(self):
        data, _ = bundle()
        with self.assertRaisesRegex(ValueError, "archive checksum"):
            backend.verified_payload(data, "0" * 64)

    def test_archive_traversal(self):
        data, checksum = bundle(("../escape", b"no"))
        with self.assertRaisesRegex(ValueError, "Unsafe archive"):
            backend.verified_payload(data, checksum)

    def test_manifest_traversal(self):
        data, checksum = bundle(manifest_edit=lambda m: m["files"].update({"../escape": "0" * 64}))
        with self.assertRaisesRegex(ValueError, "Unsafe manifest"):
            backend.verified_payload(data, checksum)

    def test_symlink_rejected(self):
        link = zipfile.ZipInfo("HandheldControls-Linux-x64/link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        data, checksum = bundle((link, b"/tmp/escape"))
        with self.assertRaisesRegex(ValueError, "symlinks"):
            backend.verified_payload(data, checksum)

    def test_corrupt_payload(self):
        data, checksum = bundle(manifest_edit=lambda m: m["files"].update({"payload/vencord/dist/renderer.js": "0" * 64}))
        with self.assertRaisesRegex(ValueError, "Payload checksum"):
            backend.verified_payload(data, checksum)

    def test_wrong_version(self):
        data, checksum = bundle(manifest_edit=lambda m: m.update(version="0.0.0"))
        with self.assertRaisesRegex(ValueError, "version mismatch"):
            backend.verified_payload(data, checksum)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.installer = backend.Installer(self.home)
        self.config = self.home / ".config/vesktop"
        self.config.mkdir(parents=True)
        self.state = self.config / "state.json"
        backend.atomic_json(self.state, {"vencordDir": "/original/dist", "windowBounds": {"width": 800}})
        self.payload = {name: b"new build" for name in ["renderer.js", "preload.js", "patcher.js"]}
        self.patches = [patch.object(self.installer, "assert_user"), patch.object(self.installer, "assert_closed"),
                        patch.object(self.installer, "config", return_value=(self.config, "native")),
                        patch.object(self.installer, "download", return_value=self.payload),
                        patch.object(backend.shutil, "which", return_value="/usr/bin/vesktop")]
        for mock in self.patches:
            mock.start()

    def tearDown(self):
        for mock in reversed(self.patches):
            mock.stop()
        self.temp.cleanup()

    def test_install_preserves_settings_and_remove_restores_location(self):
        result = self.installer.install()
        self.assertTrue(result["installed"])
        self.assertEqual(backend.read_json(self.state)["windowBounds"], {"width": 800})
        self.assertTrue(self.installer.launcher.stat().st_mode & 0o111)
        self.installer.remove()
        self.assertEqual(backend.read_json(self.state)["vencordDir"], "/original/dist")
        self.assertFalse(self.installer.launcher.exists())

    def test_update_keeps_original_restore_path_and_shortcut(self):
        self.installer.install()
        self.installer.save_shortcut(12345)
        self.installer.install()
        self.assertEqual(backend.read_json(self.installer.record)["shortcutId"], 12345)
        self.installer.remove()
        self.assertEqual(backend.read_json(self.state)["vencordDir"], "/original/dist")

    def test_remove_preserves_later_user_choice(self):
        self.installer.install()
        state = backend.read_json(self.state)
        state["vencordDir"] = "/later/user-choice"
        backend.atomic_json(self.state, state)
        self.installer.remove()
        self.assertEqual(backend.read_json(self.state)["vencordDir"], "/later/user-choice")

    def test_remove_unsets_previously_absent_path(self):
        backend.atomic_json(self.state, {"windowBounds": {"width": 800}})
        self.installer.install()
        self.installer.remove()
        self.assertNotIn("vencordDir", backend.read_json(self.state))

    def test_failed_download_leaves_no_installation(self):
        with patch.object(self.installer, "download", side_effect=ValueError("checksum")):
            with self.assertRaises(ValueError):
                self.installer.install()
        self.assertFalse(self.installer.root.exists())
        self.assertEqual(backend.read_json(self.state)["vencordDir"], "/original/dist")

    def test_failed_update_rolls_back_dist_and_state(self):
        self.installer.install()
        target = self.config / "handheld-controls-decky/dist"
        (target / "renderer.js").write_bytes(b"existing")
        original = self.state.read_bytes()
        real_atomic = backend.atomic_json
        def fail_record(path, data):
            if path == self.installer.record:
                raise OSError("record failed")
            return real_atomic(path, data)
        with patch.object(backend, "atomic_json", side_effect=fail_record):
            with self.assertRaises(OSError):
                self.installer.install()
        self.assertEqual((target / "renderer.js").read_bytes(), b"existing")
        self.assertEqual(self.state.read_bytes(), original)

    def test_corrupt_settings_abort_before_state_change(self):
        self.state.write_text("invalid")
        with self.assertRaises(json.JSONDecodeError):
            self.installer.install()
        self.assertFalse(self.installer.root.exists())

    def test_shortcut_requires_installation(self):
        with self.assertRaises(RuntimeError):
            self.installer.save_shortcut(1)

    def test_remove_keeps_unrelated_files(self):
        self.installer.install()
        extra = self.config / "handheld-controls-decky/dist/custom.txt"
        extra.write_text("keep")
        self.installer.remove()
        self.assertEqual(extra.read_text(), "keep")

    def test_remove_refuses_edited_payload(self):
        self.installer.install()
        path = self.config / "handheld-controls-decky/dist/renderer.js"
        path.write_text("edited")
        with self.assertRaisesRegex(RuntimeError, "Managed file was edited"):
            self.installer.remove()
        self.assertTrue(self.installer.record.exists())
        self.assertEqual(path.read_text(), "edited")

    def test_late_failure_restores_launcher_and_record(self):
        self.installer.install()
        launcher = self.installer.launcher.read_bytes()
        record = self.installer.record.read_bytes()
        real_atomic = backend.atomic_json
        def fail_record(path, data):
            if path == self.installer.record:
                raise OSError("record failed")
            return real_atomic(path, data)
        with patch.object(backend, "atomic_json", side_effect=fail_record), patch.object(backend.shutil, "which", return_value="/usr/bin/new-vesktop"):
            with self.assertRaises(OSError):
                self.installer.install()
        self.assertEqual(self.installer.launcher.read_bytes(), launcher)
        self.assertEqual(self.installer.record.read_bytes(), record)

    def test_stale_flatpak_config_does_not_select_missing_client(self):
        (self.home / ".var/app" / backend.APP / "config/vesktop").mkdir(parents=True)
        with patch.object(self.installer, "flatpak_present", return_value=False):
            config, kind = backend.Installer.config(self.installer)
        self.assertEqual((config, kind), (self.config, "native"))

    def test_process_check_rejects_running_vesktop(self):
        # Call the real method, bypassing this fixture's no-live-process mock.
        def fake_run(args, **kwargs):
            self.assertIn("vesktop\\.bin", args[-1])
            return type("Result", (), {"returncode": 0})()
        self.installer.run = fake_run
        with self.assertRaisesRegex(RuntimeError, "Fully close"):
            backend.Installer.assert_closed(self.installer)


if __name__ == "__main__":
    unittest.main()
