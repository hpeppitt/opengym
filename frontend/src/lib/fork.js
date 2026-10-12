// Fork build flag (hpeppitt/opengym, see docs/fork/FORK.md).
// Set VITE_FORK=1 at build time; scripts/fork/build-android.sh does. Upstream's own builds and
// test runs leave it unset, so everything gated on FORK behaves exactly as upstream wrote it.
export const FORK = import.meta.env.VITE_FORK === '1'
