# HotelOps Anthropic Proxy

A 100-line Cloudflare Worker that lets the HotelOps client use Claude
without shipping the API key to every browser.

## Why

Until v1.5.0 the desktop app called `api.anthropic.com` directly with a
key from `localStorage`. Anyone with DevTools could read it, run their
own queries on the customer's bill, or pull billing telemetry from the
key. This Worker is the smallest possible fix: the key lives as a
Cloudflare secret; the client only knows the Worker URL.

## Deploy

```bash
# one-time setup
npm i -g wrangler
cd worker
wrangler login

# secrets
wrangler secret put ANTHROPIC_API_KEY   # paste your sk-ant-... key
wrangler secret put PROXY_AUTH_TOKEN    # optional shared secret (recommended)

# deploy
wrangler deploy
```

You'll get a URL like `https://hotelops-anthropic-proxy.<your>.workers.dev`.

## Wire it into HotelOps

In the desktop app, open **Settings → System → Anthropic Proxy** and paste
the Worker URL. If you set `PROXY_AUTH_TOKEN`, also paste it as the auth
token. From then on:

- The client POSTs to your Worker
- The Worker forwards to Anthropic with the secret key
- The API key never leaves your Cloudflare account

## Endpoint

`POST /messages` — body is forwarded verbatim to
`https://api.anthropic.com/v1/messages`. The Worker injects:

- `x-api-key` (from secret)
- `anthropic-version: 2023-06-01`

The client only needs to send the Anthropic JSON body and (if used) the
`X-HotelOps-Auth` header.

## Costs

Cloudflare Workers free tier: 100k requests/day. Plenty for any single
hotel's audit ingestion. Anthropic charges go to whoever owns the
`ANTHROPIC_API_KEY`.
