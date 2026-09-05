"""Live end-to-end proof of the Telegraph loop, using real money.

What is real here: the transaction and its verification over public Ethereum
JSON-RPC, the Telegraph gateway, the x402 challenge, the payment, the
settlement, the persisted receipt, and the API responses.

What is controlled: the movement feed. A dormant branch is seeded at an address
whose next outgoing transaction is already known, so the run does not depend on
a thief moving funds on demand. The RPC verification of that movement is not
faked; NEMESIS fetches and normalizes the transaction itself. This is the
"controlled real path" the PRD allows, and it is labelled as such in the output
rather than presented as organic activity.

Run with the gateway already listening. Every paid call is bounded by the
gateway's own ceilings.
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.providers import JsonRpcProvider
from app.taskmaster import InMemoryMonitoringRepository, Taskmaster, TraceBranch
from app.telegraph import (
    InMemoryTelegraphReceiptRepository,
    TelegraphEnricher,
    TelegraphGatewayClient,
)

CASE = "NMS-260826-915B337C"
CHAIN = "ethereum"
# The theft transaction of the real case, and the address it credited.
THEFT_TX = "0xb61413c495fdad6114a7aa863a00b2e3c28945979a10885b12b30316ea9f072c"
VICTIM = "0x0fa09c3a328792253f8dee7116848723b72a6d2e"
DESTINATION = "0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4"


class ScriptedMovement(JsonRpcProvider):
    """Real RPC for everything except which movement to look at next."""

    def __init__(self, rpc_urls, movements):
        super().__init__(rpc_urls)
        self.movements = movements

    async def get_address_movements(self, chain, address, after_block, max_blocks=20, asset=None):
        rows = [m for m in self.movements.get((chain, address.lower()), []) if m["block_number"] > after_block]
        return (max([after_block + 1, *[m["block_number"] for m in rows]]), rows)

    async def get_indexed_native_transfers(self, chain, transaction, source):
        return []


class Publisher:
    def __init__(self):
        self.events = []

    async def publish(self, event):
        self.events.append(event)
        return "local"


async def main():
    gateway_url = os.getenv("TELEGRAPH_GATEWAY_URL", "http://127.0.0.1:8099")
    token = os.getenv("TELEGRAPH_INTERNAL_TOKEN", "")
    rpc_url = os.getenv("ETHEREUM_RPC_URL", "https://ethereum-rpc.publicnode.com")
    if not token:
        raise SystemExit("TELEGRAPH_INTERNAL_TOKEN is required")

    provider = ScriptedMovement(
        {"ethereum": rpc_url, "base": rpc_url},
        {(CHAIN, VICTIM): [{"transaction_hash": THEFT_TX, "block_number": 21895251, "direction": "out"}]},
    )

    # Verify independently before anything is allowed to spend.
    verified = await provider.get_normalized_transaction(CHAIN, THEFT_TX)
    print(json.dumps({
        "step": "rpc_verification",
        "transaction": verified.hash,
        "status": verified.status,
        "block_number": verified.block_number,
        "from": verified.from_address,
        "to": verified.to_address,
    }, indent=2))
    if verified.status != "success":
        raise SystemExit("refusing to spend on an unverified transaction")

    repo = InMemoryMonitoringRepository()
    receipts = InMemoryTelegraphReceiptRepository()
    enricher = TelegraphEnricher(receipts, TelegraphGatewayClient(gateway_url, token, 90.0))
    publisher = Publisher()
    master = Taskmaster(repo, provider, publisher, enricher=enricher)
    enricher.timeline = master._timeline

    branch = TraceBranch(
        id="BR-E2E", case_id=CASE, current_address=VICTIM, chain=CHAIN, asset="native",
        amount="1000000000000000", status="DORMANT", last_transaction="0x" + "00" * 32,
        cursor_block=21895250, last_checked=datetime.now(timezone.utc), depth=1,
    )
    await repo.save_branch(branch)
    print(json.dumps({"step": "seeded_dormant_branch", "branch": branch.id, "address": VICTIM}, indent=2))

    recheck = await master.recheck("BR-E2E")
    print(json.dumps({"step": "autonomous_recheck", **recheck}, indent=2))
    if not recheck.get("movement"):
        raise SystemExit("no movement detected; nothing to enrich")

    trace_event = next(e for e in publisher.events if e["type"] == "TRACE_REQUESTED")
    resumed = await master.consume(trace_event)
    print(json.dumps({"step": "trace_resumed", **resumed}, indent=2))

    requests = [e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED"]
    print(json.dumps({
        "step": "enrichment_requested",
        "count": len(requests),
        "intents": [e["intent"] for e in requests],
        "targets": [e["target_value"] for e in requests],
    }, indent=2))

    for event in requests:
        outcome = await master.consume(event)
        print(json.dumps({"step": "enrichment_consumed", "intent": event["intent"], **outcome}, indent=2))

    stored = await receipts.list_by_case(CASE)
    print(json.dumps({
        "step": "persisted_receipts",
        "receipts": [
            {
                "id": r.id, "intent": r.intent, "status": r.status,
                "miner": r.miner_name, "routing_mode": r.routing_mode,
                "cost_usd": r.reported_cost_usd, "duration_ms": r.duration_ms,
                "signal_hash": r.signal_hash,
                "settlement": (r.payment or {}).get("settlement_transaction"),
                "label": r.label, "discrepancy": r.discrepancy,
                "error_code": r.error_code,
            }
            for r in stored
        ],
    }, indent=2))

    timeline = [e.type for e in await repo.get_timeline(CASE)]
    print(json.dumps({"step": "timeline", "events": timeline}, indent=2))

    final = await repo.get_branch("BR-E2E")
    print(json.dumps({
        "step": "branch_after_enrichment",
        "address": final.current_address,
        "status": final.status,
        "note": "Branch state is set by RPC-verified tracing alone. Telegraph cannot change it.",
    }, indent=2))


asyncio.run(main())
