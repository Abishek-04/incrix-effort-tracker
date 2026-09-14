# Incrix Effort Tracker

A Next.js app for logging work, scoring it against a points rate card and tracking each person's monthly target. Data is stored in AWS DynamoDB. Sign-in uses JWT sessions and has two roles.

## Pages and roles

| Route | What it does | Team | Admin |
| --- | --- | :-: | :-: |
| `/login` | Sign in | – | – |
| `/log` | Log a task with live points and progress against the monthly target | ✅ | ✅ |
| `/dashboard` | Summary cards, team performance, department and weekly charts, "Needs attention" | ✅ | ✅ |
| `/grid` | Month grid showing who logged work on which day | ✅ | ✅ |
| `/entries` | Search, filter, edit, delete (with undo) and export CSV | ✅ | ✅ |
| `/setup` | Team and targets, rate card (Software = Engineering + UI/UX Design), backup, restore and reset, **Access & security** | ❌ | ✅ |

There are two logins, stored in DynamoDB:

- **Administrator:** full access.
- **Team:** one login shared by the team.

Admins can change either login's email or password, or sign out all devices, in **Setup → Access & security**.

## Local development

Requires Node.js 22.18 or newer.

```bash
npm install
cp .env.example .env.local        # fill in the AWS keys and JWT_SECRET (openssl rand -base64 48)
npm run db:setup                  # creates the table and loads the default team and rates (safe to re-run)
npm run auth:set -- admin admin@yourcompany.com   # prompts for a password
npm run auth:set -- team  team@yourcompany.com
npm run dev                       # http://localhost:3000
```

| Script | |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop, build, run |
| `npm run typecheck` | Check types |
| `npm run db:setup` | Create and seed the table if missing (never overwrites data) |
| `npm run auth:set -- <admin\|team> <email>` | Create a login or reset its password. This also works if everyone is locked out. |

## Deploying to Vercel

1. Push the repo to GitHub, then **Import Project** on Vercel. It detects Next.js automatically. `vercel.json` pins the functions to **Mumbai (`bom1`)**, next to the DynamoDB table in `ap-south-1`.
2. Under **Settings → Environment Variables**, add these for Production (and Preview if you use it):

   | Name | Value |
   | --- | --- |
   | `APP_AWS_REGION` | `ap-south-1` |
   | `APP_AWS_ACCESS_KEY_ID` | access key of a least-privilege IAM user (see below) |
   | `APP_AWS_SECRET_ACCESS_KEY` | its secret |
   | `DYNAMODB_TABLE` | `incrix-effort-tracker` |
   | `JWT_SECRET` | a new random value from `openssl rand -base64 48` |

   Use the `APP_` prefix, because Vercel reserves `AWS_*` variable names.
3. Deploy. The logins already exist in DynamoDB, so sign in with the same credentials as locally.

Sign-in cookies are marked `Secure` automatically over HTTPS, as they are on Vercel.

## Security model

- **Sessions:** HS256 JWTs (via `jose`) stored in an `HttpOnly`, `SameSite=Lax` cookie, never in `localStorage`. They last 12 hours, or 30 days with "Keep me signed in".
- **Where sessions are checked:** three places, so bypassing any one of them isn't enough.
  - `src/proxy.ts` checks the token signature on every request.
  - Each API route calls `requireSession()` or `requireSession("admin")`. This also confirms the session hasn't been revoked.
  - The `(app)` and `setup` layouts re-check on the server before rendering.
- **Revocation:** each login has a version number that is embedded in its tokens. Changing a password or email, or using "Sign out all devices", bumps the version and invalidates old tokens immediately. Every check reads the current version from the database, on every server instance.
- **Passwords:** hashed with scrypt (N=2¹⁵, r=8, p=1) plus a random salt. The minimum is 10 characters with letters and numbers. Security changes require the admin's current password.
- **Brute force:** 8 failed attempts in 15 minutes pauses sign-in for that email. Unknown emails take the same time to reject as wrong passwords.
- **Data safety:** reset and restore never touch login accounts, and backups never include password hashes.
- **CSRF:** `SameSite=Lax` cookies, and every state-changing API requires `application/json`.

### Least-privilege IAM policy

Use an IAM user that can only reach this table, not an admin key:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query",
      "dynamodb:Scan", "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems", "dynamodb:DescribeTable"
    ],
    "Resource": "arn:aws:dynamodb:ap-south-1:610265770005:table/incrix-effort-tracker"
  }]
}
```

## Data model

One DynamoDB table, `incrix-effort-tracker` (on-demand billing, point-in-time recovery, deletion protection):

| PK | SK | Item |
| --- | --- | --- |
| `META` | `CONFIG` | Schema version |
| `AUTH` | `ACCOUNT#admin` / `ACCOUNT#team` | email, scrypt hash, session version |
| `AUTH` | `THROTTLE#<email>` | Failed sign-in counter |
| `TEAM` | `MEMBER#<uuid>` | name, role, dept, target, active |
| `RATE` | `TYPE#<uuid>` | dept, type, unit, rate, group |
| `ENTRY#YYYY-MM` | `ENTRY#<uuid>` | date, memberId, typeId, desc, qty, hours, status |

## Moving data over from the HTML tracker

In the HTML file, download a backup from **Setup → Data & backup**. Then in this app, go to **Setup → Data & backup → Restore**. Names are matched automatically and sample entries are skipped.

## Self-hosting (optional)

`npm run start:lan` (`server.mjs`) serves the app to the local network only. `deploy/macmini.sh` installs it as an always-on macOS service. Sign-in works the same way in both.
