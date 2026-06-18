// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PredictionMarket} from "./PredictionMarket.sol";

contract PredictionMarketFactory {
    uint16 public constant MAX_FEE_BPS = 150;

    address public immutable collateral;
    address public immutable oracle;
    address public immutable frontendRegistry;
    address public immutable feeVault;
    uint16 public immutable feeBps;

    address[] public markets;

    event MarketCreated(
        address indexed market,
        bytes32 indexed assetId,
        string assetSymbol,
        uint256 tradingStart,
        uint256 tradingEnd,
        uint256 predictionStart,
        uint256 predictionEnd,
        uint256 predictionDuration,
        uint16 feeBps
    );

    error FeeTooHigh();
    error InvalidDuration();
    error InvalidStart();
    error InvalidAddress();

    constructor(
        address collateral_,
        address oracle_,
        address frontendRegistry_,
        address feeVault_,
        uint16 feeBps_
    ) {
        if (
            collateral_ == address(0) || oracle_ == address(0) || frontendRegistry_ == address(0)
                || feeVault_ == address(0)
        ) revert InvalidAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        collateral = collateral_;
        oracle = oracle_;
        frontendRegistry = frontendRegistry_;
        feeVault = feeVault_;
        feeBps = feeBps_;
    }

    function createMarket(bytes32 assetId, string calldata assetSymbol, uint256 predictionStart, uint256 predictionDuration)
        external
        returns (address market)
    {
        if (predictionDuration < 5 || predictionDuration % 5 != 0) revert InvalidDuration();
        if (predictionStart <= block.timestamp || predictionStart < predictionDuration) revert InvalidStart();

        market = address(
            new PredictionMarket(
                collateral,
                oracle,
                frontendRegistry,
                feeVault,
                assetId,
                assetSymbol,
                predictionStart,
                predictionDuration,
                feeBps
            )
        );

        markets.push(market);

        emit MarketCreated(
            market,
            assetId,
            assetSymbol,
            PredictionMarket(market).tradingStart(),
            PredictionMarket(market).tradingEnd(),
            PredictionMarket(market).predictionStart(),
            PredictionMarket(market).predictionEnd(),
            predictionDuration,
            feeBps
        );
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function allMarkets() external view returns (address[] memory) {
        return markets;
    }
}
