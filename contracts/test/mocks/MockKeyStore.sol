// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockKeyStore
/// @notice Test double for the Altana KeyStore. Mirrors the real onchain
///         semantics that the marketplace depends on: isValidKey returns true
///         only when the key exists, is not revoked, and has not expired.
///         Revocation drops the key immediately; expiry does not remove it
///         from storage but flips the validity answer.

contract MockKeyStore {
    struct KeyRecord {
        bool exists;
        bool revoked;
        uint256 expiry;
    }

    mapping(address wallet => mapping(bytes32 keyId => KeyRecord)) public keys;

    /// @notice Register a session key for a wallet with an expiry.
    function addKey(address wallet, bytes32 keyId, uint256 expiry) external {
        keys[wallet][keyId] = KeyRecord({exists: true, revoked: false, expiry: expiry});
    }

    /// @notice Simulate the admin revoking a session key.
    function revokeKey(address wallet, bytes32 keyId) external {
        KeyRecord storage k = keys[wallet][keyId];
        k.revoked = true;
        k.expiry = 0;
    }

    /// @notice The exact function GuardRailMarketplace calls on the real
    ///         Altana KeyStore.
    function isValidKey(address wallet, bytes32 keyId) external view returns (bool) {
        KeyRecord storage k = keys[wallet][keyId];
        if (!k.exists || k.revoked) return false;
        if (k.expiry != 0 && block.timestamp >= k.expiry) return false;
        return true;
    }
}
