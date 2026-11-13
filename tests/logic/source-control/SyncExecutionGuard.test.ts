import { describe, expect, it } from 'vitest';
import { SyncExecutionGuard } from '../../../src/logic/source-control/SyncExecutionGuard';

describe('SyncExecutionGuard', () => {
    it('reports locked while held and unlocks on release', async () => {
        const guard = new SyncExecutionGuard();
        expect(guard.isLocked).toBe(false);

        const release = await guard.acquire();
        expect(guard.isLocked).toBe(true);

        release();
        expect(guard.isLocked).toBe(false);
    });

    it('tryAcquire fails (returns null) while held, so automatic work can skip', async () => {
        const guard = new SyncExecutionGuard();
        const release = await guard.acquire();

        expect(guard.tryAcquire()).toBeNull();

        release();
        expect(guard.tryAcquire()).not.toBeNull();
    });

    it('queues a waiting acquire so manual work is serialized rather than discarded', async () => {
        const guard = new SyncExecutionGuard();
        const release = await guard.acquire();

        const order: string[] = [];
        const waiting = guard.acquire().then(release2 => {
            order.push('acquired');
            release2();
        });
        order.push('waiting');

        release();
        await waiting;

        expect(order).toEqual(['waiting', 'acquired']);
    });

    it('ignores a second release call from the same holder', async () => {
        const guard = new SyncExecutionGuard();
        const release = await guard.acquire();
        release();
        release();
        expect(guard.isLocked).toBe(false);
    });
});
