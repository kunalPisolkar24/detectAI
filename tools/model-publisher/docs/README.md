# Model Publisher Documentation

Welcome to the Model Publisher documentation. This tool publishes local DetectAI model artifacts to HuggingFace Hub as versioned model repos.

## New to This Tool?

Start here:

1. **[Quick Start](getting-started/quickstart.md)** - Publish your first model in minutes
2. **[Architecture](concepts/architecture.md)** - Understand how the tool is built
3. **[Configuration](getting-started/configuration.md)** - Set up credentials and settings

## Documentation by Topic

### Getting Started

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Quick Start](getting-started/quickstart.md) | Install, configure, and publish your first model | First time using the tool |
| [Configuration](getting-started/configuration.md) | All settings, env vars, and validation rules | Setting up credentials or troubleshooting config |

### Concepts

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Architecture](concepts/architecture.md) | How the tool is structured and why | Understanding the codebase |
| [Publishing Flow](concepts/publishing-flow.md) | Step-by-step what happens when you publish | Understanding the lifecycle |

### Components

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [CLI Reference](components/cli.md) | All command-line arguments and examples | Running the tool |
| [Validation](components/validation.md) | What inputs are accepted | Debugging validation errors |

### Testing

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Testing Overview](testing/overview.md) | How to run and write tests | Contributing or debugging |

## Reading Order for Different Roles

### New Developers
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Architecture](concepts/architecture.md) - Understand the big picture
3. [Configuration](getting-started/configuration.md) - Set up your environment
4. [Publishing Flow](concepts/publishing-flow.md) - See how publishing works

### DevOps / Release Managers
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Configuration](getting-started/configuration.md) - Configure credentials
3. [CLI Reference](components/cli.md) - Learn all command options
4. [Publishing Flow](concepts/publishing-flow.md) - Understand what happens on publish

### Contributors
1. [Architecture](concepts/architecture.md) - Understand the codebase structure
2. [Testing Overview](testing/overview.md) - How to run and write tests
3. [Validation](components/validation.md) - Input rules and constraints
4. [Publishing Flow](concepts/publishing-flow.md) - Understand the full lifecycle

## Related Files

- **Main README**: [`../../README.md`](../../README.md) - Project overview
- **Makefile**: [`../../Makefile`](../../Makefile) - Build and test commands
- **CI Pipeline**: [`../../.github/workflows/tools-model-publisher.yaml`](../../.github/workflows/tools-model-publisher.yaml) - GitHub Actions workflow
- **Example Env**: [`../../.env.example`](../../.env.example) - Environment template
