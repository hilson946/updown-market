// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IOracleMarket} from "./IOracleMarket.sol";
import {IPriceOracle} from "./IPriceOracle.sol";
import {IUniswapV3Pool} from "./IUniswapV3Pool.sol";

contract UniswapV3TwapOracleAdapter is IPriceOracle {
    uint256 public constant MAX_POOLS = 5;
    uint32 public constant MIN_TWAP_WINDOW = 10;
    uint32 public constant MAX_TWAP_WINDOW = 1 days;
    int24 public constant TICK_SCORE_OFFSET = 1_000_000;

    struct MarketConfig {
        bool configured;
        address baseToken;
        address quoteToken;
        uint32 twapWindow;
        uint128 minLiquidity;
        address[] pools;
    }

    address public immutable owner;
    mapping(address => MarketConfig) private marketConfigs;

    event MarketConfigured(
        address indexed market,
        address indexed baseToken,
        address indexed quoteToken,
        uint32 twapWindow,
        uint128 minLiquidity,
        address[] pools
    );

    error NotOwner();
    error AlreadyConfigured();
    error InvalidMarket();
    error InvalidTokenPair();
    error InvalidPoolCount();
    error InvalidWindow();
    error InvalidLiquidity();
    error TradingAlreadyStarted();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        require(owner_ != address(0), "owner zero");
        owner = owner_;
    }

    function configureMarket(
        address market,
        address baseToken,
        address quoteToken,
        address[] calldata pools,
        uint32 twapWindow,
        uint128 minLiquidity
    ) external onlyOwner {
        if (market == address(0)) revert InvalidMarket();
        if (marketConfigs[market].configured) revert AlreadyConfigured();
        if (baseToken == address(0) || quoteToken == address(0) || baseToken == quoteToken) {
            revert InvalidTokenPair();
        }
        if (pools.length == 0 || pools.length > MAX_POOLS) revert InvalidPoolCount();
        if (twapWindow < MIN_TWAP_WINDOW || twapWindow > MAX_TWAP_WINDOW) revert InvalidWindow();
        if (minLiquidity == 0) revert InvalidLiquidity();
        if (block.timestamp >= IOracleMarket(market).tradingStart()) revert TradingAlreadyStarted();

        for (uint256 i = 0; i < pools.length; i++) {
            IUniswapV3Pool pool = IUniswapV3Pool(pools[i]);
            address token0 = pool.token0();
            address token1 = pool.token1();
            bool matchesForward = token0 == baseToken && token1 == quoteToken;
            bool matchesReverse = token0 == quoteToken && token1 == baseToken;
            if (!matchesForward && !matchesReverse) revert InvalidTokenPair();
        }

        MarketConfig storage config = marketConfigs[market];
        config.configured = true;
        config.baseToken = baseToken;
        config.quoteToken = quoteToken;
        config.twapWindow = twapWindow;
        config.minLiquidity = minLiquidity;
        for (uint256 i = 0; i < pools.length; i++) {
            config.pools.push(pools[i]);
        }

        emit MarketConfigured(market, baseToken, quoteToken, twapWindow, minLiquidity, pools);
    }

    function getMarketConfig(address market)
        external
        view
        returns (
            bool configured,
            address baseToken,
            address quoteToken,
            uint32 twapWindow,
            uint128 minLiquidity,
            address[] memory pools
        )
    {
        MarketConfig storage config = marketConfigs[market];
        return (
            config.configured,
            config.baseToken,
            config.quoteToken,
            config.twapWindow,
            config.minLiquidity,
            config.pools
        );
    }

    function getPrices(address market) external view override returns (bool valid, uint256 startPrice, uint256 endPrice) {
        MarketConfig storage config = marketConfigs[market];
        if (!config.configured) return (false, 0, 0);

        IOracleMarket oracleMarket = IOracleMarket(market);
        uint256 predictionStart = oracleMarket.predictionStart();
        uint256 predictionEnd = oracleMarket.predictionEnd();
        if (block.timestamp < predictionEnd) return (false, 0, 0);

        (bool startValid, int24 startTick) = _medianTick(config, predictionStart);
        if (!startValid) return (false, 0, 0);
        (bool endValid, int24 endTick) = _medianTick(config, predictionEnd);
        if (!endValid) return (false, 0, 0);

        return (true, _tickScore(startTick), _tickScore(endTick));
    }

    function _medianTick(MarketConfig storage config, uint256 targetTimestamp)
        internal
        view
        returns (bool valid, int24 medianTick)
    {
        uint256 currentTimestamp = block.timestamp;
        if (currentTimestamp < targetTimestamp || targetTimestamp < config.twapWindow) {
            return (false, 0);
        }

        uint256 newerAgo256 = currentTimestamp - targetTimestamp;
        uint256 olderAgo256 = newerAgo256 + config.twapWindow;
        if (olderAgo256 > type(uint32).max) return (false, 0);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = _checkedUint32(olderAgo256);
        secondsAgos[1] = _checkedUint32(newerAgo256);

        int24[] memory ticks = new int24[](config.pools.length);
        for (uint256 i = 0; i < config.pools.length; i++) {
            (bool poolValid, int24 tick) = _normalizedPoolTick(
                config.pools[i],
                config.baseToken,
                config.minLiquidity,
                config.twapWindow,
                secondsAgos
            );
            if (!poolValid) return (false, 0);
            ticks[i] = tick;
        }

        _sortTicks(ticks);
        uint256 middle = ticks.length / 2;
        if (ticks.length % 2 == 1) {
            return (true, ticks[middle]);
        }

        int256 left = ticks[middle - 1];
        int256 right = ticks[middle];
        return (true, int24((left + right) / 2));
    }

    function _normalizedPoolTick(
        address poolAddress,
        address baseToken,
        uint128 minLiquidity,
        uint32 twapWindow,
        uint32[] memory secondsAgos
    ) internal view returns (bool valid, int24 normalizedTick) {
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);
        if (pool.liquidity() < minLiquidity) return (false, 0);

        try pool.observe(secondsAgos) returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        ) {
            if (tickCumulatives.length != 2 || secondsPerLiquidityCumulativeX128s.length != 2) return (false, 0);
            int56 delta = tickCumulatives[1] - tickCumulatives[0];
            int56 window = int56(uint56(twapWindow));
            int56 average = delta / window;
            if (delta < 0 && delta % window != 0) {
                average--;
            }
            if (average < type(int24).min || average > type(int24).max) return (false, 0);
            // casting to int24 is safe after the explicit range check above.
            // forge-lint: disable-next-line(unsafe-typecast)
            int24 avgTick = int24(average);

            return (true, pool.token0() == baseToken ? avgTick : -avgTick);
        } catch {
            return (false, 0);
        }
    }

    function _sortTicks(int24[] memory ticks) internal pure {
        for (uint256 i = 1; i < ticks.length; i++) {
            int24 key = ticks[i];
            uint256 j = i;
            while (j > 0 && ticks[j - 1] > key) {
                ticks[j] = ticks[j - 1];
                j--;
            }
            ticks[j] = key;
        }
    }

    function _tickScore(int24 tick) internal pure returns (uint256) {
        int256 score = int256(tick) + int256(TICK_SCORE_OFFSET);
        require(score > 0, "tick score underflow");
        // casting to uint256 is safe because score is explicitly positive.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(score);
    }

    function _checkedUint32(uint256 value) internal pure returns (uint32) {
        require(value <= type(uint32).max, "seconds ago overflow");
        // casting to uint32 is safe after the explicit max-value check above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(value);
    }
}
