// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPriceOracle {
    function getPrices(address market) external view returns (bool valid, uint256 startPrice, uint256 endPrice);
}
