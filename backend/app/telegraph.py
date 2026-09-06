"""Telegraph external intelligence.

Telegraph is an enrichment plane. It may add context around what NEMESIS has
already proven over JSON-RPC; it may never establish a blockchain fact. Every
function here keeps that boundary: a receipt records what a miner said, never
what is true on chain.
"""

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Literal

import httpx
from pydantic import BaseModel, Field

from .models import ChainName

TelegraphIntent = Literal["ONCHAIN_TX_LOOKUP", "FRAUD_DETECTION", "NEWS_SEARCH"]
ReceiptStatus = Literal["PENDING", "SUCCEEDED", "FAILED"]
RoutingMode = Literal["routed", "direct_fallback", "none"]

# Triggers that may spend. Anything else must not reach the gateway.
TRIGGERS = ("VERIFIED_INCIDENT", "MOVEMENT_DETECTED", "ANALYST_REQUEST")


class TelegraphReceipt(BaseModel):
    """One Telegraph attempt, successful or not. Failures stay visible."""

    id: str
    idempotency_key: str
    case_id: str
    branch_id: str | None = None
    trigger: str
    event_id: str | None = None

    intent: str
    returned_intent: str | None = None
    intent_matched: bool | None = None

    target_type: Literal["transaction", "address", "topic"]
    target_value: str
    target_chain: ChainName | None = None
    # Points at the deterministic evidence that justified the spend.
    rpc_evidence_reference: str | None = None

    routing_mode: RoutingMode = "none"
    fallback_reason: str | None = None
    miner_id: str | None = None
    miner_name: str | None = None

    result: dict | None = None
    label: str | None = None
    # A short line the miner actually wrote. Extracted, never composed.
    result_summary: str | None = None
    confidence: float | None = None
    risk_score: float | None = None
    coverage_complete: bool | None = None
    # Set when a miner contradicts RPC. RPC still wins; the clash is recorded.
    discrepancy: dict | None = None

    quoted_cost_usdc: str | None = None
    quoted_amount_atomic: str | None = None
    # Terms from the signed x402 challenge. Observed, never assumed: a receipt
    # that cannot say which asset on which network paid whom is not proof.
    payment_network: str | None = None
    payment_asset: str | None = None
    payment_payee: str | None = None
    payment_scheme: str | None = None
    reported_cost_usd: float | None = None
    duration_ms: int | None = None
    reported_duration_ms: int | None = None
    signal_hash: str | None = None
    verification: dict | None = None
    payment: dict | None = None
    raw_response_hash: str | None = None

    status: ReceiptStatus = "PENDING"
    error_code: str | None = None
    error: str | None = None
    attempts: int = 0
    created_at: datetime
    updated_at: datetime


def receipt_id(idempotency_key: str) -> str:
    return "TG-" + hashlib.sha256(idempotency_key.lower().encode()).hexdigest()[:20].upper()


def idempotency_key(case_id, branch_id, event_id, intent, chain, target) -> str:
    """Deterministic so a redelivered event resolves to the receipt already paid for."""
    parts = [case_id, branch_id or "-", event_id or "-", intent, chain or "-", (target or "").lower()]
    return ":".join(str(part) for part in parts)


class TelegraphReceiptRepository:
    async def save(self, receipt: TelegraphReceipt) -> TelegraphReceipt:
        raise NotImplementedError

    async def get(self, receipt_id_value: str) -> TelegraphReceipt | None:
        raise NotImplementedError

    async def list_by_case(self, case_id: str) -> list[TelegraphReceipt]:
        raise NotImplementedError

    async def claim(self, receipt: TelegraphReceipt) -> TelegraphReceipt | None:
        """Reserves a receipt id, or returns None when one already exists.

        This is the payment guard. A duplicate Pub/Sub delivery loses the race
        and never reaches the gateway.
        """
        raise NotImplementedError


class InMemoryTelegraphReceiptRepository(TelegraphReceiptRepository):
    def __init__(self):
        self._receipts: dict[str, dict] = {}

    async def save(self, receipt):
        self._receipts[receipt.id] = receipt.model_dump(mode="json")
        return receipt

    async def get(self, receipt_id_value):
        value = self._receipts.get(receipt_id_value)
        return TelegraphReceipt.model_validate(value) if value else None

    async def list_by_case(self, case_id):
        found = [
            TelegraphReceipt.model_validate(value)
            for value in self._receipts.values()
            if value.get("case_id") == case_id
        ]
        return sorted(found, key=lambda item: item.created_at)

    async def claim(self, receipt):
        if receipt.id in self._receipts:
            return None
        self._receipts[receipt.id] = receipt.model_dump(mode="json")
        return receipt


class FirestoreTelegraphReceiptRepository(TelegraphReceiptRepository):
    """Top-level collection, matching how branches and timeline are already stored."""

    def __init__(self, client, collection: str = "telegraph_receipts"):
        self.client, self.collection = client, collection

    async def save(self, receipt):
        await self.client.collection(self.collection).document(receipt.id).set(
            receipt.model_dump(mode="python")
        )
        return receipt

    async def get(self, receipt_id_value):
        snap = await self.client.collection(self.collection).document(receipt_id_value).get()
        return TelegraphReceipt.model_validate(snap.to_dict()) if snap.exists else None

    async def list_by_case(self, case_id):
        query = self.client.collection(self.collection).where("case_id", "==", case_id)
        found = [TelegraphReceipt.model_validate(snap.to_dict()) async for snap in query.stream()]
        return sorted(found, key=lambda item: item.created_at)

    async def claim(self, receipt):
        try:
            # create() fails if the document exists, which is the whole point.
            await self.client.collection(self.collection).document(receipt.id).create(
                receipt.model_dump(mode="python")
            )
        except Exception as exc:
            if "already exists" in str(exc).lower() or exc.__class__.__name__ == "AlreadyExists":
                return None
            raise
        return receipt


class TelegraphUnavailable(Exception):
    """The gateway could not be reached. Tracing continues regardless."""


class TelegraphGatewayClient:
    """Thin HTTP client for the gateway. It holds no key and signs nothing.

    Two independent layers guard the gateway. Cloud Run IAM consumes the
    Authorization header for its own identity token, so the shared secret gets
    a header of its own. Losing either one is not enough to reach the payer.
    """

    def __init__(self, base_url: str, token: str, timeout: float = 60.0):
        self.base_url, self.token, self.timeout = base_url.rstrip("/"), token, timeout

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.token)

    def _identity_token(self) -> str | None:
        """A Google OIDC token for the gateway, when running on Cloud Run.

        Absent locally, where the gateway is not behind IAM. A failure here is
        not fatal: the request still carries the shared secret, and the gateway
        rejects it if that is not enough.
        """
        if not self.base_url.startswith("https://"):
            return None
        try:
            from google.auth.transport.requests import Request as GoogleRequest
            from google.oauth2 import id_token

            return id_token.fetch_id_token(GoogleRequest(), self.base_url)
        except Exception:
            return None

    def _headers(self) -> dict:
        headers = {"x-telegraph-token": self.token}
        identity = self._identity_token()
        if identity:
            headers["authorization"] = "Bearer " + identity
        else:
            # Local development, where nothing sits in front of the gateway.
            headers["authorization"] = "Bearer " + self.token
        return headers

    async def enrich(self, payload: dict) -> dict:
        if not self.enabled:
            raise TelegraphUnavailable("Telegraph gateway is not configured")
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.base_url + "/internal/telegraph/enrich",
                    json=payload,
                    headers=self._headers(),
                )
        except httpx.HTTPError as exc:
            raise TelegraphUnavailable(str(exc)) from exc
        if response.status_code != 200:
            raise TelegraphUnavailable("gateway HTTP " + str(response.status_code))
        return response.json()

    async def health(self) -> dict:
        if not self.enabled:
            return {"enabled": False}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(self.base_url + "/health", headers=self._headers())
            return {"enabled": True, **response.json()}
        except httpx.HTTPError as exc:
            return {"enabled": True, "status": "unreachable", "error": str(exc)}
        except ValueError as exc:
            return {"enabled": True, "status": "unreadable", "error": str(exc)}


def build_query(intent: str, target_type: str, target: str, chain: str | None, context: dict) -> str:
    """A narrow question. Vague prompts buy vague answers at the same price."""
    where = " on " + chain if chain else ""
    if intent == "ONCHAIN_TX_LOOKUP":
        return (
            "Look up transaction " + target + where + ". Report its status, block, sender, "
            "recipient, and token movements. Report only what you can observe."
        )
    if intent == "FRAUD_DETECTION":
        return (
            "Assess observable fraud-risk signals for address " + target + where + ". "
            "Report screening measurements and coverage only. Do not infer the real-world "
            "identity or ownership of this address."
        )
    if intent == "NEWS_SEARCH":
        subject = context.get("subject") or target
        return (
            "Find current public reporting about the " + str(subject) + " incident, including "
            "confirmed exploit details and affected protocols. Cite sources."
        )
    return "Provide external intelligence about " + target + where + "."


# Values a miner may return that mean "nothing found", which is never "safe".
_UNKNOWN_VERDICTS = {"recheck", "unknown", "no_data", "insufficient_data", "none"}


# Intents whose whole purpose is to say whether something looks bad. Only these
# may be summarized as an absence of risk signal.
_RISK_INTENTS = {"FRAUD_DETECTION"}

# Fields that carry an answer rather than routing noise, used to decide whether
# a non-risk intent actually returned anything.
_EMPTY_KEYS = {"signal", "answer", "explanation", "source", "mode", "confidence"}


def summarize(result: dict | None, intent: str | None = None) -> dict:
    """Pulls the display fields miners actually return, without inventing any.

    A risk question that comes back non-committal or empty becomes an explicit
    unknown, because silence must never read as an all-clear. A lookup question
    is different: returning facts and no verdict is a complete answer, so it is
    not labelled as an absence of signal.
    """
    if not isinstance(result, dict):
        return {"label": None, "confidence": None, "risk_score": None, "coverage_complete": None}

    verdict = result.get("verdict") or result.get("risk_tier") or result.get("label")
    risk = result.get("risk_score")
    confidence = result.get("confidence")
    is_risk_question = intent is None or intent.upper() in _RISK_INTENTS

    label = str(verdict) if verdict is not None else None
    if label is not None and label.strip().lower() in _UNKNOWN_VERDICTS:
        label = "NO_EXTERNAL_SIGNAL" if is_risk_question else "INCONCLUSIVE"
    if label is None and risk is None:
        if is_risk_question:
            label = "NO_EXTERNAL_SIGNAL"
        else:
            # Anything beyond bookkeeping fields counts as a real answer.
            substantive = [k for k, v in result.items() if k not in _EMPTY_KEYS and v not in (None, "", [], {})]
            label = "ANSWERED" if substantive else "NO_EXTERNAL_SIGNAL"

    return {
        "label": label,
        "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
        "risk_score": float(risk) if isinstance(risk, (int, float)) else None,
        "coverage_complete": result.get("coverage_complete") if isinstance(result.get("coverage_complete"), bool) else None,
    }


# Fields miners have actually used to carry their answer in prose.
_SUMMARY_KEYS = ("signal", "answer", "explanation", "reasoning", "summary")


def extract_summary(result: dict | None) -> str | None:
    """Returns a line the miner wrote, or nothing.

    This never composes a sentence. If the miner did not provide prose, the UI
    shows the structured fields instead of an invented description.
    """
    if not isinstance(result, dict):
        return None
    for key in _SUMMARY_KEYS:
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            text = " ".join(value.split())
            return text if len(text) <= 400 else text[:397] + "..."
    return None


def detect_discrepancy(result: dict | None, expected: dict) -> dict | None:
    """Compares a miner's transaction claims against RPC-verified facts.

    RPC is authoritative, so a mismatch is never resolved here. It is recorded
    so the case can show that two sources disagreed.
    """
    if not isinstance(result, dict) or not expected:
        return None
    clashes = {}
    for field, truth in expected.items():
        claimed = result.get(field)
        if claimed is None or truth is None:
            continue
        if isinstance(truth, str) and isinstance(claimed, str):
            if claimed.lower() != truth.lower():
                clashes[field] = {"telegraph": claimed, "rpc": truth}
        elif str(claimed) != str(truth):
            clashes[field] = {"telegraph": claimed, "rpc": truth}
    if not clashes:
        return None
    return {"fields": clashes, "authoritative": "json_rpc"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def raw_hash(value) -> str:
    return "sha256:" + hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def gateway_from_env() -> TelegraphGatewayClient:
    return TelegraphGatewayClient(
        os.getenv("TELEGRAPH_GATEWAY_URL", ""),
        os.getenv("TELEGRAPH_INTERNAL_TOKEN", ""),
    )


# Value below which a new destination is not worth paying to enrich. Raw units,
# so this is deliberately conservative for 6-decimal tokens as well as wei.
DUST_THRESHOLD = 1


def plan_intents(trigger: str, target_type: str, has_public_subject: bool = False) -> list[str]:
    """Which intents a case event justifies.

    Telegraph is not called because a graph node appeared. It is called when a
    verified event changes what the investigation needs to know.
    """
    if trigger not in TRIGGERS:
        return []
    intents = []
    if target_type == "transaction":
        intents.append("ONCHAIN_TX_LOOKUP")
    if target_type in ("transaction", "address"):
        intents.append("FRAUD_DETECTION")
    # Public context is only worth buying when the case already names something
    # narrow enough to search for.
    if has_public_subject:
        intents.append("NEWS_SEARCH")
    return intents


def should_enrich(branch_amount: str | None, depth: int, max_depth: int = 4) -> tuple[bool, str | None]:
    """Guards enrichment on branches that are too deep or carry dust."""
    try:
        amount = int(branch_amount) if branch_amount is not None else None
    except (TypeError, ValueError):
        amount = None
    if amount is not None and amount <= DUST_THRESHOLD:
        return False, "DUST_AMOUNT"
    if depth > max_depth:
        return False, "BEYOND_ENRICHMENT_DEPTH"
    return True, None


class TelegraphEnricher:
    """Turns a verified case event into at most one paid call per logical target.

    Ordering matters: the receipt id is claimed before the gateway is called, so
    a redelivered event cannot produce a second payment.
    """

    def __init__(self, receipts: TelegraphReceiptRepository, gateway: TelegraphGatewayClient, timeline=None):
        self.receipts, self.gateway, self.timeline = receipts, gateway, timeline

    @property
    def enabled(self) -> bool:
        return self.gateway.enabled

    async def enrich(
        self,
        case_id: str,
        intent: str,
        target_type: str,
        target_value: str,
        chain: str | None,
        trigger: str,
        branch_id: str | None = None,
        event_id: str | None = None,
        rpc_evidence_reference: str | None = None,
        expected: dict | None = None,
        context: dict | None = None,
    ) -> TelegraphReceipt | None:
        if not self.enabled or trigger not in TRIGGERS:
            return None

        key = idempotency_key(case_id, branch_id, event_id, intent, chain, target_value)
        timestamp = now()
        pending = TelegraphReceipt(
            id=receipt_id(key),
            idempotency_key=key,
            case_id=case_id,
            branch_id=branch_id,
            trigger=trigger,
            event_id=event_id,
            intent=intent,
            target_type=target_type,
            target_value=target_value,
            target_chain=chain,
            rpc_evidence_reference=rpc_evidence_reference,
            status="PENDING",
            attempts=1,
            created_at=timestamp,
            updated_at=timestamp,
        )
        claimed = await self.receipts.claim(pending)
        if claimed is None:
            # Someone already paid for this exact question.
            return await self.receipts.get(pending.id)

        payload = {
            "idempotency_key": key,
            "case_id": case_id,
            "branch_id": branch_id,
            "trigger": trigger,
            "intent": intent,
            "query": build_query(intent, target_type, target_value, chain, context or {}),
            "context": {"chain": chain, target_type: target_value, **(context or {})},
        }

        try:
            transport = await self.gateway.enrich(payload)
        except TelegraphUnavailable as exc:
            pending.status = "FAILED"
            pending.error_code = "GATEWAY_UNAVAILABLE"
            pending.error = str(exc)
            pending.updated_at = now()
            await self.receipts.save(pending)
            await self._note(pending, "TELEGRAPH_ENRICHMENT_FAILED", "Telegraph intelligence unavailable")
            return pending

        receipt = self._apply(pending, transport, expected or {})
        await self.receipts.save(receipt)
        await self._note(
            receipt,
            "TELEGRAPH_INTELLIGENCE_RECEIVED" if receipt.status == "SUCCEEDED" else "TELEGRAPH_ENRICHMENT_FAILED",
            "External intelligence received" if receipt.status == "SUCCEEDED" else "Telegraph intelligence failed",
        )
        return receipt

    def _apply(self, receipt: TelegraphReceipt, transport: dict, expected: dict) -> TelegraphReceipt:
        raw_result = transport.get("result")
        result = raw_result if isinstance(raw_result, dict) else None
        summary = summarize(result, receipt.intent)
        receipt.status = "SUCCEEDED" if transport.get("status") == "succeeded" else "FAILED"
        receipt.routing_mode = transport.get("routing_mode") or "none"
        receipt.fallback_reason = transport.get("fallback_reason")
        receipt.returned_intent = transport.get("returned_intent")
        receipt.intent_matched = transport.get("intent_matched")
        receipt.miner_id = transport.get("miner_id")
        receipt.miner_name = transport.get("miner_name")
        if result is not None:
            receipt.result = result
        elif raw_result is not None:
            receipt.result = {"value": raw_result}
        receipt.label = summary["label"]
        receipt.result_summary = extract_summary(result)
        receipt.confidence = summary["confidence"]
        receipt.risk_score = summary["risk_score"]
        receipt.coverage_complete = summary["coverage_complete"]
        receipt.quoted_cost_usdc = transport.get("quoted_cost_usdc")
        challenge = transport.get("challenge")
        if isinstance(challenge, dict):
            receipt.quoted_amount_atomic = challenge.get("amount_atomic")
            receipt.payment_network = challenge.get("network")
            receipt.payment_asset = challenge.get("asset")
            receipt.payment_payee = challenge.get("pay_to")
            receipt.payment_scheme = challenge.get("scheme")
        receipt.reported_cost_usd = transport.get("reported_cost_usd")
        receipt.duration_ms = transport.get("duration_ms")
        receipt.reported_duration_ms = transport.get("reported_duration_ms")
        receipt.signal_hash = transport.get("signal_hash")
        verification = transport.get("verification")
        receipt.verification = verification if isinstance(verification, dict) else None
        payment = transport.get("payment")
        receipt.payment = payment if isinstance(payment, dict) else None
        receipt.raw_response_hash = transport.get("raw_response_hash")
        receipt.error_code = transport.get("error_code")
        receipt.error = transport.get("error")
        # An answer to a different question is not the answer, whatever it cost.
        if receipt.intent_matched is False:
            receipt.status = "FAILED"
            receipt.error_code = receipt.error_code or "INTENT_MISMATCH"
            receipt.error = receipt.error or "Telegraph answered a different intent"
        if receipt.status == "SUCCEEDED":
            receipt.discrepancy = detect_discrepancy(result, expected)
        receipt.updated_at = now()
        return receipt

    async def _note(self, receipt: TelegraphReceipt, event_type: str, message: str) -> None:
        if self.timeline is None:
            return
        # The timeline references the receipt; it never copies the raw payload.
        await self.timeline(
            receipt.case_id,
            event_type,
            message,
            {
                "receipt_id": receipt.id,
                "branch_id": receipt.branch_id,
                "intent": receipt.intent,
                "routing_mode": receipt.routing_mode,
                "miner_id": receipt.miner_id,
                "miner_name": receipt.miner_name,
                "status": receipt.status,
                "label": receipt.label,
                "cost_usd": receipt.reported_cost_usd,
                "signal_hash": receipt.signal_hash,
                "evidence_plane": "telegraph_external_intelligence",
            },
        )
