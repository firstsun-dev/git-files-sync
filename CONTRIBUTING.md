# Contributing

Contributions are welcome. Git File Sync interacts with real Git repositories and supports multiple providers, so changes to sync behavior should be validated at the appropriate testing layer.

## Development

```bash
npm install

npm run lint
npm run test
npm run build
```

## Testing strategy

The project uses several complementary testing layers.

### Unit and integration tests

Run with:

```bash
npm run test
```

These cover sync logic, provider behavior, path mapping, binary and hidden files, UI components, and regression cases without requiring external credentials.

### Real-provider E2E

Changes that affect provider APIs or synchronization behavior may also require the real-provider E2E suite.

```bash
npm run test:e2e -- --provider gitea
```

The E2E harness exercises the production `SyncManager` and provider implementations against real Git servers.

Remote assertions are performed independently of the implementation under test, so a provider does not verify its own write by reading it back through the same abstraction.

Supported E2E targets are:

- GitHub — dedicated sandbox repository and credentials required
- GitLab — dedicated sandbox project and credentials required
- Gitea — disposable local Docker instance; no external credentials required

See [Real-provider E2E](docs/testing/real-provider-e2e.md) for setup, architecture, CI behavior, and current limitations.

## Pull requests

Before submitting a pull request:

1. Run `npm run lint`.
2. Run `npm run test`.
3. Run `npm run build`.
4. For changes to sync or provider behavior, run the relevant E2E suite when practical.
5. Add or update regression coverage when fixing a bug.

External contributors are not expected to provide GitHub or GitLab sandbox credentials. CI coverage that requires repository secrets is handled by trusted repository infrastructure.
