import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomaticSyncScheduler } from '../../src/runtime/AutomaticSyncScheduler';

interface Settings {
    automaticSyncEnabled: boolean;
    automaticSyncIntervalMinutes: number;
}

function buildScheduler(initial: Settings, run = vi.fn().mockResolvedValue(undefined)) {
    let settings: Settings = { ...initial };
    const registerInterval = vi.fn((id: number) => id);
    const scheduler = new AutomaticSyncScheduler({
        getSettings: () => settings,
        run,
        registerInterval,
    });
    return {
        scheduler,
        run,
        registerInterval,
        setSettings(next: Partial<Settings>) { settings = { ...settings, ...next }; },
    };
}

describe('AutomaticSyncScheduler', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not schedule anything while automatic sync is disabled', () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: false, automaticSyncIntervalMinutes: 5 });

        harness.scheduler.apply();

        expect(harness.scheduler.isScheduled).toBe(false);
        vi.advanceTimersByTime(60 * 60_000);
        expect(harness.run).not.toHaveBeenCalled();
    });

    it('runs on the configured interval when enabled', async () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 5 });

        harness.scheduler.apply();
        expect(harness.scheduler.isScheduled).toBe(true);

        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(harness.run).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(harness.run).toHaveBeenCalledTimes(2);
    });

    it('clears the old interval and installs the new one when the interval changes', async () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 5 });
        harness.scheduler.apply();

        harness.setSettings({ automaticSyncIntervalMinutes: 10 });
        harness.scheduler.apply();

        // The old 5-minute tick no longer fires.
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(harness.run).not.toHaveBeenCalled();

        // The new 10-minute schedule is active.
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(harness.run).toHaveBeenCalledTimes(1);
    });

    it('stops scheduled execution when disabled again', async () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 5 });
        harness.scheduler.apply();

        harness.setSettings({ automaticSyncEnabled: false });
        harness.scheduler.apply();

        expect(harness.scheduler.isScheduled).toBe(false);
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(harness.run).not.toHaveBeenCalled();
    });

    it('does not postpone the existing timer when unrelated settings are re-applied unchanged', async () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 5 });
        harness.scheduler.apply();

        await vi.advanceTimersByTimeAsync(4 * 60_000);
        harness.scheduler.apply();
        await vi.advanceTimersByTimeAsync(1 * 60_000);

        expect(harness.run).toHaveBeenCalledTimes(1);
    });

    it('never creates a zero/rapid timer from an invalid interval, falling back to the default', async () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 0 });
        harness.scheduler.apply();

        // 0 falls back to the 5-minute default.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(harness.run).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000);
        expect(harness.run).toHaveBeenCalledTimes(1);
    });

    it('dispose stops scheduled execution and clears registration state', async () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 1 });
        harness.scheduler.apply();

        harness.scheduler.dispose();

        expect(harness.scheduler.isScheduled).toBe(false);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(harness.run).not.toHaveBeenCalled();
    });

    it('registers the interval with the plugin lifecycle so unload clears it', () => {
        vi.useFakeTimers();
        const harness = buildScheduler({ automaticSyncEnabled: true, automaticSyncIntervalMinutes: 5 });

        harness.scheduler.apply();

        expect(harness.registerInterval).toHaveBeenCalledTimes(1);
    });
});
