import { GitHubService } from '../../src/services/github-service';
import { GitHubVerifier } from '../verifier/github-verifier';
import { provisionGitHub, teardownGitHub, type GitHubEnvironment } from '../provision/github-provision';
import type { ProviderE2EAdapter, ProvisionedProvider } from './provider-adapter';

export interface GitHubProvisionedProvider extends ProvisionedProvider {
    verifier: GitHubVerifier;
    env: GitHubEnvironment;
}

export class GitHubE2EAdapter implements ProviderE2EAdapter {
    readonly name = 'github';

    async provision(): Promise<GitHubProvisionedProvider> {
        const env = await provisionGitHub();

        const service = new GitHubService();
        service.updateConfig(env.token, env.owner, env.repo, '');

        const verifier = new GitHubVerifier(env.owner, env.repo, env.token);

        return { service, branch: env.branch, rootPath: '', verifier, env };
    }

    async teardown(context: GitHubProvisionedProvider): Promise<void> {
        await teardownGitHub(context.env);
    }
}
