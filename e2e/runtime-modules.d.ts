/**
 * Compile-time contract for `@e2e-runtime/git-verifier`, which only resolves
 * at runtime via the `vitest.e2e.config.ts` alias to the generated
 * `${E2E_RUNTIME_DIR}/verifier/git-verifier.ts` (never committed — see
 * docs/testing/real-provider-e2e.md). `verifier-runtime-types.ts` is the
 * single source of truth for the shape; this just points the module
 * specifier at it so suites can `import` it statically.
 */
declare module '@e2e-runtime/git-verifier' {
    export const GitVerifier: new () => import('./verifier-runtime-types').GitVerifier;
}
