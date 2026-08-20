interface PushResultDiagnostic {
    success: number;
    failed: number;
    errors: ReadonlyArray<unknown>;
}

export function describePushResult(result: PushResultDiagnostic): string {
    return `push result: success=${result.success}, failed=${result.failed}, errors=${JSON.stringify(result.errors)}`;
}
