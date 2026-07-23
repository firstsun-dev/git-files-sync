/**
 * Developer-facing, telemetry-free measurements for one batched push.
 * The plugin never stores or transmits these records; callers opt in by
 * registering a handler on GitHubService.
 */
export interface PushTimingRecord {
    strategy: 'github-graphql' | 'github-git-data';
    fileCount: number;
    rawBytes: number;
    encodedBytes: number;
    changePreparationMs: number;
    encodingMs: number;
    requestUploadMs: number;
    responseParsingMs: number;
    /** requestUrl does not expose server-only timing, so it is intentionally null. */
    providerProcessingMs: null;
    requestCount: number;
    totalMs: number;
    failure?: string;
}

export type PushTimingHandler = (record: PushTimingRecord) => void;

export class PushTimingCollector {
    private readonly startedAt = performance.now();
    private requestUploadMs = 0;
    private responseParsingMs = 0;
    private requestCount = 0;

    async measureRequest<T>(operation: () => Promise<T>): Promise<T> {
        const startedAt = performance.now();
        try {
            return await operation();
        } finally {
            this.requestUploadMs += performance.now() - startedAt;
            this.requestCount++;
        }
    }

    measureParsing<T>(operation: () => T): T {
        const startedAt = performance.now();
        try {
            return operation();
        } finally {
            this.responseParsingMs += performance.now() - startedAt;
        }
    }

    createRecord(
        strategy: PushTimingRecord['strategy'], fileCount: number, rawBytes: number,
        encodedBytes: number, changePreparationMs: number, encodingMs: number, failure?: string
    ): PushTimingRecord {
        return {
            strategy, fileCount, rawBytes, encodedBytes, changePreparationMs, encodingMs,
            requestUploadMs: this.requestUploadMs, responseParsingMs: this.responseParsingMs,
            providerProcessingMs: null, requestCount: this.requestCount,
            totalMs: performance.now() - this.startedAt,
            ...(failure ? { failure } : {}),
        };
    }
}
