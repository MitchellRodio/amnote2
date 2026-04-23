# Creator Tasks, Railway Edition

Slack-native task manager for creator/account channels.

This version is prepared for **Railway + Postgres** so you do not need to host it locally.

## Stack
- TypeScript
- Node.js
- Slack Bolt for JavaScript
- Prisma
- PostgreSQL
- Socket Mode

## What changed for Railway
- Switched Prisma from SQLite to PostgreSQL
- Added `postinstall` script so Prisma Client is generated during build
- Added `railway.json` with a pre-deploy Prisma push and start command
- Added `.env.railway.example`

## Local dev
1. Copy `.env.example` to `.env`
2. Fill in:
   - `DATABASE_URL`
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_APP_TOKEN`
3. Run:

```bash
npm install
npx prisma db push
npm run dev
```

## Railway deploy
1. Push this project to GitHub
2. In Railway, create a new project from your GitHub repo
3. Add a PostgreSQL service to the project
4. In the app service Variables tab, add:
   - `DATABASE_URL` = reference the Postgres service's `DATABASE_URL`
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_APP_TOKEN`
   - `TIMEZONE=America/New_York`
   - `SLACK_LOG_LEVEL=info`
5. Deploy

Railway will:
- install dependencies
- run `postinstall` -> `prisma generate`
- run pre-deploy command -> `npx prisma db push`
- run start command -> `npm run start`

## Slack app requirements
This app uses **Socket Mode**, so you need:
- Bot token (`xoxb-...`)
- App token (`xapp-...`) with `connections:write`
- Signing secret

Socket Mode means you do **not** need ngrok or a public request URL.

## Commands
- `/todo <task>`
- `/todos`
- `/mytodos`
- `/overdue`
- `/today`
- `/list`

## Notes
- If you change the Prisma schema later, redeploy or run `npx prisma db push` again.
- After adding a new slash command in Slack, reinstall the Slack app to your workspace.
