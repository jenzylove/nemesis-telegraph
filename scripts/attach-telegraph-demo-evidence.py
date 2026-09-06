"""Attach the already verified transaction to the isolated public demo case.

This intentionally updates only cases/NMS-TG-DEMO-002.evidence. It cannot
touch receipts, spend counters, branches, timeline events, jobs, or Pub/Sub.
"""
import os
import subprocess
import sys

import httpx

PROJECT = "nemesis-506114"
DATABASE = "nemesis-telegraph"
CASE_ID = "NMS-TG-DEMO-002"
TX = "0xbdab85894d981ba9e4b6aad7a024564d62a53a38c158c67224ed9b8b2905239b"
SOURCE = "0x663d98059d1c77e4d185f28b36e94f11120e5826"
DESTINATION = "0x927f4998eebb541eedbc7654960c9378a3fdd738"
AMOUNT = "22500505562000000000"


def firestore_value(item):
    if item is None:
        return {"nullValue": None}
    if isinstance(item, bool):
        return {"booleanValue": item}
    if isinstance(item, int):
        return {"integerValue": str(item)}
    if isinstance(item, list):
        return {"arrayValue": {"values": [firestore_value(value) for value in item]}}
    if isinstance(item, dict):
        return {"mapValue": {"fields": {key: firestore_value(value) for key, value in item.items()}}}
    return {"stringValue": str(item)}


access = subprocess.run(
    ["gcloud", "auth", "print-access-token"],
    capture_output=True,
    text=True,
    check=True,
    shell=(os.name == "nt"),
).stdout.strip()
if not access:
    sys.exit("gcloud returned no access token")

evidence = {
    "submitted_wallet": SOURCE,
    "transaction": {
        "hash": TX,
        "chain": "ethereum",
        "block_number": 25913380,
        "timestamp": "2026-09-05T19:59:47Z",
        "status": "success",
        "from_address": SOURCE,
        "to_address": DESTINATION,
        "native_value_wei": AMOUNT,
        "native_transfers": [{
            "from_address": SOURCE,
            "to_address": DESTINATION,
            "raw_amount": AMOUNT,
            "provenance": ["json_rpc", "transaction.native_value_wei", TX],
        }],
        "input": "0x",
        "erc20_transfers": [],
        "nft_transfers": [],
    },
}

url = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/"
    f"documents/cases/{CASE_ID}?updateMask.fieldPaths=evidence"
)
response = httpx.patch(
    url,
    headers={"Authorization": "Bearer " + access, "content-type": "application/json"},
    json={"fields": {"evidence": firestore_value(evidence)}},
    timeout=60.0,
)
if response.status_code >= 300:
    sys.exit(f"evidence update failed: {response.status_code} {response.text[:400]}")
print(f"updated only cases/{CASE_ID}.evidence in {DATABASE}")
