/**
 * Secret redaction for E2E logs. Provisioning prints container names, ports,
 * and setup progress to stdout for debugging failed CI runs; tokens and
 * passwords generated during provisioning must never appear in that output.
 */

const REDACTED = '[REDACTED]';

/** Registers a secret value to be scrubbed from any string passed through `redact()`. */
export class SecretRegistry {
    private readonly secrets = new Set<string>();

    add(secret: string | undefined | null): void {
        if (secret) this.secrets.add(secret);
    }

    redact(input: string): string {
        let out = input;
        for (const secret of this.secrets) {
            if (!secret) continue;
            out = out.split(secret).join(REDACTED);
        }
        return out;
    }
}

/** Process-wide registry so any log call site can redact without threading a registry through. */
export const globalSecrets = new SecretRegistry();

export function redact(input: string): string {
    return globalSecrets.redact(input);
}

export function logInfo(message: string): void {
    console.debug(`[e2e] ${redact(message)}`);
}

export function logError(message: string): void {
    console.error(`[e2e] ${redact(message)}`);
}
