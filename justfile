# Justfile for kusama-forum-svelte

set dotenv-load

# Install dependencies
install:
    pnpm install

# Run the dev server
dev:
    pnpm run dev

# Build the production bundle
build:
    pnpm run build

# Preview the production build
preview:
    pnpm run preview

# Typecheck / Svelte diagnostics
check:
    pnpm run check

# Lint (eslint + prettier check)
lint:
    pnpm run lint

# Format (prettier write)
format:
    pnpm run format

# Unit tests
test:
    pnpm run test

# Default
default:
    just dev
