// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IOracleMarket {
    function tradingStart() external view returns (uint256);
    function predictionStart() external view returns (uint256);
    function predictionEnd() external view returns (uint256);
}
