<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# React Component Design Guidelines

Reference guidelines for building and refactoring UI in this project.

**Stack:** Next.js App Router, React, TypeScript, shadcn/ui, Zustand, and TanStack Query.

## 1. Core Principles

Apply these principles pragmatically; do not add abstractions just to follow a rule.

- **Single Responsibility (SRP):** Give each component one cohesive UI responsibility and one main reason to change.
- **Composition over configuration:** Prefer composing smaller components through `children` and compound components over a component with many unrelated boolean props.
- **Separation of concerns:** Keep rendering, UI behavior, server communication, and shared state in their appropriate layers.
- **Small, cohesive interfaces (ISP):** Give components only the props they need. Avoid large prop interfaces full of unrelated flags.
- **Colocation:** Keep feature-specific components, hooks, services, types, and tests near their feature.
- **Reuse deliberately:** Extract shared components when the abstraction is genuinely useful. Do not generalize code solely because it appears twice.

## 2. Component Placement

```text
src/
├── app/                         # Routes, layouts, pages, route handlers
├── components/
│   ├── ui/                      # shadcn and generic design-system primitives
│   ├── common/                  # Reusable, app-level components
│   └── layouts/                 # Shared navigation and shell components
├── features/
│   └── <feature>/
│       ├── components/          # Feature-specific UI
│       ├── hooks/               # Feature-specific React hooks
│       ├── services/            # API communication
│       ├── store/               # Feature-specific Zustand stores, when needed
│       ├── types/
│       ├── utils/
│       └── __tests__/
├── hooks/                       # Truly app-wide hooks
├── lib/                         # Shared clients and integrations
├── stores/                      # Truly global Zustand stores
└── types/                       # Truly global types

tests/
└── e2e/                         # Playwright end-to-end tests
```

Placement rules:

- `components/ui/`: Generic primitives such as Button, Input, Dialog, AlertDialog, Select, Badge, and Table. Customize shadcn components here to maintain the project's design system. Keep this directory flat by default; introduce subfolders only when navigation becomes difficult and tooling/aliases remain compatible.
- `components/common/`: App-level components reusable across unrelated features, such as PageHeader, EmptyState, generic ConfirmDialog, or LoadingState.
- `components/layouts/`: Shared application shell components, such as Navbar, Sidebar, and AppShell.
- `features/<feature>/components/`: Components that know about a particular feature or its domain, such as ChatWindow, MessageList, or DeleteChatDialog.
- `app/`: Route composition and Next.js routing concerns. Keep substantial feature UI and behavior in the feature layer rather than turning page files into large components.

Do not move a component to a shared directory merely because it is used in two places. Consider whether it represents a stable, coherent abstraction.

## 3. State and Data Ownership

Use the simplest state mechanism that fits the lifetime and ownership of the data.

| State/data | Preferred location |
|---|---|
| Input value, local dropdown or dialog visibility | Component state (`useState`) |
| State shared across distant components | Zustand, only when genuinely shared |
| Fetched data, caching, mutations, refetching | TanStack Query |
| Initial/server-rendered data | Next.js Server Components where appropriate |
| API request/response logic | Feature `services/` |
| Pure transformations and formatting | Feature `utils/` or shared `lib/` |

Rules:

- Do not copy TanStack Query data into Zustand. Avoid two sources of truth.
- Do not put every UI state value in a global store. Keep state local until sharing is necessary.
- Keep API calls out of presentational components. Put request logic in services and expose it through query/mutation hooks where appropriate.
- Do not create a custom hook that merely renames or wraps one trivial line without adding meaningful behavior, reuse, or separation.

## 4. Custom Hooks

Create a custom hook when it meaningfully:

- Encapsulates a query or mutation for a feature.
- Coordinates multiple state sources or related actions.
- Encapsulates non-trivial interaction or lifecycle behavior.
- Makes behavior reusable or independently testable.

Hooks should expose a clear, small API to components. Keep simple, one-off UI state in the component. Let TanStack Query own its loading, error, and mutation states; do not build a second state-management layer around it.

## 5. Component Design Rules

- Prefer explicit props and clear TypeScript types. Avoid `any`.
- Prefer composition and `children` for flexible layouts rather than many boolean props.
- Avoid components with unrelated responsibilities or deeply nested conditional JSX; extract cohesive subcomponents when that improves readability.
- Keep event handlers understandable. Move substantial reusable behavior into hooks or pure functions.
- Do not split components based only on line count. Split when responsibilities, state, behavior, or reuse form clear boundaries.
- Avoid premature abstractions, excessive wrappers, and unnecessary indirection.
- Use semantic HTML and accessible shadcn/Radix patterns. Preserve keyboard interaction, labels, focus behavior, and ARIA semantics.
- Use design tokens and established shadcn variants. Avoid one-off hardcoded colors and arbitrary styling values when an existing token or variant fits.

## 6. Next.js App Router

- Prefer Server Components by default.
- Add `"use client"` only where client interactivity, React hooks, browser APIs, Zustand, or client-side TanStack Query are required.
- Keep the client boundary as low in the component tree as practical; do not mark an entire page or layout client-side without a reason.
- Use Server Components for appropriate server-side data loading; use TanStack Query for client caching, mutations, background refetching, and interactive server state.
- Keep route files focused on composing the page and handling route-level concerns.

## 7. Testing

- Colocate Vitest and React Testing Library tests with the feature they cover, under `__tests__/` or alongside the source file, following the existing project convention.
- Use unit tests for pure logic and services, component tests for observable UI behavior, and hook tests when hook behavior warrants independent coverage.
- Use Playwright under `tests/e2e/` for complete browser workflows.
- Test observable behavior and user outcomes rather than implementation details.

## 8. Practical Component Review Checklist

Before adding or refactoring a component, consider:

1. Does it have one clear, cohesive responsibility?
2. Does it belong to `ui/`, `common/`, `layouts/`, or a specific feature?
3. Can simpler composition replace a large set of configuration props?
4. Is state kept at the lowest level that needs it?
5. Is server state owned by TanStack Query or the server, rather than duplicated in Zustand?
6. Is API communication outside the UI component?
7. Does a custom hook add meaningful behavior or reuse?
8. Is the component accessible and straightforward to test?
9. Does this change follow existing project conventions without introducing unnecessary abstractions?

**Default approach:** Build the simplest cohesive component, colocate feature-specific code, compose shared primitives, and extract abstractions only when they clarify responsibility or remove meaningful duplication.
