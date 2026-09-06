"use client";

type Section="overview"|"graph"|"evidence"|"intelligence"|"timeline";

type Props={
  caseState:string;
  chain:string;
  txStatus:string;
  txHash:string;
  branchCount:number;
  dormantCount:number;
  telegraphPaid:number;
  telegraphSpend:number;
  minerNames:string[];
  provisional:boolean;
  confidence:number;
  lifecycle:{label:string;detail:string;done:boolean}[];
  go:(section:Section)=>void;
};

const short=(v:string)=>v&&v.length>16?`${v.slice(0,10)}…${v.slice(-8)}`:v||"—";

/**
 * The first thirty seconds of a judge's attention.
 *
 * Overview answers what happened, what is proven, what was bought and what is
 * still being watched, then routes onward. It deliberately previews rather than
 * repeats: every detailed panel lives in its own section, so nothing here has
 * to compete with a full graph or a receipt list.
 */
export default function CaseOverview({
  caseState,chain,txStatus,txHash,branchCount,dormantCount,
  telegraphPaid,telegraphSpend,minerNames,provisional,confidence,lifecycle,go,
}:Props){
  const monitoring=dormantCount>0;
  const cards:{id:Section;title:string;sub:string;value:string;glyph:string}[]=[
    {id:"evidence",title:"ONCHAIN EVIDENCE",sub:"Verified blockchain facts",value:`${chain.toUpperCase()} · ${txStatus.toUpperCase()}`,glyph:"◎"},
    {id:"graph",title:"FUND TRACE",sub:"Where the funds moved",value:`${branchCount} branch${branchCount===1?"":"es"}`,glyph:"⌁"},
    {id:"intelligence",title:"TELEGRAPH INTELLIGENCE",sub:"Paid miner responses and x402 proof",value:telegraphPaid?`${telegraphPaid} paid receipt${telegraphPaid===1?"":"s"}`:"No paid answers yet",glyph:"◇"},
    {id:"evidence",title:"AGENT ASSESSMENT",sub:"Evidence-grounded interpretation",value:"Bounded by evidence",glyph:"◆"},
  ];

  return <>
    <section className="execSummary">
      <div className="execHeadline">
        <div>
          <span className="execKicker">INVESTIGATION SUMMARY</span>
          <h3>
            {provisional
              ? "A likely theft transaction was identified from wallet history and traced."
              : "A verified theft transaction was identified and traced."}
          </h3>
          <p>
            NEMESIS verified the transaction over JSON-RPC, followed the funds across
            {" "}{branchCount} branch{branchCount===1?"":"es"}, and
            {telegraphPaid>0
              ? ` automatically purchased ${telegraphPaid} independent miner ${telegraphPaid===1?"answer":"answers"} through Telegraph when the case required outside context.`
              : " will purchase independent Telegraph intelligence when a verified case event requires outside context."}
            {monitoring?" Monitoring stays active on the quiet branches.":""}
          </p>
        </div>
        <div className="execState">
          <span className={`execBadge ${monitoring?"watch":"ok"}`}><i/>{caseState}</span>
          {provisional&&<span className="execBadge provisionalBadge">LIKELY INCIDENT · {Math.round(confidence*100)}%</span>}
          {monitoring&&<small>{dormantCount} dormant branch{dormantCount===1?"":"es"} watched</small>}
        </div>
      </div>

      <div className="execFacts">
        <div><small>NEMESIS VERIFIED</small><b>{txStatus.toUpperCase()}</b><span>{short(txHash)}</span></div>
        <div><small>FUNDS TRACED</small><b>{branchCount}</b><span>persisted branches</span></div>
        <div><small>TELEGRAPH PURCHASED</small><b>{telegraphPaid}</b><span>${telegraphSpend.toFixed(2)} settled via x402</span></div>
        <div><small>MONITORING</small><b>{monitoring?"ACTIVE":"IDLE"}</b><span>{monitoring?"resumes on new movement":"no dormant branch"}</span></div>
      </div>

      <div className="execLifecycle">
        {lifecycle.map((step,i)=><div key={step.label} className={step.done?"done":"pending"}>
          <i>{step.done?"✓":i+1}</i><b>{step.label}</b><span>{step.detail}</span>
        </div>)}
        <button className="execLink" onClick={()=>go("timeline")}>View full timeline →</button>
      </div>

      {telegraphPaid>0&&<div className="execTelegraph">
        <div>
          <span>TELEGRAPH INTELLIGENCE</span>
          <b>Independent miner intelligence, purchased automatically.</b>
          <p>
            When a verified case event needed outside context, NEMESIS paid {telegraphPaid} Telegraph
            {" "}miner{telegraphPaid===1?"":"s"} over x402 and kept the settlement proof.
            {minerNames.length?` Answered by ${minerNames.join(", ")}.`:""} Miner claims add context; they are not chain truth.
          </p>
        </div>
        <button className="primary" onClick={()=>go("intelligence")}>View Telegraph intelligence →</button>
      </div>}
    </section>

    <section className="navCards">
      {cards.map(card=><button key={card.title} className="navCard" onClick={()=>go(card.id)}>
        <span className="navGlyph">{card.glyph}</span>
        <b>{card.title}</b>
        <small>{card.sub}</small>
        <em>{card.value}</em>
        <span className="navGo">→</span>
      </button>)}
    </section>
  </>;
}
