// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GuardRailMarketplace} from "../src/GuardRailMarketplace.sol";
import {MockKeyStore} from "./mocks/MockKeyStore.sol";

contract GuardRailMarketplaceTest is Test {
    GuardRailMarketplace public marketplace;
    MockKeyStore public keyStore;

    address public admin = makeAddr("admin");
    address public operator = makeAddr("operator");
    address public hirer = makeAddr("hirer");
    address public attacker = makeAddr("attacker");

    address public agentWallet = makeAddr("agentWallet");
    bytes32 public sessionKeyId = keccak256("session-public-key");
    bytes32 public deadKeyId = keccak256("revoked-session-key");

    address public router = makeAddr("router");
    address public usdt = makeAddr("USDT");

    GuardRailMarketplace.SpendCap internal cap =
        GuardRailMarketplace.SpendCap({token: address(0), limit: 0.1 ether, period: 1 days});

    function setUp() public {
        keyStore = new MockKeyStore();
        marketplace = new GuardRailMarketplace(address(keyStore), admin);

        keyStore.addKey(agentWallet, sessionKeyId, block.timestamp + 7 days);
        keyStore.addKey(agentWallet, deadKeyId, block.timestamp + 7 days);
        keyStore.revokeKey(agentWallet, deadKeyId);
    }

    function _allowlist() internal view returns (address[] memory list) {
        list = new address[](2);
        list[0] = router;
        list[1] = usdt;
    }

    // ------------------------------------------------------------ listing

    function test_ListWithLiveSession() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.Rebalancing,
            "GridBot BSC",
            agentWallet,
            sessionKeyId,
            cap,
            _allowlist()
        );

        assertEq(id, 1);
        assertEq(marketplace.listingCount(), 1);

        (uint256 _id, GuardRailMarketplace.Category cat, string memory name, address w, bytes32 keyId,,) =
            marketplace.listingSummary(id);
        assertEq(_id, 1);
        assertEq(uint256(cat), uint256(GuardRailMarketplace.Category.Rebalancing));
        assertEq(name, "GridBot BSC");
        assertEq(w, agentWallet);
        assertEq(keyId, sessionKeyId);
    }

    function test_ListRejectsDeadSession() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                GuardRailMarketplace.SessionNotLive.selector, agentWallet, deadKeyId
            )
        );
        marketplace.list(
            GuardRailMarketplace.Category.GridTrading,
            "Dead Bot",
            agentWallet,
            deadKeyId,
            cap,
            _allowlist()
        );
    }

    function test_ListRejectsEmptyAllowlist() public {
        address[] memory empty;
        vm.prank(operator);
        vm.expectRevert(GuardRailMarketplace.EmptyAllowlist.selector);
        marketplace.list(
            GuardRailMarketplace.Category.GridTrading, "No allow", agentWallet, sessionKeyId, cap, empty
        );
    }

    function test_ListRejectsZeroCap() public {
        GuardRailMarketplace.SpendCap memory zeroCap =
            GuardRailMarketplace.SpendCap({token: address(0), limit: 0, period: 1 days});
        vm.prank(operator);
        vm.expectRevert(GuardRailMarketplace.EmptyCap.selector);
        marketplace.list(
            GuardRailMarketplace.Category.GridTrading, "No cap", agentWallet, sessionKeyId, zeroCap, _allowlist()
        );
    }

    function test_ListRejectsZeroKey() public {
        vm.prank(operator);
        vm.expectRevert(GuardRailMarketplace.ZeroSessionKey.selector);
        marketplace.list(
            GuardRailMarketplace.Category.GridTrading, "No key", agentWallet, bytes32(0), cap, _allowlist()
        );
    }

    // ------------------------------------------------------------ all four categories

    function test_AllFourCategoriesCanList() public {
        address[4] memory wallets = [makeAddr("w1"), makeAddr("w2"), makeAddr("w3"), makeAddr("w4")];
        for (uint256 i = 0; i < 4; i++) {
            keyStore.addKey(wallets[i], sessionKeyId, block.timestamp + 1 days);
            vm.prank(operator);
            marketplace.list(
                GuardRailMarketplace.Category(i), "Cat agent", wallets[i], sessionKeyId, cap, _allowlist()
            );
        }
        assertEq(marketplace.listingCount(), 4);
        for (uint256 i = 0; i < 4; i++) {
            assertEq(marketplace.countLiveInCategory(GuardRailMarketplace.Category(i)), 1);
        }
    }

    // ------------------------------------------------------------ verifyLive

    function test_VerifyLiveTrueWhileKeyLive() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.YieldOptimisation, "Yield", agentWallet, sessionKeyId, cap, _allowlist()
        );
        assertTrue(marketplace.verifyLive(id));
    }

    function test_VerifyLiveFalseAfterRevoke() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.YieldOptimisation, "Yield", agentWallet, sessionKeyId, cap, _allowlist()
        );

        // Admin revokes the session key onchain (the one-tx Altana revoke).
        keyStore.revokeKey(agentWallet, sessionKeyId);

        assertFalse(marketplace.verifyLive(id));
    }

    function test_VerifyLiveFalseAfterExpiry() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.YieldOptimisation, "Yield", agentWallet, sessionKeyId, cap, _allowlist()
        );

        // Session expires (7-day expiry from setUp). The listing reports dead.
        vm.warp(block.timestamp + 8 days);

        assertFalse(marketplace.verifyLive(id));
    }

    // ------------------------------------------------------------ operator control

    function test_OnlyOperatorCanUnlist() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.GridTrading, "Grid", agentWallet, sessionKeyId, cap, _allowlist()
        );

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(GuardRailMarketplace.NotOperator.selector, id, attacker));
        marketplace.unlist(id);

        vm.prank(operator);
        marketplace.unlist(id);
        assertEq(marketplace.listingCount(), 1); // count never decrements, listing deleted
    }

    function test_OperatorCanToggleActive() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.HealthFactor, "Health", agentWallet, sessionKeyId, cap, _allowlist()
        );

        vm.prank(operator);
        marketplace.toggleActive(id, false);
        assertFalse(marketplace.isActive(id));

        vm.prank(operator);
        marketplace.toggleActive(id, true);
        assertTrue(marketplace.isActive(id));
    }

    // ------------------------------------------------------------ ratings and hires

    function test_RateAndAverage() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.Rebalancing, "LP Guard", agentWallet, sessionKeyId, cap, _allowlist()
        );

        vm.prank(hirer);
        marketplace.rate(id, 4);
        vm.prank(hirer);
        marketplace.rate(id, 5);

        assertEq(marketplace.averageRating(id), 4); // (4+5)/2 truncates
        (uint32 _hires, uint256 ratingSum, uint32 ratingCount) = marketplace.stats(id);
        assertEq(_hires, 0);
        assertEq(ratingSum, 9);
        assertEq(ratingCount, 2);
    }

    function test_RateOutOfRangeReverts() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.Rebalancing, "LP Guard", agentWallet, sessionKeyId, cap, _allowlist()
        );
        vm.prank(hirer);
        vm.expectRevert("score out of range");
        marketplace.rate(id, 6);
    }

    function test_RecordHire() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.GridTrading, "Grid", agentWallet, sessionKeyId, cap, _allowlist()
        );
        vm.prank(hirer);
        marketplace.recordHire(id);
        (uint32 hires,,) = marketplace.stats(id);
        assertEq(hires, 1);
    }

    // ------------------------------------------------------------ admin

    function test_AdminEmergencyUnlist() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.GridTrading, "Grid", agentWallet, sessionKeyId, cap, _allowlist()
        );

        vm.prank(admin);
        marketplace.adminUnlist(id);

        vm.expectRevert(abi.encodeWithSelector(GuardRailMarketplace.NotListed.selector, id));
        marketplace.verifyLive(id);
    }

    function test_NonAdminCannotEmergencyUnlist() public {
        vm.prank(operator);
        uint256 id = marketplace.list(
            GuardRailMarketplace.Category.GridTrading, "Grid", agentWallet, sessionKeyId, cap, _allowlist()
        );

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(GuardRailMarketplace.NotAdmin.selector, attacker));
        marketplace.adminUnlist(id);
    }
}
