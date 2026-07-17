# calendar-creator

Text a Telegram bot in plain language ("dentist tomorrow at 3pm at Main St") and it
parses the details with OpenAI and creates the event on your Google Calendar.

- **Backend:** Node.js + Express
- **Parsing:** OpenAI (structured JSON output)
- **Calendar:** Google Calendar API via a service account
- **Auth:** only your Telegram user id may create events
- **Deploy:** Render (webhook-based)

## How it works

```
Telegram message → /telegram/webhook/<secret> → auth check
   → OpenAI parses text into a structured event → Google Calendar insert → reply
```

## Setup

### 1. Create the Telegram bot
1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **bot token**.
2. Find your numeric **user id** by messaging [@userinfobot](https://t.me/userinfobot).

### 2. Google service account (reuse your existing one)
You can reuse the service account you already use for Google Sheets.
1. In [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services* →
   **enable the Google Calendar API** for that project.
2. Open the service account and copy its email (`...@...iam.gserviceaccount.com`).
3. In [Google Calendar](https://calendar.google.com/) → *Settings* → your calendar →
   **Share with specific people** → add the service account email with
   **"Make changes to events"**.
4. `GOOGLE_CALENDAR_ID` is usually just your Gmail address.

> The service account has its own (invisible) calendar. Events only appear on *your*
> calendar because you shared it in step 3 and set `GOOGLE_CALENDAR_ID` to your address.

### 3. Configure env vars
Copy `.env.example` to `.env` and fill it in. For `GOOGLE_SERVICE_ACCOUNT_JSON`
you can paste the raw JSON, or base64-encode it (easier for Render):

```bash
base64 -i service-account.json | tr -d '\n'
```

Generate a webhook secret:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

### 4. Run locally
```bash
npm install
npm run dev
```

### 5. Deploy to Render
1. Push this repo to GitHub.
2. In Render → **New → Web Service** → connect the repo (it reads `render.yaml`).
3. Add the env vars marked `sync: false` in the Render dashboard.
4. After it deploys, register the webhook (run locally, pointing at the live URL):

```bash
PUBLIC_URL=https://your-app.onrender.com npm run set-webhook
```

Now text your bot. 🎉

## Notes
- Render's **free** web service sleeps after inactivity; the first message after a
  sleep may take ~30s while it wakes. Upgrade to a paid instance to avoid this.
- Only the `TELEGRAM_ALLOWED_USER_ID` you configure can create events.
- Times are interpreted in `DEFAULT_TIMEZONE` unless the message implies otherwise.
