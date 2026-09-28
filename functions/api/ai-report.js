export async function onRequestPost(context) {
  const cors = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  try {
    if (context.request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { ...cors, Allow: 'POST' } });
    }
    const contentLength = Number(context.request.headers.get('content-length') || 0);
    if (contentLength > 100000) {
      return new Response(JSON.stringify({ error: 'Report payload is too large.' }), { status: 413, headers: cors });
    }
    const body = await context.request.json();
    if (!body || !body.factors || !Array.isArray(body.factors) || body.factors.length !== 7) {
      return new Response(JSON.stringify({ error: 'Invalid PropertyLens report payload.' }), { status: 400, headers: cors });
    }
    const apiKey = context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is not configured on the server.' }), { status: 503, headers: cors });
    }
    const model = context.env.OPENAI_MODEL || 'gpt-5.6-luna';
    const prompt = `You are the AI report writer for PropertyLens, a real-estate analysis tool. Interpret ONLY the deterministic financial data supplied below. Do not recalculate, invent, or change any figures. Explain uncertainty and assumptions. Do not give a buy/sell recommendation or pretend to provide financial, legal, tax, valuation, or investment advice. Produce a polished customer report with these headings: Executive interpretation; 1. Affordability; 2. Rental economics; 3. Financing; 4. Capital appreciation; 5. Cash-flow sustainability; 6. Risk & sensitivity; 7. Exit & overall return; Key red flags; Questions to verify before committing; What could change the result. For each factor explain what the numbers mean in plain language and identify the most important assumption to verify. End with exactly this disclaimer: Scenario-based decision support, not financial, legal, tax, valuation or investment advice.\n\nPROPERTYLENS DATA:\n${JSON.stringify(body)}`;
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 3000 })
    });
    const data = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || 'OpenAI request failed.' }), { status: 502, headers: cors });
    }
    const report = data.output_text || (data.output || []).flatMap(x => x.content || []).map(x => x.text || '').join('\n').trim();
    if (!report) return new Response(JSON.stringify({ error: 'The AI returned an empty report.' }), { status: 502, headers: cors });
    return new Response(JSON.stringify({ report, model }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Unable to generate the AI report.' }), { status: 500, headers: cors });
  }
}