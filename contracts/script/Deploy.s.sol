// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GuardRailMarketplace} from "../src/GuardRailMarketplace.sol";

/// @notice Deploys GuardRailMarketplace. Pass keyStore + admin as env:
///   KEYSTORE=0x... ADMIN=0x... forge script script/Deploy.s.sol --rpc-url <url> --broadcast
contract Deploy is Script {
    function run() external {
        address keyStore = vm.envAddress("KEYSTORE");
        address admin = vm.envAddress("ADMIN");
        vm.startBroadcast();
        GuardRailMarketplace m = new GuardRailMarketplace(keyStore, admin);
        vm.stopBroadcast();
        console2.log("GuardRailMarketplace deployed at:", address(m));
    }
}
