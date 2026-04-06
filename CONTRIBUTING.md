# Contributing to ULP

Thank you for your interest in the Universal Ledger Protocol.

## Ways to Contribute

### Implement a Client
The best way to support ULP is to build a client in your language or platform:
- PHP / Laravel
- Python
- Ruby
- Go
- Java / Kotlin
- C# / .NET

### Improve the Specification
Open an issue or pull request if you find ambiguity or areas for improvement in the spec documents under `spec/`.

### Report Issues
Found a bug in the reference implementation? Open an issue with:
- What you expected
- What actually happened
- Steps to reproduce

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npx tsc

# Run tests (coming soon)
npm test
```

## Code Style

- TypeScript strict mode
- No `any` types in public APIs
- JSDoc comments for exported functions

## Spec Changes

Changes to the specification documents (`spec/`) require discussion via GitHub Issues before a PR is submitted. This ensures backward compatibility and community input.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
