import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runNamespace } from '../namespace';
import { globalSecrets, logInfo } from '../redact';
import { giteaImage, timeouts } from '../config/env';
import { createNetwork, removeNetwork, removeContainer, hostPortFor, waitUntilReady, docker, containerLogsAllowFailure } from './docker';

const execFileAsync = promisify(execFile);

export interface GiteaEnvironment {
    baseUrl: string;
    owner: string;
    repo: string;
    token: string;
    containerName: string;
    networkName: string;
}

const ADMIN_USERNAME = 'e2e-admin';
const SANDBOX_REPO = 'e2e-sandbox';
const DEFAULT_BRANCH = 'main';

/**
 * Provisions a throwaway Gitea instance in Docker: isolated network,
 * randomly-named container on a dynamic host port, an admin user (created
 * via the `gitea` CLI inside the container, bypassing the setup wizard), an
 * API token, and a sandbox repository. All resource names are derived from
 * runNamespace() so concurrent jobs on a shared Docker daemon never collide.
 */
export async function provisionGitea(): Promise<GiteaEnvironment> {
    const namespace = runNamespace('gitea');
    const containerName = namespace;
    const networkName = `${namespace}-net`;
    const password = randomBytes(16).toString('hex');
    globalSecrets.add(password);

    logInfo(`Creating network ${networkName}`);
    await createNetwork(networkName);

    logInfo(`Starting Gitea container ${containerName} (${giteaImage})`);
    await docker([
        'run', '-d',
        '--name', containerName,
        '--network', networkName,
        '-e', 'GITEA__security__INSTALL_LOCK=true',
        '-e', 'GITEA__database__DB_TYPE=sqlite3',
        '-e', 'GITEA__server__DISABLE_SSH=true',
        '-e', 'GITEA__service__DISABLE_REGISTRATION=true',
        '-e', `GITEA__repository__DEFAULT_BRANCH=${DEFAULT_BRANCH}`,
        '-p', '0:3000',
        giteaImage,
    ]);

    try {
        const port = await hostPortFor(containerName, 3000);
        const baseUrl = `http://127.0.0.1:${port}`;

        logInfo(`Waiting for Gitea to become ready at ${baseUrl}`);
        await waitUntilReady(
            async () => {
                const res = await fetch(`${baseUrl}/api/healthz`);
                return res.ok;
            },
            timeouts.containerReadyMs,
            timeouts.pollIntervalMs
        );

        logInfo('Creating admin user');
        await execFileAsync('docker', [
            'exec', '-u', 'git', containerName,
            'gitea', 'admin', 'user', 'create',
            '--username', ADMIN_USERNAME,
            '--password', password,
            '--email', `${ADMIN_USERNAME}@example.com`,
            '--admin',
            '--must-change-password=false',
        ]);

        logInfo('Creating API token');
        const token = await createToken(baseUrl, ADMIN_USERNAME, password);
        globalSecrets.add(token);

        logInfo(`Creating sandbox repository ${SANDBOX_REPO}`);
        await createSandboxRepo(baseUrl, token);

        return { baseUrl, owner: ADMIN_USERNAME, repo: SANDBOX_REPO, token, containerName, networkName };
    } catch (e) {
        // Provisioning failed partway through. A readiness timeout in particular
        // gives no clue *why* Gitea never came up (self-hosted runner Docker/
        // network hiccup vs. a real startup failure) without runner shell access
        // -- attach the container's own logs to the error before it's torn down,
        // so a future CI failure is diagnosable straight from the job output.
        const logs = await containerLogsAllowFailure(containerName);
        await teardownGitea({ containerName, networkName } as GiteaEnvironment);
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`${message}\n\n-- gitea container logs (tail) --\n${logs}`);
    }
}

async function createToken(baseUrl: string, username: string, password: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/users/${username}/tokens`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        },
        body: JSON.stringify({
            name: `e2e-${Date.now()}`,
            scopes: ['write:repository', 'write:user'],
        }),
    });
    if (!res.ok) throw new Error(`Failed to create Gitea token: ${res.status} ${await res.text()}`);
    const data = await res.json() as { sha1: string };
    return data.sha1;
}

async function createSandboxRepo(baseUrl: string, token: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/v1/user/repos`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `token ${token}`,
        },
        body: JSON.stringify({
            name: SANDBOX_REPO,
            private: true,
            auto_init: true,
            default_branch: DEFAULT_BRANCH,
        }),
    });
    if (!res.ok) throw new Error(`Failed to create Gitea sandbox repo: ${res.status} ${await res.text()}`);
}

/** Best-effort cleanup — safe to call even if provisioning only partially completed. */
export async function teardownGitea(env: Pick<GiteaEnvironment, 'containerName' | 'networkName'>): Promise<void> {
    if (process.env.E2E_KEEP_BRANCH === '1' || process.env.E2E_KEEP_BRANCH === 'true') {
        logInfo(`E2E_KEEP_BRANCH set — leaving container ${env.containerName} running for debugging`);
        return;
    }
    logInfo(`Removing container ${env.containerName}`);
    await removeContainer(env.containerName);
    logInfo(`Removing network ${env.networkName}`);
    await removeNetwork(env.networkName);
}

export { DEFAULT_BRANCH as GITEA_DEFAULT_BRANCH };
