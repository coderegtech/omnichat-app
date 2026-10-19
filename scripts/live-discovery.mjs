// Read-only by design: never invokes a provider generation endpoint.
if (process.env.LIVE_OMNIROUTE_TESTS !== 'true') {console.log('Skipped: set LIVE_OMNIROUTE_TESTS=true for read-only live discovery.');process.exit(0);}
const base=(process.env.OMNIROUTE_BASE_URL||'http://127.0.0.1:20128/v1').replace(/\/$/,'');
const headers=process.env.OMNIROUTE_API_KEY?{Authorization:`Bearer ${process.env.OMNIROUTE_API_KEY}`}:{ };
const response=await fetch(`${base}/models`,{headers,signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error(`Gateway discovery returned HTTP ${response.status}`);
const payload=await response.json();
if(!Array.isArray(payload.data))throw new Error('Gateway did not return a model list.');
console.log(JSON.stringify({reachable:true,catalogueEntries:payload.data.length,providers:[...new Set(payload.data.map(model=>model.owned_by).filter(Boolean))],upstreamGenerationTested:false},null,2));
