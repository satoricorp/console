# gx console

<p align="center">
  <a href="https://github.com/satoricorp/console/actions/workflows/deploy.yaml"><img src="https://img.shields.io/github/actions/workflow/status/satoricorp/console/deploy.yaml?branch=main&label=ci" alt="CI"></a>
  <a href="https://github.com/satoricorp/console/actions/workflows/deploy.yaml"><img src="https://img.shields.io/github/actions/workflow/status/satoricorp/console/deploy.yaml?branch=main&label=unit%20tests" alt="unit tests"></a>
</p>

The web app and the API behind GX that enables  pull request comment posts. The CLI in [satoricorp/gx](https://github.com/satoricorp/gx) handles the git hooks and triggers the PR comments.

## Get started

Clone this repository. You need Postgres and a [Convex](https://convex.dev) account.

Create two GitHub credentials.

**OAuth App**, for sign-in and `gx auth login`. GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**.

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

**GitHub App**, so the API can post on pull requests. GitHub **Settings → Developer settings → GitHub Apps → New GitHub App**.

- **Webhook URL:** `https://<your-api-host>/github/webhook`. The API listens on port 3201. GitHub has to be able to reach that URL.
- **Webhook secret:** you pick this
- **Permissions:** Contents (read and write), Pull requests (read and write), Issues (read and write), Checks (read), Actions (read).
- **Subscribe to events:** Installation, Installation repositories, Pull request, Pull request review, Pull request review comment, Issue comment, and Push.

After GitHub creates the app, copy the App ID, generate a private key, and install the app on the account or org you want to run gx against. Its install page is `https://github.com/apps/<your-app-slug>/installations/new`.

Copy `.env.example` to `.env.local` and fill in the Convex URL, `BETTER_AUTH_SECRET`, and the OAuth client id and secret. Put the API values in `server/.env`:

```bash
DATABASE_URL=postgres://localhost:5432/gx
GITHUB_APP_ID=<app id>
GITHUB_APP_PRIVATE_KEY=<private key pem>
GITHUB_WEBHOOK_SECRET=<webhook secret>
GITHUB_APP_INSTALL_URL=https://github.com/apps/<your-app-slug>/installations/new
CONVEX_SITE_URL=<your convex site url>
GX_CLOUD_API_KEY=<shared with Convex>
```

`GITHUB_APP_PRIVATE_KEY_PATH` can point at the `.pem` file instead of inlining the key. The same `GX_CLOUD_API_KEY` has to be set on the Convex deployment. Stripe, PostHog, and TurboPuffer in `.env.example` are optional.

```bash
brew services start postgresql@16 && createdb gx
# or: docker compose up -d postgres
#     that container's database is named api (user gx, password gx):
#     DATABASE_URL=postgres://gx:gx@localhost:5432/api

bun install
bunx convex dev

cd server
bun install
bun run migrate
bun run dev
```

In another terminal, from the repository root:

```bash
bun dev
```

The site is [http://localhost:3000](http://localhost:3000). The API is on port 3201. Point the CLI at it with `GX_CLOUD_URL=http://localhost:3201`.

## Reviews

`/reviews` is on in development and off in production builds. Set `NEXT_PUBLIC_REVIEWS_ENABLED=1` at build time to turn it on in production, or `0` to hide it locally. The flag is inlined, so a production change needs a rebuild. With it off, signed-in users land on `/repositories` and the review pages return 404. The API's `/v1/reviews` endpoints and pull request summaries keep running.

## Deploy

`infra/` deploys the API to ECS. See `infra/README.md`. Pass `-c certificateArn=<arn>` when the load balancer should also serve a certificate issued outside this stack.
