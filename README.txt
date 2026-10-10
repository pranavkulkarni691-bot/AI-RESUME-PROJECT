RESUME AI  - version for LAPTOP + VERCEL  (frontend + backend in one folder)

=====================================================
A) RUN ON YOUR LAPTOP
=====================================================
1. Install Node.js LTS (20 or newer) from https://nodejs.org  -> check with:  node -v
2. Open THIS folder in VS Code (the one that contains server.js and package.json).
3. In the terminal run:
       npm install          (only the first time, takes about a minute)
       npm run dev
   (Windows shortcut: double-click start.bat, it does both)
4. Open http://localhost:4000

The .env file has AI_MOCK=true, so you get SAMPLE AI answers without a key.
For real AI: set AI_MOCK=false and paste your key after ANTHROPIC_API_KEY=, restart.
On your laptop the data is saved in the data/ folder. Leave the two TURSO lines empty.

=====================================================
B) PUT IT ON VERCEL (free Hobby plan, personal / non-commercial use)
=====================================================
Why Turso? Vercel erases local files, so users and resumes need a hosted database.
Turso is a free hosted SQLite, and this project already uses it.

STEP 1 - Create the free database
  - Go to https://turso.tech , sign up, create a database (any name, nearest region).
  - Copy its URL (looks like  libsql://your-db-name-yourname.turso.io ).
  - Create a database token and copy it.

STEP 2 - Put the folder on GitHub
  - Create a new GitHub repository and upload everything in this folder.
  - Do NOT upload .env (the .gitignore already blocks it) or node_modules.

STEP 3 - Import into Vercel
  - Go to https://vercel.com , log in with GitHub, Add New > Project, pick your repo.
  - Framework Preset: Other.  Leave build settings empty.
  - Open "Environment Variables" and add:
        JWT_SECRET            a long random text (60+ letters and numbers)
        TURSO_DATABASE_URL    the libsql:// URL from step 1
        TURSO_AUTH_TOKEN      the token from step 1
        ANTHROPIC_API_KEY     your key   (needed only for real AI)
        AI_MOCK               false      (or true for fake sample AI)
  - Click Deploy, then open the link Vercel gives you.

IF SOMETHING GOES WRONG
  - Deploy error about "maxDuration": open vercel.json and change 30 to 10, deploy again.
  - AI buttons time out: the AI answer took longer than your plan allows. Try again,
    or upgrade the plan, or use a host that keeps a server running (e.g. Render).
  - "Something went wrong on the server": Vercel > your project > Logs. Most often the
    Turso URL or token is wrong or missing.
  - After you change environment variables you must Redeploy.

NOTES
  - AI calls are billed by Anthropic per use (60 per user per hour limit is built in).
  - The per-user limit counters are kept in memory, so on Vercel they can reset
    when the function restarts. Keep an eye on your Anthropic usage.
