// Sibling ES module, loaded via dynamic import() from app.mjs.
// Its sole purpose is to prove that BOTH static (<script type=module>) and
// dynamic module loading work in the runtime under test. It carries a fixed
// marker constant so the result is deterministic (no timestamps/randomness).
export const MODULE_MARKER = 'runtime-eval:dynamic-module:v1';

// A pure, deterministic function the caller invokes to confirm executable code
// (not just parsing) ran from the dynamically imported module.
export function moduleAdd(a, b) {
  return a + b;
}
