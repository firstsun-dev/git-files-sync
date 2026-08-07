import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Thin wrapper around the `docker` CLI. Kept separate from gitea-provision.ts
 * so other providers (GitLab) can reuse the same primitives without
 * depending on Gitea-specific code. */
export async function docker(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('docker', args);
    return stdout.trim();
}

export async function dockerAllowFailure(args: string[]): Promise<void> {
    try {
        await docker(args);
    } catch {
        // best-effort: used for cleanup, where the resource may already be gone
    }
}

export async function createNetwork(name: string): Promise<void> {
    await docker(['network', 'create', name]);
}

export async function removeNetwork(name: string): Promise<void> {
    await dockerAllowFailure(['network', 'rm', name]);
}

export async function removeContainer(name: string): Promise<void> {
    await dockerAllowFailure(['rm', '-f', name]);
}

/** Reads back the dynamic host port Docker assigned for a `-p 0:<containerPort>` mapping. */
export async function hostPortFor(containerName: string, containerPort: number): Promise<number> {
    const output = await docker(['port', containerName, String(containerPort)]);
    // e.g. "0.0.0.0:32768\n[::]:32768" — take the first mapping's port.
    const firstLine = output.split('\n')[0] ?? '';
    const match = /:(\d+)\s*$/.exec(firstLine);
    if (!match?.[1]) throw new Error(`Could not parse host port from "docker port" output: ${output}`);
    return Number(match[1]);
}

export async function waitUntilReady(check: () => Promise<boolean>, timeoutMs: number, pollIntervalMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            if (await check()) return;
        } catch (e) {
            lastError = e;
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    const detail = lastError instanceof Error ? lastError.message : lastError !== undefined ? JSON.stringify(lastError) : undefined;
    throw new Error(`Timed out after ${timeoutMs}ms waiting for readiness${detail ? `: ${detail}` : ''}`);
}
