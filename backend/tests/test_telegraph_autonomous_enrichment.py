"""The flagship loop: a dormant branch moves, and NEMESIS buys fresh context.

These tests pin the two properties that make the integration honest. Telegraph
is only reached after JSON-RPC has verified a real change, and a Telegraph
failure never touches branch state or stops the trace.
"""
from datetime import datetime, timezone

import pytest

from app.models import DeterministicEvidence, NormalizedTransaction
from app.providers import JsonRpcProvider
from app.taskmaster import InMemoryMonitoringRepository, Taskmaster, TraceBranch
from app.telegraph import (
    InMemoryTelegraphReceiptRepository,
    TelegraphEnricher,
    TelegraphGatewayClient,
    TelegraphUnavailable,
)

WALLET = "0x" + "aa" * 20
DEST = "0x" + "b1" * 20
NEXT = "0x" + "c2" * 20
TX1 = "0x" + "11" * 32
TX2 = "0x" + "22" * 32


def make_tx(hash_value, block, source, destination, native=1000):
    return NormalizedTransaction(
        hash=hash_value, chain="ethereum", block_number=block,
        timestamp=datetime.now(timezone.utc), status="success",
        from_address=source, to_address=destination,
        native_value_wei=str(native), input="0x", erc20_transfers=[],
    )


class Publisher:
    def __init__(self):
        self.events = []

    async def publish(self, event):
        self.events.append(event)
        return "id"


class Rpc(JsonRpcProvider):
    def __init__(self, transactions, movements):
        super().__init__({"ethereum": "fixture", "base": "fixture"})
        self.transactions, self.movements = transactions, movements

    async def get_normalized_transaction(self, chain, tx_hash):
        return self.transactions[chain, tx_hash].model_copy(deep=True)

    async def get_address_movements(self, chain, address, after_block, max_blocks=20, asset=None):
        rows = [m for m in self.movements.get((chain, address.lower()), []) if m["block_number"] > after_block]
        return (max([after_block + 1, *[m["block_number"] for m in rows]]), rows)

    async def get_indexed_native_transfers(self, chain, transaction, source):
        return []

    async def get_bridge_evidence(self, chain, transaction, source, asset, amount):
        return None


class Gateway(TelegraphGatewayClient):
    def __init__(self, fail=False):
        super().__init__("http://gateway", "token")
        self.fail, self.calls = fail, []

    async def enrich(self, payload):
        self.calls.append(payload)
        if self.fail:
            raise TelegraphUnavailable("gateway down")
        return {
            "status": "succeeded", "routing_mode": "routed", "returned_intent": payload["intent"],
            "intent_matched": True, "miner_id": "302", "miner_name": "ChainSight",
            "result": {"status": "ok", "verdict": "clean_by_screening", "confidence": 0.8},
            "quoted_cost_usdc": "0.010000", "reported_cost_usd": 0.01, "duration_ms": 8800,
            "signal_hash": "0x" + "ab" * 32, "verification": None,
            "payment": {"network": "eip155:84532", "settlement_transaction": "0x" + "cd" * 32, "settled": True},
            "raw_response_hash": "sha256:abc",
        }


def build(gateway=None, enabled=True):
    repo = InMemoryMonitoringRepository()
    rpc = Rpc(
        {("ethereum", TX2): make_tx(TX2, 220, DEST, NEXT)},
        {("ethereum", DEST.lower()): [{"transaction_hash": TX2, "block_number": 220, "direction": "out"}]},
    )
    publisher = Publisher()
    enricher = None
    if enabled:
        receipts = InMemoryTelegraphReceiptRepository()
        enricher = TelegraphEnricher(receipts, gateway or Gateway())
    master = Taskmaster(repo, rpc, publisher, enricher=enricher)
    if enricher is not None:
        enricher.timeline = lambda c, t, m, d: master._timeline(c, t, m, d)
    return master, repo, publisher, enricher


async def dormant_branch(repo, case="NMS-1"):
    branch = TraceBranch(
        id="BR-1", case_id=case, current_address=DEST, chain="ethereum", asset="native",
        amount="1000", status="DORMANT", last_transaction=TX1, cursor_block=200,
        last_checked=datetime.now(timezone.utc), depth=1,
    )
    await repo.save_branch(branch)
    return branch


@pytest.mark.asyncio
async def test_a_quiet_recheck_buys_nothing():
    master, repo, publisher, enricher = build()
    branch = await dormant_branch(repo)
    # Move the cursor past the only movement so the recheck finds nothing.
    branch.cursor_block = 999
    await repo.save_branch(branch)
    assert (await master.recheck("BR-1")) == {"movement": False}
    assert enricher.gateway.calls == []
    assert [e["type"] for e in publisher.events] == []


@pytest.mark.asyncio
async def test_verified_movement_publishes_enrichment_after_the_trace_resumes():
    master, repo, publisher, _ = build()
    await dormant_branch(repo)
    assert (await master.recheck("BR-1"))["movement"] is True
    await master.resume("BR-1", TX2)

    kinds = [e["type"] for e in publisher.events]
    assert "TRACE_REQUESTED" in kinds
    enrich = [e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED"]
    assert enrich, "a verified movement should request external intelligence"
    assert kinds.index("TRACE_REQUESTED") < kinds.index("TELEGRAPH_ENRICH_REQUESTED")
    intents = {e["intent"] for e in enrich}
    assert intents == {"ONCHAIN_TX_LOOKUP", "FRAUD_DETECTION"}
    assert all(e["trigger"] == "MOVEMENT_DETECTED" for e in enrich)
    # The verified transaction and the new destination are both worth asking about.
    assert {e["target_value"] for e in enrich} == {TX2, NEXT}


@pytest.mark.asyncio
async def test_the_published_event_carries_the_rpc_facts_to_compare_against():
    master, repo, publisher, _ = build()
    await dormant_branch(repo)
    await master.recheck("BR-1")
    await master.resume("BR-1", TX2)
    tx_event = next(e for e in publisher.events if e.get("target_type") == "transaction")
    assert tx_event["expected"]["status"] == "success"
    assert tx_event["expected"]["block_number"] == 220
    assert tx_event["rpc_evidence_reference"].startswith("json_rpc:")


@pytest.mark.asyncio
async def test_consuming_the_event_pays_once_and_persists_a_receipt():
    master, repo, publisher, enricher = build()
    await dormant_branch(repo)
    await master.recheck("BR-1")
    await master.resume("BR-1", TX2)
    event = next(e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED")

    first = await master.consume(dict(event))
    assert first["status"] == "SUCCEEDED"
    receipts = await enricher.receipts.list_by_case("NMS-1")
    assert len(receipts) == 1
    assert receipts[0].miner_id == "302"
    assert receipts[0].payment["settled"] is True

    # Pub/Sub redelivers. The event claim stops it before the receipt claim has to.
    assert (await master.consume(dict(event))) == {"duplicate": True}
    assert len(enricher.gateway.calls) == 1


@pytest.mark.asyncio
async def test_a_duplicate_target_from_a_different_event_still_pays_only_once():
    master, repo, publisher, enricher = build()
    await dormant_branch(repo)
    await master.recheck("BR-1")
    await master.resume("BR-1", TX2)
    event = next(e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED")
    await master.consume(dict(event))
    # Same question, different delivery id: the receipt claim is the backstop.
    await master.consume({**event, "id": "EV-DIFFERENT"})
    assert len(enricher.gateway.calls) == 1


@pytest.mark.asyncio
async def test_a_telegraph_outage_leaves_the_trace_untouched():
    master, repo, publisher, enricher = build(gateway=Gateway(fail=True))
    await dormant_branch(repo)
    await master.recheck("BR-1")
    await master.resume("BR-1", TX2)
    event = next(e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED")
    result = await master.consume(dict(event))

    assert result["status"] == "FAILED"
    receipts = await enricher.receipts.list_by_case("NMS-1")
    assert receipts[0].error_code == "GATEWAY_UNAVAILABLE"
    # The branch moved on regardless of what Telegraph could or could not say.
    branch = await repo.get_branch("BR-1")
    assert branch.current_address == NEXT
    assert branch.status in {"MOVING", "DORMANT", "OBSCURED", "ACTIONABLE"}


@pytest.mark.asyncio
async def test_the_timeline_records_the_request_and_the_answer():
    master, repo, publisher, _ = build()
    await dormant_branch(repo)
    await master.recheck("BR-1")
    await master.resume("BR-1", TX2)
    event = next(e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED")
    await master.consume(dict(event))
    kinds = [e.type for e in await repo.get_timeline("NMS-1")]
    assert "MOVEMENT_DETECTED" in kinds
    assert "TELEGRAPH_ENRICHMENT_REQUESTED" in kinds
    assert "TELEGRAPH_INTELLIGENCE_RECEIVED" in kinds


@pytest.mark.asyncio
async def test_telegraph_stays_out_of_the_way_when_it_is_not_configured():
    master, repo, publisher, _ = build(enabled=False)
    await dormant_branch(repo)
    assert (await master.recheck("BR-1"))["movement"] is True
    await master.resume("BR-1", TX2)
    assert [e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED"] == []
    assert (await repo.get_branch("BR-1")).current_address == NEXT


@pytest.mark.asyncio
async def test_a_verified_incident_asks_about_the_theft_transaction():
    master, repo, publisher, _ = build()
    theft = make_tx(TX1, 100, WALLET, DEST)
    evidence = DeterministicEvidence(submitted_wallet=WALLET, transaction=theft)
    await master.trace_initial("NMS-2", evidence)
    enrich = [e for e in publisher.events if e["type"] == "TELEGRAPH_ENRICH_REQUESTED"]
    assert {e["trigger"] for e in enrich} == {"VERIFIED_INCIDENT"}
    assert TX1 in {e["target_value"] for e in enrich}
