# GX Server Deploy

This CDK app lives in the private Console repo. It deploys the Hono server in
`server/` to ECS/Fargate with private RDS Postgres, an ALB, Route 53 records,
and Bedrock access through the ECS task role. It also serves the macOS app ZIP
from `https://download.<domain>/GX-macOS.zip` through CloudFront and a private
S3 bucket.

## Local Bedrock Setup

The server hardcodes the Bedrock model to `anthropic.claude-sonnet-4-6`; local
and deployed runtime configuration only needs normal AWS credential and region
settings.

1. Enable Anthropic Claude Sonnet 4.6 access in the Bedrock console for the AWS
   account and region you will use. Complete the Anthropic first-use form if AWS
   asks for it.
2. Create an IAM user for local/deploy work, create an access key for it, and
   attach `AdministratorAccess` while you are still standing this up. Tighten
   this later after the deploy path is proven.
3. Configure the local AWS profile with that access key:

   ```bash
   aws configure --profile gx-local
   ```

   Use `us-east-1` as the default region and `json` as the default output.
4. Verify the caller and Bedrock access:

   ```bash
   AWS_PROFILE=gx-local AWS_REGION=us-east-1 aws sts get-caller-identity
   AWS_PROFILE=gx-local AWS_REGION=us-east-1 aws bedrock list-foundation-models --by-provider Anthropic
   ```

5. Put the profile and region in `server/.env`:

   ```dotenv
   AWS_PROFILE=gx-local
   AWS_REGION=us-east-1
   ```

6. Run the server:

   ```bash
   cd server
   bun run dev
   ```

The AWS SDK v3 default credential chain picks up `AWS_PROFILE=gx-local` locally.
In ECS, the same SDK path picks up task-role credentials automatically.

## AWS Setup

1. Create or choose a Route 53 public hosted zone for `<domain>`.
2. In Spaceship, set the domain nameservers to the Route 53 hosted zone
   nameservers. CDK then manages the `download`, `staging`, and `api` records.
3. Bootstrap CDK once per AWS account/region:

   ```bash
   cd infra
   bun install
   AWS_PROFILE=gx AWS_REGION=us-east-1 bun run cdk bootstrap -c domainName=<domain>
   ```

4. Deploy the download host once if you want to create it before the first
   GitHub Actions run:

   ```bash
   AWS_PROFILE=gx AWS_REGION=us-east-1 bun run cdk deploy gx-downloads -c domainName=<domain>
   ```

5. For the simple GitHub Actions path, use the same IAM user's access key as
   environment secrets. OIDC can replace this later without changing the app.

## GitHub Environments

Create GitHub Environments named `staging` and `production`.

Each environment needs:

```text
secrets.AWS_ACCESS_KEY_ID
secrets.AWS_SECRET_ACCESS_KEY
secrets.CONVEX_DEPLOY_KEY   # optional; workflow skips Convex deploy when absent
vars.AWS_REGION             # use us-east-1 for this app
vars.DOMAIN_NAME            # bare domain, for example example.com
```

If you later create a GitHub OIDC role, set `secrets.AWS_ROLE_TO_ASSUME`; the
workflow will prefer OIDC and ignore the access-key secrets.

Use `us-east-1` for this CDK app. The download host uses CloudFront, and its
ACM certificate must be issued in `us-east-1`.

The staging deploy workflow is `.github/workflows/deploy.yaml`. The production
promotion workflow is `.github/workflows/promote-production.yaml`.

## First Deploy

1. Run the `Deploy` workflow manually for `staging`.
2. The workflow creates `gx-server-staging` in ECR if missing, pushes the Docker
   image as both the commit SHA and `staging`, deploys `gx-downloads` and
   `gx-server-staging` with CDK, runs migrations as a one-off Fargate task,
   rolls the ECS service, and smoke-tests `https://staging.<domain>/health`.
3. Update the generated app secret before using the API:

   ```bash
   aws secretsmanager put-secret-value \
     --secret-id /gx/staging/server \
     --secret-string '{
       "GX_CLOUD_API_KEY": "...",
       "CONVEX_SITE_URL": "https://<your-convex-deployment>.convex.site",
       "GITHUB_APP_ID": "...",
       "GITHUB_APP_PRIVATE_KEY": "...",
       "GITHUB_WEBHOOK_SECRET": "...",
       "OPENAI_API_KEY": "...",
       "TURBOPUFFER_API_KEY": "...",
       "GX_POSTHOG_KEY": "<gx-staging phc_…>",
       "GX_POSTHOG_HOST": "https://f.gx.run"
     }'

   For production (`/gx/production/server`), use the production PostHog project
   token and the same `GX_POSTHOG_HOST`.
   ```

4. Promote the same commit to `production` with the `Promote Production`
   workflow; the Route 53 record is `api`, so the public URL is
   `https://api.<domain>`.

## Production Promotion

Production is promoted by commit SHA, not by semver and not by rebuilding.

1. Confirm the commit has deployed cleanly to staging.
2. Run the `Promote Production` workflow manually.
3. Leave `commit_sha` blank to promote the selected `main` commit, or paste a
   full commit SHA to promote a specific staging image.

The workflow copies `gx-server-staging:<commit_sha>` to
`gx-server-production:<commit_sha>` and `gx-server-production:production`, then
deploys the production stack, runs production migrations, rolls ECS, and
smoke-tests `https://api.<domain>/health`.

## Runtime Notes

- The ECS task role allows `bedrock:InvokeModel` and
  `bedrock:InvokeModelWithResponseStream` for the hardcoded model list in
  `lib/gx-server-stack.ts`: the server's own Sonnet summary model plus the two
  Opus reviewers the `/gx/bedrock/fight` passthrough proxies for the CLI. Each
  is granted as a `us.` inference profile *and* as its underlying foundation
  model in every region (cross-region inference needs both). Adding a model to
  `BEDROCK_FIGHT_MODELS` in `server/src/routes/bedrock.ts` without adding it
  here is an `AccessDeniedException` in production only.
- `download.<domain>` serves the latest uploaded `GX-macOS.zip`; the API
  remains on `staging.<domain>` and `api.<domain>`.
- RDS is private and only reachable from the ECS service security group.
- Migrations run in GitHub Actions by starting a one-off Fargate task inside the
  VPC; GitHub-hosted runners never connect directly to RDS.
- The server reads RDS credentials from `PGHOST`, `PGPORT`, `PGDATABASE`,
  `PGUSER`, and `PGPASSWORD`, injected from the generated RDS secret.
