# Contributing to ThreadPort

Thanks for helping improve ThreadPort. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search [existing issues](https://github.com/AristideDongo/threadport/issues) and pull requests.
- Open an issue for a bug, feature request, or larger design change. For small documentation fixes, a pull request is enough.
- Avoid posting tokens, private session data, or agent transcripts in public issues.

## Development

Use Node.js 24 or newer and npm. Clone the repository, then run:

```bash
npm ci
npm run check
npm test
npm run build
```

See [development notes](docs/development.md) and [architecture](docs/architecture.md) for the project structure. Keep domain rules independent of infrastructure, use TypeScript without `any`, and add tests for behavior changes.

## Pull requests

Create a branch from `main`, make a focused change, and open a pull request. Describe the behavior, link the relevant issue, and include the commands you ran. CI must pass before merging. Maintainers may ask for changes or close requests that fall outside the project scope.

Contributions are submitted under the [MIT License](LICENSE).
