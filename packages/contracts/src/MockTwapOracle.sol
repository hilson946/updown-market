// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPriceOracle} from "./IPriceOracle.sol";

contract MockTwapOracle is IPriceOracle {
    struct Prices {
        bool valid;
        uint256 startPrice;
        uint256 endPrice;
    }

    mapping(address => Prices) public prices;

    event PricesSet(address indexed market, bool valid, uint256 startPrice, uint256 endPrice);

    function setPrices(address market, uint256 startPrice, uint256 endPrice, bool valid) external {
        prices[market] = Prices({
            valid: valid,
            startPrice: startPrice,
            endPrice: endPrice
        });
        emit PricesSet(market, valid, startPrice, endPrice);
    }

    function getPrices(address market) external view override returns (bool valid, uint256 startPrice, uint256 endPrice) {
        Prices memory value = prices[market];
        return (value.valid, value.startPrice, value.endPrice);
    }
}
