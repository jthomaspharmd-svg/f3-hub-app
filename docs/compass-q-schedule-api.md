# Compass Q Schedule API

This endpoint exposes the upcoming Compass Q schedule as JSON for Google Apps Script and other read-only consumers.

## Current data source

The Compass Q-sheet tab does not read from a local file or browser-only `localStorage`.
It subscribes directly to the Firestore `workoutSessions` collection and updates each session's `q` field in Firestore.

Important assumption:
`workoutSessions` appears to be Compass-only shared schedule data today.
The Q-sheet UI does not filter that collection by `aoId`, and the `WorkoutSession` model does not currently store an `aoId`.
Other AOs use Google Sheets or external signup pages instead of this collection.

## Run locally with Netlify Dev

From the repo root:

```bash
npx netlify dev
```

Local function URL:

```text
http://localhost:8888/.netlify/functions/compass-q-schedule
```

Example with a custom lookahead:

```text
http://localhost:8888/.netlify/functions/compass-q-schedule?lookaheadDays=30
```

Example with a fixed test start date:

```text
http://localhost:8888/.netlify/functions/compass-q-schedule?fromDate=2026-05-08&lookaheadDays=7
```

## Production URL

```text
https://f3workouthub.netlify.app/.netlify/functions/compass-q-schedule
```

Example:

```text
https://f3workouthub.netlify.app/.netlify/functions/compass-q-schedule?lookaheadDays=30
```

Production can also use an explicit start date if needed:

```text
https://f3workouthub.netlify.app/.netlify/functions/compass-q-schedule?fromDate=2026-05-08&lookaheadDays=7
```

## Query params

- `lookaheadDays`
  Optional. Default is `7`.
- `fromDate`
  Optional. Format: `YYYY-MM-DD`. If supplied, the API uses that date as the start of the lookahead window instead of the current date.
- `key`
  Optional unless `Q_SCHEDULE_API_KEY` is set in the environment.

## API key behavior

If `Q_SCHEDULE_API_KEY` exists, callers must provide a matching `?key=VALUE`.

Examples:

```bash
Q_SCHEDULE_API_KEY=your-shared-secret
```

For local Netlify Dev, add it to `.env` if you want the endpoint protected locally.
If `Q_SCHEDULE_API_KEY` is not set locally, the function allows local development without a key.

In Netlify production, set `Q_SCHEDULE_API_KEY` in the site's environment variables if you want protection enabled there.

## Production Firestore requirement

Local Netlify Dev can read `serviceAccountKey.json` from the repo root if present.
Netlify production cannot use that local file.

For production, the function will use credentials in this order:

1. `FIREBASE_SERVICE_ACCOUNT_JSON`
2. `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`

If neither exists, production will fail with an explicit credential error.

If you want a dedicated Firebase credential, set this environment variable in Netlify:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"..."}
```

Do not commit the service account file or JSON into the repo.

If `FIREBASE_SERVICE_ACCOUNT_JSON` is not set, the function will fall back to `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` for Firestore access.

## Response JSON

Successful response:

```json
{
  "ok": true,
  "aoId": "compass",
  "aoName": "Compass at Lost Creek",
  "lookaheadDays": 7,
  "schedule": [
    {
      "aoId": "compass",
      "aoName": "Compass at Lost Creek",
      "workoutDate": "2026-05-09",
      "startTime": "06:30",
      "qPaxId": "hardwood",
      "qName": "Hardwood",
      "preblastUrl": "https://f3workouthub.netlify.app/preblast?ao=compass",
      "bandUrl": "https://www.band.us/band/94185591/post"
    }
  ]
}
```

In local development, diagnostics also include `fromDateUsed` so you can confirm which start date was applied.

If no upcoming Compass Qs are assigned within the requested window:

```json
{
  "ok": true,
  "aoId": "compass",
  "aoName": "Compass at Lost Creek",
  "lookaheadDays": 7,
  "schedule": []
}
```

## How Google Apps Script will call it

Apps Script can call the endpoint with `UrlFetchApp.fetch()` and parse the JSON body.

Example shape:

```javascript
const url =
  "https://f3workouthub.netlify.app/.netlify/functions/compass-q-schedule?lookaheadDays=7";

const response = UrlFetchApp.fetch(url);
const payload = JSON.parse(response.getContentText());
```

If you enable `Q_SCHEDULE_API_KEY`, include `&key=YOUR_VALUE` in the request URL.
