import pytest

from app.telegraph import (
    InMemoryTelegraphReceiptRepository,
    TelegraphEnricher,
    TelegraphGatewayClient,
    TelegraphUnavailable,
    build_query,
    detect_discrepancy,
    idempotency_key,
    plan_intents,
    receipt_id,
    should_enrich,
    summarize,
    extract_summary,
)

CASE = "NMS-260826-915B337C"
BRANCH = "BR-1"
TX = "0xb61413c495fdad6114a7aa863a00b2e3c28945979a10885b12b30316ea9f072c"
ADDRESS = "0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4"

# The transport shape the gateway actually returned on 2026-09-05.
SETTLED = {
    "status": "succeeded",
    "routing_mode": "routed",
    "fallback_reason": None,
    "requested_intent": "ONCHAIN_TX_LOOKUP",
    "returned_intent": "ONCHAIN_TX_LOOKUP",
    "intent_matched": True,
    "miner_id": "302",
    "miner_name": "ChainSight",
    "result": {"status": "ok", "block_number": 21895251, "to": ADDRESS, "confidence": 0.9},
    "quoted_cost_usdc": "0.010000",
    "reported_cost_usd": 0.01,
    "reported_duration_ms": 1046,
    "duration_ms": 8872,
    "signal_hash": "0x273ba7a9af69491ef294b0e5c3c30c249016209238d02ee28f1b52dd31aa5bc0",
    "verification": None,
    "payment": {"network": "eip155:84532", "settlement_transaction": "0x86" + "9b" * 31, "settled": True},
    "raw_response_hash": "sha256:deadbeef",
    "error_code": None,
    "error": None,
}


class StubGateway(TelegraphGatewayClient):
    """A gateway that answers from a script instead of paying anyone."""

    def __init__(self, responses=None, error=None):
        super().__init__("http://gateway", "token")
        self.responses = list(responses or [])
        self.error = error
        self.calls = []

    async def enrich(self, payload):
        self.calls.append(payload)
        if self.error:
            raise TelegraphUnavailable(self.error)
        return self.responses.pop(0) if self.responses else dict(SETTLED)


def enricher(gateway=None, timeline=None):
    return TelegraphEnricher(InMemoryTelegraphReceiptRepository(), gateway or StubGateway(), timeline)


def test_idempotency_key_is_stable_and_case_insensitive():
    left = idempotency_key(CASE, BRANCH, "EV-1", "FRAUD_DETECTION", "ethereum", ADDRESS.upper())
    right = idempotency_key(CASE, BRANCH, "EV-1", "FRAUD_DETECTION", "ethereum", ADDRESS.lower())
    assert receipt_id(left) == receipt_id(right)


def test_different_targets_get_different_receipts():
    one = receipt_id(idempotency_key(CASE, BRANCH, "EV-1", "FRAUD_DETECTION", "ethereum", ADDRESS))
    two = receipt_id(idempotency_key(CASE, BRANCH, "EV-1", "FRAUD_DETECTION", "ethereum", "0x" + "99" * 20))
    assert one != two


@pytest.mark.asyncio
async def test_settled_response_becomes_a_persisted_receipt():
    service = enricher()
    receipt = await service.enrich(
        CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "VERIFIED_INCIDENT",
        branch_id=BRANCH, event_id="EV-1", rpc_evidence_reference="transaction.hash",
    )
    assert receipt.status == "SUCCEEDED"
    assert receipt.miner_id == "302"
    assert receipt.signal_hash == SETTLED["signal_hash"]
    assert receipt.reported_cost_usd == 0.01
    assert receipt.payment["settled"] is True
    stored = await service.receipts.get(receipt.id)
    assert stored is not None and stored.status == "SUCCEEDED"


@pytest.mark.asyncio
async def test_a_redelivered_event_never_pays_twice():
    gateway = StubGateway()
    service = enricher(gateway)
    args = (CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "MOVEMENT_DETECTED")
    first = await service.enrich(*args, branch_id=BRANCH, event_id="EV-1")
    second = await service.enrich(*args, branch_id=BRANCH, event_id="EV-1")
    assert len(gateway.calls) == 1, "the duplicate delivery must not reach the gateway"
    assert first.id == second.id


@pytest.mark.asyncio
async def test_a_gateway_outage_produces_a_visible_failed_receipt():
    service = enricher(StubGateway(error="connection refused"))
    receipt = await service.enrich(CASE, "FRAUD_DETECTION", "address", ADDRESS, "ethereum", "MOVEMENT_DETECTED")
    assert receipt.status == "FAILED"
    assert receipt.error_code == "GATEWAY_UNAVAILABLE"
    assert (await service.receipts.list_by_case(CASE))[0].status == "FAILED"


@pytest.mark.asyncio
async def test_an_answer_to_a_different_intent_is_not_accepted():
    mismatched = {**SETTLED, "returned_intent": "WEB_SEARCH", "intent_matched": False}
    service = enricher(StubGateway([mismatched]))
    receipt = await service.enrich(CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "VERIFIED_INCIDENT")
    assert receipt.status == "FAILED"
    assert receipt.error_code == "INTENT_MISMATCH"


@pytest.mark.asyncio
async def test_a_miner_contradicting_rpc_records_the_clash_without_resolving_it():
    contradicting = {**SETTLED, "result": {"status": "failed", "block_number": 999, "to": ADDRESS}}
    service = enricher(StubGateway([contradicting]))
    receipt = await service.enrich(
        CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "VERIFIED_INCIDENT",
        expected={"status": "ok", "block_number": 21895251},
    )
    assert receipt.status == "SUCCEEDED"
    assert receipt.discrepancy["authoritative"] == "json_rpc"
    assert set(receipt.discrepancy["fields"]) == {"status", "block_number"}


@pytest.mark.asyncio
async def test_agreement_with_rpc_records_no_discrepancy():
    service = enricher()
    receipt = await service.enrich(
        CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "VERIFIED_INCIDENT",
        expected={"status": "ok", "block_number": 21895251},
    )
    assert receipt.discrepancy is None


@pytest.mark.asyncio
async def test_an_untrusted_trigger_cannot_spend():
    gateway = StubGateway()
    service = enricher(gateway)
    assert await service.enrich(CASE, "FRAUD_DETECTION", "address", ADDRESS, "ethereum", "PAGE_VIEWED") is None
    assert gateway.calls == []


@pytest.mark.asyncio
async def test_timeline_references_the_receipt_and_not_the_payload():
    events = []

    async def timeline(case_id, event_type, message, data):
        events.append((event_type, data))

    service = enricher(timeline=timeline)
    receipt = await service.enrich(CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "VERIFIED_INCIDENT")
    event_type, data = events[0]
    assert event_type == "TELEGRAPH_INTELLIGENCE_RECEIVED"
    assert data["receipt_id"] == receipt.id
    assert data["evidence_plane"] == "telegraph_external_intelligence"
    assert "result" not in data


@pytest.mark.asyncio
async def test_a_failed_call_is_announced_on_the_timeline_too():
    events = []

    async def timeline(case_id, event_type, message, data):
        events.append(event_type)

    service = enricher(StubGateway(error="down"), timeline)
    await service.enrich(CASE, "FRAUD_DETECTION", "address", ADDRESS, "ethereum", "MOVEMENT_DETECTED")
    assert events == ["TELEGRAPH_ENRICHMENT_FAILED"]


def test_a_non_committal_risk_answer_reads_as_unknown_not_safe():
    # The real SarzOps reply on 2026-09-05: no data, verdict RECHECK.
    summary = summarize({"verdict": "RECHECK", "confidence": 0.6, "mode": "knowledge"})
    assert summary["label"] == "NO_EXTERNAL_SIGNAL"
    assert summary["risk_score"] is None


def test_an_empty_result_reads_as_unknown():
    assert summarize({})["label"] == "NO_EXTERNAL_SIGNAL"
    assert summarize(None)["label"] is None


def test_a_real_risk_answer_is_preserved():
    summary = summarize({"risk_tier": "elevated_risk", "risk_score": 0.4, "confidence": 0.85, "coverage_complete": False})
    assert summary["label"] == "elevated_risk"
    assert summary["risk_score"] == 0.4
    assert summary["coverage_complete"] is False


def test_discrepancy_ignores_fields_the_miner_did_not_claim():
    assert detect_discrepancy({"status": "ok"}, {"status": "ok", "block_number": 21895251}) is None


def test_verified_incident_asks_for_transaction_and_risk_intelligence():
    assert plan_intents("VERIFIED_INCIDENT", "transaction") == ["ONCHAIN_TX_LOOKUP", "FRAUD_DETECTION"]


def test_a_named_exploit_adds_public_context():
    assert "NEWS_SEARCH" in plan_intents("MOVEMENT_DETECTED", "transaction", has_public_subject=True)


def test_public_context_is_not_bought_without_a_subject():
    assert "NEWS_SEARCH" not in plan_intents("MOVEMENT_DETECTED", "transaction")


def test_a_routine_recheck_plans_nothing():
    assert plan_intents("RECHECK_REQUESTED", "address") == []


def test_dust_and_deep_branches_are_not_worth_paying_for():
    assert should_enrich("0", 1) == (False, "DUST_AMOUNT")
    assert should_enrich("1000000", 9) == (False, "BEYOND_ENRICHMENT_DEPTH")
    assert should_enrich("1000000", 1) == (True, None)
    assert should_enrich(None, 1) == (True, None)


def test_the_fraud_query_forbids_identity_inference():
    query = build_query("FRAUD_DETECTION", "address", ADDRESS, "ethereum", {})
    assert ADDRESS in query
    assert "Do not infer the real-world" in query


def test_a_lookup_that_returned_facts_is_not_called_an_absence_of_signal():
    """The live INTERLOCK reply: real transaction facts, no verdict field."""
    summary = summarize({"status": "ok", "block_number": 21895251, "to": ADDRESS}, "ONCHAIN_TX_LOOKUP")
    assert summary["label"] == "ANSWERED"


def test_a_risk_question_with_no_verdict_still_reads_as_no_signal():
    assert summarize({"source": "groq"}, "FRAUD_DETECTION")["label"] == "NO_EXTERNAL_SIGNAL"


def test_a_lookup_that_returned_nothing_useful_reads_as_no_signal():
    assert summarize({"source": "groq", "mode": "knowledge"}, "ONCHAIN_TX_LOOKUP")["label"] == "NO_EXTERNAL_SIGNAL"


def test_a_non_committal_lookup_is_inconclusive_not_an_all_clear():
    summary = summarize({"verdict": "RECHECK", "block_number": 1}, "ONCHAIN_TX_LOOKUP")
    assert summary["label"] == "INCONCLUSIVE"


def test_an_unknown_intent_is_treated_as_a_risk_question():
    """The cautious default: if we cannot tell, do not imply safety."""
    assert summarize({"source": "x"})["label"] == "NO_EXTERNAL_SIGNAL"


def test_a_summary_is_taken_from_what_the_miner_wrote():
    # The real SarzOps shape: prose under "explanation".
    text = "I do not have any observable fraud-risk signals for this address."
    assert extract_summary({"explanation": text}) == text
    assert extract_summary({"signal": "Confirmed transfer of 22.5 ETH."}) == "Confirmed transfer of 22.5 ETH."


def test_no_summary_is_composed_when_the_miner_wrote_none():
    assert extract_summary({"risk_score": 0.4, "verdict": "elevated_risk"}) is None
    assert extract_summary({}) is None
    assert extract_summary(None) is None


def test_a_long_summary_is_truncated_rather_than_dropped():
    long_text = "word " * 200
    summary = extract_summary({"answer": long_text})
    assert len(summary) <= 400
    assert summary.endswith("...")


def test_summary_whitespace_is_normalised_for_display():
    assert extract_summary({"signal": "line one\n  line two\t"}) == "line one line two"


@pytest.mark.asyncio
async def test_challenge_terms_are_persisted_on_the_receipt():
    settled = {
        **SETTLED,
        "challenge": {
            "scheme": "exact",
            "network": "eip155:84532",
            "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "amount_atomic": "10000",
            "amount_usdc": "0.010000",
            "pay_to": "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8",
            "max_timeout_seconds": 60,
        },
    }
    service = enricher(StubGateway([settled]))
    r = await service.enrich(CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "VERIFIED_INCIDENT")
    assert r.payment_network == "eip155:84532"
    assert r.payment_asset == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    assert r.payment_payee == "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8"
    assert r.payment_scheme == "exact"
    assert r.quoted_amount_atomic == "10000"


@pytest.mark.asyncio
async def test_a_response_without_challenge_terms_leaves_them_null():
    service = enricher()
    r = await service.enrich(CASE, "ONCHAIN_TX_LOOKUP", "transaction", TX, "ethereum", "VERIFIED_INCIDENT")
    assert r.payment_network is None
    assert r.payment_asset is None
