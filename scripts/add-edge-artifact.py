"""Attach an Edge-named copy of the tested cross-browser Chromium ZIP."""
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);report=json.loads((root/'release-manifest.json').read_text())
source=root/report['archive'];data=source.read_bytes();digest=hashlib.sha256(data).hexdigest()
if digest!=report['sha256']:raise ValueError('Chrome artifact checksum mismatch')
name=f"xgoose-edge-{report['version']}.zip";target=root/name
if target.exists() and target.read_bytes()!=data:raise ValueError('Refusing to replace different Edge bytes')
target.write_bytes(data)
checks=(root/'SHA256SUMS').read_text().splitlines()
line=f'{digest}  {name}'
if line not in checks:checks.append(line)
(root/'SHA256SUMS').write_text('\n'.join(checks)+'\n')
(root/'release-manifest-edge.json').write_text(json.dumps({**report,'archive':name,'browser':'Microsoft Edge'},indent=2)+'\n')
print(f'Edge artifact: {name} SHA256 {digest}')
