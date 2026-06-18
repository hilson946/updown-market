// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockUSDC} from "../src/MockUSDC.sol";
import {FrontendRegistry} from "../src/FrontendRegistry.sol";
import {MockUniswapV3Pool} from "../src/MockUniswapV3Pool.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {PredictionMarketFactory} from "../src/PredictionMarketFactory.sol";
import {UniswapV3TwapOracleAdapter} from "../src/UniswapV3TwapOracleAdapter.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
    function expectRevert(bytes4 selector) external;
}

contract UniswapV3TwapOracleAdapterTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant BASE = address(0xBEEF);
    uint8 internal constant UP = 1;
    uint8 internal constant DOWN = 2;

    MockUSDC internal usdc;
    FrontendRegistry internal registry;
    UniswapV3TwapOracleAdapter internal adapter;
    PredictionMarketFactory internal factory;
    PredictionMarket internal market;
    MockUniswapV3Pool internal pool;

    uint256 internal start;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new FrontendRegistry();
        adapter = new UniswapV3TwapOracleAdapter(address(this));
        factory = new PredictionMarketFactory(address(usdc), address(adapter), address(registry), address(this), 50);

        start = block.timestamp + 310;
        market = PredictionMarket(factory.createMarket(keccak256("ETH/USDC"), "ETH/USDC", start, 300));
        pool = new MockUniswapV3Pool(BASE, address(usdc), 1_000_000);

        address[] memory pools = new address[](1);
        pools[0] = address(pool);
        adapter.configureMarket(address(market), BASE, address(usdc), pools, 30, 100);
    }

    function testSinglePoolUp() public {
        _setPoolTicks(pool, 100, 250);

        (bool valid, uint256 startPrice, uint256 endPrice) = _pricesAtSettlement();

        assertTrue(valid, "valid");
        assertEq(startPrice, 1_000_100, "start score");
        assertEq(endPrice, 1_000_250, "end score");
        assertTrue(endPrice > startPrice, "up");
    }

    function testSinglePoolDown() public {
        _setPoolTicks(pool, 250, 100);

        (bool valid, uint256 startPrice, uint256 endPrice) = _pricesAtSettlement();

        assertTrue(valid, "valid");
        assertTrue(endPrice < startPrice, "down");
    }

    function testReverseTokenOrderNormalizesTick() public {
        MockUniswapV3Pool reversePool = new MockUniswapV3Pool(address(usdc), BASE, 1_000_000);
        PredictionMarket reverseMarket =
            PredictionMarket(factory.createMarket(keccak256("ETH/USDC/REV"), "ETH/USDC REV", start, 300));

        address[] memory pools = new address[](1);
        pools[0] = address(reversePool);
        adapter.configureMarket(address(reverseMarket), BASE, address(usdc), pools, 30, 100);

        _setPoolTicks(reversePool, -100, -250);
        vm.warp(reverseMarket.predictionEnd());
        (bool valid, uint256 startPrice, uint256 endPrice) = adapter.getPrices(address(reverseMarket));

        assertTrue(valid, "valid");
        assertEq(startPrice, 1_000_100, "start score");
        assertEq(endPrice, 1_000_250, "end score");
    }

    function testMedianAcrossMultiplePools() public {
        MockUniswapV3Pool pool2 = new MockUniswapV3Pool(BASE, address(usdc), 1_000_000);
        MockUniswapV3Pool pool3 = new MockUniswapV3Pool(BASE, address(usdc), 1_000_000);
        PredictionMarket medianMarket =
            PredictionMarket(factory.createMarket(keccak256("ETH/USDC/MED"), "ETH/USDC MED", start, 300));

        address[] memory pools = new address[](3);
        pools[0] = address(pool);
        pools[1] = address(pool2);
        pools[2] = address(pool3);
        adapter.configureMarket(address(medianMarket), BASE, address(usdc), pools, 30, 100);

        _setPoolTicks(pool, 100, 400);
        _setPoolTicks(pool2, 110, 250);
        _setPoolTicks(pool3, 90, 10);

        vm.warp(medianMarket.predictionEnd());
        (bool valid, uint256 startPrice, uint256 endPrice) = adapter.getPrices(address(medianMarket));

        assertTrue(valid, "valid");
        assertEq(startPrice, 1_000_100, "start median");
        assertEq(endPrice, 1_000_250, "end median");
    }

    function testInsufficientLiquidityInvalidatesMarketPrice() public {
        pool.setLiquidity(99);
        _setPoolTicks(pool, 100, 250);

        (bool valid,,) = _pricesAtSettlement();

        assertTrue(!valid, "invalid");
    }

    function testCannotConfigureTwice() public {
        address[] memory pools = new address[](1);
        pools[0] = address(pool);

        vm.expectRevert(UniswapV3TwapOracleAdapter.AlreadyConfigured.selector);
        adapter.configureMarket(address(market), BASE, address(usdc), pools, 30, 100);
    }

    function testCannotConfigureAfterTradingStarts() public {
        PredictionMarket lateMarket =
            PredictionMarket(factory.createMarket(keccak256("ETH/USDC/LATE"), "ETH/USDC LATE", start, 300));
        address[] memory pools = new address[](1);
        pools[0] = address(pool);

        vm.warp(start);
        vm.expectRevert(UniswapV3TwapOracleAdapter.TradingAlreadyStarted.selector);
        adapter.configureMarket(address(lateMarket), BASE, address(usdc), pools, 30, 100);
    }

    function _pricesAtSettlement() internal returns (bool valid, uint256 startPrice, uint256 endPrice) {
        vm.warp(market.predictionEnd());
        return adapter.getPrices(address(market));
    }

    function _setPoolTicks(MockUniswapV3Pool targetPool, int24 startTick, int24 endTick) internal {
        targetPool.setCumulative(330, 0);
        targetPool.setCumulative(300, int56(startTick) * 30);
        targetPool.setCumulative(30, 0);
        targetPool.setCumulative(0, int56(endTick) * 30);
    }

    function assertEq(uint256 actual, uint256 expected, string memory reason) internal pure {
        require(actual == expected, reason);
    }

    function assertTrue(bool condition, string memory reason) internal pure {
        require(condition, reason);
    }
}
