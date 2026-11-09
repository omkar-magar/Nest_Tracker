# Deploying to Render (staging)

This creates a **separate** copy of YOLO Nest on Render. Your live Vercel + Supabase site is not touched and does not know this exists.
Render builds from the git branch `render-migration`, so the branch must be pushed to GitHub first.

## What gets created
| Name | Type | What it is |
|---|---|---|
| `yolo-nest-db` | PostgreSQL | the new database (empty at first) |
| `yolo-nest-api` | Web Service | the Express API in `server/` |
| `yolo-nest-site` | Static Site | the React website (`dist/`) |

## 1. First deploy
1. Make sure `render-migration` is pushed to GitHub (ask Claude to push it).
2. In the Render dashboard: **New +** > **Blueprint**, connect your GitHub account, pick the `Nest_Tracker` repository, choose branch `render-migration`.
3. Render reads `render.yaml` and lists the three resources above. It asks for two values:
   - `APP_ORIGIN` and `APP_URL`: the address the website will get, `https://yolo-nest-site.onrender.com` (no slash at the end).
     If the name is already taken Render adds a suffix; you fix the value in step 3 below.
4. Click **Apply**. Render creates the database first, then builds the API and the site (a few minutes).

## 2. Check it
- API: open `https://yolo-nest-api.onrender.com/api/health`. You should see `{"ok":true}`.
- Database: open `/api/health/db`. `{"ok":true}` means the API can reach Postgres.
- Migrations: in the API service > **Logs**, look for lines like `applied server/db/prelude.sql` ... `done, 8 migration(s) applied`.
- Website: open the site URL. Until the frontend switch stage it shows the static content from `src/data/site.js`, same as a visit without Supabase.

## 3. If the addresses differ from the guesses
Open each service > **Environment**. Copy the real site address into `APP_ORIGIN` and `APP_URL` on the API. In `render.yaml` change the `destination` of the `/api/*` route to the real API address, commit, push. Render redeploys by itself.

## 4. Load the sample rooms (once)
API service > **Shell** tab:
```
npm run db:migrate -- --seed
```
This adds the rooms, beds and amenities from `supabase/seed.sql`. It is safe to run twice; the second time does nothing.

## If something fails
- **Deploy fails at "migration"**: open the log. The message starts with the file name that failed. Copy it to Claude. The most likely first problem is a permission error on `create role` (Render's database user may not be allowed to create roles).
- **`Bad server configuration: ...`**: a required setting is missing in the API's Environment tab; the message names it.
- Every push to `render-migration` redeploys automatically (turn this off in a service's Settings > Build & Deploy > Auto-Deploy if you prefer manual).
- To stop all cost: delete the three resources in the dashboard. Nothing else is affected.

## Later stages add
Resend, R2 and Razorpay keys (uncomment them in `render.yaml` when their stage arrives), and the data copy from Supabase (`docs/cutover.md`).
