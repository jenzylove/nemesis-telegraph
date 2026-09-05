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
