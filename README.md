# EngageAI Backend

Node.js + PostgreSQL backend for the EngageAI - Portal do Colaborador.

## Stack

- **Runtime**: Node.js 20 LTS
- **Framework**: Fastify v5
- **ORM**: Prisma 6
- **Auth**: @fastify/jwt (JWT + Refresh Token Rotation)
- **Validation**: Zod
- **Queue**: BullMQ (async gamification)
- **Cache**: ioredis (Redis sorted sets for leaderboard)
- **DB**: PostgreSQL

## Quick Start

### 1. Prerequisites

- PostgreSQL running on `localhost:5432`
- Redis running on `localhost:6379`
- Node.js 20+

### 2. Setup

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env
# Edit .env with your DB credentials

# Run migrations
npm run db:migrate

# Seed with 45 users from the frontend mock
npm run db:seed

# Start dev server
npm run dev
```

### 3. Verify

```bash
# Health check
curl http://localhost:3001/health

# Login as super admin
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"carlos.eduardo@engageai.com","password":"engageai123"}'

# Swagger UI
open http://localhost:3001/docs
```

## Default Credentials (after seed)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | carlos.eduardo@engageai.com | engageai123 |
| Gestor | marina.oliveira@engageai.com | engageai123 |
| Colaborador | ana.carolina@engageai.com | engageai123 |

## API Endpoints

All routes prefixed with `/api/v1/`

| Module | Base Path | Key Operations |
|--------|-----------|----------------|
| Auth | `/auth` | login, refresh, logout, me |
| Users | `/users` | CRUD, team, stats, change-password |
| Mood | `/mood` | register (1x/day), today, history, stats, team |
| Feed | `/feed` | posts, reactions, comments, pin |
| Feedbacks | `/feedbacks` | send, approve/reject, settings |
| Surveys | `/surveys` | CRUD, respond, results |
| Courses | `/courses` | CRUD, start, lesson-complete, certificate |
| Events | `/events` | CRUD, register, participate |
| Engagements | `/engagements` | CRUD, start, action-complete, participants |
| Goals | `/goals` | CRUD, activate, progress |
| Rewards | `/rewards` | CRUD, redeem |
| Daily Missions | `/daily-missions` | today, complete |
| Ranking | `/ranking` | global, team, department |
| Analytics | `/analytics` | platform, engagement, mood, training |
| Notifications | `/notifications` | list, read, read-all |

## Architecture

```
src/
├── config/         # Zod-validated env vars
├── domain/         # Business rules (pure)
├── application/    # Use cases (orchestration)
├── infrastructure/ # Prisma, Redis, BullMQ
├── presentation/   # Fastify routes, middlewares, plugins
└── shared/         # Errors, utils, types
```

## Gamification (Async)

XP/Stars are **never** blocked in HTTP:
1. User action → immediate HTTP 201 response
2. `awardXpUseCase()` enqueues to BullMQ
3. GamificationGuard processor: only `colaborador` role receives XP
4. On level-up: notification queued
5. Redis leaderboard updated

## RBAC

```
colaborador < gestor < super_admin

- colaborador: own profile, participate in all features, receive XP/stars
- gestor: manage team, approve feedbacks, create surveys/courses/events, view analytics
- super_admin: full CRUD, create engajamentos/goals, manage settings
```
