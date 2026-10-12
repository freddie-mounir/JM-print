# JMprint quote requests

The Deno server hosts the static site, accepts quote requests, stores them in a local SQLite
database, and provides a password-protected admin table at `/admin`.

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

The SQLite file is created at `data/quote-requests.sqlite3`. Back up that file and use a host
with persistent disk storage when deploying. Run one server instance against the SQLite file.
Set `COOKIE_SECURE=true` in production and serve the site over HTTPS. Keep `.env` and the
database out of public/static hosting.

The admin table shows the 500 most recent requests. Login sessions expire after eight hours,
and repeated failed sign-in attempts are temporarily rate-limited.
