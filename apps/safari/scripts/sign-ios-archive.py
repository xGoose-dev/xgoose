#!/usr/bin/env python3
"""Sign an unsigned iOS archive before export, preserving App Group/Keychain.

Uses existing local App Store profiles and the distribution identity. Never
creates credentials. Exporting a wholly unsigned archive can drop entitlements.
"""
import argparse, plistlib, subprocess, tempfile, shutil
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);args=parser.parse_args()
app=args.archive/'Products/Applications/xgoose.app'
if not app.is_dir():raise SystemExit('Expected an xgoose iOS archive')
profiles={}
for folder in [Path.home()/'Library/MobileDevice/Provisioning Profiles',Path.home()/'Library/Developer/Xcode/UserData/Provisioning Profiles']:
 if not folder.exists():continue
 for path in folder.glob('*.mobileprovision'):
  result=subprocess.run(['security','cms','-D','-i',str(path)],capture_output=True)
  if result.returncode:continue
  data=plistlib.loads(result.stdout)
  profiles[data.get('Name')]=(path,data)
for bundle,name in [(app/'PlugIns/SafariExtension.appex','xgoose iOS Ext AppStore'),(app,'xgoose iOS App AppStore')]:
 profile,info=profiles[name]
 allowed=info['Entitlements']
 group='group.org.xgoose.xgoose-safari';keychain='2L6B6ZA57F.org.xgoose.xgoose-safari'
 assert group in allowed.get('com.apple.security.application-groups',[]),'Profile missing App Group'
 assert any(keychain==g or g=='2L6B6ZA57F.*' for g in allowed.get('keychain-access-groups',[])),'Profile missing shared Keychain'
 ent={k:allowed[k] for k in ['application-identifier','com.apple.developer.team-identifier','get-task-allow']}
 ent.update({'com.apple.security.application-groups':[group],'keychain-access-groups':[keychain]})
 if 'beta-reports-active' in allowed:ent['beta-reports-active']=allowed['beta-reports-active']
 shutil.copyfile(profile,bundle/'embedded.mobileprovision')
 with tempfile.NamedTemporaryFile(suffix='.plist') as f:
  f.write(plistlib.dumps(ent));f.flush()
  subprocess.run(['codesign','--force','--sign','Apple Distribution','--entitlements',f.name,str(bundle)],check=True)
 actual=plistlib.loads(subprocess.run(['codesign','-d','--entitlements','-','--xml',str(bundle)],capture_output=True,check=True).stdout)
 assert actual['com.apple.security.application-groups']==[group]
 assert actual['keychain-access-groups']==[keychain]
 print('Signed and verified shared entitlements:',bundle.name)
subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
