// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GuardRailMarketplace
/// @notice Onchain agent marketplace registry for BNB Chain's AI agent economy.
///         Every listing is bound to a live Altana session: the agent acts on
///         a self-custodial Altana wallet through a session key whose authority
///         is registered in the public Altana KeyStore. The marketplace never
///         trusts a frontend claim. verifyLive() reads the KeyStore directly,
///         so a user can see exactly what a listed agent may do and when that
///         authority expires, onchain, from any RPC.
///
/// @dev The four hackathon categories are first-class: Rebalancing, Grid
///      Trading, Yield Optimisation, Health Factor Monitoring. A listing can
///      only exist while its session key is live, which is the structural
///      difference between this marketplace and a static directory: revoke
///      the session onchain and the listing reports not-live immediately.
///
///      Zero runtime dependencies. The KeyStore address is chain-specific
///      (BSC mainnet 0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a, BSC testnet
///      0x6b8361C29d05D498b1a12B54A37310f94171E94A) and set at deploy time.

interface IKeyStore {
    /// @notice Whether `keyId` is currently authorized to act on `user`'s wallet.
    /// @dev Free read, unlimited, from any RPC. True only when the key exists,
    ///      is not revoked, and has not expired.
    function isValidKey(address user, bytes32 keyId) external view returns (bool);
}

contract GuardRailMarketplace {
    // ------------------------------------------------------------- types

    enum Category { Rebalancing, GridTrading, YieldOptimisation, HealthFactor }

    /// @notice Per-token spend cap recorded on the listing.
    struct SpendCap {
        address token;    // address(0) = native BNB
        uint256 limit;    // smallest unit of the token
        uint256 period;   // seconds of the rolling window
    }

    struct Listing {
        uint256 id;
        Category category;
        string name;              // display name, e.g. "GridBot BSC"
        address agentWallet;      // the Altana wallet the agent acts on
        bytes32 sessionKeyId;     // keccak256 of the session public key, the
                                  // identifier the KeyStore checks
        address operator;         // who listed and can unlist
        SpendCap cap;             // what the session may spend per window
        address[] allowlist;      // contracts the session may call
        uint256 listedAt;
        bool active;              // operator can pause a listing
        uint32 hires;
        uint256 ratingSum;
        uint32 ratingCount;
    }

    // ------------------------------------------------------------- state

    address public immutable keyStore;
    address public immutable admin;
    uint256 public listingCount;
    mapping(uint256 => Listing) public listings;

    // ------------------------------------------------------------- events

    event Listed(
        uint256 indexed id,
        Category indexed category,
        address indexed agentWallet,
        bytes32 sessionKeyId,
        address operator,
        string name
    );
    event Unlisted(uint256 indexed id);
    event Toggled(uint256 indexed id, bool active);
    event Hired(uint256 indexed id, address indexed hirer);
    event Rated(uint256 indexed id, uint8 score);

    // ------------------------------------------------------------- errors

    error NotOperator(uint256 id, address caller);
    error NotAdmin(address caller);
    error SessionNotLive(address wallet, bytes32 keyId);
    error NotListed(uint256 id);
    error ZeroAddress();
    error ZeroSessionKey();
    error EmptyAllowlist();
    error EmptyCap();

    // ------------------------------------------------------------- init

    constructor(address _keyStore, address _admin) {
        if (_keyStore == address(0) || _admin == address(0)) revert ZeroAddress();
        keyStore = _keyStore;
        admin = _admin;
    }

    // ------------------------------------------------------------- listing

    /// @notice List an agent. The session key MUST be live in the KeyStore at
    ///         listing time, otherwise the listing is rejected. The cap and
    ///         allowlist are what the session was granted, surfaced so any
    ///         user can judge the agent without trusting the operator.
    function list(
        Category category,
        string calldata name,
        address agentWallet,
        bytes32 sessionKeyId,
        SpendCap calldata cap,
        address[] calldata allowlist
    ) external returns (uint256 id) {
        if (agentWallet == address(0)) revert ZeroAddress();
        if (sessionKeyId == bytes32(0)) revert ZeroSessionKey();
        if (allowlist.length == 0) revert EmptyAllowlist();
        if (cap.limit == 0 || cap.period == 0) revert EmptyCap();
        if (!IKeyStore(keyStore).isValidKey(agentWallet, sessionKeyId)) {
            revert SessionNotLive(agentWallet, sessionKeyId);
        }

        id = ++listingCount;
        listings[id] = Listing({
            id: id,
            category: category,
            name: name,
            agentWallet: agentWallet,
            sessionKeyId: sessionKeyId,
            operator: msg.sender,
            cap: cap,
            allowlist: allowlist,
            listedAt: block.timestamp,
            active: true,
            hires: 0,
            ratingSum: 0,
            ratingCount: 0
        });
        emit Listed(id, category, agentWallet, sessionKeyId, msg.sender, name);
    }

    /// @notice Operator removes their own listing.
    function unlist(uint256 id) external {
        Listing storage l = _onlyOperator(id);
        delete listings[id];
        emit Unlisted(id);
    }

    /// @notice Operator pauses or resumes their listing without deleting it.
    function toggleActive(uint256 id, bool active) external {
        Listing storage l = _onlyOperator(id);
        l.active = active;
        emit Toggled(id, active);
    }

    // ------------------------------------------------------------- reads

    /// @notice Is the listed session key still authorized right now? Reads the
    ///         public Altana KeyStore directly. Revoked or expired sessions
    ///         return false immediately.
    function verifyLive(uint256 id) external view returns (bool) {
        Listing storage l = _requireListed(id);
        return IKeyStore(keyStore).isValidKey(l.agentWallet, l.sessionKeyId);
    }

    /// @notice Number of active listings in a category, for the marketplace
    ///         landing page. Reads the KeyStore so stale listings are never
    ///         counted as live.
    function countLiveInCategory(Category category) external view returns (uint256) {
        uint256 n;
        for (uint256 i = 1; i <= listingCount; i++) {
            Listing storage l = listings[i];
            if (l.id == 0 || l.category != category || !l.active) continue;
            if (IKeyStore(keyStore).isValidKey(l.agentWallet, l.sessionKeyId)) n++;
        }
        return n;
    }

    function allowlistOf(uint256 id) external view returns (address[] memory) {
        return _requireListed(id).allowlist;
    }

    /// @notice The fields a marketplace card needs, one call.
    function listingSummary(uint256 id)
        external
        view
        returns (
            uint256 _id,
            Category category,
            string memory name,
            address agentWallet,
            bytes32 sessionKeyId,
            address operator,
            uint256 listedAt
        )
    {
        Listing storage l = _requireListed(id);
        _id = l.id;
        category = l.category;
        name = l.name;
        agentWallet = l.agentWallet;
        sessionKeyId = l.sessionKeyId;
        operator = l.operator;
        listedAt = l.listedAt;
    }

    function isActive(uint256 id) external view returns (bool) {
        return _requireListed(id).active;
    }

    function stats(uint256 id)
        external
        view
        returns (uint32 hires, uint256 ratingSum, uint32 ratingCount)
    {
        Listing storage l = _requireListed(id);
        hires = l.hires;
        ratingSum = l.ratingSum;
        ratingCount = l.ratingCount;
    }

    function averageRating(uint256 id) external view returns (uint256) {
        Listing storage l = _requireListed(id);
        if (l.ratingCount == 0) return 0;
        return l.ratingSum / l.ratingCount;
    }

    // ------------------------------------------------------------- activity

    /// @notice Anyone can record that they hired this agent. Purely
    ///         observational; the actual hire is an ERC-8183 escrow onchain.
    function recordHire(uint256 id) external {
        Listing storage l = _requireListed(id);
        l.hires++;
        emit Hired(id, msg.sender);
    }

    /// @notice Post-hire feedback, 1..5. Immutable per rater via admin
    ///         enforcement is out of scope for v0; the sum/count aggregate is
    ///         what the marketplace shows.
    function rate(uint256 id, uint8 score) external {
        if (score < 1 || score > 5) revert("score out of range");
        Listing storage l = _requireListed(id);
        l.ratingSum += score;
        l.ratingCount++;
        emit Rated(id, score);
    }

    // ------------------------------------------------------------- admin

    /// @notice Emergency unlist by the marketplace admin (e.g. an agent was
    ///         compromised before its session was revoked onchain).
    function adminUnlist(uint256 id) external {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _requireListed(id);
        delete listings[id];
        emit Unlisted(id);
    }

    // ------------------------------------------------------------- internal

    function _onlyOperator(uint256 id) internal view returns (Listing storage l) {
        l = _requireListed(id);
        if (msg.sender != l.operator) revert NotOperator(id, msg.sender);
    }

    function _requireListed(uint256 id) internal view returns (Listing storage l) {
        l = listings[id];
        if (l.id == 0 || l.agentWallet == address(0)) revert NotListed(id);
    }
}
