import { type GitLabFilesPushSettings } from '../settings';

/** Prepends rootPath, mirroring BaseGitService.getFullPath. */
function withRootPath(rootPath: string, path: string): string {
    if (path.startsWith('/')) return path.slice(1);
    if (!rootPath) return path;
    const cleanRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
    return path.startsWith(cleanRoot) ? path : cleanRoot + path;
}

/** Percent-encodes each segment but keeps the separators intact. */
function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
}

// Scanned rather than matched with /\/+$/, which backtracks super-linearly on
// a long run of trailing slashes.
function trimSlash(url: string): string {
    let end = url.length;
    while (end > 0 && url[end - 1] === '/') end--;
    return url.slice(0, end);
}

/**
 * Browser URL for a file on the configured provider, or null when the settings
 * can't identify one.
 *
 * Callers must treat null as "render the path as plain text": a link that 404s
 * is worse than no link, which is the whole reason the sync panel picks its
 * link target from the file's status rather than linking everything.
 *
 * `repoRelativePath` is a vault path with the vaultFolder prefix already
 * stripped (i.e. what the git services take); rootPath is applied here.
 */
export function buildRemoteFileUrl(settings: GitLabFilesPushSettings, repoRelativePath: string): string | null {
    const path = encodePath(withRootPath(settings.rootPath, repoRelativePath));
    const branch = encodeURIComponent(settings.branch);
    if (!path) return null;

    switch (settings.serviceType) {
        case 'github': {
            const { githubOwner: owner, githubRepo: repo } = settings;
            if (!owner || !repo) return null;
            return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${branch}/${path}`;
        }
        case 'gitea': {
            const { giteaBaseUrl: base, giteaOwner: owner, giteaRepo: repo } = settings;
            if (!base || !owner || !repo) return null;
            return `${trimSlash(base)}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/src/branch/${branch}/${path}`;
        }
        case 'gitlab': {
            const { gitlabBaseUrl: base, projectId } = settings;
            // The setting is documented as a numeric project ID, which has no
            // per-file web URL — only a namespace path ("group/project") can be
            // turned into one. Some users do enter the path form, since the API
            // accepts it URL-encoded, so support that and give up on the rest.
            if (!base || !projectId.includes('/')) return null;
            return `${trimSlash(base)}/${encodePath(projectId)}/-/blob/${branch}/${path}`;
        }
        default:
            return null;
    }
}
