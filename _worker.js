import { INDIA_PROPERTY_INDEX } from './india-property-index.js';
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
    const body=await request.json();
    const query=String(body?.query||'').trim();
    if(!query||query.length>240)return json({error:'Enter a property or project name up to 240 characters.'},400);

    const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const tokens=normalized(query).split(/\s+/).filter(x=>x.length>1);
    const localResults=INDIA_PROPERTY_INDEX.map(x=>{
      const hay=normalized(x.name+' '+x.address);
      const name=normalized(x.name);
      const hits=tokens.filter(t=>hay.includes(t)).length;
      const nameHits=tokens.filter(t=>name.includes(t)).length;
      const exact=name===normalized(query);
      const score=Math.min(100,Math.round((hits/Math.max(tokens.length,1))*65+(nameHits/Math.max(tokens.length,1))*25+(exact?10:0)));
      return {...x,matchScore:score,matchLabel:score>=80?'Strong match':score>=45?'Possible match':'Related Indian project'};
    }).filter(x=>x.matchScore>=35);

    const nominatimUrl='https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&limit=15&countrycodes=in&q='+encodeURIComponent(query);
    const photonUrl='https://photon.komoot.io/api/?q='+encodeURIComponent(query)+'&limit=20&lang=en';

    const [nominatimResponse,photonResponse]=await Promise.allSettled([
      fetch(nominatimUrl,{headers:{'Accept':'application/json','Accept-Language':'en-IN,en;q=0.8','User-Agent':'PropertyLens/1.0 (+https://propertylens.visionpl.workers.dev; India property discovery)'}}),
      fetch(photonUrl,{headers:{'Accept':'application/json','Accept-Language':'en-IN,en;q=0.8','User-Agent':'PropertyLens/1.0 (+https://propertylens.visionpl.workers.dev; India property discovery)'}})
    ]);

    const raw=[];
    if(nominatimResponse.status==='fulfilled'&&nominatimResponse.value.ok){
      const places=await nominatimResponse.value.json();
      for(const p of (Array.isArray(places)?places:[])){
        const address=p.display_name||'';
        const name=p.name||p.namedetails?.name||address.split(',')[0]||'Unnamed place';
        raw.push({name,address,lat:p.lat?Number(p.lat):null,lng:p.lon?Number(p.lon):null,type:p.type||p.class||'place',source:'OpenStreetMap / Nominatim',importance:Number(p.importance||0),country:'India'});
      }
    }
    if(photonResponse.status==='fulfilled'&&photonResponse.value.ok){
      const data=await photonResponse.value.json();
      for(const f of (Array.isArray(data?.features)?data.features:[])){
        const p=f.properties||{}, c=f.geometry?.coordinates||[];
        const country=String(p.countrycode||'').toLowerCase();
        if(country&&country!=='in')continue;
        if(p.country&&normalized(p.country)!=='india'&&!normalized(p.country).includes('india'))continue;
        const parts=[p.name,p.housenumber,p.street,p.district,p.city,p.state,p.postcode,p.country].filter(Boolean);
        raw.push({name:p.name||parts[0]||'Unnamed place',address:parts.join(', ')||'Location returned by Photon',lat:Number(c[1])||null,lng:Number(c[0])||null,type:p.osm_value||p.osm_key||'place',source:'OpenStreetMap / Photon',importance:Number(p.rank?.importance||0),country:'India'});
      }
    }

    const osm=raw.map(x=>{
      const hay=normalized(x.name+' '+x.address);
      const hits=tokens.filter(t=>hay.includes(t)).length;
      const ratio=tokens.length?hits/tokens.length:0;
      const exact=normalized(x.name)===normalized(query);
      const nameHits=tokens.filter(t=>normalized(x.name).includes(t)).length;
      const score=Math.min(100,Math.round(ratio*70+Math.min(1,nameHits/Math.max(tokens.length,1))*20+(exact?10:0)));
      return {...x,matchScore:score,matchLabel:score>=75?'Strong match':score>=45?'Possible match':'Location match'};
    });

    const merged=[...localResults.map(x=>({...x,lat:null,lng:null})),...osm].sort((a,b)=>b.matchScore-a.matchScore);
    const deduped=[],seen=new Set();
    for(const x of merged){
      const key=normalized(x.name)+'|'+normalized(x.address||'');
      if(seen.has(key))continue;
      seen.add(key);deduped.push(x);
    }

    return json({
      source:'india-project-index + OpenStreetMap',
      providers:['PropertyLens India project index','Nominatim','Photon'],
      query,
      results:deduped.slice(0,24),
      indexSize:INDIA_PROPERTY_INDEX.length,
      note:'India-only discovery. Project names come from the PropertyLens curated index or OpenStreetMap; price, rent, area and investment figures still require a listing, broker/developer feed, or another permitted source.',
      fallbackAvailable:deduped.length===0
    });
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

async function whatsappWebhook(request,env){
  const url=new URL(request.url);
  if(request.method==='GET'){
    const mode=url.searchParams.get('hub.mode');
    const token=url.searchParams.get('hub.verify_token');
    const challenge=url.searchParams.get('hub.challenge');
    if(mode==='subscribe'&&token&&env.WHATSAPP_VERIFY_TOKEN&&token===env.WHATSAPP_VERIFY_TOKEN)return new Response(challenge,{status:200,headers:{'Content-Type':'text/plain'}});
    return new Response('Forbidden',{status:403});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405,{Allow:'GET, POST'});
  try{
    const body=await request.json();
    const messages=[];
    for(const entry of (Array.isArray(body?.entry)?body.entry:[])){
      for(const change of (entry.changes||[])){
        const value=change.value||{};
        for(const m of (value.messages||[])){
          const textBody=m?.text?.body||m?.button?.text||m?.interactive?.button_reply?.title||'';
          if(textBody)messages.push({from:m.from||null,messageId:m.id||null,timestamp:m.timestamp||null,type:m.type||'text',text:textBody});
        }
      }
    }
    return json({ok:true,received:messages.length,messages,automation:{status:'queued',next:'process conversation → update customer profile → rematch inventory → create follow-up'}});
  }catch(e){return json({error:'Invalid WhatsApp webhook payload.'},400)}
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/ai-report')return aiReport(request,env);
  if(url.pathname==='/api/property-search')return propertySearch(request,env);
  if(url.pathname==='/api/whatsapp/webhook')return whatsappWebhook(request,env);

  // Resolve legacy/clean URLs directly instead of returning an HTTP redirect.
  // This also prevents Safari + service-worker redirect errors.
  const aliases={
    '/':'/index.html',
    '/home':'/index.html',
    '/home/':'/index.html',
    '/analyze':'/analyze.html',
    '/analyze/':'/analyze.html',
    '/property-search':'/property-search.html',
    '/property-search/':'/property-search.html',
    '/brokers':'/brokers.html',
    '/brokers/':'/brokers.html',
    '/broker-whatsapp':'/broker-whatsapp.html',
    '/broker-whatsapp/':'/broker-whatsapp.html',
    '/pricing':'/pricing.html',
    '/pricing/':'/pricing.html',
    '/about':'/about.html',
    '/about/':'/about.html'
  };
  if(aliases[url.pathname]){
    const target=new URL(aliases[url.pathname],url.origin);
    const request2=new Request(target.toString(),request);
    return env.ASSETS.fetch(request2);
  }

  return env.ASSETS.fetch(request);
}};