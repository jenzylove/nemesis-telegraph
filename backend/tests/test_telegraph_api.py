"""The Telegraph plane is served separately, and it respects case ownership."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.main as main
from app.models import InvestigationCase
from app.telegraph import (
    InMemoryTelegraphReceiptRepository,
    TelegraphEnricher,
    TelegraphGatewayClient,
    TelegraphReceipt,
)

OWNER = {"sub": "owner-1"}
NOW = datetime.now(timezone.utc)


def case(case_id, public=False):
    return InvestigationCase(
        id=case_id, state="MONITORING", created_at=NOW, updated_at=NOW,
        wallet_address="0x" + "ab" * 20, chain="ethereum",
        owner_user_id="owner-1", owner_email="victim@example.com",
        is_public_case=public,
    )


def receipt(case_id, receipt_id, status="SUCCEEDED", cost=0.01, discrepancy=None, signal=True):
    return TelegraphReceipt(
        id=receipt_id, idempotency_key=receipt_id.lower(), case_id=case_id,
        trigger="MOVEMENT_DETECTED", intent="ONCHAIN_TX_LOOKUP",
        returned_intent="ONCHAIN_TX_LOOKUP", intent_matched=True,
        target_type="transaction", target_value="0x" + "11" * 32, target_chain="ethereum",
        routing_mode="routed", miner_id="302", miner_name="ChainSight",
        result={"status": "ok"}, label="ok", reported_cost_usd=cost,
        signal_hash=("0x" + "ab" * 32) if signal else None,
        payment={"settled": True, "settlement_transaction": "0x" + "cd" * 32},
        discrepancy=discrepancy, status=status, created_at=NOW, updated_at=NOW,
    )


class Repo:
    def __init__(self, cases):
        self.cases = {c.id: c for c in cases}

    async def get(self, case_id):
        return self.cases.get(case_id)


@pytest.fixture
def wired(monkeypatch):
    monkeypatch.setattr(main, "repository", Repo([case("NMS-PUBLIC", True), case("NMS-PRIVATE")]))
    receipts = InMemoryTelegraphReceiptRepository()
    enricher = TelegraphEnricher(receipts, TelegraphGatewayClient("http://gateway", "token"))
    monkeypatch.setattr(main, "telegraph", enricher)
    return receipts


@pytest.mark.asyncio
async def test_the_owner_sees_their_receipts_and_a_spend_summary(wired):
    await wired.save(receipt("NMS-PRIVATE", "TG-1"))
    await wired.save(receipt("NMS-PRIVATE", "TG-2", status="FAILED", cost=None))
    payload = await main.get_case_telegraph("NMS-PRIVATE", OWNER)
    assert payload["summary"]["total"] == 2
    assert payload["summary"]["succeeded"] == 1
    assert payload["summary"]["failed"] == 1
    assert payload["summary"]["miners"] == ["ChainSight"]
    assert payload["summary"]["spend_usd"] == 0.01


@pytest.mark.asyncio
async def test_failed_receipts_stay_visible_rather_than_being_hidden(wired):
    await wired.save(receipt("NMS-PRIVATE", "TG-F", status="FAILED"))
    payload = await main.get_case_telegraph("NMS-PRIVATE", OWNER)
    assert [r["status"] for r in payload["receipts"]] == ["FAILED"]


@pytest.mark.asyncio
async def test_every_receipt_is_labelled_as_non_authoritative(wired):
    await wired.save(receipt("NMS-PRIVATE", "TG-1"))
    payload = await main.get_case_telegraph("NMS-PRIVATE", OWNER)
    row = payload["receipts"][0]
    assert row["evidence_plane"] == "telegraph_external_intelligence"
    assert row["authoritative_for_chain_facts"] is False


@pytest.mark.asyncio
async def test_proof_is_claimed_only_when_telegraph_returned_it(wired):
    await wired.save(receipt("NMS-PRIVATE", "TG-PROOF", signal=True))
    with_proof = (await main.get_case_telegraph("NMS-PRIVATE", OWNER))["receipts"][0]
    assert with_proof["has_proof"] is True

    bare = receipt("NMS-PRIVATE", "TG-BARE", signal=False)
    bare.payment = None
    await wired.save(bare)
    rows = {r["id"]: r for r in (await main.get_case_telegraph("NMS-PRIVATE", OWNER))["receipts"]}
    assert rows["TG-BARE"]["has_proof"] is False


@pytest.mark.asyncio
async def test_a_recorded_disagreement_is_counted(wired):
    clash = {"fields": {"status": {"telegraph": "failed", "rpc": "ok"}}, "authoritative": "json_rpc"}
    await wired.save(receipt("NMS-PRIVATE", "TG-D", discrepancy=clash))
    payload = await main.get_case_telegraph("NMS-PRIVATE", OWNER)
    assert payload["summary"]["discrepancies"] == 1
    assert payload["receipts"][0]["discrepancy"]["authoritative"] == "json_rpc"


@pytest.mark.asyncio
async def test_another_account_cannot_read_a_case_it_does_not_own(wired):
    await wired.save(receipt("NMS-PRIVATE", "TG-1"))
    with pytest.raises(HTTPException) as raised:
        await main.get_case_telegraph("NMS-PRIVATE", {"sub": "someone-else"})
    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_an_unpublished_case_has_no_public_telegraph_view(wired):
    await wired.save(receipt("NMS-PRIVATE", "TG-1"))
    with pytest.raises(HTTPException) as raised:
        await main.get_public_case_telegraph("NMS-PRIVATE")
    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_a_published_case_exposes_its_receipts(wired):
    await wired.save(receipt("NMS-PUBLIC", "TG-P"))
    payload = await main.get_public_case_telegraph("NMS-PUBLIC")
    assert payload["receipts"][0]["miner_name"] == "ChainSight"


@pytest.mark.asyncio
async def test_a_receipt_cannot_be_read_through_the_wrong_case(wired):
    await wired.save(receipt("NMS-PUBLIC", "TG-OTHER"))
    with pytest.raises(HTTPException) as raised:
        await main.get_case_telegraph_receipt("NMS-PRIVATE", "TG-OTHER", OWNER)
    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_a_case_with_no_intelligence_returns_an_empty_plane(wired):
    payload = await main.get_case_telegraph("NMS-PRIVATE", OWNER)
    assert payload["receipts"] == []
    assert payload["summary"]["total"] == 0


@pytest.mark.asyncio
async def test_health_reports_telegraph_as_off_when_unconfigured(monkeypatch):
    monkeypatch.setattr(main, "telegraph", None)
    assert (await main.telegraph_health()) == {"enabled": False, "reason": "not configured"}


@pytest.mark.asyncio
async def test_the_evidence_package_keeps_telegraph_on_its_own_plane(wired):
    clash = {"fields": {"status": {"telegraph": "failed", "rpc": "ok"}}, "authoritative": "json_rpc"}
    await wired.save(receipt("NMS-PRIVATE", "TG-1"))
    await wired.save(receipt("NMS-PRIVATE", "TG-2", discrepancy=clash))
    plane = await main.telegraph_evidence("NMS-PRIVATE")
    assert plane["call_count"] == 2
    assert plane["settled_spend_usd"] == 0.02
    assert plane["disagreements_with_rpc"][0]["receipt_id"] == "TG-2"
    # The caveat travels with the evidence, not in a footnote somewhere else.
    assert "not evidence that an address is clean" in plane["boundary"]
    assert "not what is true on chain" in plane["boundary"]


@pytest.mark.asyncio
async def test_the_package_states_the_boundary_even_with_telegraph_off(monkeypatch):
    monkeypatch.setattr(main, "telegraph", None)
    plane = await main.telegraph_evidence("NMS-PRIVATE")
    assert plane["enabled"] is False
    assert plane["receipts"] == []
    assert plane["boundary"]


@pytest.mark.asyncio
async def test_payment_proof_exposes_everything_a_reader_can_check(wired):
    full = receipt("NMS-PRIVATE", "TG-PROOF-FULL")
    full.payment_network = "eip155:84532"
    full.payment_asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    full.payment_payee = "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8"
    full.payment_scheme = "exact"
    full.quoted_amount_atomic = "10000"
    full.quoted_cost_usdc = "0.010000"
    full.payment = {
        "settled": True,
        "settlement_transaction": "0x" + "cd" * 32,
        "payer": "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324",
        "network": "eip155:84532",
    }
    await wired.save(full)

    proof = (await main.get_case_telegraph("NMS-PRIVATE", OWNER))["receipts"][0]["payment_proof"]
    assert proof["network"] == "eip155:84532"
    assert proof["asset"] == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    assert proof["payee"].startswith("0x5a2324")
    assert proof["payer"].startswith("0x8827d3")
    assert proof["scheme"] == "exact"
    assert proof["quoted_amount_atomic"] == "10000"
    assert proof["reported_cost_usd"] == 0.01
    assert proof["settled"] is True
    assert proof["settlement_transaction"].startswith("0x")
    assert proof["settlement_explorer_url"].startswith("https://sepolia.basescan.org/tx/0x")
    assert proof["signal_hash"].startswith("0x")


@pytest.mark.asyncio
async def test_absent_payment_fields_stay_null_rather_than_being_invented(wired):
    bare = receipt("NMS-PRIVATE", "TG-BARE-PROOF", signal=False)
    bare.payment = None
    await wired.save(bare)
    proof = (await main.get_case_telegraph("NMS-PRIVATE", OWNER))["receipts"][0]["payment_proof"]
    for field in ("network", "asset", "payee", "scheme", "payer", "settlement_transaction", "signal_hash", "verification"):
        assert proof[field] is None, field
    assert proof["settlement_explorer_url"] is None


@pytest.mark.asyncio
async def test_no_explorer_link_is_offered_for_an_unrecognised_network(wired):
    other = receipt("NMS-PRIVATE", "TG-OTHER-NET")
    other.payment_network = "eip155:1"
    other.payment = {"settled": True, "settlement_transaction": "0x" + "ab" * 32}
    await wired.save(other)
    proof = (await main.get_case_telegraph("NMS-PRIVATE", OWNER))["receipts"][0]["payment_proof"]
    assert proof["settlement_transaction"].startswith("0x")
    assert proof["settlement_explorer_url"] is None
