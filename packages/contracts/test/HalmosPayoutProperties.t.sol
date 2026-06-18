// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract HalmosPayoutProperties {
    uint16 internal constant MAX_FEE_BPS = 150;
    uint16 internal constant BPS = 10_000;
    int24 internal constant TICK_SCORE_OFFSET = 1_000_000;

    function check_FeeNeverExceedsPool(uint128 upPool, uint128 downPool, uint16 feeBps) public pure {
        if (feeBps > MAX_FEE_BPS) return;
        uint256 total = uint256(upPool) + uint256(downPool);
        uint256 fee = (total * feeBps) / BPS;
        assert(fee <= total);
    }

    function check_PoolCapAllowsOnlyUint128Total(uint128 currentPool, uint256 amount) public pure {
        uint256 maxTotalPool = type(uint128).max;
        bool wouldAccept = amount <= maxTotalPool && uint256(currentPool) <= maxTotalPool - amount;
        if (!wouldAccept) return;

        uint256 totalAfter = uint256(currentPool) + amount;
        assert(totalAfter <= maxTotalPool);
    }

    function check_TickScorePreservesOrdering(int24 startTick, int24 endTick) public pure {
        if (startTick <= -TICK_SCORE_OFFSET || endTick <= -TICK_SCORE_OFFSET) return;

        int256 rawStartScore = int256(startTick) + int256(TICK_SCORE_OFFSET);
        int256 rawEndScore = int256(endTick) + int256(TICK_SCORE_OFFSET);
        // casting to uint256 is safe because both raw scores are positive after the guards above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 startScore = uint256(rawStartScore);
        // casting to uint256 is safe because both raw scores are positive after the guards above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 endScore = uint256(rawEndScore);

        if (endTick > startTick) assert(endScore > startScore);
        if (endTick < startTick) assert(endScore < startScore);
        if (endTick == startTick) assert(endScore == startScore);
    }
}
