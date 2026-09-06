"""Judging must be frictionless; spending must not be.

A visitor with no account has to be able to read a published case in full,
including its Telegraph receipts. That same visitor must have no route, direct
or indirect, that causes a paid miner call.
"""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.main as main
from app.models import InvestigationCase
from app.telegraph import (
    InMemoryTelegraphReceiptRepository,
    TelegraphEnricher,
    TelegraphGatewayClient,
    TelegraphReceipt,
)

NOW = datetime.now(timezone.utc)

# Every route an anonymous visitor is allowed to reach.
PUBLIC_ROUTES = (
    "/health",
    "/v1/public/cases/NMS-PUBLIC",
    "/v1/public/cases/NMS-PUBLIC/trace",
    "/v1/public/cases/NMS-PUBLIC/telegraph",
)

# Routes that must refuse an anonymous caller.
GUARDED_ROUTES = (
    ("GET", "/v1/me/cases"),
    ("GET", "/v1/cases/NMS-PUBLIC"),
    ("GET", "/v1/cases/NMS-PUBLIC/trace"),
    ("GET", "/v1/cases/NMS-PUBLIC/timeline"),
    ("GET", "/v1/cases/NMS-PUBLIC/telegraph"),
    ("GET", "/v1/cases/NMS-PUBLIC/telegraph/TG-1"),
    ("GET", "/v1/cases/NMS-PUBLIC/evidence-package"),
    ("POST", "/internal/monitoring/tick"),
    ("POST", "/internal/events/pubsub"),
)


def case(case_id, public):
    return InvestigationCase(
        id=case_id, state="MONITORING", created_at=NOW, updated_at=NOW,
        wallet_address="0x" + "ab" * 20, chain="ethereum",
        owner_user_id="owner-1", owner_email="victim@example.com",
        is_public_case=public,
    )


class Repo:
    # No Firestore client, so app startup falls back to in-memory monitoring
    # and an unconfigured gateway. That is the point: the deployed app needs a
    # gateway URL and token to spend, and a test app has neither.
    client = None

    def __init__(self):
        self.cases = {c.id: c for c in (case("NMS-PUBLIC", True), case("NMS-PRIVATE", False))}

    async def initialize(self):
        return None

    async def get(self, case_id):
        return self.cases.get(case_id)


class CountingGateway(TelegraphGatewayClient):
    """Fails loudly if anything reaches it. Nothing in this file may."""

    def __init__(self):
        super().__init__("http://gateway", "token")
        self.calls = 0

    async def enrich(self, payload):
        self.calls += 1
        raise AssertionError("a paid call was attempted from an unauthenticated path")

    async def health(self):
        return {"enabled": True, "status": "ok"}


@pytest.fixture
def anon(monkeypatch):
    gateway = CountingGateway()
    receipts = InMemoryTelegraphReceiptRepository()
    enricher = TelegraphEnricher(receipts, gateway)
    monkeypatch.setattr(main, "repository", Repo())
    monkeypatch.setattr(main, "telegraph", enricher)
    return {"gateway": gateway, "receipts": receipts, "enricher": enricher}


@pytest.mark.asyncio
async def test_a_published_case_is_fully_readable_without_an_account(anon):
    await anon["receipts"].save(
        TelegraphReceipt(
            id="TG-1", idempotency_key="k", case_id="NMS-PUBLIC", trigger="MOVEMENT_DETECTED",
            intent="FRAUD_DETECTION", target_type="address", target_value="0x" + "cd" * 20,
            routing_mode="routed", miner_id="91001", miner_name="SarzOps",
            reported_cost_usd=0.01, signal_hash="0x" + "ab" * 32,
            payment={"settled": True, "settlement_transaction": "0x" + "ef" * 32, "network": "eip155:84532"},
            payment_network="eip155:84532", payment_asset="0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            status="SUCCEEDED", created_at=NOW, updated_at=NOW,
        )
    )
    payload = await main.get_public_case_telegraph("NMS-PUBLIC")
    assert payload["summary"]["total"] == 1
    proof = payload["receipts"][0]["payment_proof"]
    assert proof["settlement_transaction"].startswith("0x")
    assert proof["network"] == "eip155:84532"
    assert anon["gateway"].calls == 0


@pytest.mark.asyncio
async def test_reading_a_public_case_never_reaches_the_gateway(anon):
    await main.get_public_case_telegraph("NMS-PUBLIC")
    await main.telegraph_receipts("NMS-PUBLIC")
    assert anon["gateway"].calls == 0


@pytest.mark.asyncio
async def test_an_unpublished_case_stays_invisible_to_anonymous_readers(anon):
    with pytest.raises(HTTPException) as raised:
        await main.get_public_case_telegraph("NMS-PRIVATE")
    assert raised.value.status_code == 404


def test_anonymous_callers_are_refused_on_every_guarded_route(anon):
    """No token at all must never reach product logic."""
    with TestClient(main.app) as client:
        for method, path in GUARDED_ROUTES:
            response = client.request(method, path)
            assert response.status_code in (401, 403), f"{method} {path} returned {response.status_code}"


def test_an_app_without_gateway_configuration_cannot_pay_at_all(anon):
    """Belt and braces: no gateway URL or token means enrichment is inert."""
    with TestClient(main.app):
        assert main.telegraph is not None
        assert main.telegraph.enabled is False


def test_creating_an_investigation_requires_a_signed_in_user(anon):
    with TestClient(main.app) as client:
        response = client.post("/v1/cases", json={"wallet_address": "0x" + "ab" * 20, "chain": "ethereum"})
    assert response.status_code == 401


def test_a_forged_bearer_token_is_rejected(anon):
    with TestClient(main.app) as client:
        response = client.post(
            "/v1/cases",
            json={"wallet_address": "0x" + "ab" * 20, "chain": "ethereum"},
            headers={"Authorization": "Bearer not-a-real-firebase-token"},
        )
    assert response.status_code == 401


def test_a_malformed_case_is_rejected_before_authentication_is_considered(anon):
    """422 here is deliberate: schema validation must not leak auth state."""
    with TestClient(main.app) as client:
        response = client.post("/v1/cases", json={"wallet_address": "not-an-address"})
    assert response.status_code == 422


def test_public_routes_stay_reachable(anon):
    with TestClient(main.app) as client:
        for path in PUBLIC_ROUTES:
            assert client.get(path).status_code == 200, path


@pytest.mark.asyncio
async def test_only_verified_lifecycle_triggers_can_spend(anon):
    """The trigger allowlist is the last line before money moves."""
    for trigger in ("PAGE_VIEWED", "PUBLIC_READ", "", "RECHECK_REQUESTED"):
        result = await anon["enricher"].enrich(
            "NMS-PUBLIC", "FRAUD_DETECTION", "address", "0x" + "cd" * 20, "ethereum", trigger
        )
        assert result is None
    assert anon["gateway"].calls == 0


def test_a_signed_in_user_gets_past_authentication(anon):
    """The gate must open for a real user, not just close for everyone.

    The investigation itself needs RPC and discovery providers that a test app
    does not have, so this asserts only that authentication passed: the request
    reaches product logic instead of being turned away at the door.
    """
    from app.auth import require_case_user

    async def signed_in():
        return {"sub": "test-user", "email": "user@example.com"}

    main.app.dependency_overrides[require_case_user] = signed_in
    try:
        with TestClient(main.app) as client:
            response = client.post(
                "/v1/cases",
                json={"wallet_address": "0x" + "ab" * 20, "chain": "ethereum"},
            )
        assert response.status_code not in (401, 403), response.text
    finally:
        main.app.dependency_overrides.pop(require_case_user, None)


def test_the_override_does_not_leak_into_later_requests(anon):
    """Guards the test above: a stale override would hide a real regression."""
    with TestClient(main.app) as client:
        response = client.post("/v1/cases", json={"wallet_address": "0x" + "ab" * 20, "chain": "ethereum"})
    assert response.status_code == 401
