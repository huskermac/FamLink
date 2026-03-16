# FamLink Monorepo Overview

FamLink is a **family coordination platform** (shared calendar, tasks, communication) built as a modern, multi-app project:

- A **web app** (runs in the browser)
- A **mobile app** (runs on iOS/Android using React Native / Expo)
- Shared **libraries** for data models and configuration so everything stays in sync

If you’ve built data‑driven sites in **ColdFusion**, you can think of this as:

- One **codebase** that contains multiple “sites” (apps)
- Shared **CFM custom tags / CFCs** replaced by shared **TypeScript libraries**

The main goal of this repo is to keep **web and mobile** in lockstep: same data shapes, same validation rules, same business logic where it makes sense.

---

## Top-level layout

At the root of the project you’ll see:

- **`apps/`** – actual end-user applications (web and mobile)
- **`packages/`** – shared libraries used by those apps
- **`package.json`** – root project configuration (scripts, dependencies)
- **`turbo.json`** – orchestrates tasks across all apps/packages (build, test, type-check)
- **`tsconfig.base.json`** – shared TypeScript compilation settings (our “strict typing” rules)

This structure is managed by **Turborepo**, which is like a traffic controller for running `build`, `test`, `lint`, etc., across many sub-projects in a smart, cached way.

---

## Apps: what the user actually sees

### `apps/web` – Web app (Next.js)

This is the **browser experience**, roughly analogous to:

- ColdFusion templates (`.cfm` files) that render HTML
- Routing handled by URLs, each URL mapping to a page

Key pieces:

- **`apps/web/app/`**
  - `layout.tsx` – global page shell (HTML `<html>`, `<body>` wrapper, shared styles)
  - `page.tsx` – the **home page**. In CF terms, think `index.cfm` with dynamic UI logic.
- **`apps/web/components/`**
  - `components/ui/button.tsx` – a reusable button component, similar to a CF **custom tag** you’d use across pages (consistent styles and behavior).
- **`apps/web/lib/cn.ts`**
  - Tiny helper for combining CSS class names. This is just a small utility function.
- **`apps/web/tailwind.config.ts` + `app/globals.css`**
  - Tailwind CSS configuration and global styles. This replaces manually writing a lot of CSS.

Under the hood, the web app is written with **React** components instead of CF templates:

- React components = reusable, stateful UI blocks (like smarter, interactive CFM layouts/tags).
- Next.js handles **routing**, **server rendering**, and bundling for the browser.

### `apps/mobile` – Mobile app (Expo + React Native)

This is the **native mobile experience**, packaged for iOS/Android using web-like code:

- **`apps/mobile/app/`**
  - `_layout.tsx` – top-level navigation layout; defines screens and titles.
  - `index.tsx` – the home screen, similar idea to `index.cfm`, but rendered in a native app.
- **Routing** is done by **Expo Router**:
  - Each file in `app/` becomes a screen (like URL-based routing in Next.js, or mapping `.cfm` files to paths).
- **Styling** uses **NativeWind**:
  - Tailwind-like classes (`className="..."`) applied to React Native components (`<View>`, `<Text>`), giving a CSS-feeling workflow for native UI.

If the web app is your **browser site**, the mobile app is your **native client**, both talking to the same future backend and sharing the same data models.

---

## Shared packages: the common foundation

The `packages/` folder holds **reusable building blocks**. Think of these as your CFCs / shared CF include files, but strongly typed and shared across web + mobile.

### `packages/shared` – Shared types and utilities

Goal: define **common data shapes** that all apps agree on.

Key file:

- `src/index.ts`
  - `UserId`, `FamilyMember`, `FamilyGroup` types – these are like typed struct definitions you’d keep in a CFC to standardize what a “user” or “family” looks like.
  - `getPrimaryContact(group)` – example utility function operating on those types.

Both web and mobile will import these types to ensure:

- If we change the shape of `FamilyGroup`, TypeScript will flag code that hasn’t been updated yet.

### `packages/db` – Database access (Prisma)

This will be our **single source of truth for data access**, similar to:

- CFCs that encapsulate database queries / stored procedure calls

Key files:

- `schema.prisma` – high-level definition of database models (e.g., `User`, `Family`).
  - Prisma uses this to:
    - Generate an ORM client (`@prisma/client`) with typed queries.
    - Manage migrations (like version-controlled schema changes).
- `src/client.ts`
  - Creates and exports a `PrismaClient` instance.
  - This client is what future API routes / backend services will use to talk to the database.

Conceptually:

- Instead of writing raw SQL or CFQuery in `.cfm`/CFC files, you call Prisma methods:
  - e.g., `prismaClient.user.findMany()` instead of `SELECT * FROM Users`.

### `packages/config` – Shared configuration (linting, TypeScript)

This package centralizes **project-wide rules and settings**, so every app follows the same standards.

Key files:

- `src/eslint.ts`
  - Exports a base ESLint configuration (`baseEslintConfig`).
  - ESLint is a linter: it enforces code quality rules, like catching unused variables or obvious mistakes.
- `src/tsconfig-next.json`
  - A reusable TypeScript configuration tuned for Next.js projects.
  - Apps like `apps/web` can extend this so we don’t repeat ourselves.
- `tsconfig.base.json` in the package
  - Build settings for this config package itself (output to `dist/`).

This is like having a central `Application.cfc` where you define behavior and rules once, then each part of the system follows them.

---

## Root configuration and tooling

### `package.json` (root)

Defines:

- The monorepo **name** and workspaces:
  - `"workspaces": ["apps/*", "packages/*"]` – tells the toolchain that each folder under `apps` and `packages` is its own package.
- **Scripts** (shortcuts you run with `npm run`):
  - `dev` – runs all dev servers as defined by Turborepo.
  - `build` – builds all apps/packages.
  - `lint` – runs code quality checks.
  - `test` – (placeholder for future tests).
  - `type-check` – runs TypeScript static analysis across the repo.
  - `clean` – clears build artifacts and caches.

You can think of these like shell scripts you might have used to automate CF deployments, but now they coordinate multiple apps.

### `turbo.json`

This is the **Turborepo pipeline definition**:

- Defines tasks like `build`, `dev`, `lint`, `test`, `type-check` for the whole monorepo.
- Knows:
  - Which tasks depend on others (e.g., build steps).
  - Which tasks are **long-running** (`dev` is marked `persistent: true`).
  - Which outputs to cache so repeated builds are faster (`dist/**`, `.next/**`, etc.).

Instead of manually deciding the order of building each app, Turborepo:

- Figures out what changed.
- Rebuilds only what’s necessary.
- Reuses previous results where possible.

### `tsconfig.base.json` (root)

This is the **shared TypeScript configuration**. It enforces:

- **Strict typing** – no implicit `any` types, fewer runtime surprises.
- **No JavaScript files** – we only use TypeScript (`.ts`/`.tsx`) everywhere.
- Common compiler settings for all apps and packages.

In CF terms, this is like declaring strict variable scoping, required arguments, and shared settings at the application level rather than per-file.

---

## How it all fits together

When you run `npm run dev` at the root:

1. Turborepo sees the `dev` pipeline and starts dev servers for relevant apps.
2. `apps/web` runs a Next.js dev server for the browser UI.
3. `apps/mobile` runs an Expo dev server for the mobile UI.
4. Both apps can:
   - Import shared types from `packages/shared`.
   - Eventually talk to an API that uses `packages/db` for data access.

When you run `npm run type-check`:

1. Turborepo calls **TypeScript** across the repo.
2. If any app or package uses the wrong shape for, say, `FamilyGroup`, you’ll see a compile-time error instead of a production bug.

When we later add backend APIs:

- Those APIs will:
  - Use `packages/db` to talk to the database.
  - Use `packages/shared` types to ensure consistent data structures.
  - Serve both web and mobile clients.

---

## Mental model summary (ColdFusion → FamLink)

- **CFM pages / templates** → React components and pages in `apps/web` and `apps/mobile/app`.
- **CFCs / custom tags for shared logic** → Shared TypeScript libraries in `packages/shared` and `packages/db`.
- **Application-level CFC / global settings** → Root `tsconfig.base.json`, `turbo.json`, and `packages/config`.
- **Manual build/deploy steps** → Automated, cached pipelines via Turborepo scripts.

You can think of FamLink as:

> A single, strongly-typed codebase that powers both the web and mobile experiences, with shared data models and rules, orchestrated by Turborepo to keep everything fast, consistent, and maintainable.

