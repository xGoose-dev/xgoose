/** Strict SemVer ordering; unknown versions are never treated as an upgrade. */
export function newerVersion(next: string, current: string): boolean {
  const parse = (value: string) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z.-]+)?$/.exec(value);
  const a = parse(next), b = parse(current);
  if (!a || !b) return false;
  for (let i=1;i<=3;i++) if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]);
  if (!a[4] || !b[4]) return !!b[4] && !a[4];
  const x=a[4].split('.'), y=b[4].split('.');
  for(let i=0;i<Math.max(x.length,y.length);i++) {
    if(x[i]===undefined)return false;if(y[i]===undefined)return true;
    if(x[i]===y[i])continue;
    const xn=/^\d+$/.test(x[i]),yn=/^\d+$/.test(y[i]);
    return xn&&yn ? BigInt(x[i])>BigInt(y[i]) : xn!==yn ? !xn : x[i]>y[i];
  }
  return false;
}
