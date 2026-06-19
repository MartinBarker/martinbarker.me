# discord2playlist — AWS Deployment & User Workflow Guide

This is the single source of truth for getting `discord2playlist` (bot repo: `https://github.com/MartinBarker/discord2playlist`) running in production on AWS, with martinbarker.me as the user-facing landing page and result dashboard.

**Decision recap:**

- **Bot host:** AWS ECS Fargate, inside the existing `portfolioCluster` in `us-west-1`.
- **Database:** AWS RDS PostgreSQL (`db.t3.micro`, free tier eligible for first 12 months).
- **Site:** martinbarker.me on AWS ECS (`portfolioCluster` / `us-west-1`, service `DevPortfolioClusterService2`, ECR repo `dev-portfolio-react`) — already deployed. Its infra doesn't change; you only add two env vars to its task definition (`DevTaskDefPortfolio`). Everything is AWS — no Vercel.
- **Auth model:** No martinbarker.me login. Users get a one-time **signed magic link** from the bot after running `/makeplaylists`. Connecting YouTube is a separate Google OAuth.
- **Bot ↔ Site comms:** Bot exposes an HTTPS API; site calls it over a shared secret. Either side can be redeployed independently.

The bot's `README.md` covers local development only — everything else (deploy, infra, workflow, retry, scheduling) is here.

---

## Table of Contents

1. [What you're building](#1-what-youre-building)
2. [Architecture](#2-architecture)
3. [Cost summary](#3-cost-summary)
4. [Phase 1 — AWS setup walkthrough](#4-phase-1--aws-setup-walkthrough)
   - [4.1 Prerequisites](#41-prerequisites)
   - [4.2 RDS Postgres](#42-rds-postgres)
   - [4.3 Apply the schema](#43-apply-the-schema)
   - [4.4 Secrets Manager](#44-secrets-manager)
   - [4.5 ECR repository](#45-ecr-repository)
   - [4.6 IAM task execution role](#46-iam-task-execution-role)
   - [4.7 Task definition](#47-task-definition)
   - [4.8 ECS service](#48-ecs-service)
   - [4.9 Public URL for the bot API](#49-public-url-for-the-bot-api)
   - [4.10 GitHub Actions CI/CD](#410-github-actions-cicd)
   - [4.11 Register slash commands (one-time)](#411-register-slash-commands-one-time)
   - [4.12 Verify](#412-verify)
5. [Phase 2 — end-user workflow](#5-phase-2--end-user-workflow)
   - [5.0 Worked example: one user's full journey](#50-worked-example-one-users-full-journey)
   - [5.1 The happy path](#51-the-happy-path)
   - [5.2 Implementing the invite button](#52-implementing-the-invite-button)
   - [5.3 Implementing the magic link (no auth)](#53-implementing-the-magic-link-no-auth)
   - [5.4 Results page on martinbarker.me](#54-results-page-on-martinbarkerme)
   - [5.5 YouTube OAuth — one-time connect](#55-youtube-oauth--one-time-connect)
   - [5.6 Adding videos to a playlist with retry](#56-adding-videos-to-a-playlist-with-retry)
6. [Phase 3 — auto-running with /schedule](#6-phase-3--auto-running-with-schedule)
7. [Updating the bot without touching the site](#7-updating-the-bot-without-touching-the-site)
8. [Troubleshooting](#8-troubleshooting)
9. [Appendix A — full schema](#9-appendix-a--full-schema)
10. [Appendix B — future tiers & monetization](#10-appendix-b--future-tiers--monetization)
11. [Launch checklist](#11-launch-checklist)

---

## 1. What you're building

The end-user experience, in their words:

1. User lands on `martinbarker.me/discord2playlist` → clicks **Invite the bot**.
2. User authorizes the bot to join their Discord server.
3. In Discord, they run `/makeplaylists input_channel:#music`.
4. The bot scans the channel, finds every YouTube/Spotify/SoundCloud/Bandcamp link, deduplicates them, and posts an output message like:
   > Found 87 videos. **[View & add to YouTube playlist →](https://martinbarker.me/discord2playlist/results/abc123?t=signed-token)**
5. They click the link — no login. They see every track listed. One button: **Add all to YouTube**.
6. First time, they click **Connect YouTube** (Google sign-in popup, takes ~10 seconds). After that the connection persists.
7. They hit **Add all to playlist**. The bot grinds through each video, retrying transient failures automatically, and reports progress in real time on the page.
8. Optionally they run `/schedule cadence:daily` in Discord. From then on, the bot rescans the channel every day and auto-pushes new tracks to the same playlist. They never have to think about it again.

Nothing about this requires the user to create an account on martinbarker.me.

---

## 2. Architecture

```
┌──────────────────────────┐           ┌────────────────────────────────────────┐
│ martinbarker.me (ECS)    │           │ discord2playlist bot (ECS Fargate)     │
│                          │           │   us-west-1 / portfolioCluster         │
│  /discord2playlist        │  HTTPS    │                                       │
│   • Invite button        │  shared   │  ┌──────────────────────────────────┐ │
│   • Result page          │◄─secret──►│  │ Express HTTP API                  │ │
│     /results/[scanId]    │           │  │  GET  /api/scans/:id?t=token      │ │
│     • track list          │           │  │  POST /api/scans/:id/push         │ │
│     • Connect YouTube     │           │  │  GET  /api/youtube/oauth/callback │ │
│     • Add all to playlist │           │  └──────────────────────────────────┘ │
│   • OAuth callback        │           │  ┌──────────────────────────────────┐ │
│     /api/youtube/callback │           │  │ discord.js Gateway                │ │
│                          │           │  │  • /makeplaylists                 │ │
└──────────┬───────────────┘           │  │  • /schedule                      │ │
           │                            │  │  • /stop                          │ │
           │                            │  └──────────────────────────────────┘ │
           │                            │  ┌──────────────────────────────────┐ │
           │                            │  │ node-cron scheduler               │ │
           │                            │  │  • rehydrate jobs at boot         │ │
           │                            │  │  • incremental scan + auto-push   │ │
           │                            │  └──────────────────────────────────┘ │
           │                            └───────────────┬────────────────────────┘
           │                                            │
           └──────────────────────┐                     ▼
                                  │            ┌──────────────────────┐
                                  ├───────────►│ RDS PostgreSQL       │
                                  │            │   guilds             │
                                  │            │   scan_jobs          │
                                  │            │   extracted_links    │
                                  │            │   magic_tokens       │
                                  │            │   youtube_tokens     │
                                  │            │   playlist_items     │
                                  │            └──────────────────────┘
                                  │
                                  ▼
                  ┌──────────────────────────────┐
                  │ Discord API · YouTube API    │
                  └──────────────────────────────┘
```

Three deployable units, three independent lifecycles:

| Unit | Lives in | Deployed via | Touched when |
|---|---|---|---|
| Web pages | `martinbarker.me` repo | `git push main` → GitHub Actions → ECR → ECS (`DevPortfolioClusterService2`) | UI / copy changes |
| Bot service | `discord2playlist` repo | `git push main` → GitHub Actions → ECR → ECS | Bot logic, slash commands, scheduler |
| Database schema | `discord2playlist/db/schema.sql` | `npm run db:migrate` (one-off ECS task) | Schema changes only |

---

## 3. Cost summary

Based on `us-west-1` pricing, single bot instance, ~100 guilds.

### First 12 months (AWS Free Tier eligible)

| Resource | Free tier | After free tier |
|---|---|---|
| Fargate (0.25 vCPU · 0.5 GB · 24/7) | not covered | ~$9 |
| RDS `db.t3.micro` (750 hrs/mo, 20 GB) | **free** | ~$14 |
| Secrets Manager (5–7 secrets × $0.40) | not covered | ~$2.50 |
| ECR storage (<500 MB) | **free** | ~$0.05 |
| CloudWatch Logs (minimal) | **free** | ~$0.10 |
| Data transfer | **100 GB free** | ~$0 |
| **Total** | **~$11/month** (Fargate + Secrets only) | **~$26/month** |

### Want to cut $14/month?

Swap RDS for [Neon](https://neon.tech) free Postgres. You lose VPC isolation but the bot connects over TLS with `DATABASE_URL` exactly the same way. **Net: ~$11/month total, indefinitely.**

### Want to go even cheaper?

EC2 `t4g.nano` + systemd + Neon ≈ **$3/month**. You manage the OS. The trade-off was discussed previously — for one bot, ECS is the right call if you want it to feel like part of your existing AWS stack.

---

## 4. Phase 1 — AWS setup walkthrough

Everything below assumes:
- `us-west-1` region
- Existing `portfolioCluster` ECS cluster (the same one running martinbarker.me)
- AWS CLI configured (`aws configure`)
- The bot's `Dockerfile` is committed to `https://github.com/MartinBarker/discord2playlist`

Replace placeholders as you go: `YOUR_ACCOUNT_ID`, `subnet-XXXX`, `sg-XXXX`, `STRONG_PASSWORD`, etc.

### 4.1 Prerequisites

```bash
# Get your AWS account ID — used in every ARN below
aws sts get-caller-identity --query Account --output text

# Get the subnets and security group your existing service uses
# (you'll reuse them for the bot)
aws ecs describe-services \
  --cluster portfolioCluster \
  --services DevPortfolioClusterService2 \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' \
  --region us-west-1
```

Write down the two subnet IDs and the security group ID. You'll paste them into several commands below.

### 4.2 RDS Postgres

```bash
# Create a DB subnet group spanning your existing subnets
aws rds create-db-subnet-group \
  --db-subnet-group-name discord2playlist-db-subnets \
  --db-subnet-group-description "Subnets for Discord2Playlist RDS" \
  --subnet-ids '["subnet-XXXXXXXX", "subnet-YYYYYYYY"]' \
  --region us-west-1

# Create the RDS instance — db.t3.micro is on Free Tier for 12 months
aws rds create-db-instance \
  --db-instance-identifier discord2playlist-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16.4 \
  --master-username discord2playlist_admin \
  --master-user-password 'STRONG_PASSWORD' \
  --allocated-storage 20 \
  --storage-type gp3 \
  --db-name discord2playlist \
  --db-subnet-group-name discord2playlist-db-subnets \
  --vpc-security-group-ids sg-XXXXXXXX \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --storage-encrypted \
  --region us-west-1

# Wait ~5–10 min for it to come up
aws rds wait db-instance-available \
  --db-instance-identifier discord2playlist-db --region us-west-1

# Grab the endpoint
aws rds describe-db-instances \
  --db-instance-identifier discord2playlist-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text --region us-west-1
```

Endpoint will look like `discord2playlist-db.xxxxxxxxxxxx.us-west-1.rds.amazonaws.com`.

Open port 5432 from the ECS security group:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-XXXXXXXX \
  --protocol tcp --port 5432 \
  --source-group sg-XXXXXXXX \
  --region us-west-1
```

(If your ECS and RDS use different SGs, replace `--source-group` with the ECS SG ID.)

### 4.3 Apply the schema

The schema lives at `db/schema.sql` in the bot repo and `db/migrate.js` runs it. You can apply it two ways.

**Option A — `psql` from your machine (only works if RDS is reachable from your IP — temporarily open it):**

```bash
psql "postgresql://discord2playlist_admin:STRONG_PASSWORD@discord2playlist-db.xxxx.us-west-1.rds.amazonaws.com:5432/discord2playlist" \
  -f db/schema.sql
```

**Option B — one-off ECS task (run after step 4.7):**

```bash
aws ecs run-task \
  --cluster portfolioCluster \
  --task-definition Discord2PlaylistTask \
  --launch-type FARGATE \
  --overrides '{
    "containerOverrides": [{
      "name": "discord2playlist-container",
      "command": ["node", "db/migrate.js"]
    }]
  }' \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["subnet-XXXXXXXX"],
      "securityGroups": ["sg-XXXXXXXX"],
      "assignPublicIp": "ENABLED"
    }
  }' \
  --region us-west-1
```

Tail logs to confirm: `aws logs tail /ecs/discord2playlist-bot --since 5m --region us-west-1`. You should see `Schema applied successfully`.

### 4.4 Secrets Manager

```bash
aws secretsmanager create-secret \
  --name discord2playlist/prod \
  --region us-west-1 \
  --secret-string '{
    "DISCORD_TOKEN":      "your-discord-bot-token",
    "DISCORD_CLIENT_ID":  "your-discord-client-id",
    "GCP_CLIENT_ID":      "your-google-client-id",
    "GCP_CLIENT_SECRET":  "your-google-client-secret",
    "SCAN_SECRET":        "openssl rand -hex 32 → paste here",
    "SITE_SHARED_SECRET": "openssl rand -hex 32 → paste here",
    "DATABASE_URL":       "postgresql://discord2playlist_admin:STRONG_PASSWORD@discord2playlist-db.xxxx.us-west-1.rds.amazonaws.com:5432/discord2playlist"
  }'
```

`SCAN_SECRET` signs magic links. `SITE_SHARED_SECRET` authenticates martinbarker.me's calls to the bot's API. Generate both with `openssl rand -hex 32` and never log them.

Note the secret ARN — used below. Update later with `aws secretsmanager update-secret --secret-id discord2playlist/prod --secret-string '...'`.

### 4.5 ECR repository

```bash
aws ecr create-repository \
  --repository-name discord2playlist-bot \
  --region us-west-1 \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256
```

Save the `repositoryUri` — looks like `YOUR_ACCOUNT_ID.dkr.ecr.us-west-1.amazonaws.com/discord2playlist-bot`.

### 4.6 IAM task execution role

The simplest path is to reuse the role your existing martinbarker.me ECS service uses, but add Secrets Manager access for the new secret:

```bash
# Find the existing role
aws ecs describe-task-definition --task-definition DevTaskDefPortfolio \
  --query 'taskDefinition.executionRoleArn' --output text

# Grant it access to the new secret (replace ROLE_NAME and SECRET_ARN)
aws iam put-role-policy \
  --role-name ROLE_NAME \
  --policy-name SecretsManagerDiscord2Playlist \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "SECRET_ARN"
    }]
  }'
```

If you'd rather isolate it, create a fresh role — see the bot's old README in git history. Reusing is fine for v1.

### 4.7 Task definition

Save as `task-definition.json` in the bot repo (replace placeholders):

```json
{
  "family": "Discord2PlaylistTask",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_EXECUTION_ROLE",
  "taskRoleArn":      "arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_EXECUTION_ROLE",
  "containerDefinitions": [
    {
      "name": "discord2playlist-container",
      "image": "YOUR_ACCOUNT_ID.dkr.ecr.us-west-1.amazonaws.com/discord2playlist-bot:latest",
      "essential": true,
      "portMappings": [
        { "containerPort": 3000, "protocol": "tcp" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/discord2playlist-bot",
          "awslogs-region": "us-west-1",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      },
      "secrets": [
        { "name": "DISCORD_TOKEN",      "valueFrom": "arn:aws:secretsmanager:us-west-1:YOUR_ACCOUNT_ID:secret:discord2playlist/prod:DISCORD_TOKEN::" },
        { "name": "DISCORD_CLIENT_ID",  "valueFrom": "arn:aws:secretsmanager:us-west-1:YOUR_ACCOUNT_ID:secret:discord2playlist/prod:DISCORD_CLIENT_ID::" },
        { "name": "GCP_CLIENT_ID",      "valueFrom": "arn:aws:secretsmanager:us-west-1:YOUR_ACCOUNT_ID:secret:discord2playlist/prod:GCP_CLIENT_ID::" },
        { "name": "GCP_CLIENT_SECRET",  "valueFrom": "arn:aws:secretsmanager:us-west-1:YOUR_ACCOUNT_ID:secret:discord2playlist/prod:GCP_CLIENT_SECRET::" },
        { "name": "SCAN_SECRET",        "valueFrom": "arn:aws:secretsmanager:us-west-1:YOUR_ACCOUNT_ID:secret:discord2playlist/prod:SCAN_SECRET::" },
        { "name": "SITE_SHARED_SECRET", "valueFrom": "arn:aws:secretsmanager:us-west-1:YOUR_ACCOUNT_ID:secret:discord2playlist/prod:SITE_SHARED_SECRET::" },
        { "name": "DATABASE_URL",       "valueFrom": "arn:aws:secretsmanager:us-west-1:YOUR_ACCOUNT_ID:secret:discord2playlist/prod:DATABASE_URL::" }
      ],
      "environment": [
        { "name": "NODE_ENV",    "value": "production" },
        { "name": "PORT",        "value": "3000" },
        { "name": "SITE_ORIGIN", "value": "https://martinbarker.me" }
      ]
    }
  ]
}
```

Register it:

```bash
aws logs create-log-group --log-group-name /ecs/discord2playlist-bot --region us-west-1

aws ecs register-task-definition \
  --cli-input-json file://task-definition.json \
  --region us-west-1
```

### 4.8 ECS service

```bash
aws ecs create-service \
  --cluster portfolioCluster \
  --service-name Discord2PlaylistService \
  --task-definition Discord2PlaylistTask \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["subnet-XXXXXXXX", "subnet-YYYYYYYY"],
      "securityGroups": ["sg-XXXXXXXX"],
      "assignPublicIp": "ENABLED"
    }
  }' \
  --deployment-configuration '{
    "maximumPercent": 200,
    "minimumHealthyPercent": 100
  }' \
  --region us-west-1
```

`assignPublicIp: ENABLED` lets the Fargate task reach Discord's gateway and YouTube's API. If you already have a NAT Gateway in this VPC, you can flip this to `DISABLED` and route via NAT.

Allow inbound to the bot's API port. Note the callers are **the user's browser** (the results page opens an SSE stream straight to the bot, §5.6) and **Google's OAuth redirect** (§5.5) — not just the site's server — so the endpoint must be reachable from the public internet regardless. Allow port 3000 from the world and rely on the magic-token + shared-secret for auth:

> **Tip — keep it internal where you can.** Because the site runs in the *same* `portfolioCluster`/VPC as the bot, the site's *server-side* fetch (§5.4) can reach the bot over the private network instead of the public URL (ECS Service Connect / Cloud Map, or an internal ALB). You'd still need the public hostname for the browser SSE and the OAuth callback, but server-to-server traffic never has to leave the VPC.

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-XXXXXXXX \
  --protocol tcp --port 3000 --cidr 0.0.0.0/0 \
  --region us-west-1
```

### 4.9 Public URL for the bot API

The site needs a stable hostname to call. Three options ranked:

1. **CloudFront → ECS task public IP** (simplest, no extra cost beyond Cloudfront which has a generous free tier). Point a Route 53 record `bot.martinbarker.me` at a CloudFront distribution that origins to the Fargate task IP. Re-resolve when the task restarts.
2. **Application Load Balancer in front of the service** (~$16–22/month). Cleaner — stable DNS, TLS termination, auto-recovers across task restarts. Worth it if you can spend the $20.
3. **Cloudflare Tunnel** (free). Install `cloudflared` in the container, exposes a stable `bot.martinbarker.me` hostname over Cloudflare. Adds a sidecar but zero infra cost. Reasonable middle ground.

**Recommendation for v1:** option 3 (Cloudflare Tunnel). Cheapest, simplest, stable hostname. Promote to ALB once revenue justifies it.

Whatever you pick, end up with `https://bot.martinbarker.me` resolving to the Express server inside the container. The site config below assumes that.

### 4.10 GitHub Actions CI/CD

In the bot repo, **Settings → Secrets and variables → Actions**, add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (reuse the values from martinbarker.me's repo — same account). These are the *only* GitHub secrets the workflow needs — the bot's runtime secrets (`DISCORD_TOKEN`, `DATABASE_URL`, …) live in Secrets Manager (§4.4), never in GitHub.

**IAM permissions for the deploy user.** The access keys above belong to an IAM user that must be allowed to push to ECR and roll out the ECS service. The committed workflow renders a new task-definition revision (`DescribeTaskDefinition` + `RegisterTaskDefinition`) and updates the service, so it also needs `iam:PassRole` for the task roles. Attach this minimal policy to that user (replace `YOUR_ACCOUNT_ID` and `YOUR_EXECUTION_ROLE`; add the task role too if it differs from the execution role):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "EcrPushPull",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:us-west-1:YOUR_ACCOUNT_ID:repository/discord2playlist-bot"
    },
    {
      "Sid": "EcsTaskDefRegister",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EcsServiceDeploy",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService"
      ],
      "Resource": "arn:aws:ecs:us-west-1:YOUR_ACCOUNT_ID:service/portfolioCluster/Discord2PlaylistService"
    },
    {
      "Sid": "PassEcsRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_EXECUTION_ROLE"
      ],
      "Condition": {
        "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" }
      }
    }
  ]
}
```

Notes on the scoping:
- `ecr:GetAuthorizationToken` and the two `ecs:*TaskDefinition` actions **don't support resource-level restrictions** — AWS requires `"Resource": "*"` for them. Everything else is pinned to your repo and service ARNs.
- `iam:PassRole` is the permission most people forget. Without it, the deploy fails at the register/deploy step with a confusing `AccessDenied`. The `iam:PassedToService` condition limits it to ECS so the keys can't pass that role anywhere else.
- If you reuse the martinbarker.me deploy user, it likely already has broad ECR/ECS access — check with `aws iam list-attached-user-policies --user-name <user>`. This policy is the least-privilege alternative if you'd rather create a dedicated `discord2playlist-deployer` user.

Save the workflow as `.github/workflows/deploy.yml` in the bot repo:

```yaml
name: Deploy to ECS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-west-1

      - name: Login to ECR
        id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, push image
        env:
          REGISTRY: ${{ steps.ecr.outputs.registry }}
          REPO: discord2playlist-bot
          TAG: ${{ github.sha }}
        run: |
          docker build -t $REGISTRY/$REPO:$TAG -t $REGISTRY/$REPO:latest .
          docker push $REGISTRY/$REPO:$TAG
          docker push $REGISTRY/$REPO:latest

      - name: Force new deployment
        run: |
          aws ecs update-service \
            --cluster portfolioCluster \
            --service Discord2PlaylistService \
            --force-new-deployment \
            --region us-west-1
```

Now every `git push origin main` builds, pushes, and rolls out a new bot version. **martinbarker.me is never touched.**

### 4.11 Register slash commands (one-time)

You only do this once, or when you add/change a command. From your laptop with the bot's `.env` populated:

```bash
npm run deploy:global
```

This registers `/makeplaylists`, `/schedule`, `/stop`, `/version` globally. Discord propagates global commands in ~1 hour. For testing, use `npm run deploy:guild` against your own server for instant updates.

### 4.12 Verify

```bash
aws ecs describe-services \
  --cluster portfolioCluster \
  --services Discord2PlaylistService \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount}' \
  --region us-west-1

aws logs tail /ecs/discord2playlist-bot --since 5m --region us-west-1
```

You should see `Bot is ready! Logged in as ...` and `Express API listening on :3000`. Run `/makeplaylists` in your test server to smoke-test end-to-end.

---

## 5. Phase 2 — end-user workflow

This is the part the user actually experiences. Every step assumes Phase 1 is live.

### 5.0 Worked example: one user's full journey

Meet **Sam**, who runs a Discord server called *Crate Diggers* with a busy `#music-share` channel. Here is everything Sam does, in order, and exactly where each step happens (Discord, your website, or Google).

> **The key question answered up front:** *Does Sam run a Discord command to connect YouTube first?* **No.** YouTube authorization happens **in the browser, on your website, the first time Sam actually wants to push tracks** — not as an upfront Discord command. You *cannot* do Google OAuth inside Discord (it needs a real browser redirect), so the natural place is the results page Sam already has open. Auth is **lazy** (asked for only when needed) and **one-time** (the refresh token persists, so Sam never does it again). An optional `/connect` command exists for power users who want to pre-authorize — see the note at the end.

```
WHERE        WHAT SAM DOES                                         WHAT THE SYSTEM DOES
─────────────────────────────────────────────────────────────────────────────────────────
🌐 website   1. Visits martinbarker.me/discord2playlist           Static page. Invite button is a
                Clicks "Invite the bot".                             plain discord.com OAuth URL.

💬 Discord   2. Discord asks "Add Crate Diggers?" → Authorize.    Discord adds the bot. Bot's
                                                                     guildCreate fires → inserts a
                                                                     row into `guilds`.

💬 Discord   3. Types in any channel:                              Bot scans #music-share, extracts
                /makeplaylists input_channel:#music-share            + dedupes every YouTube/Spotify/
                output_channel:#bot-output                           SC/Bandcamp link, writes them to
                                                                     `extracted_links` under a new
                                                                     scan_job. Issues a signed magic
                                                                     token. Posts in #bot-output:
                                                                       "Found 87 tracks.
                                                                        [View & add to YouTube →]"

🌐 website   4. Clicks that link. No login, no account.           Site verifies the HMAC token, calls
                Sees all 87 tracks listed, two buttons:             the bot API, renders the track list.
                [ Connect YouTube ]  [ Add all to playlist ]

🌐→🔵 Google 5. FIRST TIME ONLY: clicks "Connect YouTube".        Popup → Google sign-in → "Allow
                Signs in with the Google account that owns           discord2playlist to manage your
                the playlist. ~10 seconds.                           YouTube account?" → Allow.
                                                                     Bot's OAuth callback exchanges the
                                                                     code, stores the encrypted refresh
                                                                     token in `youtube_tokens` keyed by
                                                                     Sam's Discord user ID. Popup closes.

🌐 website   6. Clicks "Add all to playlist".                     Bot creates/finds the playlist, loops
                Watches a live progress bar:                         through all 87 videos calling
                  "Adding 12 / 87…"                                  playlistItems.insert with retry,
                Gets a link to the finished YouTube playlist.        streaming progress back over SSE.
                                                                     Records each result in
                                                                     `playlist_items` (resumable).

💬 Discord   7. (Optional) Types:                                  Bot sets cron_expression on the
                /schedule input_channel:#music-share                 scan_job and schedules it. From now
                cadence:daily                                        on it re-scans incrementally every
                                                                     day and AUTO-pushes new links to the
                                                                     SAME playlist — because YouTube is
                                                                     already connected from step 5.

         8. Sam never touches anything again. New links posted in #music-share show up in the
            YouTube playlist automatically, every day, forever.
```

**Why this ordering is the right design:**

- **Steps 1–3 need no YouTube auth at all.** Inviting the bot and scanning a channel only touch Discord. Sam gets value (a deduped list of 87 tracks) before being asked to connect anything. Don't gate the scan behind OAuth.
- **Auth is deferred to step 5, on the web, at the moment of need.** This is the answer to "would they auth in Discord first?" — they don't. The first time Sam clicks "Add all," the page notices there's no YouTube token for Sam and shows **Connect YouTube** instead. After that click, the button becomes **Add all to playlist** permanently.
- **It's one-time.** The stored refresh token means step 5 never repeats — not on the next manual push, and not on scheduled runs. Sam authorizes once, ever.
- **Scheduling (step 7) reuses the step-5 connection.** This is why `/schedule` "just works" silently: by the time Sam schedules, the YouTube token is already on file. The scheduler pushes on Sam's behalf with no further interaction.

**Edge case — what if Sam runs `/schedule` before ever connecting YouTube?** The scheduled run still scans and finds new links, but it has no token to push with. The bot handles this by **DMing Sam a fresh magic link** ("Found 4 new tracks — connect YouTube to push them →"). Sam clicks it, lands on the results page, connects once (step 5), and from then on it's fully automatic. So the flow self-heals regardless of the order Sam does things in.

**Optional convenience — a `/connect` command.** If you want to let power users pre-authorize without first running a scan, add a tiny Discord command that replies *ephemerally* with the bot's OAuth start URL:

```js
// commands/connect.js — replies only to the user, with a one-click connect link
const token = await issueConnectToken(interaction.user.id);   // short-lived, like a magic token
const url = `${process.env.SITE_ORIGIN}/discord2playlist/connect?t=${token}`;
await interaction.reply({
  content: `Connect your YouTube account (one-time): ${url}`,
  ephemeral: true,
});
```

This is purely additive — the lazy "connect on the results page" path (step 5) remains the primary one, because most users discover the need to connect exactly when they hit **Add all to playlist**.

### 5.1 The happy path

```
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 1.  User visits martinbarker.me/discord2playlist                  │
│          Clicks "Invite the bot" button.                               │
│          Discord OAuth screen → "Authorize" → bot joins their server.  │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 2.  In Discord they run:                                          │
│          /makeplaylists input_channel:#music output_channel:#bot-output│
│                                                                        │
│          Bot scans every message in #music, extracts links,            │
│          deduplicates, inserts into Postgres as scan_id="abc123".      │
│          Generates a magic token, signs it with SCAN_SECRET,           │
│          inserts the row into magic_tokens.                            │
│                                                                        │
│          Bot posts in #bot-output:                                     │
│            Found 87 videos. [View & add to YouTube →]                  │
│            https://martinbarker.me/discord2playlist/results/abc123?t=… │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 3.  User clicks the link (or opens it on their phone).            │
│          martinbarker.me verifies the HMAC, calls bot API to fetch     │
│          the scan results, renders the track list.                     │
│          No login. No account. Just the tracks.                        │
│                                                                        │
│          Two buttons:                                                  │
│            [ Connect YouTube ]   [ Add all to playlist ]               │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  ▼ first time              ▼ already connected
┌────────────────────────────┐   ┌──────────────────────────────────────┐
│ STEP 4a. Connect YouTube   │   │ STEP 4b. Add all to playlist         │
│   Google OAuth popup.      │   │   Site POSTs to bot's API.           │
│   On callback,             │   │   Bot loads user's refresh token.    │
│   refresh token stored     │   │   Loops through videos, calling      │
│   keyed by Discord user ID │   │   playlistItems.insert with retry    │
│   in youtube_tokens table. │   │   on transient errors. Reports       │
│   Persists across scans.   │   │   progress to the site over SSE.     │
└────────────────────────────┘   └──────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ STEP 5.  (Optional) In Discord they run:                               │
│          /schedule cadence:daily                                       │
│          The same scan_job_id now has cron_expression="0 0 * * *".     │
│          Once a day the bot re-scans incrementally (using              │
│          last_message_id), finds new links, and auto-pushes them       │
│          to the same playlist if YouTube is connected.                 │
│                                                                        │
│          User never visits martinbarker.me again unless they want to.  │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Implementing the invite button

The button on `martinbarker.me/discord2playlist` is already wired in `app/(main)/discord2playlist/page.js`. The URL format:

```
https://discord.com/oauth2/authorize
  ?client_id=YOUR_DISCORD_CLIENT_ID
  &permissions=67584
  &integration_type=0
  &scope=bot+applications.commands
```

`67584` = `Send Messages` (2048) + `Read Message History` (65536). Nothing else.

When the user authorizes, Discord fires the bot's `guildCreate` event. In `start_discord_bot.js`:

```js
client.on('guildCreate', async (guild) => {
  await db.query(
    `INSERT INTO guilds (guild_id, guild_name)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET guild_name = $2`,
    [guild.id, guild.name]
  );
});
```

The guild row is now ready to accept scans.

### 5.3 Implementing the magic link (no auth)

This is the heart of "no martinbarker.me account." The link is a one-time signed URL.

**Token format:**

```
token = base64url(HMAC_SHA256(SCAN_SECRET, scan_id + ":" + discord_user_id + ":" + exp))
```

Where `exp` is a Unix timestamp 7 days in the future. All three values are also stored in the `magic_tokens` table — the HMAC is purely a tamper-check, not a lookup.

**Schema addition (already in Appendix A):**

```sql
CREATE TABLE IF NOT EXISTS magic_tokens (
    token_id         TEXT PRIMARY KEY,            -- short random ID shown in URL
    scan_job_id      INTEGER NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
    discord_user_id  TEXT NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked          BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_magic_tokens_scan ON magic_tokens(scan_job_id);
```

**Bot side — issuing the token** (in `commands/makePlaylists.js`, after the scan completes):

```js
const crypto = require('crypto');

const tokenId = crypto.randomBytes(9).toString('base64url');  // ~12 chars
const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
const sig = crypto
  .createHmac('sha256', process.env.SCAN_SECRET)
  .update(`${tokenId}:${scanJobId}:${interaction.user.id}:${exp}`)
  .digest('base64url');
const token = `${tokenId}.${sig}`;

await db.query(
  `INSERT INTO magic_tokens (token_id, scan_job_id, discord_user_id, expires_at)
   VALUES ($1, $2, $3, to_timestamp($4))`,
  [tokenId, scanJobId, interaction.user.id, exp]
);

const url = `${process.env.SITE_ORIGIN}/discord2playlist/results/${scanJobId}?t=${token}`;
await interaction.followUp({ content: `Found ${videoCount} videos. **[View & add to YouTube →](${url})**` });
```

**Bot side — verifying the token** (Express middleware on `GET /api/scans/:id`):

```js
function verifyMagicToken(req, res, next) {
  const token = req.query.t;
  if (!token) return res.status(401).json({ error: 'missing token' });
  const [tokenId, sig] = token.split('.');
  const row = await db.query(
    `SELECT discord_user_id, expires_at, scan_job_id, revoked
     FROM magic_tokens WHERE token_id = $1`, [tokenId]
  );
  if (!row || row.revoked) return res.status(403).json({ error: 'invalid token' });
  if (row.expires_at < new Date()) return res.status(410).json({ error: 'expired' });
  if (String(row.scan_job_id) !== req.params.id) return res.status(403).json({ error: 'wrong scan' });

  const exp = Math.floor(row.expires_at.getTime() / 1000);
  const expected = crypto
    .createHmac('sha256', process.env.SCAN_SECRET)
    .update(`${tokenId}:${row.scan_job_id}:${row.discord_user_id}:${exp}`)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(403).json({ error: 'bad signature' });
  }

  req.discordUserId = row.discord_user_id;
  req.scanJobId = row.scan_job_id;
  next();
}
```

Every API call from the site carries `?t=token`. The bot verifies on every request — no session, no cookies.

If the user wants a fresh link, they re-run `/makeplaylists`. Tokens can be revoked with `UPDATE magic_tokens SET revoked = true WHERE …`.

### 5.4 Results page on martinbarker.me

New route to add: `app/(main)/discord2playlist/results/[scanId]/page.js`. Server component:

```jsx
import { notFound } from 'next/navigation';

export default async function ResultsPage({ params, searchParams }) {
  const { scanId } = params;
  const { t: token } = searchParams;
  if (!token) notFound();

  const res = await fetch(`${process.env.BOT_API_URL}/api/scans/${scanId}?t=${token}`, {
    headers: { 'x-site-secret': process.env.SITE_SHARED_SECRET },
    cache: 'no-store'
  });
  if (!res.ok) notFound();
  const { tracks, alreadyConnected, scanJob } = await res.json();

  return (
    <ResultsView
      scanId={scanId}
      token={token}
      tracks={tracks}
      alreadyConnected={alreadyConnected}
      scanJob={scanJob}
    />
  );
}
```

The page renders the tracks and the two buttons. **Connect YouTube** kicks off `/api/youtube/oauth/start?scanId=…&t=…` (handled by the bot, redirects to Google). **Add all to playlist** opens an SSE connection to `/api/scans/:id/push?t=…` and streams progress events.

Add `BOT_API_URL=https://bot.martinbarker.me` and `SITE_SHARED_SECRET=...` to the **martinbarker.me ECS task definition** (`DevTaskDefPortfolio`) — `BOT_API_URL` as a plain `environment` entry, `SITE_SHARED_SECRET` as a `secrets` entry sourced from Secrets Manager (same pattern as the bot's task def in §4.7). After editing, register a new revision and `aws ecs update-service --force-new-deployment` so the site picks them up. The client-side SSE call also needs the bot URL exposed to the browser — add `NEXT_PUBLIC_BOT_API_URL` the same way.

### 5.5 YouTube OAuth — one-time connect

The bot owns the OAuth flow because it's the thing that needs the tokens. Site just opens a popup at the bot's URL.

```
Site                  Bot                  Google
 │  popup → /api/youtube/oauth/start?scanId=…&t=…
 │ ────────────────────►│
 │                      │ verify magic token, build Google URL with
 │                      │   state = HMAC({scan_id, discord_user_id, nonce})
 │                      │   scope = youtube
 │                      │   prompt=consent access_type=offline
 │ ◄──── 302 redirect ──│
 │                                          │
 │ ─────────────── user logs in ────────────►│
 │                      │                   │
 │                      │ ◄── 302 callback ─│  /api/youtube/oauth/callback?code=…&state=…
 │                      │
 │                      │ verify state HMAC, exchange code for tokens,
 │                      │ store refresh_token (AES-encrypted) keyed by discord_user_id,
 │                      │ render a tiny "You're connected, close this window" page
 │                      │ (or postMessage to opener).
 │
 │ popup closes; site polls /api/scans/:id (now returns alreadyConnected: true)
```

`prompt=consent access_type=offline` is mandatory — that's what makes Google return a `refresh_token`. Without those flags you get an access token that expires in an hour with no way to refresh.

Schema for the token table:

```sql
CREATE TABLE IF NOT EXISTS youtube_tokens (
    discord_user_id  TEXT PRIMARY KEY,
    refresh_token    BYTEA NOT NULL,              -- AES-256-GCM encrypted
    youtube_channel_id   TEXT,
    youtube_channel_name TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Encrypt with a key derived from `SCAN_SECRET` (or a dedicated `TOKEN_ENCRYPTION_KEY`). Standard Node `crypto.createCipheriv('aes-256-gcm', ...)` pattern.

### 5.6 Adding videos to a playlist with retry

The user clicks **Add all to playlist**. The site opens an SSE stream to the bot.

**Bot side — `POST /api/scans/:id/push`:**

```js
app.post('/api/scans/:id/push', verifyMagicToken, async (req, res) => {
  const { scanJobId, discordUserId } = req;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  const emit = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const tokens = await loadYouTubeTokens(discordUserId);
  if (!tokens) { emit('error', { code: 'no_youtube' }); return res.end(); }

  const youtube = google.youtube({ version: 'v3', auth: oauth2ClientFor(tokens) });

  // 1) ensure a playlist exists for this scan_job_id
  let playlistId = await getOrCreatePlaylistId(scanJobId, discordUserId, youtube);

  // 2) load every video_id we haven't pushed yet (resumability!)
  const todo = await db.query(`
    SELECT el.media_id
    FROM extracted_links el
    LEFT JOIN playlist_items pi
      ON pi.scan_job_id = el.scan_job_id
      AND pi.media_id = el.media_id
      AND pi.discord_user_id = $1
      AND pi.status = 'inserted'
    WHERE el.scan_job_id = $2 AND el.platform = 'youtube' AND pi.id IS NULL
    ORDER BY el.id ASC
  `, [discordUserId, scanJobId]);

  emit('start', { total: todo.length, playlistId });

  for (const { media_id } of todo) {
    try {
      await insertWithRetry(youtube, playlistId, media_id);
      await db.query(
        `INSERT INTO playlist_items (scan_job_id, discord_user_id, media_id, youtube_playlist_id, status)
         VALUES ($1, $2, $3, $4, 'inserted')
         ON CONFLICT (scan_job_id, discord_user_id, media_id) DO UPDATE
         SET status = 'inserted', error = NULL`,
        [scanJobId, discordUserId, media_id, playlistId]
      );
      emit('progress', { mediaId: media_id, status: 'inserted' });
    } catch (err) {
      await db.query(
        `INSERT INTO playlist_items (scan_job_id, discord_user_id, media_id, youtube_playlist_id, status, error)
         VALUES ($1, $2, $3, $4, 'failed', $5)
         ON CONFLICT (scan_job_id, discord_user_id, media_id) DO UPDATE
         SET status = 'failed', error = $5`,
        [scanJobId, discordUserId, media_id, playlistId, err.message]
      );
      emit('progress', { mediaId: media_id, status: 'failed', error: err.message });
    }
  }

  emit('done', { playlistId });
  res.end();
});
```

**The retry helper** — handles the failures YouTube actually throws:

```js
async function insertWithRetry(youtube, playlistId, videoId, attempt = 0) {
  try {
    await youtube.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } }
      }
    });
  } catch (err) {
    const code = err.code || err.response?.status;
    const reason = err.errors?.[0]?.reason || err.response?.data?.error?.errors?.[0]?.reason;

    // Permanent — don't retry these
    if (reason === 'videoNotFound')        throw new Error('video unavailable');
    if (reason === 'videoAlreadyInPlaylist') return;   // treat as success
    if (reason === 'forbidden')            throw new Error('access denied to video');
    if (reason === 'quotaExceeded')        throw new Error('YouTube daily quota hit — try tomorrow');

    // Transient — retry with backoff up to 5 times
    const transient = code >= 500 || code === 429 || reason === 'rateLimitExceeded' || reason === 'backendError';
    if (transient && attempt < 5) {
      const delay = Math.min(2 ** attempt * 1000 + Math.random() * 500, 30000);
      await new Promise(r => setTimeout(r, delay));
      return insertWithRetry(youtube, playlistId, videoId, attempt + 1);
    }
    throw err;
  }
}
```

Three things this design gets right:

1. **Resumable.** The `LEFT JOIN playlist_items` query skips videos that are already `inserted`. If the user closes the tab mid-push, the next click picks up exactly where the last one left off. Same logic applies when `/schedule` runs auto-pushes later.
2. **Failures are recorded, not hidden.** Permanently failed videos stay in `playlist_items` with `status = 'failed'` and the error message. The site can show "3 videos couldn't be added — see why" instead of silently dropping them.
3. **Quota-aware.** If YouTube returns `quotaExceeded`, we stop the run and tell the user. The remaining videos stay in the DB and the next push (manual or scheduled) will pick them up automatically once the quota resets at midnight Pacific.

**Site side — consuming the SSE stream:**

```js
'use client';
const evt = new EventSource(`${BOT_API_URL}/api/scans/${scanId}/push?t=${token}`);
evt.addEventListener('start', e => setTotal(JSON.parse(e.data).total));
evt.addEventListener('progress', e => {
  const { mediaId, status, error } = JSON.parse(e.data);
  setProgress(p => [...p, { mediaId, status, error }]);
});
evt.addEventListener('done', e => {
  const { playlistId } = JSON.parse(e.data);
  setPlaylistUrl(`https://www.youtube.com/playlist?list=${playlistId}`);
  evt.close();
});
evt.addEventListener('error', e => {
  setError('Connection dropped — click Add all to resume.');
  evt.close();
});
```

Closing the tab is fine. Opening it again and hitting "Add all" resumes — same magic link, same scan, same playlist.

---

## 6. Phase 3 — auto-running with /schedule

The user runs `/schedule` in Discord against an existing scan. From then on the bot owns the lifecycle: re-scan, find new links, push to the same playlist, every N hours/days.

### 6.1 The slash command

Add `commands/schedule.js`:

```js
const { SlashCommandBuilder, ChannelType } = require('discord.js');

const PRESETS = {
  hourly: '0 * * * *',
  '6h':   '0 */6 * * *',
  daily:  '0 0 * * *',
  weekly: '0 0 * * 0',
  off:    null
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Auto-run /makeplaylists for a channel on a recurring schedule')
    .addChannelOption(o => o.setName('input_channel')
      .setDescription('The channel to re-scan')
      .addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o => o.setName('cadence')
      .setDescription('How often')
      .setRequired(true)
      .addChoices(
        { name: 'Every hour',     value: 'hourly' },
        { name: 'Every 6 hours',  value: '6h' },
        { name: 'Every day',      value: 'daily' },
        { name: 'Every week',     value: 'weekly' },
        { name: 'Turn off',       value: 'off' }
      )),
  async execute(interaction) {
    const inputChannel = interaction.options.getChannel('input_channel');
    const cadence = interaction.options.getString('cadence');
    const cron = PRESETS[cadence];

    const { rows } = await db.query(
      `UPDATE scan_jobs
       SET cron_expression = $1, is_active = $2
       WHERE guild_id = $3 AND input_channel_id = $4
       RETURNING id`,
      [cron, cron !== null, interaction.guild.id, inputChannel.id]
    );
    if (rows.length === 0) {
      return interaction.reply({
        content: `No scan exists for ${inputChannel}. Run \`/makeplaylists\` first.`,
        ephemeral: true
      });
    }

    rescheduleJob(rows[0].id, cron);   // see below

    const label = cron
      ? `**${cadence}** (\`${cron}\`)`
      : '**disabled**';
    await interaction.reply({
      content: `Scan for ${inputChannel} is now ${label}. The bot will rescan and auto-push new links to YouTube if you've connected your account.`,
      ephemeral: true
    });
  }
};
```

### 6.2 The scheduler

A small module that keeps an in-memory `Map<scanJobId, cronTask>` in sync with the database. Re-hydrated on boot.

```js
// scheduler.js
const cron = require('node-cron');
const db = require('./db');

const jobs = new Map();

async function rescheduleJob(scanJobId, cronExpression) {
  const existing = jobs.get(scanJobId);
  if (existing) { existing.stop(); jobs.delete(scanJobId); }
  if (!cronExpression) return;

  const task = cron.schedule(cronExpression, () => runScheduled(scanJobId).catch(err => {
    console.error(`scheduled scan ${scanJobId} failed:`, err);
  }));
  jobs.set(scanJobId, task);
}

async function runScheduled(scanJobId) {
  const job = await db.query('SELECT * FROM scan_jobs WHERE id = $1 AND is_active', [scanJobId]);
  if (!job) return;

  // 1) incremental re-scan (uses last_message_id)
  const newLinkCount = await rescanChannel(job);

  // 2) if user has YouTube connected, auto-push the new links
  if (newLinkCount > 0) {
    const hasTokens = await db.query(
      'SELECT 1 FROM youtube_tokens WHERE discord_user_id = $1',
      [job.initiated_by_user_id]
    );
    if (hasTokens) {
      await pushPendingToPlaylist(scanJobId, job.initiated_by_user_id);
    } else {
      // DM the user a fresh magic link so they can push manually
      const token = await issueMagicToken(scanJobId, job.initiated_by_user_id);
      await dmUser(job.initiated_by_user_id,
        `Found ${newLinkCount} new tracks in <#${job.input_channel_id}>. ` +
        `[Push them to YouTube →](${process.env.SITE_ORIGIN}/discord2playlist/results/${scanJobId}?t=${token})`
      );
    }
  }

  await db.query('UPDATE scan_jobs SET last_run_at = NOW() WHERE id = $1', [scanJobId]);
}

async function rehydrateAll() {
  const { rows } = await db.query(
    `SELECT id, cron_expression FROM scan_jobs WHERE is_active AND cron_expression IS NOT NULL`
  );
  for (const r of rows) await rescheduleJob(r.id, r.cron_expression);
  console.log(`Rehydrated ${rows.length} scheduled scans.`);
}

module.exports = { rescheduleJob, rehydrateAll };
```

Call `rehydrateAll()` once during boot in `start_discord_bot.js`, right after the discord.js `ready` event. Now scheduled jobs survive deploys — the new task picks up the schedule from Postgres.

`pushPendingToPlaylist()` is the same loop as `POST /api/scans/:id/push` from §5.6, just called internally instead of over HTTP. Because the loop is resumable, **a scheduled push that fails mid-run will finish itself on the next tick** — exactly what you want.

### 6.3 What the user sees

After they've run `/schedule cadence:daily` and connected YouTube once, they get this experience forever:

> Day 1, 10:00 AM — Someone posts a YouTube link in `#music`.
> Day 1, 11:00 PM — Nothing happens. The cron is at midnight.
> Day 2, 00:00 UTC — Bot rescans `#music`, finds 1 new video, adds it to the same playlist.
> Day 2, 00:01 UTC — That's it. Silent. Done.

If something goes wrong (YouTube auth expired, quota hit, etc.), the bot DMs them a fresh magic link with the failed batch waiting. They click → fix → push. Then it's silent again.

---

## 7. Updating the bot without touching the site

This is automatic from the GitHub Actions workflow in 4.10.

```
edit bot code → git push origin main → Actions builds → ECR receives new image
   → ECS rolling deploy (zero downtime, ~60s)
   → martinbarker.me is not touched, never redeployed (its own ECS service stays as-is)
```

To verify a deploy went out:

```bash
aws ecs describe-services \
  --cluster portfolioCluster \
  --services Discord2PlaylistService \
  --query 'services[0].deployments' \
  --region us-west-1

aws logs tail /ecs/discord2playlist-bot --since 5m --region us-west-1
```

Rolling back is one command — point the service at the previous task definition revision:

```bash
aws ecs update-service \
  --cluster portfolioCluster \
  --service Discord2PlaylistService \
  --task-definition Discord2PlaylistTask:PREVIOUS_REVISION \
  --region us-west-1
```

---

## 8. Troubleshooting

```bash
# Find stopped tasks (something crashed)
aws ecs list-tasks --cluster portfolioCluster \
  --service-name Discord2PlaylistService \
  --desired-status STOPPED --region us-west-1

# Describe one to see the stop reason
aws ecs describe-tasks --cluster portfolioCluster --tasks TASK_ARN \
  --query 'tasks[0].stoppedReason' --region us-west-1
```

| Symptom | Likely cause | Fix |
|---|---|---|
| `Essential container exited` | Missing env var or bad token | Check Secrets Manager values, restart service |
| `CannotPullContainerError` | Execution role missing ECR perms | Attach `AmazonECSTaskExecutionRolePolicy` |
| `ResourceNotFoundException` on secret | Secret ARN missing the `::` suffix | Each secret key in the task def needs `:KEY::` at the end |
| Task starts then exits after ~30s | Invalid `DISCORD_TOKEN` | Regenerate token in Discord Developer Portal, update secret |
| Slash command not appearing in Discord | Global commands haven't propagated | Wait up to 1 hour, or use `npm run deploy:guild` for instant updates in your test server |
| `playlistItems.insert` returns 403 | Wrong scopes on OAuth or token expired | Re-run Connect YouTube, verify `scope=youtube` and `prompt=consent` |
| `quotaExceeded` errors at low volume | Hit YouTube's 10k unit/day cap | Apply for quota increase or have each user supply their own GCP client (see §3 in the prior version of this guide) |
| Magic link returns "invalid token" immediately | `SCAN_SECRET` mismatch between issue and verify | Both ops must read the same secret from the same Secrets Manager entry — no `.env` overrides |
| Bot can't reach RDS | Security group rule missing | `authorize-security-group-ingress` for port 5432 from ECS SG to RDS SG |

---

## 9. Appendix A — full schema

Save in the bot repo as `db/schema.sql`. Applied via `npm run db:migrate` (which `db/migrate.js` runs).

```sql
-- Guilds (Discord servers) using Discord2Playlist
CREATE TABLE IF NOT EXISTS guilds (
    guild_id        TEXT PRIMARY KEY,
    guild_name      TEXT,
    tier            TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team')),
    stripe_customer_id TEXT,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scan jobs: each /makeplaylists run creates or updates one of these
CREATE TABLE IF NOT EXISTS scan_jobs (
    id                  SERIAL PRIMARY KEY,
    guild_id            TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    input_channel_id    TEXT NOT NULL,
    output_channel_id   TEXT NOT NULL,
    output_message_id   TEXT,
    initiated_by_user_id TEXT NOT NULL,
    youtube_sync_mode   TEXT NOT NULL DEFAULT 'admin-only'
        CHECK (youtube_sync_mode IN ('admin-only', 'anyone', 'role')),
    youtube_sync_role_id TEXT,
    last_message_id     TEXT,
    cron_expression     TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    last_run_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (guild_id, input_channel_id, output_channel_id)
);

-- Magic tokens for unauthenticated web access
CREATE TABLE IF NOT EXISTS magic_tokens (
    token_id         TEXT PRIMARY KEY,
    scan_job_id      INTEGER NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
    discord_user_id  TEXT NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked          BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extracted media links
CREATE TABLE IF NOT EXISTS extracted_links (
    id                  SERIAL PRIMARY KEY,
    scan_job_id         INTEGER NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
    guild_id            TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    platform            TEXT NOT NULL
        CHECK (platform IN ('youtube', 'spotify', 'soundcloud', 'bandcamp')),
    media_id            TEXT NOT NULL,
    media_url           TEXT,
    author_discord_id   TEXT,
    author_username     TEXT,
    source_message_id   TEXT,
    extracted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scan_job_id, platform, media_id)
);

-- Per-user YouTube OAuth tokens (refresh_token encrypted at rest)
CREATE TABLE IF NOT EXISTS youtube_tokens (
    discord_user_id  TEXT PRIMARY KEY,
    refresh_token    BYTEA NOT NULL,
    youtube_channel_id   TEXT,
    youtube_channel_name TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-(scan, user, video) push status — drives the retry/resume logic
CREATE TABLE IF NOT EXISTS playlist_items (
    id                  SERIAL PRIMARY KEY,
    scan_job_id         INTEGER NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
    discord_user_id     TEXT NOT NULL,
    media_id            TEXT NOT NULL,
    youtube_playlist_id TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'inserted', 'failed', 'skipped')),
    error               TEXT,
    attempts            INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scan_job_id, discord_user_id, media_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scan_jobs_guild
    ON scan_jobs(guild_id);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_active_cron
    ON scan_jobs(is_active, cron_expression)
    WHERE is_active = true AND cron_expression IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extracted_links_job
    ON extracted_links(scan_job_id);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_scan
    ON magic_tokens(scan_job_id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_scan_user
    ON playlist_items(scan_job_id, discord_user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_status
    ON playlist_items(scan_job_id, status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guilds_updated_at         BEFORE UPDATE ON guilds         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_scan_jobs_updated_at      BEFORE UPDATE ON scan_jobs      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_youtube_tokens_updated_at BEFORE UPDATE ON youtube_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_playlist_items_updated_at BEFORE UPDATE ON playlist_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

`db/index.js` (shared pg Pool):

```js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
pool.on('error', err => console.error('db pool error:', err));
module.exports = { query: (text, params) => pool.query(text, params), getClient: () => pool.connect(), pool };
```

---

## 10. Appendix B — future tiers & monetization

Not required for launch, but the schema already includes a `tier` column on `guilds` and a `subscriptions` table can be added when needed. Sketch only:

**Free** — unlimited one-time scans, 2 input channels per server, 5,000-message history depth, no scheduled runs.

**Pro ($3.99/mo)** — up to 10 input channels, full history, scheduled runs (≥1 hour interval), JSON export.

**Team ($9.99/mo)** — unlimited channels, scheduled runs ≥15 min, multiple YouTube accounts, webhook notifications.

Implementation when you want it: Stripe Checkout from `/upgrade` slash command → webhook updates `guilds.tier` → command handlers check tier before allowing scheduled runs.

---

## 11. Launch checklist

Before sharing the bot publicly:

- [ ] All AWS resources from §4 are live and healthy
- [ ] Magic-link flow tested end-to-end with a friend's Discord account (not just yours)
- [ ] YouTube OAuth tested with a Google account that doesn't own the GCP project
- [ ] Retry behavior verified by intentionally pushing a deleted/unavailable video
- [ ] `/schedule daily` ran at least once on a real scan
- [ ] Logs flowing to CloudWatch, retention set (default is forever — set to 30 days to keep costs down)
- [ ] UptimeRobot or similar pinging `https://bot.martinbarker.me/healthz` every 5 min
- [ ] Sentry or equivalent capturing unhandled exceptions
- [ ] Privacy policy and ToS pages on martinbarker.me (Discord requires them once you hit 75 servers)
- [ ] Discord bot verification application submitted (required at 75 servers)
- [ ] YouTube quota increase application drafted (so you can submit the moment you have 10+ active users)

Once that list is green, the bot can run unattended for months. Updates are `git push`; the user experience is "invite → command → click link → done."
