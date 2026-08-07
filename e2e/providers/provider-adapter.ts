import type { GitServiceInterface } from '../../src/services/git-service-interface';

/**
 * What a provider-specific E2E adapter must supply. One implementation per
 * provider (e.g. gitea-adapter.ts, and future github-adapter.ts /
 * gitlab-adapter.ts). Keeps provisioning/config concerns out of the suite
 * files in e2e/suites/, which should only orchestrate: provision -> exercise
 * the real GitServiceInterface -> verify independently -> cleanup.
 */
export interface ProviderE2EAdapter {
    readonly name: string;

    /**
     * Brings up whatever infrastructure the provider needs (a Docker
     * container for a self-hostable provider like Gitea/GitLab, or just
     * validating pre-supplied credentials for a hosted provider like
     * GitHub) and returns a ready-to-use production service plus the
     * context a suite needs to drive it and an independent verifier needs
     * to check it.
     */
    provision(): Promise<ProvisionedProvider>;

    /** Best-effort teardown. Must not throw — provisioning failures and test
     * failures both still need cleanup to run. */
    teardown(context: ProvisionedProvider): Promise<void>;
}

export interface ProvisionedProvider {
    /** The real production GitServiceInterface implementation under test,
     * already configured (updateConfig called) against the provisioned repo. */
    service: GitServiceInterface;
    /** Branch the suite should read/write against. */
    branch: string;
    /** Repo-root-relative path prefix the suite should write test files under,
     * so parallel runs (and reruns) never collide within a shared repo. */
    rootPath: string;
}
