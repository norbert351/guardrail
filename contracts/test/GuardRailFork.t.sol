// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GuardRailMarketplace} from "../src/GuardRailMarketplace.sol";

/// @notice Fork test against LIVE BSC testnet (chain 97). Proves the
///         marketplace reads the REAL Altana KeyStore deployment, not a mock.
///         Run with:
///           forge test --match-contract ForkTest --fork-url https://bsc-testnet-rpc.publicnode.com
///         Read-only, no gas required, no funding needed.
contract GuardRailForkTest is Test {
    // Real Altana BSC testnet deployment (chain 97), from the SDK config.
    address internal constant REAL_KEYSTORE = 0x6b8361C29d05D498b1a12B54A37310f94171E94A;
    // The live upgraded GuardRailMarketplace deployment on BSC testnet.
    address internal constant LIVE_MARKETPLACE = 0x0e111C58E488fE3647F0b45011Ba7334d163E566;
    address internal constant REAL_WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address internal admin = makeAddr("admin");

    GuardRailMarketplace public marketplace;

    function setUp() public {
        // Fork test against LIVE BSC testnet (chain 97). Guard against a
        // local run without --fork-url so plain `forge test` stays green.
        if (block.chainid != 97) {
            vm.skip(true);
            return;
        }
        // Deploy against the real KeyStore contract on the fork.
        marketplace = new GuardRailMarketplace(REAL_KEYSTORE, admin);
    }

    function test_KeyStoreIsTheRealDeployment() public {
        assertEq(marketplace.keyStore(), REAL_KEYSTORE);
        // The real KeyStore has code on BSC testnet (deployed by Altana).
        assertTrue(REAL_KEYSTORE.code.length > 0);
    }

    function test_VerifyLiveReadsRealKeyStore() public {
        // No listing exists: verifyLive on id 1 reverts NotListed.
        vm.expectRevert(abi.encodeWithSelector(GuardRailMarketplace.NotListed.selector, 1));
        marketplace.verifyLive(1);
    }

    function test_RealKeyStoreIsValidKeySemantics() public {
        // Plain read against the REAL Altana KeyStore on the fork: a random
        // key on a random wallet is not authorized.
        bytes32 randomKey = keccak256("no-such-agent");
        (bool ok, bytes memory ret) = REAL_KEYSTORE.call(
            abi.encodeWithSignature("isValidKey(address,bytes32)", address(0x1234), randomKey)
        );
        assertTrue(ok, "isValidKey call should not revert");
        bool result = abi.decode(ret, (bool));
        assertFalse(result, "unregistered key must not be valid");
    }

    function test_CountLiveInCategoryEmptyOnFork() public {
        // Fresh deploy: zero live agents in every category on the fork.
        for (uint256 i = 0; i < 4; i++) {
            assertEq(
                marketplace.countLiveInCategory(GuardRailMarketplace.Category(i)), 0
            );
        }
    }

    function test_WbnbIsDeployedOnTestnet() public {
        // Sanity check on the fork's chain state: WBNB testnet has code.
        assertTrue(REAL_WBNB.code.length > 0);
    }

    /// The upgraded marketplace is live on the fork and its new onchain views
    /// work against the REAL KeyStore, so the trust/scope layer is verifiable
    /// onchain, not just in local tests.
    function test_LiveMarketplaceTrustScore() public {
        // id 1 is the live LP Guardian listing; its live session must score > 0.
        (bool ok, bytes memory ret) = LIVE_MARKETPLACE.call(
            abi.encodeWithSignature("trustScore(uint256)", 1)
        );
        assertTrue(ok, "trustScore should not revert on a live listing");
        uint256 score = abi.decode(ret, (uint256));
        assertGt(score, 0, "live scoped listing should score above zero");
        assertLe(score, 100);
    }

    function test_LiveMarketplaceTrustScoreZeroForUnlisted() public {
        // Far out-of-range id: the live contract reverts NotListed.
        (bool ok,) = LIVE_MARKETPLACE.call(abi.encodeWithSignature("trustScore(uint256)", 9999));
        assertFalse(ok, "unlisted id must revert");
    }

    function test_LiveMarketplaceScopeAudit() public {
        (bool ok, bytes memory ret) = LIVE_MARKETPLACE.call(
            abi.encodeWithSignature("scopeAudit(uint256)", 1)
        );
        assertTrue(ok, "scopeAudit should not revert on a live listing");

        // Decode: agentWallet, keyId, capToken, capLimit, capPeriod, allowlist, active, live.
        (address agentWallet, bytes32 keyId, address capToken, uint256 capLimit, uint256 capPeriod, address[] memory allowlist, bool active, bool live) =
            abi.decode(ret, (address, bytes32, address, uint256, uint256, address[], bool, bool));

        assertEq(agentWallet, 0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97);
        assertTrue(keyId != bytes32(0));
        assertEq(capToken, address(0), "cap is in native BNB");
        assertEq(capLimit, 0.02 ether, "0.02 tBNB/day cap");
        assertEq(capPeriod, 86400, "1 day period");
        assertGt(allowlist.length, 0, "scoped allowlist present");
        assertTrue(active);
        assertTrue(live);
    }
}
