"""Seeds one controlled demo case into the isolated Telegraph Firestore database.

This is the only scripted part of the deployed proof, and it is deliberately
small: a case record and a dormant branch positioned one block behind a real
historical outgoing transaction. Everything after this point is the production
path doing its own work. The deployed monitoring tick rechecks the branch, the
real movement provider finds the transfer, JSON-RPC verifies it, tracing
resumes, and enrichment is published, paid for, and persisted.

The case is marked public so its Telegraph receipts are visible on the
read-only case page without an account.

Writes only to the nemesis-telegraph database over the Firestore REST API,
using the caller's own gcloud credentials. The submitted deployment reads
(default) and is not touched.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

import httpx

PROJECT = os.getenv("FIRESTORE_PROJECT_ID", "nemesis-506114")
DATABASE = os.getenv("FIRESTORE_DATABASE", "nemesis-telegraph")

if DATABASE in ("(default)", "", None):
    sys.exit("refusing to write to the default database")

CASE_ID = "NMS-TG-DEMO-002"
BRANCH_ID = "BR-TG-DEMO-002"
CHAIN = "ethereum"
# A real Ethereum transfer of 22.5 ETH. A branch parked one block earlier sees
# it as a genuine outgoing native movement, which is what the monitoring path
# needs in order to have something real to verify.
#
# No claim of wrongdoing is made about either address. They are ordinary
# mainnet addresses chosen only because the transfer is real and verifiable.
MOVEMENT_TX = "0xbdab85894d981ba9e4b6aad7a024564d62a53a38c158c67224ed9b8b2905239b"
SUBJECT = "0x663d98059d1c77e4d185f28b36e94f11120e5826"
AMOUNT_WEI = "22500505562000000000"
BLOCK = 25913380

NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents"


def token() -> str:
    """The caller's own access token. TELEGRAPH_ACCESS_TOKEN wins if provided,
    which avoids resolving the gcloud wrapper on Windows."""
    supplied = os.getenv("TELEGRAPH_ACCESS_TOKEN")
    if supplied:
        return supplied.strip()
    return subprocess.run(
        ["gcloud", "auth", "print-access-token"],
        capture_output=True, text=True, check=True, shell=(os.name == "nt"),
    ).stdout.strip()


def s(value):
    return {"stringValue": value}


def write(collection: str, document_id: str, fields: dict, access: str) -> None:
    response = httpx.patch(
        f"{BASE}/{collection}/{document_id}",
        headers={"Authorization": "Bearer " + access, "content-type": "application/json"},
        json={"fields": fields},
        timeout=60.0,
    )
    if response.status_code >= 300:
        sys.exit(f"write failed for {collection}/{document_id}: {response.status_code} {response.text[:400]}")
    print(f"wrote {collection}/{document_id}")


case_fields = {
    "id": s(CASE_ID),
    "state": s("MONITORING"),
    "created_at": {"timestampValue": NOW},
    "updated_at": {"timestampValue": NOW},
    "wallet_address": s(SUBJECT),
    "chain": s(CHAIN),
    "theft_transaction_hash": s(MOVEMENT_TX),
    "owner_user_id": s("telegraph-demo"),
    "owner_email": s("telegraph-demo@example.com"),
    "is_public_case": {"booleanValue": True},
    "discovery": {"nullValue": None},
    "evidence": {"nullValue": None},
    "finding": {"nullValue": None},
    "error": {"nullValue": None},
    "demo_note": s(
        "Controlled Telegraph Track 3 demonstration case. The branch cursor is "
        "positioned one block behind a real historical Ethereum transfer so the "
        "monitoring path has verifiable movement to find, rather than waiting on "
        "new activity. Everything downstream is real: JSON-RPC verification, "
        "Telegraph routing, x402 payment, settlement and the persisted receipt. "
        "No claim of theft or wrongdoing is made about any address in this case. "
        "The addresses are ordinary mainnet addresses chosen only because the "
        "transfer between them is real and independently verifiable."
    ),
}

branch_fields = {
    "id": s(BRANCH_ID),
    "case_id": s(CASE_ID),
    "current_address": s(SUBJECT),
    "chain": s(CHAIN),
    "asset": s("native"),
    "amount": s(AMOUNT_WEI),
    "status": s("DORMANT"),
    "last_transaction": s("0x" + "00" * 32),
    "cursor_block": {"integerValue": str(BLOCK - 1)},
    "last_checked": {"timestampValue": NOW},
    "evidence_provenance": {"arrayValue": {"values": [s("controlled_demo_seed")]}},
    "parent_branch_id": {"nullValue": None},
    "depth": {"integerValue": "1"},
    "terminal_reason": s("AWAITING_CONTROLLED_MOVEMENT"),
    "attribution": {"nullValue": None},
}

access = token()
write("cases", CASE_ID, case_fields, access)
write("trace_branches", BRANCH_ID, branch_fields, access)
print(json.dumps({
    "database": DATABASE,
    "case": CASE_ID,
    "public": True,
    "branch": BRANCH_ID,
    "address": SUBJECT,
    "cursor_block": BLOCK - 1,
    "status": "DORMANT",
}, indent=2))
