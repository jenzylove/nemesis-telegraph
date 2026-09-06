"use client";
import {useState} from "react";

type Candidate={
  transaction_hash:string;
  selection_confidence:number;
  reasons:string[];
};

/**
 * Shown when discovery could not separate the top candidates confidently.
 *
 * The investigation has already continued from the strongest RPC-verified
 * outflow, so this explains that choice and its confidence rather than asking
 * anyone to approve it. The alternatives stay one click away for someone who
 * knows better, which is an override and not a gate.
 */
export default function ProvisionalIncident({
  confidence,
  reason,
  selectedHash,
  candidates,
  onChoose,
  busyHash,
  error,
}:{
  confidence:number;
  reason:string|null;
  selectedHash:string|null;
  candidates:Candidate[];
  onChoose:(hash:string)=>void;
  busyHash:string|null;
  error:string;
}){
  const [open,setOpen]=useState(false);
  const others=candidates.filter(c=>c.transaction_hash.toLowerCase()!==(selectedHash||"").toLowerCase());
  const short=(v:string)=>v.length>16?`${v.slice(0,10)}…${v.slice(-8)}`:v;

  return <section className="panel provisional">
    <div className="panelHead"><div><span>LIKELY INCIDENT IDENTIFIED</span><small> PROVISIONAL · NOT A CONFIDENT SELECTION</small></div><small>{Math.round(confidence*100)}% SELECTION CONFIDENCE</small></div>
    <h3>NEMESIS is continuing with the strongest verified candidate.</h3>
    <div className="provisionalFacts">
      <span>The transaction is <b>verified onchain</b></span>
      <span>It <b>moved funds from this wallet</b></span>
      <span>That it was the theft is <b>still provisional</b></span>
    </div>
    {reason&&<small className="caution">{reason}</small>}
    {others.length>0&&<>
      <button className="tgToggle" onClick={()=>setOpen(!open)} aria-expanded={open}>
        {open?"Hide":"Show"} other plausible transactions ({others.length})
      </button>
      {open&&<div className="transferList provisionalAlternatives">
        {others.map(c=><div key={c.transaction_hash}>
          <span>{Math.round(c.selection_confidence*100)}% selection confidence</span>
          <b>{short(c.transaction_hash)}</b>
          <small>{c.reasons.slice(0,3).join(" · ")||"Verified outflow from this wallet"}</small>
          <button className="secondary" disabled={!!busyHash} onClick={()=>onChoose(c.transaction_hash)}>
            {busyHash===c.transaction_hash?"Verifying…":"Investigate this instead"}
          </button>
        </div>)}
        {error&&<div className="formError">{error}</div>}
      </div>}
    </>}
  </section>;
}
