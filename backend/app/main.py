import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .agent_runtime import classifier_from_settings
from .alchemy_discovery import AlchemyIncidentDiscovery
from .auth import require_case_user, require_user
from .config import get_settings
from .discovery import (
    ChainabuseClient,
    DiscoveryProviderError,
    DiscoveryUnavailableError,
    GoPlusAddressClient,
    IncidentNotFoundError,
)
from .models import CaseCreate, CaseResponse, ChainName
from .movement import (
    AlchemyHistoricalMovementDetector,
    AlchemyIndexedTransferResolver,
    BitqueryRealtimeMovementDetector,
    HybridMovementProvider,
)
from .outcome import UNRESOLVED_REASONS, build_outcome, derive_case_state
from .progress import (
    FirestoreProgressReporter,
    InMemoryProgressReporter,
    ProgressReporter,
    describe as describe_progress,
)
from .providers import JsonRpcProvider, RpcProviderError
from .report import render as render_report
from .repository import repository_from_settings
from .telegraph import (
    FirestoreTelegraphReceiptRepository,
    InMemoryTelegraphReceiptRepository,
    TelegraphEnricher,
    TelegraphGatewayClient,
)
from .taskmaster import (
    FirestoreMonitoringRepository,
    GooglePubSubPublisher,
    InMemoryMonitoringRepository,
    Taskmaster,
    decode_pubsub,
)
from .workflow import CaseWorkflow

settings = get_settings()
logging.basicConfig(level=settings.log_level)
repository = repository_from_settings(settings)
rpc_provider = JsonRpcProvider(
    {"ethereum": settings.ethereum_rpc_url, "base": settings.base_rpc_url},
    timeout_seconds=settings.rpc_timeout_seconds,
)
provider = HybridMovementProvider(
    rpc_provider,
    historical=(
        AlchemyHistoricalMovementDetector(
            settings.alchemy_api_key,
            timeout_seconds=settings.rpc_timeout_seconds,
        )
        if settings.alchemy_api_key
        else None
    ),
    indexed_transfers=(
        AlchemyIndexedTransferResolver(
            settings.alchemy_api_key,
            timeout_seconds=settings.rpc_timeout_seconds,
        )
        if settings.alchemy_api_key
        else None
    ),
    realtime=(
        BitqueryRealtimeMovementDetector(
            settings.bitquery_access_token,
            endpoint=settings.bitquery_endpoint,
            timeout_seconds=settings.rpc_timeout_seconds,
        )
        if settings.bitquery_access_token
        else None
    ),
)
classifier = classifier_from_settings(settings)

goplus = GoPlusAddressClient(
    base_url=settings.goplus_base_url,
    access_token=settings.goplus_access_token,
)
chainabuse = ChainabuseClient(
    api_key=settings.chainabuse_api_key,
    base_url=settings.chainabuse_base_url,
)
discovery = (
    AlchemyIncidentDiscovery(
        api_key=settings.alchemy_api_key,
        timeout_seconds=settings.rpc_timeout_seconds,
        max_pages=settings.alchemy_discovery_max_pages,
        goplus=goplus,
        chainabuse=chainabuse,
    )
    if settings.alchemy_api_key
    else None
)
progress_reporter: ProgressReporter = InMemoryProgressReporter()
workflow = CaseWorkflow(repository, provider, classifier, discovery=discovery, progress=progress_reporter)
taskmaster = None
telegraph = None
bearer = HTTPBearer(auto_error=False)


async def require_internal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "authenticated internal caller required")
    try:
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2 import id_token

        claims = id_token.verify_oauth2_token(
            credentials.credentials,
            GoogleRequest(),
            audience=settings.cloud_run_service_url,
        )
    except Exception as exc:
        raise HTTPException(401, "invalid internal identity token") from exc
    if settings.internal_service_account and claims.get("email") != settings.internal_service_account:
        raise HTTPException(403, "internal caller is not authorized")
    return claims


async def owned_case(case_id: str, user: dict):
    case = await repository.get(case_id)
    if not case:
        raise HTTPException(404, "case not found")
    if case.owner_user_id != user.get("sub"):
        raise HTTPException(404, "case not found")
    return case



# Fields that identify the account behind an investigation. A published case is
# evidence about a wallet, never about the person who submitted it.
PRIVATE_CASE_FIELDS = ("owner_user_id", "owner_email")


TELEGRAPH_BOUNDARY = (
    "Telegraph results are paid external intelligence from independent miners. They record what a "
    "miner reported, not what is true on chain. Every blockchain fact in this package is established "
    "by NEMESIS JSON-RPC verification. A Telegraph result must not be treated as proof of identity, "
    "ownership, or wrongdoing, and the absence of a Telegraph signal is not evidence that an address "
    "is clean."
)


async def published_case(case_id: str):
    """A case the owner has published, or 404.

    Anything not explicitly published is indistinguishable from a case that
    does not exist, so this endpoint cannot be used to probe for private ones.
    """
    case = await repository.get(case_id)
    if not case or not getattr(case, "is_public_case", False):
        raise HTTPException(404, "case not found")
    return case


def redact(case) -> dict:
    payload = case.model_dump(mode="json")
    for field in PRIVATE_CASE_FIELDS:
        payload.pop(field, None)
    return payload


class DormantRequest(BaseModel):
    case_id: str = Field(min_length=4, max_length=80)
    chain: ChainName
    address: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")
    cursor_block: int = Field(ge=0)


@asynccontextmanager
async def lifespan(_):
    global taskmaster, telegraph
    await repository.initialize()
    if hasattr(repository, "client") and repository.client is not None:
        workflow.progress = FirestoreProgressReporter(repository.client)
        monitor_repo = FirestoreMonitoringRepository(repository.client)
        publisher = GooglePubSubPublisher(settings.google_cloud_project, settings.pubsub_topic)
    else:
        monitor_repo = InMemoryMonitoringRepository()
        publisher = GooglePubSubPublisher(settings.google_cloud_project, settings.pubsub_topic)
    receipts = (
        FirestoreTelegraphReceiptRepository(repository.client, settings.telegraph_receipts_collection)
        if getattr(repository, "client", None) is not None
        else InMemoryTelegraphReceiptRepository()
    )
    telegraph = TelegraphEnricher(
        receipts,
        TelegraphGatewayClient(
            settings.telegraph_gateway_url,
            settings.telegraph_internal_token,
            settings.telegraph_timeout_seconds,
        ),
    )
    taskmaster = Taskmaster(
        monitor_repo,
        provider,
        publisher,
        settings.monitoring_max_blocks,
        settings.trace_max_depth,
        # Deep tracing runs for minutes on a real drain. It continues on the
        # event path so the case is delivered as soon as its evidence stands
        # and never depends on the browser holding the request open.
        defer_deep_trace=True,
        enricher=telegraph,
    )
    # Receipts reference the timeline the trace already writes, so intelligence
    # lands in the same case narrative as the deterministic evidence.
    telegraph.timeline = taskmaster._timeline
    workflow.taskmaster = taskmaster
    yield
    close = getattr(repository, "close", None)
    if close:
        result = close()
        if hasattr(result, "__await__"):
            await result


app = FastAPI(
    title="NEMESIS Case Runtime",
    version="0.9.0",
    lifespan=lifespan,
    docs_url=None if settings.app_env == "production" else "/docs",
    openapi_url=None if settings.app_env == "production" else "/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "runtime": "nemesis",
        "git_sha": os.getenv("GIT_SHA", "unknown"),
        "environment": settings.app_env,
        "persistence": repository.__class__.__name__,
        "agent": classifier.__class__.__name__,
        "trace_engine": "deterministic_v2",
        "trace_max_depth": settings.trace_max_depth,
        "incident_discovery": "alchemy" if discovery else "unavailable",
        "historical_branch_continuation": "alchemy+rpc_verify" if settings.alchemy_api_key else "rpc",
        "realtime_movement_detection": "bitquery+rpc_verify" if settings.bitquery_access_token else "rpc",
        "authentication": "firebase" if (settings.firebase_project_id or settings.google_cloud_project) else "unconfigured",
        "enrichment": {
            "goplus": True,
            "chainabuse": bool(settings.chainabuse_api_key),
        },
        "telegraph": await telegraph_health(),
    }


async def telegraph_health() -> dict:
    """Operational view of the enrichment plane. Never exposes a secret."""
    if telegraph is None or not telegraph.enabled:
        return {"enabled": False, "reason": "not configured"}
    return await telegraph.gateway.health()


@app.post("/v1/cases", response_model=CaseResponse, status_code=201)
async def create_case(body: CaseCreate, user: dict = Depends(require_case_user)):
    try:
        return await workflow.create_and_investigate(body, user["sub"], user.get("email"))
    except IncidentNotFoundError as exc:
        raise HTTPException(422, str(exc)) from exc
    except DiscoveryUnavailableError as exc:
        raise HTTPException(503, str(exc)) from exc
    except DiscoveryProviderError as exc:
        raise HTTPException(502, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RpcProviderError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/v1/me/cases")
async def my_cases(user: dict = Depends(require_user)):
    cases = await repository.list_by_owner(user["sub"])
    return [case.model_dump(mode="json") for case in cases]


@app.get("/v1/cases/{case_id}")
async def get_case(case_id: str, user: dict = Depends(require_user)):
    case = await owned_case(case_id, user)
    return case.model_dump(mode="json")


@app.get("/v1/cases/{case_id}/timeline")
async def get_timeline(case_id: str, user: dict = Depends(require_user)):
    await owned_case(case_id, user)
    if taskmaster is None:
        raise HTTPException(503, "monitoring runtime unavailable")
    return [e.model_dump(mode="json") for e in await taskmaster.repo.get_timeline(case_id)]


def asset_totals(case, trace: dict) -> list[dict]:
    totals: dict[str, dict[str, int]] = {}
    if case.evidence:
        transaction = case.evidence.transaction
        wallet = case.wallet_address.lower()
        if transaction.from_address == wallet and int(transaction.native_value_wei) > 0:
            totals["native"] = {
                "stolen": int(transaction.native_value_wei),
                "located": 0,
                "unresolved": 0,
            }
        for transfer in transaction.native_transfers:
            if transfer.from_address != wallet:
                continue
            total = totals.setdefault("native", {"stolen": 0, "located": 0, "unresolved": 0})
            total["stolen"] += int(transfer.raw_amount)
        for transfer in transaction.erc20_transfers:
            if transfer.from_address != wallet:
                continue
            total = totals.setdefault(
                transfer.token_contract,
                {"stolen": 0, "located": 0, "unresolved": 0},
            )
            total["stolen"] += int(transfer.raw_amount)
    for branch in trace["branches"]:
        total = totals.setdefault(
            branch["asset"],
            {"stolen": 0, "located": 0, "unresolved": 0},
        )
        amount = int(branch["amount"])
        # Funds resting at a known address are located, even when tracing
        # deliberately stopped there. Only funds whose onward path could not be
        # established are unresolved, otherwise every number would be identical
        # and none of them would tell the victim anything.
        total["located"] += amount
        if branch.get("terminal_reason") in UNRESOLVED_REASONS:
            total["unresolved"] += amount
    return [
        {"asset": asset, **values, "unit": "raw"}
        for asset, values in sorted(totals.items())
    ]

@app.get("/v1/progress/{token}")
async def get_progress(token: str, user: dict = Depends(require_user)):
    """Progress for an investigation this user started.

    Returns the phase the workflow has actually reached. An unknown token
    reports no phase rather than an error, because the client polls from the
    moment it submits, before the first phase has been published.
    """
    record = await workflow.progress.read(token, user["sub"])
    return describe_progress((record or {}).get("phase"))


@app.get("/v1/cases/{case_id}/trace")
async def get_trace(case_id: str, user: dict = Depends(require_user)):
    case = await owned_case(case_id, user)
    if taskmaster is None:
        raise HTTPException(503, "tracing runtime unavailable")
    trace = await taskmaster.case_trace(case_id)
    trace["asset_totals"] = asset_totals(case, trace)
    trace["outcome"] = build_outcome(trace["asset_totals"], trace)
    state = derive_case_state(trace["branches"], case.state)
    if state != case.state:
        case.state = state
        case.updated_at = datetime.now(timezone.utc)
        await repository.save(case)
    trace["case_state"] = state
    return trace



@app.get("/v1/public/cases/{case_id}")
async def get_public_case(case_id: str):
    """Read-only view of a published case. No authentication, no owner data."""
    return redact(await published_case(case_id))


@app.get("/v1/public/cases/{case_id}/trace")
async def get_public_trace(case_id: str):
    case = await published_case(case_id)
    if taskmaster is None:
        raise HTTPException(503, "tracing runtime unavailable")
    trace = await taskmaster.case_trace(case_id)
    trace["asset_totals"] = asset_totals(case, trace)
    trace["outcome"] = build_outcome(trace["asset_totals"], trace)
    trace["case_state"] = derive_case_state(trace["branches"], case.state)
    return trace


# Telegraph intelligence is served as its own evidence plane. It is deliberately
# a separate payload from the trace so the frontend cannot accidentally render
# an external opinion as a deterministic fact.
EXPLORER_BY_NETWORK = {"eip155:84532": "https://sepolia.basescan.org/tx/"}


def telegraph_view(receipt) -> dict:
    payload = receipt.model_dump(mode="json")
    payload["evidence_plane"] = "telegraph_external_intelligence"
    payload["authoritative_for_chain_facts"] = False
    payment = receipt.payment or {}
    settlement = payment.get("settlement_transaction")
    # Proof is shown only where Telegraph actually returned it.
    payload["has_proof"] = bool(receipt.signal_hash or settlement)
    explorer = EXPLORER_BY_NETWORK.get(receipt.payment_network or payment.get("network") or "")
    # One place for everything a reader needs to check the payment themselves.
    # Every entry is a value Telegraph or its signed challenge actually
    # returned; absent values stay null rather than being filled in.
    payload["payment_proof"] = {
        "network": receipt.payment_network or payment.get("network"),
        "asset": receipt.payment_asset,
        "payee": receipt.payment_payee,
        "scheme": receipt.payment_scheme,
        "payer": payment.get("payer"),
        "quoted_amount_atomic": receipt.quoted_amount_atomic,
        "quoted_cost_usdc": receipt.quoted_cost_usdc,
        "reported_cost_usd": receipt.reported_cost_usd,
        "settled": payment.get("settled"),
        "settlement_transaction": settlement,
        "settlement_explorer_url": (explorer + settlement) if (explorer and settlement) else None,
        "signal_hash": receipt.signal_hash,
        "verification": receipt.verification,
    }
    return payload


async def telegraph_receipts(case_id: str) -> dict:
    if telegraph is None:
        return {"enabled": False, "receipts": [], "summary": {}}
    found = await telegraph.receipts.list_by_case(case_id)
    settled = [r for r in found if r.status == "SUCCEEDED"]
    return {
        "enabled": telegraph.enabled,
        "receipts": [telegraph_view(r) for r in found],
        "summary": {
            "total": len(found),
            "succeeded": len(settled),
            "failed": len([r for r in found if r.status == "FAILED"]),
            "intents": sorted({r.intent for r in found}),
            "miners": sorted({r.miner_name for r in settled if r.miner_name}),
            "spend_usd": round(sum(r.reported_cost_usd or 0 for r in settled), 6),
            "discrepancies": len([r for r in settled if r.discrepancy]),
        },
    }


@app.get("/v1/cases/{case_id}/telegraph")
async def get_case_telegraph(case_id: str, user: dict = Depends(require_user)):
    await owned_case(case_id, user)
    return await telegraph_receipts(case_id)


@app.get("/v1/public/cases/{case_id}/telegraph")
async def get_public_case_telegraph(case_id: str):
    await published_case(case_id)
    return await telegraph_receipts(case_id)


@app.get("/v1/cases/{case_id}/telegraph/{receipt_id}")
async def get_case_telegraph_receipt(case_id: str, receipt_id: str, user: dict = Depends(require_user)):
    await owned_case(case_id, user)
    if telegraph is None:
        raise HTTPException(503, "telegraph runtime unavailable")
    receipt = await telegraph.receipts.get(receipt_id)
    # A receipt from another case is not this case's evidence.
    if receipt is None or receipt.case_id != case_id:
        raise HTTPException(404, "receipt not found")
    return telegraph_view(receipt)


async def telegraph_evidence(case_id: str) -> dict:
    """Telegraph receipts for the escalation package, with the caveats attached."""
    if telegraph is None or not telegraph.enabled:
        return {"enabled": False, "receipts": [], "boundary": TELEGRAPH_BOUNDARY}
    found = await telegraph.receipts.list_by_case(case_id)
    settled = [r for r in found if r.status == "SUCCEEDED"]
    return {
        "enabled": True,
        "boundary": TELEGRAPH_BOUNDARY,
        "call_count": len(found),
        "answered_count": len(settled),
        "settled_spend_usd": round(sum(r.reported_cost_usd or 0 for r in settled), 6),
        "receipts": [r.model_dump(mode="json") for r in found],
        "disagreements_with_rpc": [
            {"receipt_id": r.id, "target": r.target_value, "fields": r.discrepancy["fields"]}
            for r in settled if r.discrepancy
        ],
    }


@app.get("/v1/cases/{case_id}/evidence-package")
async def get_evidence_package(case_id: str, user: dict = Depends(require_user)):
    case = await owned_case(case_id, user)
    if taskmaster is None:
        raise HTTPException(503, "tracing runtime unavailable")
    trace = await taskmaster.case_trace(case_id)
    package = {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "case_metadata": {
            "id": case.id, "state": case.state,
            "created_at": case.created_at.isoformat(),
            "updated_at": case.updated_at.isoformat(), "chain": case.chain,
        },
        "deterministic_facts": {
            "submitted_wallet": case.wallet_address,
            "selected_theft_transaction": case.theft_transaction_hash,
            "discovery": case.discovery.model_dump(mode="json") if case.discovery else None,
            "normalized_evidence": case.evidence.model_dump(mode="json") if case.evidence else None,
            "trace_branches": trace["branches"], "graph": trace["graph"],
            "asset_totals": asset_totals(case, trace),
            "current_outcome": build_outcome(asset_totals(case, trace), trace),
            "timeline": trace["timeline"],
            "monitoring_state": [
                {"branch_id": b["id"], "status": b["status"],
                 "last_checked": b["last_checked"], "terminal_reason": b.get("terminal_reason")}
                for b in trace["branches"]
            ],
            "movement_events": [e for e in trace["timeline"] if e["type"] == "MOVEMENT_DETECTED"],
            "verified_attributions": [b["attribution"] for b in trace["branches"] if b.get("attribution")],
            "provider_provenance": sorted({
                item for b in trace["branches"] for item in b.get("evidence_provenance", [])
                if not item.startswith("0x")
            }),
        },
        # A third plane, kept beside the deterministic facts rather than inside
        # them. An escalation reader must be able to tell at a glance which
        # claims are verified and which are somebody else's opinion.
        "telegraph_intelligence": await telegraph_evidence(case_id),
        "nemesis_assessment": case.finding.model_dump(mode="json") if case.finding else None,
        "unknowns_and_limitations": case.finding.limitations if case.finding else [case.error or "Model assessment unavailable."],
    }
    # A victim should be able to read what they downloaded without parsing JSON.
    # The report restates the package and never adds to it.
    package["readable_report"] = render_report(package)
    return package

@app.post("/internal/monitoring/tick", dependencies=[Depends(require_internal)])
async def monitoring_tick():
    if taskmaster is None:
        raise HTTPException(503, "monitoring runtime unavailable")
    return {"rechecks_published": await taskmaster.schedule()}


@app.post("/internal/events/pubsub", dependencies=[Depends(require_internal)])
async def pubsub_event(request: Request):
    if taskmaster is None:
        raise HTTPException(503, "monitoring runtime unavailable")
    try:
        return await taskmaster.consume(decode_pubsub(await request.json()))
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc
