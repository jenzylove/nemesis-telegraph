"""A victim who only knows their wallet must not have to name the theft transaction.

Ambiguity is a statement about ranking, not about evidence. When two verified
outflows score closely, the investigation continues from the strongest one,
labelled provisional, with the runners-up retained. What must never happen is
the case stopping to ask a victim which hex string was the theft.
"""
import asyncio
from datetime import datetime, timezone

import pytest

from app.incident_selection import rank_verified_candidates
from app.models import DiscoveryCandidate, ERC20Transfer, IncidentDiscovery, NormalizedTransaction

WALLET = "0x" + "11" * 20
CALLER = "0x" + "22" * 20
DEST = "0x" + "33" * 20
TOKEN = "0x" + "44" * 20


def transaction(tx_hash):
    return NormalizedTransaction(
        hash=tx_hash, chain="ethereum", block_number=1,
        timestamp=datetime.now(timezone.utc), status="success",
        from_address=CALLER, to_address=DEST, native_value_wei="0", input="0x23b872dd",
        erc20_transfers=[ERC20Transfer(log_index=0, token_contract=TOKEN, from_address=WALLET, to_address=DEST, raw_amount="1")],
    )


def discovery(scores):
    candidates = [
        DiscoveryCandidate(transaction_hash="0x" + f"{i:064x}", block_number=i, score=score)
        for i, score in enumerate(scores, 1)
    ]
    return IncidentDiscovery(source="alchemy", candidate_count=len(candidates), candidates=candidates)


class Provider:
    async def get_normalized_transaction(self, chain, tx_hash):
        await asyncio.sleep(0)
        return transaction(tx_hash)


@pytest.mark.asyncio
async def test_a_clear_winner_still_selects_exactly_as_before():
    """The confident path must be untouched by this change."""
    item = discovery([120, 40])
    result = await rank_verified_candidates(Provider(), "ethereum", WALLET, item)
    assert result is not None
    assert item.status == "SELECTED"
    assert item.ambiguity_reason is None
    assert item.selected_transaction_hash == result.hash.lower()
    assert item.incident_selection_confidence >= 0.70


@pytest.mark.asyncio
async def test_a_near_tie_continues_provisionally_instead_of_blocking():
    item = discovery([70, 69])
    result = await rank_verified_candidates(Provider(), "ethereum", WALLET, item)

    # The investigation has something real to trace from.
    assert result is not None, "a near tie must not stop the case"
    assert item.status == "PROVISIONAL_INCIDENT"
    assert item.selected_transaction_hash == result.hash.lower()

    # And it is honest about why.
    assert item.incident_selection_confidence < 0.70
    assert item.ambiguity_reason and "strongest" in item.ambiguity_reason
    assert "confident selection" in item.ambiguity_reason


@pytest.mark.asyncio
async def test_the_provisional_pick_is_the_highest_scoring_verified_candidate():
    item = discovery([60, 71, 69])
    result = await rank_verified_candidates(Provider(), "ethereum", WALLET, item)
    top = max(item.candidates, key=lambda c: c.score)
    assert result.hash.lower() == top.transaction_hash.lower()


@pytest.mark.asyncio
async def test_runner_up_candidates_survive_for_the_override_path():
    item = discovery([70, 69, 68])
    await rank_verified_candidates(Provider(), "ethereum", WALLET, item)
    assert len(item.candidates) >= 3
    assert all(c.selection_confidence is not None for c in item.candidates)
    assert "2 other verified outflows are retained" in item.ambiguity_reason


@pytest.mark.asyncio
async def test_a_provisional_pick_still_proves_the_transaction_is_real():
    """Provisional means "which one", never "whether this is a real outflow"."""
    item = discovery([70, 69])
    result = await rank_verified_candidates(Provider(), "ethereum", WALLET, item)
    assert result.status == "success"
    assert any(t.from_address == WALLET for t in result.erc20_transfers)


@pytest.mark.asyncio
async def test_nothing_verifiable_still_refuses_rather_than_inventing_a_case():
    """The one thing that must still stop: no candidate with real outflow."""

    class NoOutflow(Provider):
        async def get_normalized_transaction(self, chain, tx_hash):
            tx = transaction(tx_hash)
            tx.erc20_transfers = []
            return tx

    item = discovery([70, 69])
    with pytest.raises(ValueError):
        await rank_verified_candidates(NoOutflow(), "ethereum", WALLET, item)
