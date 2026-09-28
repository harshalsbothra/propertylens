# PropertyLens AI setup

The site now has a secure Cloudflare Pages Function at `/api/ai-report`.

## Required server secret
Set `OPENAI_API_KEY` as a Cloudflare Pages/Workers secret. Do **not** put it in `index.html` or any browser-side JavaScript.

Optional: set `OPENAI_MODEL` to choose another Responses API model. The default is `gpt-5.6-luna`.

## How it works
1. PropertyLens performs all deterministic calculations in the browser.
2. The browser sends only the structured 7-factor results to `/api/ai-report`.
3. The server-side function calls the OpenAI Responses API.
4. The AI interprets the supplied numbers and returns a customer-facing report.

If the secret is missing or the endpoint is unavailable, the local transparent 7-factor report still works.