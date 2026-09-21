import { DEFAULT_SETTINGS } from '../settings/model';
import { normalizeAutomaticSyncIntervalMinutes } from '../settings/helpers';

export interface AutomaticSyncScheduleSettings {
    automaticSyncEnabled: boolean;
    automaticSyncIntervalMinutes: number;
}

export interface AutomaticSyncSchedulerDependencies {
    /** Reads the current setting each time the schedule is (re)applied. */
    getSettings(): AutomaticSyncScheduleSettings;
    /** Runs one background automatic sync. Overlapping ticks are skipped by the service. */
    run(): Promise<void>;
    /** Obsidian's `registerInterval`, so the plugin unload clears the timer too. */
    registerInterval(id: number): number;
}

/**
 * Owns only the timer for Automatic Sync. Whether a run should happen, and what
 * it does, stays in AutomaticSyncService; Obsidian lifecycle stays in main.ts.
 *
 * Re-applying the schedule is idempotent for an unchanged enabled/interval
 * pair, so frequent settings saves (e.g. token typing) don't postpone the next
 * tick. A genuine enabled/interval change clears the old timer immediately and
 * installs the new one, so it takes effect without a plugin reload.
 */
export class AutomaticSyncScheduler {
    private timer: number | null = null;
    private appliedKey = '';

    constructor(private readonly dependencies: AutomaticSyncSchedulerDependencies) {}

    get isScheduled(): boolean {
        return this.timer !== null;
    }

    /** Clears and installs the timer to match the current settings. */
    apply(): void {
        const settings = this.dependencies.getSettings();
        const minutes = normalizeAutomaticSyncIntervalMinutes(
            settings.automaticSyncIntervalMinutes,
            DEFAULT_SETTINGS.automaticSyncIntervalMinutes,
        );
        const key = `${settings.automaticSyncEnabled ? 'on' : 'off'}:${minutes}`;
        if (key === this.appliedKey) return;
        this.appliedKey = key;

        this.clearTimer();
        if (!settings.automaticSyncEnabled) return;

        this.timer = window.setInterval(() => {
            void this.dependencies.run();
        }, minutes * 60_000);
        this.dependencies.registerInterval(this.timer);
    }

    /** Stops any scheduled execution. */
    dispose(): void {
        this.clearTimer();
        this.appliedKey = '';
    }

    private clearTimer(): void {
        if (this.timer === null) return;
        window.clearInterval(this.timer);
        this.timer = null;
    }
}
