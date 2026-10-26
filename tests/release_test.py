import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_chrome', SOURCE / 'scripts/package-chrome.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='xgoose-release-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for file, data in {
            'package.json': {'version': '0.2.8'},
            'apps/chrome/package.json': {'version': '0.2.8'},
            'apps/chrome/static/manifest.json': {'version': '0.2.8', 'manifest_version': 3},
            'package-lock.json': {'version': '0.2.8', 'packages': {
                '': {'version': '0.2.8'}, 'apps/chrome': {'version': '0.2.8'},
                'packages/core': {'version': '0.2.0'}}},
        }.items():
            path = self.root / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data))
        self.dist = self.root / 'apps/chrome/dist'
        (self.dist / 'skills').mkdir(parents=True)
        shutil.copyfile(self.root / 'apps/chrome/static/manifest.json', self.dist / 'manifest.json')
        for file in ('background.js', 'content.js', 'pageBridge.js', 'popup.html', 'options.html'):
            (self.dist / file).write_text('fixture')
        (self.root / 'apps/chrome/skills').mkdir()
        (self.root / 'apps/chrome/skills/fixture.xgs.js').write_text('authored fixture')
        (self.dist / 'skills/fixture.xgs.js').write_text('built fixture')
        (self.dist / 'skills/fixture.source.xgs.js').write_text('authored fixture')
        (self.dist / 'skills/registry.json').write_text('[{"name":"fixture","filePath":"skills/fixture.xgs.js","sourcePath":"skills/fixture.source.xgs.js"}]')
        (self.dist / 'content.js.map').write_text('excluded debug source')
        subprocess.run(['git', 'init', '-q', self.root], check=True)
        subprocess.run(['git', '-c', 'user.name=Release Test', '-c', 'user.email=test@example.invalid',
                        'commit', '-q', '--allow-empty', '-m', 'fixture'], cwd=self.root, check=True)

    def test_zip_is_reproducible_and_has_installable_root(self):
        a = release.build_archive(self.root, self.root / 'out-a')
        os.utime(self.dist / 'content.js', (100, 100))
        b = release.build_archive(self.root, self.root / 'out-b')
        self.assertEqual(a['sha256'], b['sha256'])
        with zipfile.ZipFile(self.root / 'out-a' / a['archive']) as z:
            self.assertIsNone(z.testzip())
            self.assertIn('manifest.json', z.namelist())
            self.assertNotIn('content.js.map', z.namelist())
            self.assertEqual(json.loads(z.read('manifest.json'))['version'], '0.2.8')

    def test_existing_release_archive_cannot_be_replaced(self):
        output = self.root / 'out'
        before = release.build_archive(self.root, output)
        archive = (output / before['archive']).read_bytes()
        (self.dist / 'content.js').write_text('different product code')
        with self.assertRaisesRegex(ValueError, 'replace'):
            release.build_archive(self.root, output)
        self.assertEqual((output / before['archive']).read_bytes(), archive)

    def test_manifest_locales_must_be_built_and_resolve_messages(self):
        manifest = {'version': '0.2.8', 'manifest_version': 3, 'default_locale': 'en',
                    'name': '__MSG_extensionName__', 'description': '__MSG_extensionDescription__'}
        for path in (self.root / 'apps/chrome/static/manifest.json', self.dist / 'manifest.json'):
            path.write_text(json.dumps(manifest))
        messages = {'extensionName': {'message': 'xgoose'},
                    'extensionDescription': {'message': 'Website AI assistant'}}
        for locale in ('en', 'zh_CN'):
            path = self.root / f'apps/chrome/static/_locales/{locale}/messages.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(messages))
        with self.assertRaisesRegex(ValueError, 'Missing or stale built locale'):
            release.build_archive(self.root, self.root / 'out')
        shutil.copytree(self.root / 'apps/chrome/static/_locales', self.dist / '_locales')
        result = release.build_archive(self.root, self.root / 'out')
        with zipfile.ZipFile(self.root / 'out' / result['archive']) as z:
            self.assertIn('_locales/zh_CN/messages.json', z.namelist())
            self.assertEqual(json.loads(z.read('_locales/en/messages.json')), messages)
        for base in (self.root / 'apps/chrome/static', self.dist):
            (base / '_locales/zh_CN/messages.json').write_text('{"extensionName":{"message":"xgoose"}}')
        with self.assertRaisesRegex(ValueError, 'Missing manifest message'):
            release.build_archive(self.root, self.root / 'invalid')

    def test_source_and_lockfile_version_mismatch_fail(self):
        path = self.root / 'package-lock.json'
        doc = json.loads(path.read_text())
        doc['packages']['apps/chrome']['version'] = '0.2.7'
        path.write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, 'Lockfile'):
            release.release_version(self.root)

    def test_stale_build_is_rejected(self):
        (self.dist / 'manifest.json').write_text('{"version":"0.2.7"}')
        with self.assertRaisesRegex(ValueError, 'Built manifest'):
            release.build_archive(self.root, self.root / 'out')

    def test_missing_bundle_and_empty_skills_fail(self):
        (self.dist / 'background.js').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing built'):
            release.build_archive(self.root, self.root / 'out')
        (self.dist / 'background.js').write_text('fixture')
        (self.dist / 'skills/registry.json').write_text('[]')
        with self.assertRaisesRegex(ValueError, 'registry does not match'):
            release.build_archive(self.root, self.root / 'out')

    def test_version_command_updates_only_release_packages(self):
        (self.root / 'scripts').mkdir()
        shutil.copyfile(SOURCE / 'scripts/set-version.mjs', self.root / 'scripts/set-version.mjs')
        subprocess.run(['node', 'scripts/set-version.mjs', '0.2.9'], cwd=self.root, check=True, capture_output=True)
        self.assertEqual(release.release_version(self.root), '0.2.9')
        lock = json.loads((self.root / 'package-lock.json').read_text())
        self.assertEqual(lock['packages']['packages/core']['version'], '0.2.0')
        for version in ('0.0.0', '01.2.3', '1.2.65536', '1.2.3-beta', 'not-a-version'):
            result = subprocess.run(['node', 'scripts/set-version.mjs', version], cwd=self.root, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(release.release_version(self.root), '0.2.9')


if __name__ == '__main__':
    unittest.main()
