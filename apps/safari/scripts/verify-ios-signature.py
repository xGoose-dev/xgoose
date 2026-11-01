#!/usr/bin/env python3
"""Fail closed on the exported IPA, not just its provisioning profiles.

An export can succeed with valid profiles while silently losing the signed
App Group and shared Keychain entitlements. That breaks every NativeService
operation on real devices. Run this immediately before every upload.
"""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import zipfile

TEAM = '2L6B6ZA57F'
APP_ID = 'org.xgoose.xgoose-safari'
GROUP = 'group.' + APP_ID
KEYCHAIN = TEAM + '.' + APP_ID


def validate_entitlements(actual, allowed, bundle_id):
    for label, entitlements in [('signed executable', actual), ('profile', allowed)]:
        if GROUP not in entitlements.get('com.apple.security.application-groups', []):
            raise ValueError(f'{bundle_id}: {label} missing required App Group')
        groups = entitlements.get('keychain-access-groups', [])
        if KEYCHAIN not in groups and not (label == 'profile' and TEAM + '.*' in groups):
            raise ValueError(f'{bundle_id}: {label} missing shared Keychain')
        if entitlements.get('application-identifier') != TEAM + '.' + bundle_id:
            raise ValueError(f'{bundle_id}: {label} application identifier mismatch')
        if entitlements.get('com.apple.developer.team-identifier') != TEAM:
            raise ValueError(f'{bundle_id}: {label} team mismatch')
        if entitlements.get('get-task-allow') is not False:
            raise ValueError(f'{bundle_id}: {label} is not a distribution signature')


def verify(ipa, version=None, build=None):
    with tempfile.TemporaryDirectory(prefix='xgoose-ios-signature-') as tmp:
        with zipfile.ZipFile(ipa) as archive:
            for name in archive.namelist():
                target = (Path(tmp) / name).resolve()
                if not target.is_relative_to(Path(tmp).resolve()):
                    raise ValueError('Unsafe IPA archive path')
            archive.extractall(tmp)
        apps = list(Path(tmp).glob('Payload/*.app'))
        if len(apps) != 1:
            raise ValueError('Expected one iOS application')
        app = apps[0]
        extension = app / 'PlugIns/SafariExtension.appex'
        verified = []
        for bundle, bundle_id in [(app, APP_ID), (extension, APP_ID + '.Extension')]:
            info = plistlib.loads((bundle / 'Info.plist').read_bytes())
            if info['CFBundleIdentifier'] != bundle_id:
                raise ValueError('Unexpected bundle identifier')
            if version is not None and info['CFBundleShortVersionString'] != version:
                raise ValueError(f'{bundle_id}: version mismatch')
            if build is not None and info['CFBundleVersion'] != build:
                raise ValueError(f'{bundle_id}: build mismatch')
            signed = subprocess.run(['codesign', '-d', '--entitlements', '-', '--xml', str(bundle)], check=True, capture_output=True)
            profile = subprocess.run(['security', 'cms', '-D', '-i', str(bundle / 'embedded.mobileprovision')], check=True, capture_output=True)
            actual, allowed = plistlib.loads(signed.stdout), plistlib.loads(profile.stdout)['Entitlements']
            validate_entitlements(actual, allowed, bundle_id)
            subprocess.run(['codesign', '--verify', '--strict', str(bundle)], check=True, capture_output=True)
            verified.append({'bundleId': bundle_id, 'version': info['CFBundleShortVersionString'], 'build': info['CFBundleVersion'], 'appGroup': GROUP, 'keychainGroup': KEYCHAIN})
        if len({(b['version'], b['build']) for b in verified}) != 1:
            raise ValueError('App and extension version/build differ')
        return {'passed': True, 'sha256': hashlib.sha256(ipa.read_bytes()).hexdigest(), 'bundles': verified}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa', type=Path)
    parser.add_argument('--version')
    parser.add_argument('--build')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = verify(args.ipa, args.version, args.build)
    output = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output)
    print(output)
