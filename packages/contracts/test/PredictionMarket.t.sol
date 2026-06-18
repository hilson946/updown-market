// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockUSDC} from "../src/MockUSDC.sol";
import {FrontendRegistry} from "../src/FrontendRegistry.sol";
import {MockTwapOracle} from "../src/MockTwapOracle.sol";
import {PredictionMarketFactory} from "../src/PredictionMarketFactory.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
    function expectRevert(bytes4 selector) external;
}

contract PredictionMarketTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant CAROL_PK = 0xCA901;
    uint8 internal constant UP = 1;
    uint8 internal constant DOWN = 2;
    uint256 internal constant SECP256K1_HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    MockUSDC internal usdc;
    FrontendRegistry internal registry;
    MockTwapOracle internal oracle;
    PredictionMarketFactory internal factory;
    PredictionMarket internal market;

    address internal alice;
    address internal bob;
    address internal carol;
    address internal feeVault = address(0xFEE);

    uint256 internal start;

    function setUp() public {
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        carol = vm.addr(CAROL_PK);

        usdc = new MockUSDC();
        registry = new FrontendRegistry();
        oracle = new MockTwapOracle();
        factory = new PredictionMarketFactory(address(usdc), address(oracle), address(registry), feeVault, 50);

        registry.registerFrontend(1, address(this), "ipfs://frontend");

        start = block.timestamp + 310;
        market = PredictionMarket(
            factory.createMarket(keccak256("ETH/USDC"), "ETH/USDC", start, 300)
        );

        usdc.mint(alice, 1_000e6);
        usdc.mint(bob, 1_000e6);
        usdc.mint(carol, 1_000e6);

        vm.prank(alice);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(market), type(uint256).max);
    }

    function testMarketWindowUsesPreviousFullDurationPlusGrace() public view {
        assertEq(market.tradingStart(), start - 300, "trading start");
        assertEq(market.tradingEnd(), start + 5, "trading end");
        assertEq(market.predictionStart(), start, "prediction start");
        assertEq(market.predictionEnd(), start + 300, "prediction end");
    }

    function testFiveMinuteMarketAcceptsPreviousWindowThroughFiveSecondGrace() public {
        vm.warp(market.tradingStart() - 1);
        PredictionMarket.BetIntent memory earlyIntent = _intent(
            alice,
            UP,
            100e6,
            0,
            1,
            address(0),
            1,
            block.timestamp + 60
        );
        bytes memory earlySig = _sign(market, earlyIntent, ALICE_PK);

        vm.expectRevert(PredictionMarket.TradingNotOpen.selector);
        market.betWithSig(earlyIntent, earlySig);

        vm.warp(market.tradingStart());
        _bet(market, ALICE_PK, UP, 100e6, 0, 1, address(0), 1);

        vm.warp(market.predictionStart() + 4);
        _bet(market, BOB_PK, DOWN, 100e6, 0, 1, address(0), 1);

        vm.warp(market.tradingEnd());
        PredictionMarket.BetIntent memory intent = _intent(
            carol,
            UP,
            100e6,
            0,
            1,
            address(0),
            1,
            block.timestamp + 60
        );
        bytes memory sig = _sign(market, intent, CAROL_PK);

        vm.expectRevert(PredictionMarket.TradingNotOpen.selector);
        market.betWithSig(intent, sig);
    }

    function testNonceReplayFails() public {
        vm.warp(start);
        PredictionMarket.BetIntent memory intent = _intent(
            alice,
            UP,
            100e6,
            0,
            1,
            address(0),
            7,
            block.timestamp + 60
        );
        bytes memory sig = _sign(market, intent, ALICE_PK);

        market.betWithSig(intent, sig);

        vm.expectRevert(PredictionMarket.NonceAlreadyUsed.selector);
        market.betWithSig(intent, sig);
    }

    function testRelayerCannotTamperWithSignedBet() public {
        vm.warp(start);
        PredictionMarket.BetIntent memory signedIntent = _intent(
            alice,
            UP,
            100e6,
            0,
            1,
            address(0),
            9,
            block.timestamp + 60
        );
        bytes memory sig = _sign(market, signedIntent, ALICE_PK);

        PredictionMarket.BetIntent memory tampered = signedIntent;
        tampered.direction = DOWN;

        vm.expectRevert(PredictionMarket.InvalidSignature.selector);
        market.betWithSig(tampered, sig);
    }

    function testUnregisteredFrontendRejected() public {
        vm.warp(start);
        PredictionMarket.BetIntent memory intent = _intent(
            alice,
            UP,
            100e6,
            0,
            999,
            address(0),
            1,
            block.timestamp + 60
        );
        bytes memory sig = _sign(market, intent, ALICE_PK);

        vm.expectRevert(PredictionMarket.InvalidFrontend.selector);
        market.betWithSig(intent, sig);
    }

    function testInactiveFrontendRejected() public {
        registry.updateFrontend(1, address(this), "ipfs://disabled", false);

        vm.warp(start);
        PredictionMarket.BetIntent memory intent = _intent(
            alice,
            UP,
            100e6,
            0,
            1,
            address(0),
            1,
            block.timestamp + 60
        );
        bytes memory sig = _sign(market, intent, ALICE_PK);

        vm.expectRevert(PredictionMarket.InvalidFrontend.selector);
        market.betWithSig(intent, sig);
    }

    function testHighSSignatureRejected() public {
        vm.warp(start);
        PredictionMarket.BetIntent memory intent = _intent(
            alice,
            UP,
            100e6,
            0,
            1,
            address(0),
            1,
            block.timestamp + 60
        );
        bytes memory badSig = abi.encodePacked(bytes32(uint256(1)), bytes32(SECP256K1_HALF_ORDER + 1), uint8(27));

        vm.expectRevert(PredictionMarket.InvalidSignature.selector);
        market.betWithSig(intent, badSig);
    }

    function testPoolCapExceeded() public {
        vm.warp(start);
        uint256 cappedAmount = market.MAX_TOTAL_POOL() + 1;
        PredictionMarket.BetIntent memory intent = _intent(
            alice,
            UP,
            cappedAmount,
            0,
            1,
            address(0),
            1,
            block.timestamp + 60
        );
        bytes memory signature = _sign(market, intent, ALICE_PK);

        vm.expectRevert(PredictionMarket.PoolCapExceeded.selector);
        market.previewPayout(UP, cappedAmount);

        vm.expectRevert(PredictionMarket.PoolCapExceeded.selector);
        market.betWithSig(intent, signature);
    }

    function testUpWinsAndClaimPaysWinner() public {
        vm.warp(start);
        _bet(market, ALICE_PK, UP, 100e6, 0, 1, address(0), 1);
        _bet(market, BOB_PK, DOWN, 100e6, 0, 1, address(0), 1);

        oracle.setPrices(address(market), 2_000e8, 2_100e8, true);
        vm.warp(market.predictionEnd());
        market.settle();

        uint256 beforeBalance = usdc.balanceOf(alice);
        vm.prank(alice);
        market.claim();
        uint256 afterBalance = usdc.balanceOf(alice);

        assertEq(market.winningDirection(), UP, "winning direction");
        assertEq(afterBalance - beforeBalance, 199e6, "winner payout");
        assertEq(usdc.balanceOf(feeVault), 1e6, "fee");
    }

    function testDownWins() public {
        vm.warp(start);
        _bet(market, ALICE_PK, UP, 100e6, 0, 1, address(0), 1);
        _bet(market, BOB_PK, DOWN, 100e6, 0, 1, address(0), 1);

        oracle.setPrices(address(market), 2_000e8, 1_900e8, true);
        vm.warp(market.predictionEnd());
        market.settle();

        assertEq(market.winningDirection(), DOWN, "winning direction");
        assertEq(market.claimable(bob), 199e6, "claimable");
    }

    function testEqualPriceTriggersRefund() public {
        vm.warp(start);
        _bet(market, ALICE_PK, UP, 100e6, 0, 1, address(0), 1);
        _bet(market, BOB_PK, DOWN, 100e6, 0, 1, address(0), 1);

        oracle.setPrices(address(market), 2_000e8, 2_000e8, true);
        vm.warp(market.predictionEnd());
        market.settle();

        assertEq(uint256(market.status()), uint256(PredictionMarket.Status.Refunding), "status");

        uint256 beforeBalance = usdc.balanceOf(alice);
        vm.prank(alice);
        market.refund();
        assertEq(usdc.balanceOf(alice) - beforeBalance, 100e6, "refund amount");
    }

    function testOneSidedPoolTriggersRefund() public {
        vm.warp(start);
        _bet(market, ALICE_PK, UP, 100e6, 0, 1, address(0), 1);

        oracle.setPrices(address(market), 2_000e8, 2_100e8, true);
        vm.warp(market.predictionEnd());
        market.settle();

        assertEq(uint256(market.status()), uint256(PredictionMarket.Status.Refunding), "status");
    }

    function testClaimCannotRunTwice() public {
        vm.warp(start);
        _bet(market, ALICE_PK, UP, 100e6, 0, 1, address(0), 1);
        _bet(market, BOB_PK, DOWN, 100e6, 0, 1, address(0), 1);
        oracle.setPrices(address(market), 2_000e8, 2_100e8, true);
        vm.warp(market.predictionEnd());
        market.settle();

        vm.prank(alice);
        market.claim();
        vm.prank(alice);
        vm.expectRevert(PredictionMarket.AlreadyClaimed.selector);
        market.claim();
    }

    function testClaimForPaysUserNotRelayer() public {
        vm.warp(start);
        _bet(market, ALICE_PK, UP, 100e6, 0, 1, address(0), 1);
        _bet(market, BOB_PK, DOWN, 100e6, 0, 1, address(0), 1);
        oracle.setPrices(address(market), 2_000e8, 2_100e8, true);
        vm.warp(market.predictionEnd());
        market.settle();

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 relayerBefore = usdc.balanceOf(address(this));

        market.claimFor(alice);

        assertEq(usdc.balanceOf(alice) - aliceBefore, 199e6, "user paid");
        assertEq(usdc.balanceOf(address(this)), relayerBefore, "relayer not paid");
    }

    function testFrontendAndReferrerAttribution() public {
        vm.warp(start);
        _bet(market, ALICE_PK, UP, 123e6, 0, 1, carol, 1);

        assertEq(market.frontendVolume(1), 123e6, "frontend volume");
        assertEq(market.referrerVolume(carol), 123e6, "referrer volume");
    }

    function testNewFactoryDoesNotAffectExistingMarketFee() public {
        PredictionMarketFactory v2 = new PredictionMarketFactory(address(usdc), address(oracle), address(registry), feeVault, 100);
        address newMarket = v2.createMarket(keccak256("ETH/USDC"), "ETH/USDC", block.timestamp + 400, 300);

        assertEq(market.feeBps(), 50, "v1 fee unchanged");
        assertEq(PredictionMarket(newMarket).feeBps(), 100, "v2 fee");
    }

    function _bet(
        PredictionMarket target,
        uint256 privateKey,
        uint8 direction,
        uint256 amount,
        uint256 minExpectedPayout,
        uint256 frontendId,
        address referrer,
        uint256 nonce
    ) internal {
        address user = vm.addr(privateKey);
        PredictionMarket.BetIntent memory intent = _intent(
            user,
            direction,
            amount,
            minExpectedPayout,
            frontendId,
            referrer,
            nonce,
            block.timestamp + 60
        );
        target.betWithSig(intent, _sign(target, intent, privateKey));
    }

    function _intent(
        address user,
        uint8 direction,
        uint256 amount,
        uint256 minExpectedPayout,
        uint256 frontendId,
        address referrer,
        uint256 nonce,
        uint256 deadline
    ) internal pure returns (PredictionMarket.BetIntent memory) {
        return PredictionMarket.BetIntent({
            user: user,
            direction: direction,
            amount: amount,
            minExpectedPayout: minExpectedPayout,
            frontendId: frontendId,
            referrer: referrer,
            nonce: nonce,
            deadline: deadline
        });
    }

    function _sign(PredictionMarket target, PredictionMarket.BetIntent memory intent, uint256 privateKey)
        internal
        returns (bytes memory)
    {
        bytes32 digest = target.hashBetIntent(intent);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function assertEq(uint256 actual, uint256 expected, string memory reason) internal pure {
        require(actual == expected, reason);
    }

    function assertEq(address actual, address expected, string memory reason) internal pure {
        require(actual == expected, reason);
    }
}
