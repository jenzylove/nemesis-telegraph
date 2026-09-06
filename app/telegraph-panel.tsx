"use client";
import {useMemo,useState} from "react";
import {shortHex,telegraphVerdict} from "./telegraph-semantics.mjs";

export type TelegraphReceipt={id:string;intent:string;returned_intent:string|null;intent_matched:boolean|null;target_type:string;target_value:string;target_chain:string|null;routing_mode:string;fallback_reason:string|null;miner_id:string|null;miner_name:string|null;result:Record<string,unknown>|null;label:string|null;confidence:number|null;risk_score:number|null;coverage_complete:boolean|null;discrepancy:{fields:Record<string,{telegraph:unknown;rpc:unknown}>;authoritative:string}|null;quoted_cost_usdc:string|null;reported_cost_usd:number|null;duration_ms:number|null;signal_hash:string|null;payment:{network?:string;settlement_transaction?:string|null;settled?:boolean}|null;status:string;error_code:string|null;error:string|null;trigger:string;created_at:string;has_proof:boolean};
export type TelegraphState={enabled:boolean;receipts:TelegraphReceipt[];summary:{total?:number;succeeded?:number;failed?:number;intents?:string[];miners?:string[];spend_usd?:number;discrepancies?:number}};

const short=shortHex;
const BASE_SEPOLIA_TX="https://sepolia.basescan.org/tx/";
const verdict=telegraphVerdict;

function resultSummary(r:TelegraphReceipt){
 const result=r.result||{};
 const value=result.signal||result.summary||result.explanation||result.verdict;
 if(typeof value==="string")return value.length>280?`${value.slice(0,277).trim()}…`:value;
 if(r.status!=="SUCCEEDED")return r.error_code==="SPEND_LIMIT_EXCEEDED"?"Payment was refused before signing because the case spend ceiling had been reached.":"No miner answer was accepted. The core trace continued from RPC evidence.";
 return "The miner returned structured intelligence. Open the raw payload to inspect every field.";
}

function Receipt({r}:{r:TelegraphReceipt}){
 const[open,setOpen]=useState(false);
 const v=verdict(r);
 return <article className={`tgReceipt ${v.tone}`}>
  <header>
   <div><b>{r.intent.replaceAll("_"," ")}</b><small>{r.target_type} {short(r.target_value)} · {new Date(r.created_at).toLocaleString()}</small></div>
   <span className={`tgVerdict ${v.tone}`}>{v.text}</span>
  </header>
  <p className="tgResultSummary">{resultSummary(r)}</p>
  <div className="tgMeta">
   <span>MINER <b>{r.miner_name||r.miner_id||"none selected"}</b></span>
   {r.returned_intent&&<span>RETURNED INTENT <b>{r.returned_intent.replaceAll("_"," ")}</b></span>}
   <span>ROUTING <b>{r.routing_mode.replaceAll("_"," ")}</b></span>
   <span>TRIGGER <b>{r.trigger.replaceAll("_"," ")}</b></span>
   {r.reported_cost_usd!==null&&<span>COST <b>${r.reported_cost_usd.toFixed(2)}</b></span>}
   {r.duration_ms!==null&&<span>LATENCY <b>{(r.duration_ms/1000).toFixed(1)}s</b></span>}
   {r.confidence!==null&&<span>MINER CONFIDENCE <b>{Math.round(r.confidence*100)}%</b></span>}
  </div>
  {r.fallback_reason&&<p className="tgNote">Routed call fell back to a direct miner: {r.fallback_reason.replaceAll("_"," ").toLowerCase()}.</p>}
  {r.coverage_complete===false&&<p className="tgNote">The miner reported incomplete coverage, so absence of a signal is not evidence of safety.</p>}
  {r.discrepancy&&<div className="tgClash"><b>Telegraph disagrees with RPC</b>{Object.entries(r.discrepancy.fields).map(([field,pair])=><span key={field}>{field}: Telegraph said <i>{String(pair.telegraph)}</i>, RPC verified <i>{String(pair.rpc)}</i></span>)}<small>RPC remains authoritative. The disagreement is recorded, not resolved.</small></div>}
  {r.status!=="SUCCEEDED"&&<p className="tgNote failed">{r.error_code?r.error_code.replaceAll("_"," ").toLowerCase():"failed"}{r.error?` — ${r.error}`:""}. Tracing continued without it.</p>}
  <footer>
   {r.has_proof?<div className="tgProof"><b>PROOF AVAILABLE</b>
     {r.payment?.settlement_transaction&&<a href={`${BASE_SEPOLIA_TX}${r.payment.settlement_transaction}`} target="_blank" rel="noreferrer">Payment settled · {short(r.payment.settlement_transaction)}</a>}
     {r.signal_hash&&<span>Signal hash {short(r.signal_hash)}</span>}
    </div>:<span className="tgProof none">No verification metadata was returned for this call.</span>}
   {r.result&&<button className="tgToggle" onClick={()=>setOpen(!open)}>{open?"Hide":"View"} raw payload</button>}
  </footer>
  {open&&r.result&&<pre className="tgRaw">{JSON.stringify(r.result,null,2)}</pre>}
 </article>;
}

export default function TelegraphPanel({state,loading}:{state:TelegraphState|null;loading:boolean}){
 const s=state?.summary||{};
 const[filter,setFilter]=useState<"successful"|"guarded"|"all">("successful");
 const receipts=state?.receipts||[];
 const successful=useMemo(()=>receipts.filter(r=>r.status==="SUCCEEDED"),[receipts]);
 const guarded=useMemo(()=>receipts.filter(r=>r.status!=="SUCCEEDED"),[receipts]);
 const shown=filter==="successful"?successful:filter==="guarded"?guarded:receipts;
 return <section className="panel telegraphPanel">
  <div className="panelHead"><div><span>TELEGRAPH INTELLIGENCE</span><small> EXTERNAL NETWORK · NON-AUTHORITATIVE</small></div><small>{state?.enabled===false?"DISABLED":`${successful.length} VERIFIED RECEIPTS`}</small></div>
  <div className="tgBoundary"><b>WHAT TELEGRAPH ADDED</b><span>Paid answers from independent miners, requested automatically after RPC verified movement. Miner claims support investigation triage; they never replace NEMESIS onchain evidence.</span></div>
  {state?.enabled===false&&<div className="emptyTrace">Telegraph enrichment is not configured for this deployment.</div>}
  {state?.enabled!==false&&<>
   <div className="tgSummary">
    <div className="success"><small>INTELLIGENCE RECEIPTS</small><strong>{successful.length}</strong><span>successful paid answers</span></div>
    <div className="guarded"><small>GUARDED ATTEMPTS</small><strong>{guarded.length}</strong><span>refused or unavailable</span></div>
    <div><small>SPEND</small><strong>${(s.spend_usd||0).toFixed(2)}</strong><span>settled USDC</span></div>
    <div><small>MINERS</small><strong>{s.miners?.length||0}</strong><span>{s.miners?.join(" · ")||"none yet"}</span></div>
    <div><small>DISAGREEMENTS</small><strong>{s.discrepancies||0}</strong><span>vs RPC</span></div>
   </div>
   {!!receipts.length&&<div className="tgFilters" role="group" aria-label="Telegraph receipt filter">
    <button className={filter==="successful"?"active":""} onClick={()=>setFilter("successful")}>Successful intelligence <b>{successful.length}</b></button>
    <button className={filter==="guarded"?"active":""} onClick={()=>setFilter("guarded")}>Guarded attempts <b>{guarded.length}</b></button>
    <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>All attempts <b>{receipts.length}</b></button>
   </div>}
   {!state?.receipts.length&&<div className="emptyTrace">{loading?"Loading external intelligence…":"No external intelligence has been requested yet. Telegraph is called when RPC verifies a new movement or destination, not on a schedule."}</div>}
   <div className="tgList">{shown.slice().reverse().map(r=><Receipt key={r.id} r={r}/>)}</div>
  </>}
 </section>;
}
