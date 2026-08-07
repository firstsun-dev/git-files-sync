import { GiteaService } from '../../src/services/gitea-service';
import { GiteaVerifier } from '../verifier/gitea-verifier';
import { provisionGitea, teardownGitea, GITEA_DEFAULT_BRANCH, type GiteaEnvironment } from '../provision/gitea-provision';
import type { ProviderE2EAdapter, ProvisionedProvider } from './provider-adapter';

export interface GiteaProvisionedProvider extends ProvisionedProvider {
    verifier: GiteaVerifier;
    env: GiteaEnvironment;
}

export class GiteaE2EAdapter implements ProviderE2EAdapter {
    readonly name = 'gitea';

    async provision(): Promise<GiteaProvisionedProvider> {
        const env = await provisionGitea();

        const service = new GiteaService();
        service.updateConfig(env.baseUrl, env.token, env.owner, env.repo, '');

        const verifier = new GiteaVerifier(env.baseUrl, env.owner, env.repo, env.token);

        return { service, branch: GITEA_DEFAULT_BRANCH, rootPath: '', verifier, env };
    }

    async teardown(context: GiteaProvisionedProvider): Promise<void> {
        await teardownGitea(context.env);
    }
}
