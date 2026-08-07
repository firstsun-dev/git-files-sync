import { GitLabService } from '../../src/services/gitlab-service';
import { GitLabVerifier } from '../verifier/gitlab-verifier';
import { provisionGitLab, teardownGitLab, type GitLabEnvironment } from '../provision/gitlab-provision';
import type { ProviderE2EAdapter, ProvisionedProvider } from './provider-adapter';

export interface GitLabProvisionedProvider extends ProvisionedProvider {
    verifier: GitLabVerifier;
    env: GitLabEnvironment;
}

export class GitLabE2EAdapter implements ProviderE2EAdapter {
    readonly name = 'gitlab';

    async provision(): Promise<GitLabProvisionedProvider> {
        const env = await provisionGitLab();

        const service = new GitLabService();
        service.updateConfig(env.baseUrl, env.token, env.projectId, '');

        const verifier = new GitLabVerifier(env.baseUrl, env.projectId, env.token);

        return { service, branch: env.branch, rootPath: '', verifier, env };
    }

    async teardown(context: GitLabProvisionedProvider): Promise<void> {
        await teardownGitLab(context.env);
    }
}
