# Eureka Atlas

Enterprise data semantic governance platform. This repository currently contains Milestone 1: the runnable monorepo foundation only.

## Prerequisites

- Node.js 24+
- pnpm 11+
- PostgreSQL running at `127.0.0.1:5432`

## Setup

1. Copy `.env.example` to `.env` and replace `<PASSWORD>` with the password for the local `postgres` account.
2. Install dependencies: `pnpm install`
3. Validate the Prisma configuration: `pnpm db:validate`
4. Verify the database connection: `pnpm db:push`

## Run

- Start web and API together: `pnpm dev`
- Web: `http://localhost:3000`
- API health check: `http://localhost:3001/health`

## Workspace

- `apps/web` — Next.js user interface.
- `apps/api` — NestJS backend API.
- `packages/database` — Prisma schema and generated database client.
- `packages/types` — shared TypeScript contracts.
- `packages/config` — shared TypeScript compiler configuration.

Business modules are scaffolded only in this milestone. DataWorks integration, governance workflows, LLM calls, and semantic packages start in later milestones.
