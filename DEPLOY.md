# PropertyLens 2.0 — deployment

## Cloudflare Pages

This is a static HTML site with one Pages Function at `/api/ai-report`.

Recommended setup:

- Repository: `harshalsbothra/propertylens`
- Production branch: `main`
- Framework preset: none
- Build command: leave blank (or `exit 0`)
- Build output directory: `/`

After the first deployment, add the following **encrypted secret** in Cloudflare Pages → Settings → Variables and Secrets:

- `OPENAI_API_KEY` = your OpenAI API key

Optional runtime variable:

- `OPENAI_MODEL` = `gpt-5.6-luna` (the code already uses this as the default)

Never put the API key in `index.html`, browser JavaScript, or Git.

## Architecture

Browser calculations → seven deterministic factors → `/api/ai-report` → OpenAI Responses API → customer-facing interpretation.

The server function is intentionally not allowed to replace or recalculate the financial numbers. If the AI endpoint is unavailable, the local seven-factor report still works.

## Important model labels

PropertyLens currently labels its return metric as **Monthly cash-flow IRR**. It is not date-based XIRR. The tax and investment outputs are scenario-based planning calculations and should not be presented as professional financial, legal, tax, valuation, or investment advice.