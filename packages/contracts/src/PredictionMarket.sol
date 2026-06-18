// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./IERC20.sol";
import {IFrontendRegistry} from "./IFrontendRegistry.sol";
import {IPriceOracle} from "./IPriceOracle.sol";

contract PredictionMarket {
    uint8 public constant DIRECTION_UP = 1;
    uint8 public constant DIRECTION_DOWN = 2;
    uint16 public constant BPS = 10_000;
    uint256 public constant TRADING_GRACE_SECONDS = 5;
    uint256 public constant MAX_TOTAL_POOL = type(uint128).max;

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant BET_INTENT_TYPEHASH = keccak256(
        "BetIntent(address user,uint8 direction,uint256 amount,uint256 minExpectedPayout,uint256 frontendId,address referrer,uint256 nonce,uint256 deadline)"
    );
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    enum Status {
        Pending,
        Trading,
        Locked,
        Settled,
        Refunding
    }

    struct BetIntent {
        address user;
        uint8 direction;
        uint256 amount;
        uint256 minExpectedPayout;
        uint256 frontendId;
        address referrer;
        uint256 nonce;
        uint256 deadline;
    }

    IERC20 public immutable collateral;
    IPriceOracle public immutable oracle;
    IFrontendRegistry public immutable frontendRegistry;
    address public immutable feeVault;
    address public immutable factory;
    bytes32 public immutable assetId;
    string public assetSymbol;
    uint256 public immutable tradingStart;
    uint256 public immutable tradingEnd;
    uint256 public immutable predictionStart;
    uint256 public immutable predictionEnd;
    uint256 public immutable predictionDuration;
    uint16 public immutable feeBps;

    Status public status;
    uint8 public winningDirection;
    uint256 public startPrice;
    uint256 public endPrice;
    uint256 public feeAmount;
    uint256 public totalUp;
    uint256 public totalDown;
    uint256 private reentrancyLock = 1;

    mapping(address => mapping(uint8 => uint256)) public stakes;
    mapping(address => bool) public claimed;
    mapping(address => bool) public refunded;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(uint256 => uint256) public frontendVolume;
    mapping(address => uint256) public referrerVolume;

    event BetPlaced(
        address indexed user,
        uint8 indexed direction,
        uint256 amount,
        uint256 frontendId,
        address indexed referrer,
        uint256 nonce
    );
    event Settled(uint8 indexed winningDirection, uint256 startPrice, uint256 endPrice, uint256 feeAmount);
    event RefundEnabled(string reason);
    event Claimed(address indexed user, uint256 amount);
    event Refunded(address indexed user, uint256 amount);

    error TradingNotOpen();
    error InvalidDirection();
    error InvalidAmount();
    error InvalidSignature();
    error InvalidFrontend();
    error SignatureExpired();
    error NonceAlreadyUsed();
    error SlippageExceeded();
    error NotReadyToSettle();
    error AlreadyFinalized();
    error NotSettled();
    error NotRefunding();
    error NothingToClaim();
    error AlreadyClaimed();
    error AlreadyRefunded();
    error TransferFailed();
    error Reentrancy();
    error PoolCapExceeded();

    modifier nonReentrant() {
        if (reentrancyLock != 1) revert Reentrancy();
        reentrancyLock = 2;
        _;
        reentrancyLock = 1;
    }

    constructor(
        address collateral_,
        address oracle_,
        address frontendRegistry_,
        address feeVault_,
        bytes32 assetId_,
        string memory assetSymbol_,
        uint256 predictionStart_,
        uint256 predictionDuration_,
        uint16 feeBps_
    ) {
        require(collateral_ != address(0), "collateral zero");
        require(oracle_ != address(0), "oracle zero");
        require(frontendRegistry_ != address(0), "registry zero");
        require(feeVault_ != address(0), "feeVault zero");
        require(predictionDuration_ >= 5, "duration too short");
        require(predictionStart_ >= predictionDuration_, "prediction start too early");

        collateral = IERC20(collateral_);
        oracle = IPriceOracle(oracle_);
        frontendRegistry = IFrontendRegistry(frontendRegistry_);
        feeVault = feeVault_;
        factory = msg.sender;
        assetId = assetId_;
        assetSymbol = assetSymbol_;
        predictionDuration = predictionDuration_;
        tradingStart = predictionStart_ - predictionDuration_;
        predictionStart = predictionStart_;
        tradingEnd = predictionStart_ + TRADING_GRACE_SECONDS;
        predictionEnd = predictionStart_ + predictionDuration_;
        feeBps = feeBps_;
        status = Status.Trading;
    }

    function betWithSig(BetIntent calldata intent, bytes calldata signature) external nonReentrant {
        if (block.timestamp < tradingStart || block.timestamp >= tradingEnd || status != Status.Trading) {
            revert TradingNotOpen();
        }
        if (intent.deadline < block.timestamp) revert SignatureExpired();
        if (intent.direction != DIRECTION_UP && intent.direction != DIRECTION_DOWN) revert InvalidDirection();
        if (intent.amount == 0) revert InvalidAmount();
        if (intent.amount > MAX_TOTAL_POOL || totalPool() > MAX_TOTAL_POOL - intent.amount) revert PoolCapExceeded();
        if (!frontendRegistry.isActive(intent.frontendId)) revert InvalidFrontend();
        if (usedNonces[intent.user][intent.nonce]) revert NonceAlreadyUsed();

        bytes32 digest = hashBetIntent(intent);
        if (_recover(digest, signature) != intent.user) revert InvalidSignature();

        uint256 preview = previewPayout(intent.direction, intent.amount);
        if (preview < intent.minExpectedPayout) revert SlippageExceeded();

        usedNonces[intent.user][intent.nonce] = true;
        stakes[intent.user][intent.direction] += intent.amount;
        frontendVolume[intent.frontendId] += intent.amount;
        if (intent.referrer != address(0)) {
            referrerVolume[intent.referrer] += intent.amount;
        }

        if (intent.direction == DIRECTION_UP) {
            totalUp += intent.amount;
        } else {
            totalDown += intent.amount;
        }

        if (!collateral.transferFrom(intent.user, address(this), intent.amount)) revert TransferFailed();

        emit BetPlaced(intent.user, intent.direction, intent.amount, intent.frontendId, intent.referrer, intent.nonce);
    }

    function settle() external nonReentrant {
        if (status == Status.Settled || status == Status.Refunding) revert AlreadyFinalized();
        if (block.timestamp < predictionEnd) revert NotReadyToSettle();

        (bool valid, uint256 oracleStart, uint256 oracleEnd) = oracle.getPrices(address(this));
        startPrice = oracleStart;
        endPrice = oracleEnd;

        if (!valid || oracleStart == 0 || oracleEnd == 0) {
            _enableRefund("ORACLE_INVALID");
            return;
        }
        if (oracleStart == oracleEnd) {
            _enableRefund("PRICE_TIE");
            return;
        }
        if (totalUp == 0 || totalDown == 0) {
            _enableRefund("ONE_SIDED_POOL");
            return;
        }

        winningDirection = oracleEnd > oracleStart ? DIRECTION_UP : DIRECTION_DOWN;
        status = Status.Settled;
        feeAmount = ((totalUp + totalDown) * feeBps) / BPS;

        if (feeAmount > 0 && !collateral.transfer(feeVault, feeAmount)) revert TransferFailed();

        emit Settled(winningDirection, oracleStart, oracleEnd, feeAmount);
    }

    function claim() external {
        claimFor(msg.sender);
    }

    function claimFor(address user) public nonReentrant {
        if (status != Status.Settled) revert NotSettled();
        if (claimed[user]) revert AlreadyClaimed();

        uint256 amount = claimable(user);
        if (amount == 0) revert NothingToClaim();

        claimed[user] = true;
        if (!collateral.transfer(user, amount)) revert TransferFailed();

        emit Claimed(user, amount);
    }

    function refund() external {
        refundFor(msg.sender);
    }

    function refundFor(address user) public nonReentrant {
        if (status != Status.Refunding) revert NotRefunding();
        if (refunded[user]) revert AlreadyRefunded();

        uint256 amount = stakes[user][DIRECTION_UP] + stakes[user][DIRECTION_DOWN];
        if (amount == 0) revert NothingToClaim();

        refunded[user] = true;
        if (!collateral.transfer(user, amount)) revert TransferFailed();

        emit Refunded(user, amount);
    }

    function currentStatus() external view returns (Status) {
        if (status == Status.Settled || status == Status.Refunding) return status;
        if (block.timestamp < tradingStart) return Status.Pending;
        if (block.timestamp < tradingEnd) return Status.Trading;
        return Status.Locked;
    }

    function totalPool() public view returns (uint256) {
        return totalUp + totalDown;
    }

    function winnerPool() public view returns (uint256) {
        if (winningDirection == DIRECTION_UP) return totalUp;
        if (winningDirection == DIRECTION_DOWN) return totalDown;
        return 0;
    }

    function previewPayout(uint8 direction, uint256 amount) public view returns (uint256) {
        if (direction != DIRECTION_UP && direction != DIRECTION_DOWN) revert InvalidDirection();
        if (amount == 0) return 0;
        if (amount > MAX_TOTAL_POOL || totalPool() > MAX_TOTAL_POOL - amount) revert PoolCapExceeded();

        uint256 totalAfter = totalPool() + amount;
        uint256 feeAfter = (totalAfter * feeBps) / BPS;
        uint256 directionPoolAfter = (direction == DIRECTION_UP ? totalUp : totalDown) + amount;

        return (amount * (totalAfter - feeAfter)) / directionPoolAfter;
    }

    function claimable(address user) public view returns (uint256) {
        if (status != Status.Settled || winningDirection == 0) return 0;
        uint256 userStake = stakes[user][winningDirection];
        if (userStake == 0) return 0;
        return (userStake * (totalPool() - feeAmount)) / winnerPool();
    }

    function hashBetIntent(BetIntent calldata intent) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                BET_INTENT_TYPEHASH,
                intent.user,
                intent.direction,
                intent.amount,
                intent.minExpectedPayout,
                intent.frontendId,
                intent.referrer,
                intent.nonce,
                intent.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("UpDownPredictionMarket")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _enableRefund(string memory reason) internal {
        status = Status.Refunding;
        emit RefundEnabled(reason);
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        if (uint256(s) > SECP256K1_HALF_ORDER) revert InvalidSignature();

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
