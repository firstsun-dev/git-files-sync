/**
 * Application-level serialization for sync mutations.
 *
 * Manual work acquires (and waits for) the guard so a user-triggered sync is
 * never discarded. Automatic work uses {@link tryAcquire} and skips its tick
 * when the sync execution path is already busy, rather than queueing a backlog
 * or running provider mutations concurrently.
 *
 * Deliberately minimal: one lock, no queue priority, no cancellation/preemption.
 */
export class SyncExecutionGuard {
    private locked = false;
    private readonly waiters: Array<() => void> = [];

    get isLocked(): boolean {
        return this.locked;
    }

    /** Waits for the guard, then returns a one-shot release function. */
    async acquire(): Promise<() => void> {
        if (!this.locked) {
            this.locked = true;
            return this.releaseOnce();
        }
        await new Promise<void>(resolve => this.waiters.push(resolve));
        return this.releaseOnce();
    }

    /** Acquires only if idle; returns null (and runs nothing) when already busy. */
    tryAcquire(): (() => void) | null {
        if (this.locked) return null;
        this.locked = true;
        return this.releaseOnce();
    }

    /**
     * Hands the lock directly to the next waiter on release so a waiting
     * manual operation doesn't race a fresh automatic tick for it.
     */
    private releaseOnce(): () => void {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.waiters.shift();
            if (next) {
                next();
            } else {
                this.locked = false;
            }
        };
    }
}
