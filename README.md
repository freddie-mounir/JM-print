# JM-print

Website for printing solutions of JM print house. The Deno server hosts the static site, accepts
quote requests, stores them in a local SQLite database, and provides a password-protected admin
table at `/admin`.

## Run locally

1. Install Deno 2.
2. Copy `.env.example` to `.env` and set a unique admin password and a random session secret.
   Generate a secret with:

   ```sh
   deno eval "console.log(Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''))"
   ```

3. Start the server from the project directory:

   ```sh
   deno task start
   ```

4. Open `http://localhost:8000` for the website or `http://localhost:8000/admin` for the
   request table.

The local Deno server stores data in `data/quote-requests.sqlite3`. The Vercel API instead
connects to a remote Turso database using `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; it creates
the required tables automatically on its first API request.

## Deploy to Vercel with Turso

1. Create a database in Turso and generate a database auth token.
2. In the Vercel project settings, add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` for each environment you deploy.
   Use an admin password of at least 14 characters and a randomly generated session secret of at
   least 32 characters. Do not add these secrets to GitHub.
3. Redeploy the project. Quote submissions and the admin request table will then use Turso.

The quote request table is created automatically in Turso. The local SQLite database is not
automatically copied; existing local requests must be migrated separately if you need them online.
Keep `.env` and the local database out of public/static hosting. Vercel uses secure session
cookies over HTTPS. The local Deno server continues to use SQLite and `COOKIE_SECURE=false`.

The admin table shows the 500 most recent requests. Login sessions expire after eight hours,
and repeated failed sign-in attempts are temporarily rate-limited using Turso on Vercel.
