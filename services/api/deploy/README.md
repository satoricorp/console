# API service on AWS ECS + RDS

Deploy the Hono API as a Fargate service with RDS Postgres.

## Architecture

- **RDS Postgres 16** in a private subnet
- **ECS Fargate** service behind an ALB
- **Convex** for CLI auth (`gxAuth.resolveCliToken` via SDK)
- **Secrets Manager** for `DATABASE_URL`
- **ECR** for container images

## 1. RDS

1. Create a Postgres 16 instance (e.g. `db.t4g.micro` for staging).
2. Create database `api`.
3. Note the connection string: `postgres://user:pass@host:5432/api`.
4. Security group: allow inbound 5432 from the ECS task security group only.

Store the URL in Secrets Manager as `api/database-url`.

Also set `DATABASE_URL` in Convex (`bunx convex env set DATABASE_URL ...`) so review pages can read events.

## 2. Build and push image

Build from the **repo root**:

```bash
cd services/api
bun install
bun run build

cd ../..
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

docker build -f services/api/Dockerfile -t api .
docker tag api:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/api:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/api:latest
```

## 3. Run migrations (one-off ECS task)

Before serving traffic, run migrations against RDS:

```bash
DATABASE_URL="postgres://..." bun run migrate
```

Or run a one-off Fargate task with command `node dist/migrate.js`.

## 4. ECS service

1. Create cluster (Fargate).
2. Register task definition from [`ecs-task-definition.json`](./ecs-task-definition.json) (replace placeholders).
3. Create ALB + target group (port 3200, health check `GET /health`).
4. Create ECS service (desired count 1+, attach to target group).
5. Point DNS at the ALB.

## 5. CLI configuration

```bash
export GX_CONVEX_SITE_URL="https://<deployment>.convex.site"
export GX_GITHUB_CLIENT_ID="<oauth-app-client-id>"
export GX_CLOUD_URL="https://<alb-host>"
```

Users run `gx auth login` once per machine, then `gx pr`.

## Environment variables

### API service (ECS)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | Postgres connection string |
| `CONVEX_URL` | yes | Convex deployment URL |
| `PORT` | no | Default `3201` |
| `CONSOLE_SITE_URL` | no | Used in ingest response `url` field |

### Convex

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | Same Postgres URL for review page reads |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | yes | Existing console OAuth app (device flow enabled) |

## Local dev (no Docker)

```bash
brew services start postgresql@16
createdb api

cd services/api
cp .env.example .env
bun install
bun run migrate
bun run dev
```

Set `DATABASE_URL` in Convex for local review pages too.

Health check: `curl http://localhost:3201/health`
