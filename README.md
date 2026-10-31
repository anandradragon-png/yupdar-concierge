# YupDar Gift Guide

**Yupik**, the Gift Guide of [YupDar](https://yupdar.com) — a little dragon who knows all 64 Gifts. YupDar is an app built on the system of 64 Gifts.
You give it your birth date; it shows your Gift, talks with you about what is going on in your
life, finds the one reading that answers it — and sells it right there, with PayPal, without
leaving the conversation. After payment it confirms what was unlocked.

Built for the **PayPal AI Hackathon** (agentic commerce). The language model is any
OpenAI-compatible chat completions API — **DeepSeek** in the live demo; payments are
**PayPal Orders v2** (sandbox for the demo).

## How it works

```
browser ──► Gift Guide (this repo) ──► LLM API, OpenAI-compatible  (the conversation)
                 │
                 └──────────────────► YupDar core, POST /api/concierge  (closed source)
                                        profile   birth date → Gift + catalog with live USD prices
                                        checkout  email + product → PayPal order (approve URL)
                                        status    email → what is unlocked
```

* The concierge never computes a Gift, never stores prices and never calls PayPal itself.
  The core does all three; this keeps one source of truth for price and access.
* The model answers in strict JSON: `{"reply": "...", "recommend": {"kind","key"} | null}`.
  A recommendation is accepted only if its key exists in the catalog the model was given,
  so the UI can draw a "Pay with PayPal" button with the exact price and nothing invented.
* Payment flow: concierge → core → PayPal order → the person approves on PayPal → PayPal
  returns them to the core, which captures the money, verifies the order by re-reading it
  from PayPal's API, and applies the purchase. "Check my access" then shows the result.

## Run it

```bash
npm install
cp .env.example .env     # fill CORE_API_URL, CORE_API_KEY, LLM_API_KEY
npm start                # http://localhost:3100
```

Environment:

| Variable | What it is |
|---|---|
| `CORE_API_URL` | YupDar core endpoint, e.g. `https://yupdar.com/api/concierge` |
| `CORE_API_KEY` | bearer key for that endpoint (issued by the core) |
| `LLM_API_KEY` | key of the language-model API |
| `LLM_API_URL` | default `https://api.deepseek.com/chat/completions` (Nebius Token Factory, OpenAI etc. work the same way) |
| `LLM_MODEL` | default `deepseek-chat` |
| `LLM_MODEL_FALLBACK` | optional second model tried when the first fails |
| `PORT` | default `3100` |

Judges: test credentials for a demo core key and a PayPal sandbox buyer are provided in the
hackathon submission notes.

## Layout

```
server.js            Express bootstrap: static page + four JSON handlers
src/routes.js        /api/start, /api/chat, /api/checkout, /api/status
src/system-prompt.js who the concierge is, the Gift, the catalog, the JSON contract
src/llm-client.js    OpenAI-compatible chat completions (primary + optional fallback model)
src/core-client.js   the single bridge to the YupDar core
src/sessions.js      in-memory conversations (1 hour TTL)
public/              one page, one stylesheet, one script — no build step
test/                node:test, no network
```

## Test

```bash
npm test
```

## License

MIT — see `LICENSE`.
