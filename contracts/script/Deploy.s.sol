// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GuardRailMarketplace} from "../src/GuardRailMarketplace.sol";

/// @notice Deploy GuardRailMarketplace against the Altana KeyStore.
///         Chain 97 (BSC testnet): KeyStore 0x6b8361C29d05D498b1a12B54A37310f94171E94A
///         Chain 56 (BSC mainnet): KeyStore 0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a
///         ADMIN = deployer by default; set GUARDRAIL_ADMIN to override.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("GUARDRAIL_DEPLOYER_PK");

        address keyStore;
        if (block.chainid == 97) {
            keyStore = 0x6b8361C29d05D498b1a12B54A37310f94171E94A;
        } else if (block.chainid == 56) {
            keyStore = 0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a;
        } else {
            revert("unsupported chain");
        }

        address admin = vm.envOr("GUARDRAIL_ADMIN", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);
        GuardRailMarketplace marketplace = new GuardRailMarketplace(keyStore, admin);
        vm.stopBroadcast();

        console2.log("GuardRailMarketplace deployed at:", address(marketplace));
        console2.log("KeyStore:", keyStore);
        console2.log("Admin:", admin);
    }
}
