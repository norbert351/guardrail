// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GuardRailMarketplace} from "../src/GuardRailMarketplace.sol";

/// @notice Deploy GuardRailMarketplace v2 to BSC MAINNET (chain 56) bound to the
///         real Altana MAINNET KeyStore. Admin = the GuardRail owner wallet.
/// Usage:
///   forge script script/Deploy.Mainnet.s.sol:DeployMainnet --rpc-url <mainnet> \
///     --broadcast --private-key <adminPk>
contract DeployMainnet is Script {
    function run() external {
        address keyStore = 0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a; // Altana BSC MAINNET KeyStore
        address admin = 0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97; // GuardRail owner wallet (funded)
        vm.startBroadcast();
        GuardRailMarketplace m = new GuardRailMarketplace(keyStore, admin);
        vm.stopBroadcast();
        console2.log("GuardRailMarketplace v2 MAINNET deployed:", address(m));
    }
}