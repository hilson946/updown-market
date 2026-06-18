// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IFrontendRegistry {
    function isActive(uint256 frontendId) external view returns (bool);
}
