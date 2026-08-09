// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";

/// @notice Proves the GuardRail ERC-8183 hire flow end to end against the
///         LIVE BSC mainnet deployment, on a fork. Testnet's router currently
///         has an empty policy whitelist (verified onchain: policyWhitelist
///         returns false there, true on mainnet), so the same five calls are
///         exercised here where the deployment is complete.
///
///         Buyer -> createJob + registerJob + setBudget + approve $U + fund
///         is exactly the atomic batch the SDK's hireErc8183Agent builds.
///         Run: forge test --match-contract HireForkTest --fork-url https://bsc-rpc.publicnode.com
interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ICommerce {
    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        uint8 status;
        address hook;
        uint256 submittedAt;
        bytes32 deliverable;
    }
    function createJob(address provider, address evaluator, uint256 expiredAt, string calldata description, address hook) external returns (uint256);
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external;
    function getJob(uint256 jobId) external view returns (Job memory);
    function jobCounter() external view returns (uint256);
}

interface IRouter {
    function registerJob(uint256 jobId, address policy) external;
    function policyWhitelist(address policy) external view returns (bool);
}

interface IPolicy {
    function disputeWindow() external view returns (uint64);
}

contract HireForkTest is Test {
    // BSC mainnet ERC-8183 stack (from the bnbagent SDK manifest).
    address internal constant COMMERCE = 0xEa4DAa3100A767e86FDed867729ae7446476EBA6;
    address internal constant ROUTER = 0x51895229E12F9876011789B04f8698af06cCD6DA;
    address internal constant POLICY = 0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5;
    address internal constant U = 0xcE24439F2D9C6a2289F741120FE202248B666666;

    address internal buyer = makeAddr("buyer");
    address internal provider = makeAddr("provider");

    function setUp() public {
        // These tests fork LIVE mainnet state. Guard against a local run
        // without --fork-url so plain `forge test` stays green.
        if (block.chainid != 56) {
            vm.skip(true);
            return;
        }
        // The deployment is live and the canonical policy IS whitelisted on
        // mainnet (this is the exact precondition testnet is missing).
        assertTrue(IRouter(ROUTER).policyWhitelist(POLICY), "policy should be whitelisted on mainnet");
    }

    function test_HireFlowEndToEnd() public {
        console2.log("TEST START");
        // Deal $U to the buyer with Foundry's ERC-20 deal cheatcode (it finds
        // the token's storage layout automatically, including proxies).
        uint256 budget = 0.1 ether; // 0.1 $U, 18 decimals
        deal(U, buyer, budget);
        assertEq(IERC20(U).balanceOf(buyer), budget, "buyer funded with $U");

        uint256 jobCounterBefore = ICommerce(COMMERCE).jobCounter();
        uint256 jobId = jobCounterBefore + 1;
        uint256 expiredAt = block.timestamp + uint256(IPolicy(POLICY).disputeWindow()) + 1800;

        vm.startPrank(buyer);
        // 1. createJob — Router is evaluator + hook (the deployment pattern).
        uint256 created = ICommerce(COMMERCE).createJob(provider, ROUTER, expiredAt, "GuardRail hire: rebalance my LP position", ROUTER);
        assertEq(created, jobId, "jobId matches predicted counter+1");
        // 2. registerJob — binds the whitelisted OptimisticPolicy.
        IRouter(ROUTER).registerJob(jobId, POLICY);
        // 3. setBudget
        ICommerce(COMMERCE).setBudget(jobId, budget, "");
        // 4. approve $U to the kernel
        IERC20(U).approve(COMMERCE, budget);
        // 5. fund
        ICommerce(COMMERCE).fund(jobId, budget, "");
        vm.stopPrank();

        // The escrow is live: status 1 = FUNDED.
        ICommerce.Job memory job = ICommerce(COMMERCE).getJob(jobId);
        console2.log("id", job.id, "expected", jobId);
        console2.log("client", job.client, "expected", buyer);
        console2.log("provider", job.provider, "expected", provider);
        console2.log("budget", job.budget, "expected", budget);
        console2.log("status", uint256(job.status));
        assertEq(job.id, jobId, "job id matches");
        assertEq(job.client, buyer, "buyer is the client");
        assertEq(job.provider, provider, "provider is the agent");
        assertEq(job.budget, budget, "budget escrowed");
        assertEq(uint256(job.status), 1, "job status is FUNDED");

        // Escrow actually holds the $U.
        assertGe(IERC20(U).balanceOf(COMMERCE), budget, "kernel holds the escrow");
    }

    function test_PolicyWhitelistedOnMainnet() public view {
        assertTrue(IRouter(ROUTER).policyWhitelist(POLICY));
        assertTrue(COMMERCE.code.length > 0);
        assertTrue(ROUTER.code.length > 0);
        assertTrue(U.code.length > 0);
    }
}
