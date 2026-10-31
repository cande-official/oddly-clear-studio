# Public deployment

The public studio has two Vercel Hobby projects: a static Vite client and a Container Function backend. The backend uses Node.js 24, FFmpeg, the official SAM parser, and one private Blob store. Container execution is stateless; private project JSON and media archives persist in Blob.

## Configuration

The backend uses `Dockerfile.vercel` and the **Container** framework preset. Set `PORT=3000`, `PUBLIC_MODE=true`, `PUBLIC_ORIGIN` to the client origin, `META_API_ENABLED=true`, and `META_DEMO_BUDGET_USD` to the approved lifetime allowance. Set `MODEL_API_KEY` as a production **Secret**. Connect the private store's `BLOB_READ_WRITE_TOKEN` to production. Do not give these variables a `VITE_` prefix or commit them.

After linking a new backend project deliberately, inspect its owner/name before deploying. The CLI may update local environment files; preserve existing local keys and keep environment files ignored.

```sh
npm ci
npm test
npm run build
vercel project inspect --non-interactive
vercel deploy --prod
```

`scripts/build-web.ts` copies the compiled client, watch page, and locally prepared demo assets into `.local/publish-web`. Its `vercel.json` proxies `/api/*` to the backend and serves `/demo`. Link that directory to the separate static client project, inspect the target, then deploy. The script currently contains this project's public backend URL; change it when forking.

## Persistence and isolation

An HttpOnly, Secure, SameSite cookie identifies an anonymous browser session. Project keys, upload tickets, leases, and media archives are scoped to its hashed identifier. A different session cannot list or load another session's project, even with its UUID. Upload capabilities are restricted to an issued filename, size, type, and ten-minute window.

Project JSON uses conditional Blob writes. The read path requests identity encoding and normalizes weak CDN ETags before conditional writes; compressed JSON otherwise produces an ETag mismatch. A persistent lease prevents overlapping long jobs. Media is restored from its private archive when a new container instance receives a request.

Long operations return an initial NDJSON project snapshot and keep the response open with heartbeats until completion. The client drains the response and polls durable state. After an interrupted task's lease window, the UI reports failure; it does not replay the model call.

## Cost controls

The deployed shared Meta pool is **$2.20 lifetime**. The ledger is stored in Blob and survives redeployment. It reserves a conservative request ceiling before inference, settles known numeric usage, and retains holds for uncertain outcomes. Spark reserves $1.35, covering its documented 1,048,576-token context plus the configured 8,000-token output ceiling at the checked Standard rates. SAM reserves its source-frame cost, with the provider's minimum of 50 frames.

This is an application cap, separate from Meta Billing's notification settings. Raising the allowance or resetting the ledger must be a deliberate operator action after checking credits and prior usage. Provider pricing must be rechecked before extending operation beyond this event.

Hobby storage/compute quotas can pause availability when exhausted; no Pro upgrade or paid add-on was enabled. Public inputs are bounded to 30 seconds / 5 MB video and 16 MB / 80 PDF pages. Capacity is three projects per session, twelve total, and 48 MB per project media archive. These are demo limits rather than a production service-level promise.

## Release checks

Check the actual production hostname, API responses, private-session isolation, full PDF/video delivery, edits and review invalidation, model usage/cleanup, final render/decode, and browser download. A READY deployment alone does not establish that the pipeline works. The three-minute video and repository must be accessible without signing in.

Keep private verification logs, account receipts, cookies, and credentials out of publication. Shut down only local development/verification processes you started; the requested public deployment remains online for judging. Clean up public resources only under the event's actual judging rules and the user's direction.
