// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GuardRailMarketplace} from "../src/GuardRailMarketplace.sol";

/// @notice Deploy GuardRailMarketplace to BSC testnet (chain 97) bound to the
///         real Altana KeyStore. Admin = the GuardRail owner wallet.
/// Usage:
///   forge script script/Deploy.s.sol:Deploy --rpc-url <rpc> \
///     --broadcast --private-key <adminPk>
contract Deploy is Script {
    function run() external {
        address keyStore = 0x6b8361C29d05D498b1a12B54A37310f94171E94A; // Altana BSC testnet KeyStore
        address admin = 0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97; // GuardRail owner wallet
        vm.startBroadcast();
        GuardRailMarketplace m = new GuardRailMarketplace(keyStore, admin);
        vm.stopBroadcast();
        console2.log("GuardRailMarketplace deployed:", address(m));
    }
}