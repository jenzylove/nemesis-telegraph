"use client";
import {useMemo,useState} from "react";
import {shortHex,telegraphVerdict} from "./telegraph-semantics.mjs";

export type TelegraphReceipt={id:string;intent:string;returned_intent:string|null;intent_matched:boolean|null;target_type:string;target_value:string;target_chain:string|null;routing_mode:string;fallback_reason:string|null;miner_id:string|null;miner_name:string|null;result:Record<string,unknown>|null;result_summary?:string|null;label:string|null;confidence:number|null;risk_score:number|null;coverage_complete:boolean|null;discrepancy:{fields:Record<string,{telegraph:unknown;rpc:unknown}>;authoritative:string}|null;quoted_cost_usdc:string|null;quoted_amount_atomic?:string|null;payment_network?:string|null;payment_asset?:string|null;payment_payee?:string|null;payment_scheme?:string|null;reported_cost_usd:number|null;duration_ms:number|null;signal_hash:string|null;payment:{network?:string;settlement_transaction?:string|null;settled?:boolean;payer?:string}|null;payment_proof?:Record<string,unknown>|null;idempotency_key?:string|null;raw_response_hash?:string|null;status:string;error_code:string|null;error:string|null;trigger:string;created_at:string;has_proof:boolean};
export type TelegraphState={enabled:boolean;receipts:TelegraphReceipt[];summary:{total?:number;succeeded?:number;failed?:number;intents?:string[];miners?:string[];spend_usd?:number;discrepancies?:number}};

const short=shortHex;
const verdict=telegraphVerdict;

const NETWORK_LABEL:Record<string,string>={"eip155:84532":"Base Sepolia testnet","eip155:8453":"Base"};

/** Product language for why a call did not happen. The policy string stays in Technical details. */
function skippedReason(r:TelegraphReceipt){
  switch(r.error_code){
    case "SPEND_LIMIT_EXCEEDED":
      return {title:"MINER CALL SKIPPED",body:"Case intelligence budget reached. NEMESIS continued tracing without this external response."};
    case "ROUTER_UNREACHABLE":
    case "ROUTER_TIMEOUT":
    case "ROUTER_HTTP_ERROR":
      return {title:"MINER UNREACHABLE",body:"The Telegraph network did not answer in time. NEMESIS continued tracing from onchain evidence."};
    case "SPEND_LEDGER_UNAVAILABLE":
      return {title:"MINER CALL HELD",body:"Spend accounting was unavailable, so NEMESIS declined to pay rather than risk an untracked charge."};
    case "INTENT_MISMATCH":
      return {title:"ANSWER REJECTED",body:"The network answered a different question than the one asked, so it was not accepted as intelligence."};
    case "CHALLENGE_REJECTED":
      return {title:"PAYMENT REFUSED",body:"The payment terms offered did not match what NEMESIS is allowed to pay, so nothing was signed."};
    case "GATEWAY_UNAVAILABLE":
      return {title:"INTELLIGENCE UNAVAILABLE",body:"External intelligence could not be reached. The investigation continued on verified evidence alone."};
    default:
      return {title:"NO MINER ANSWER",body:"No external answer was accepted. The investigation continued on verified evidence alone."};
  }
}

function summaryOf(r:TelegraphReceipt){
  if(r.result_summary)return r.result_summary;
  const result=r.result||{};
  const value=result.signal||result.summary||result.explanation||result.answer||result.verdict;
  if(typeof value==="string")return value.length>280?`${value.slice(0,277).trim()}…`:value;
  return "The miner returned structured intelligence. Open the raw payload to inspect every field.";
}

/** Identifiers, routing labels and full hashes: available for review, never in the way. */
function Technical({r}:{r:TelegraphReceipt}){
  const rows:[string,string|null|undefined][]=[
    ["Receipt id",r.id],
    ["Case event key",r.idempotency_key],
    ["Requested intent",r.intent],
    ["Returned intent",r.returned_intent],
    ["Routing mode",r.routing_mode],
    ["Fallback reason",r.fallback_reason],
    ["Miner id",r.miner_id],
    ["Trigger",r.trigger],
    ["Target",`${r.target_type} ${r.target_value}`],
    ["Quoted",r.quoted_amount_atomic?`${r.quoted_amount_atomic} atomic (${r.quoted_cost_usdc} USDC)`:r.quoted_cost_usdc],
    ["Payment scheme",r.payment_scheme],
    ["Asset",r.payment_asset],
    ["Payee",r.payment_payee],
    ["Payer",r.payment?.payer],
    ["Settlement tx",r.payment?.settlement_transaction],
    ["Signal hash",r.signal_hash],
    ["Response hash",r.raw_response_hash],
    ["Policy reason",r.error?`${r.error_code}: ${r.error}`:r.error_code],
    ["Latency",r.duration_ms!==null&&r.duration_ms!==undefined?`${r.duration_ms} ms`:null],
  ];
  return <dl className="tgTechnical">
    {rows.filter(([,v])=>v).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>;
}

function Receipt({r}:{r:TelegraphReceipt}){
  const [proof,setProof]=useState(false);
  const [tech,setTech]=useState(false);
  const [raw,setRaw]=useState(false);
  const v=verdict(r);
  const paid=r.status==="SUCCEEDED";
  const network=r.payment_network||r.payment?.network||"";
  const networkLabel=NETWORK_LABEL[network]||network||"testnet";
  const settlement=r.payment?.settlement_transaction||null;
  const explorer=(r.payment_proof?.settlement_explorer_url as string|undefined)||(settlement?`https://sepolia.basescan.org/tx/${settlement}`:null);
  const skipped=paid?null:skippedReason(r);

  return <article className={`tgReceipt ${paid?v.tone:"skipped"}`}>
    <header>
      <div>
        <b>{paid?r.intent.replaceAll("_"," "):skipped!.title}</b>
        <small>{new Date(r.created_at).toLocaleString()}</small>
      </div>
      {paid&&<span className={`tgVerdict ${v.tone}`}>{v.text}</span>}
    </header>

    {paid?<>
      <p className="tgResultSummary">{summaryOf(r)}</p>
      <div className="tgPaidLine">
        <span>Asked <b>{r.miner_name||r.miner_id||"a Telegraph miner"}</b></span>
        <span>Paid <b>{(r.reported_cost_usd??0.01).toFixed(2)} USDC</b> via x402</span>
        <span>on <b>{networkLabel}</b></span>
        <span className={r.payment?.settled?"settled":""}>{r.payment?.settled?"Payment settled ✓":"Settlement not reported"}</span>
      </div>
      {r.coverage_complete===false&&<p className="tgNote">The miner reported incomplete coverage, so the absence of a signal is not evidence of safety.</p>}
      {r.discrepancy&&<div className="tgClash"><b>Telegraph disagrees with RPC</b>{Object.entries(r.discrepancy.fields).map(([field,pair])=><span key={field}>{field}: Telegraph said <i>{String(pair.telegraph)}</i>, RPC verified <i>{String(pair.rpc)}</i></span>)}<small>RPC remains authoritative. The disagreement is recorded, not resolved.</small></div>}
    </>:<p className="tgSkipped">{skipped!.body}</p>}

    <footer>
      <div className="tgActions">
        {paid&&r.has_proof&&<button className="tgToggle primaryToggle" onClick={()=>setProof(!proof)} aria-expanded={proof}>{proof?"Hide payment proof":"View payment proof"}</button>}
        <button className="tgToggle" onClick={()=>setTech(!tech)} aria-expanded={tech}>{tech?"Hide technical details":"Technical details"}</button>
        {r.result&&<button className="tgToggle" onClick={()=>setRaw(!raw)} aria-expanded={raw}>{raw?"Hide raw payload":"Raw payload"}</button>}
      </div>
    </footer>

    {proof&&<div className="tgProofBox">
      <div><small>AMOUNT</small><b>{(r.reported_cost_usd??0.01).toFixed(2)} USDC</b></div>
      <div><small>NETWORK</small><b>{networkLabel}</b></div>
      <div><small>SETTLEMENT</small><b>{settlement?short(settlement):"not reported"}</b></div>
      <div><small>SIGNAL PROOF</small><b>{r.signal_hash?short(r.signal_hash):"not returned"}</b></div>
      {explorer&&<a href={explorer} target="_blank" rel="noreferrer">Open settlement on block explorer →</a>}
    </div>}
    {tech&&<Technical r={r}/>}
    {raw&&r.result&&<pre className="tgRaw">{JSON.stringify(r.result,null,2)}</pre>}
  </article>;
}

export default function TelegraphPanel({state,loading}:{state:TelegraphState|null;loading:boolean}){
  const s=state?.summary||{};
  const [filter,setFilter]=useState<"successful"|"guarded"|"all">("successful");
  const receipts=state?.receipts||[];
  const successful=useMemo(()=>receipts.filter(r=>r.status==="SUCCEEDED"),[receipts]);
  const guarded=useMemo(()=>receipts.filter(r=>r.status!=="SUCCEEDED"),[receipts]);
  const shown=filter==="successful"?successful:filter==="guarded"?guarded:receipts;

  return <section className="panel telegraphPanel">
    <div className="panelHead"><div><span>TELEGRAPH INTELLIGENCE</span><small> EXTERNAL NETWORK · NON-AUTHORITATIVE</small></div><small>{state?.enabled===false?"DISABLED":`${successful.length} PAID RECEIPTS`}</small></div>
    <div className="tgBoundary">
      <b>How Telegraph strengthened this investigation</b>
      <span>Independent miner intelligence, purchased automatically when a verified case event required external context. Each answer is paid for over x402 and its settlement is preserved. Miner claims support triage; every blockchain fact on this case still comes from NEMESIS JSON-RPC verification.</span>
    </div>

    {state?.enabled===false&&<div className="emptyTrace">Telegraph enrichment is not configured for this deployment.</div>}

    {state?.enabled!==false&&<>
      <div className="tgSummary">
        <div className="success"><small>PAID INTELLIGENCE</small><strong>{successful.length}</strong><span>miner answers purchased</span></div>
        <div><small>SETTLED SPEND</small><strong>${(s.spend_usd||0).toFixed(2)}</strong><span>USDC via x402</span></div>
        <div><small>MINERS</small><strong>{s.miners?.length||0}</strong><span>{s.miners?.join(" · ")||"none yet"}</span></div>
        <div className="guarded"><small>SKIPPED BY POLICY</small><strong>{guarded.length}</strong><span>budget or network guards</span></div>
      </div>

      <div className="tgFilters" role="tablist">
        <button role="tab" aria-selected={filter==="successful"} className={filter==="successful"?"on":""} onClick={()=>setFilter("successful")}>Paid intelligence ({successful.length})</button>
        <button role="tab" aria-selected={filter==="guarded"} className={filter==="guarded"?"on":""} onClick={()=>setFilter("guarded")}>Skipped ({guarded.length})</button>
        <button role="tab" aria-selected={filter==="all"} className={filter==="all"?"on":""} onClick={()=>setFilter("all")}>All ({receipts.length})</button>
      </div>

      {!shown.length&&<div className="emptyTrace">{loading?"Loading external intelligence…":"Telegraph is called when RPC verifies a new movement or destination, not on a schedule."}</div>}
      <div className="tgList">{shown.slice().reverse().map(r=><Receipt key={r.id} r={r}/>)}</div>
    </>}
  </section>;
}
