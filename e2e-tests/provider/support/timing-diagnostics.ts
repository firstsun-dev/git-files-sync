/**
 * Opt-in duration logging for the two-client E2E suite. Silent by default —
 * set `E2E_TIMING_DEBUG=1` to see where a slow run's time actually goes
 * (tree listing vs refresh vs push vs pull vs verifier), instead of only
 * knowing a whole test approached the timeout.
 */
const enabled = process.env.E2E_TIMING_DEBUG === '1';

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!enabled) return fn();
    const start = Date.now();
    try {
        return await fn();
    } finally {
        console.log(`[e2e-timing] ${label}: ${Date.now() - start}ms`);
    }
}
