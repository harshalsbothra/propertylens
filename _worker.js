const CORS={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};

function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{...CORS,...extra}})}

function parseListing(text){
  const t=String(text||'').replace(/\u00a0/g,' ');
  const money=(m)=>{if(!m)return null;let s=m[0].toLowerCase().replace(/,/g,'').replace(/₹|rs\.?|inr/g,'').trim();const x=s.match(/([\d.]+)\s*(crore|cr|lakh|lac|l)?/);if(!x)return null;let n=Number(x[1]);if(!Number.isFinite(n))return null;if(['crore','cr'].includes(x[2]))n*=1e7;else if(['lakh','lac'].includes(x[2]))n*=1e5;return Math.round(n)};
  const pm=t.match(/(?:₹|rs\.?|inr)\s*[\d.,]+\s*(?:crore|cr|lakh|lac)?/i)||t.match(/[\d.,]+\s*(?:crore|cr|lakh|lac)\b/i);
  const rm=t.match(/(?:rent|rental)[^₹\d]{0,25}(?:₹|rs\.?|inr)?\s*[\d,]+/i);
  const am=t.match(/[\d,]+\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i);
  const bm=t.match(/(?:\b[1-5]\s*BHK\b|\b[1-5]\s*bedroom)/i);
  return {price:pm?money(pm):null,rent:rm?Number((rm[0].match(/[\d,]+/)||[])[0].replace(/,/g,'')):null,area:am?Number(am[0].match(/[\d,]+/)[0].replace(/,/g,'')):null,bhk:bm?Number((bm[0].match(/[1-5]/)||[])[0]):null};
}

async function propertySearch(request,env){
  if(request.method!=='POST')return json({error:'Method not allowed.'},405,{Allow:'POST'});
  try{
    const body=await request.json();const query=String(body?.query||'').trim();
    if(!query||query.length>240)return json({error:'Enter a property or project name up to 240 characters.'},400);
    const key=env.GOOGLE_MAPS_API_KEY;
    if(!key)return json({error:'Property search is not connected yet. Add GOOGLE_MAPS_API_KEY to enable authorized property/location search. Paste a listing to use the extraction tool now.'},503);
    const response=await fetch('https://places.googleapis.com/v1/places:searchText',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.primaryType,places.types'},
      body:JSON.stringify({textQuery:query,languageCode:'en',pageSize:5})
    });
    const data=await response.json();
    if(!response.ok)return json({error:data?.error?.message||'Property search provider failed.'},502);
    const tokens=query.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
    const results=(data.places||[]).map(p=>{
      const name=p.displayName?.text||'Unnamed place';const address=p.formattedAddress||'';
      const hay=(name+' '+address).toLowerCase();const hits=tokens.filter(t=>hay.includes(t)).length;const ratio=tokens.length?hits/tokens.length:0;
      return {id:p.id,name,address,lat:p.location?.latitude||null,lng:p.location?.longitude||null,mapsUrl:p.googleMapsUri||null,primaryType:p.primaryType||null,matchScore:Math.round(ratio*100),matchLabel:ratio>=.75?'Strong match':ratio>=.45?'Possible match':'Low-confidence match',source:'Google Places'};
    }).sort((a,b)=>b.matchScore-a.matchScore);
    return json({source:'google-places',query,results});
  }catch(e){return json({error:'Unable to search for this property right now.'},500)}
}

async function aiReport(request,env){
  if(request.method!=='POST')return json({error:'Method not allowed.'},405,{Allow:'POST'});
  try{
    const contentLength=Number(request.headers.get('content-length')||0);
    if(contentLength>100000)return json({error:'Report payload is too large.'},413);
    const body=await request.json();
    if(!body||!Array.isArray(body.factors)||body.factors.length!==7)return json({error:'Invalid PropertyLens report payload.'},400);
    const apiKey=env.OPENAI_API_KEY;
    if(!apiKey)return json({error:'OPENAI_API_KEY is not configured on the server.'},503);
    const model=env.OPENAI_MODEL||'gpt-5.6-luna';
    const prompt=`You are the AI report writer for PropertyLens, a real-estate analysis tool.

Interpret ONLY the deterministic financial data supplied below. Do not recalculate, invent, or change any figures. Explain uncertainty and assumptions.

Do not give a buy/sell recommendation or pretend to provide financial, legal, tax, valuation, or investment advice.

Produce a polished customer report with these headings:
Executive interpretation
1. Affordability
2. Rental economics
3. Financing
4. Capital appreciation
5. Cash-flow sustainability
6. Risk & sensitivity
7. Exit & overall return
Key red flags
Questions to verify before committing
What could change the result

For each factor explain what the numbers mean in plain language and identify the most important assumption to verify.

End with exactly this disclaimer:
Scenario-based decision support, not financial, legal, tax, valuation or investment advice.

PROPERTYLENS DATA:
${JSON.stringify(body)}`;
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,input:prompt,max_output_tokens:3000})});
    const data=await response.json();
    if(!response.ok)return json({error:data?.error?.message||'OpenAI request failed.'},502);
    const report=data.output_text||(data.output||[]).flatMap(item=>item.content||[]).map(item=>item.text||'').join('\n').trim();
    if(!report)return json({error:'The AI returned an empty report.'},502);
    return json({report,model});
  }catch(e){return json({error:'Unable to generate the AI report.'},500)}
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/ai-report')return aiReport(request,env);
  if(url.pathname==='/api/property-search')return propertySearch(request,env);
  return env.ASSETS.fetch(request);
}};