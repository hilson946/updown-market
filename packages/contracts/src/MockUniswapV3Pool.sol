// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IUniswapV3Pool} from "./IUniswapV3Pool.sol";

contract MockUniswapV3Pool is IUniswapV3Pool {
    address public immutable override token0;
    address public immutable override token1;
    uint128 public override liquidity;
    bool public shouldRevertObserve;

    mapping(uint32 => bool) public hasCumulative;
    mapping(uint32 => int56) public cumulativeBySecondsAgo;

    constructor(address token0_, address token1_, uint128 liquidity_) {
        require(token0_ != address(0), "token0 zero");
        require(token1_ != address(0), "token1 zero");
        require(token0_ != token1_, "tokens equal");
        token0 = token0_;
        token1 = token1_;
        liquidity = liquidity_;
    }

    function setLiquidity(uint128 liquidity_) external {
        liquidity = liquidity_;
    }

    function setShouldRevertObserve(bool shouldRevertObserve_) external {
        shouldRevertObserve = shouldRevertObserve_;
    }

    function setCumulative(uint32 secondsAgo, int56 cumulative) external {
        hasCumulative[secondsAgo] = true;
        cumulativeBySecondsAgo[secondsAgo] = cumulative;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        override
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(!shouldRevertObserve, "OBSERVE_REVERT");

        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            require(hasCumulative[secondsAgos[i]], "OBSERVATION_MISSING");
            tickCumulatives[i] = cumulativeBySecondsAgo[secondsAgos[i]];
        }
    }
}
