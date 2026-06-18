// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IFrontendRegistry} from "./IFrontendRegistry.sol";

contract FrontendRegistry is IFrontendRegistry {
    struct Frontend {
        address owner;
        address payout;
        string metadataURI;
        bool active;
    }

    mapping(uint256 => Frontend) public frontends;

    event FrontendRegistered(uint256 indexed frontendId, address indexed owner, address indexed payout, string metadataURI);
    event FrontendUpdated(uint256 indexed frontendId, address indexed payout, string metadataURI, bool active);

    error FrontendAlreadyRegistered();
    error FrontendNotRegistered();
    error NotFrontendOwner();
    error InvalidPayout();

    function registerFrontend(uint256 frontendId, address payout, string calldata metadataURI) external {
        if (frontends[frontendId].owner != address(0)) revert FrontendAlreadyRegistered();
        if (payout == address(0)) revert InvalidPayout();

        frontends[frontendId] = Frontend({
            owner: msg.sender,
            payout: payout,
            metadataURI: metadataURI,
            active: true
        });

        emit FrontendRegistered(frontendId, msg.sender, payout, metadataURI);
    }

    function updateFrontend(uint256 frontendId, address payout, string calldata metadataURI, bool active) external {
        Frontend storage frontend = frontends[frontendId];
        if (frontend.owner == address(0)) revert FrontendNotRegistered();
        if (frontend.owner != msg.sender) revert NotFrontendOwner();
        if (payout == address(0)) revert InvalidPayout();

        frontend.payout = payout;
        frontend.metadataURI = metadataURI;
        frontend.active = active;

        emit FrontendUpdated(frontendId, payout, metadataURI, active);
    }

    function isActive(uint256 frontendId) external view returns (bool) {
        return frontends[frontendId].active;
    }
}
