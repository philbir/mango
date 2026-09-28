// Runtime shims for the bun-compiled desktop sidecar. MUST be imported before
// anything that pulls in `bson` (mongodb, ejson, …).
//
// bson ≥ 7 calls `v8.startupSnapshot.isBuildingSnapshot()` while defining
// ObjectId. Bun (≤ 1.3.13) implements that as a stub that *throws*
// ERR_NOT_IMPLEMENTED instead of returning false, which killed the 0.5.0
// sidecar at boot. We're never building a V8 snapshot, so pin it to false.
// No-op on Node.

import v8 from "node:v8";

if (process.versions.bun) {
  const snapshot = v8.startupSnapshot as { isBuildingSnapshot?: () => boolean } | undefined;
  if (snapshot) {
    try {
      snapshot.isBuildingSnapshot?.();
    } catch {
      snapshot.isBuildingSnapshot = () => false;
    }
  }
}
