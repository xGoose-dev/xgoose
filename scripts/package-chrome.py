#!/usr/bin/env python3
"""Validate versions and create a deterministic Chrome-store ZIP (stdlib only)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def release_version(root):
    paths = ('package.json', 'apps/chrome/package.json', 'apps/chrome/static/manifest.json')
    versions = {path: json.loads((root / path).read_text())['version'] for path in paths}
    version = versions['package.json']
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Version must have three numeric components without leading zeroes')
    if any(int(part) > 65535 for part in version.split('.')) or version == '0.0.0':
        raise ValueError('Version does not satisfy Chrome version limits')
    if len(set(versions.values())) != 1:
        raise ValueError(f'Package/manifest version mismatch: {versions}')
    lock = json.loads((root / 'package-lock.json').read_text())
    for actual in (lock['version'], lock['packages']['']['version'], lock['packages']['apps/chrome']['version']):
        if actual != version:
            raise ValueError('Lockfile versions differ; run the version script')
    return version


def build_archive(root, output):
    version = release_version(root)
    dist = root / 'apps/chrome/dist'
    if json.loads((dist / 'manifest.json').read_text()) != json.loads((root / 'apps/chrome/static/manifest.json').read_text()):
        raise ValueError('Built manifest differs from source; rebuild before packaging')
    for required in ('background.js', 'content.js', 'pageBridge.js', 'popup.html', 'options.html'):
        if not (dist / required).is_file():
            raise ValueError(f'Missing built extension file: {required}')
    registry = json.loads((dist / 'skills/registry.json').read_text())
    sources = list((root / 'apps/chrome/skills').glob('*.xgs.js'))
    if not isinstance(registry, list) or len(registry) != len(sources):
        raise ValueError('Built-in skill registry does not match authored skill sources')
    skill_paths = set()
    for skill in registry:
        for field in ('filePath', 'sourcePath'):
            relative = skill.get(field, '')
            target = dist / relative
            if not relative or not target.resolve().is_relative_to(dist.resolve()) or not target.is_file():
                raise ValueError(f'Missing or invalid skill {field}')
        if skill['filePath'] in skill_paths:
            raise ValueError('Duplicate built-in skill file')
        skill_paths.add(skill['filePath'])
    files = []
    for path in sorted(dist.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlinks are not allowed in release archives')
        if path.is_file() and path.suffix != '.map' and path.name != '.DS_Store':
            files.append(path)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'xgoose-chrome-{version}.zip'
    temporary = output / f'.{archive.name}.tmp'
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for path in files:
                entry = zipfile.ZipInfo(path.relative_to(dist).as_posix(), (2020, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                z.writestr(entry, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        if archive.exists() and archive.read_bytes() != temporary.read_bytes():
            raise ValueError('Refusing to replace a different archive with the same version')
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / 'SHA256SUMS').write_text(f'{digest}  {archive.name}\n')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    report = {'version': version, 'commit': commit, 'archive': archive.name,
              'sha256': digest, 'bytes': archive.stat().st_size,
              'built_in_skills': len(registry), 'files': len(files)}
    (output / 'release-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version-only', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    print(release_version(root) if args.version_only else json.dumps(build_archive(root, args.output or root / 'artifacts/ci-release'), indent=2))
