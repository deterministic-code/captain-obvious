export interface PackageVersion {
  name: string;
  version: string;
}

/**
 * Caret-compatibility bucket. Two versions in the same bucket satisfy each other's `^` range:
 * for 0.x that's the minor (0.3.x ↔ 0.3.y), for ≥1 the major (1.x ↔ 1.y). The lockstep release
 * keeps every package on one version, so any bucket mismatch means a half-upgraded install.
 */
function compatBucket(version: string): string {
  const [major, minor] = version.split(".");
  return Number(major) > 0 ? major : `${major}.${minor}`;
}

/** Rule packages whose version is `^`-incompatible with the engine's. Pure — no I/O. */
export function detectVersionSkew(
  engineVersion: string,
  rulePackages: PackageVersion[],
): PackageVersion[] {
  const engineBucket = compatBucket(engineVersion);
  return rulePackages.filter((p) => compatBucket(p.version) !== engineBucket);
}
