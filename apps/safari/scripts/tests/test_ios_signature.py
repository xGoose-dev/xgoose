import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verify_ios', Path(__file__).resolve().parents[1] / 'verify-ios-signature.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class ExportedSignatureTests(unittest.TestCase):
    def valid(self, bundle_id=verify.APP_ID):
        return {'application-identifier': verify.TEAM + '.' + bundle_id,
                'com.apple.developer.team-identifier': verify.TEAM,
                'get-task-allow': False,
                'com.apple.security.application-groups': [verify.GROUP],
                'keychain-access-groups': [verify.KEYCHAIN]}

    def test_profile_permission_does_not_replace_signed_app_group(self):
        signed = self.valid()
        del signed['com.apple.security.application-groups']
        with self.assertRaisesRegex(ValueError, 'signed executable missing required App Group'):
            verify.validate_entitlements(signed, self.valid(), verify.APP_ID)

    def test_missing_signed_keychain_is_rejected(self):
        signed = self.valid()
        del signed['keychain-access-groups']
        with self.assertRaisesRegex(ValueError, 'signed executable missing shared Keychain'):
            verify.validate_entitlements(signed, self.valid(), verify.APP_ID)

    def test_app_and_extension_require_the_same_shared_groups(self):
        for bundle in [verify.APP_ID, verify.APP_ID + '.Extension']:
            actual = self.valid(bundle)
            profile = {**actual, 'keychain-access-groups': [verify.TEAM + '.*']}
            verify.validate_entitlements(actual, profile, bundle)

    def test_other_team_or_app_cannot_pass(self):
        for field in ['application-identifier', 'com.apple.developer.team-identifier']:
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                verify.validate_entitlements({**self.valid(), field: 'other'}, self.valid(), verify.APP_ID)

    def test_development_signature_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'distribution signature'):
            verify.validate_entitlements({**self.valid(), 'get-task-allow': True}, self.valid(), verify.APP_ID)

    def test_profile_also_requires_the_app_group(self):
        with self.assertRaisesRegex(ValueError, 'profile missing required App Group'):
            verify.validate_entitlements(self.valid(), {**self.valid(), 'com.apple.security.application-groups': []}, verify.APP_ID)
