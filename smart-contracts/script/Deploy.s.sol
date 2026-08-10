// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {UptimeAttestation} from "../src/UptimeAttestation.sol";
import {ReputationEscrow} from "../src/ReputationEscrow.sol";

/// @title Deploy
/// @notice Deploys the GridProof contract slice and writes a deployment manifest that
///         `packages/blockchain-client`'s `deploymentManifestSchema` can parse directly.
/// @dev Every network-specific value is read from the environment — there are no hardcoded
///      RPC URLs, chain IDs, or addresses in this script (Part 11 / deployment docs). Run with:
///
///      forge script script/Deploy.s.sol:Deploy \
///        --root smart-contracts --rpc-url "$BOTCHAIN_RPC_URL" --broadcast
///
///      Required env: GRIDPROOF_ADMIN_ADDRESS, GRIDPROOF_RELAYER_ADDRESS,
///      GRIDPROOF_NETWORK, and a signer (PRIVATE_KEY or --ledger/--account).
///      Optional env (with documented defaults): GRIDPROOF_EPOCH_DURATION_SECONDS,
///      GRIDPROOF_SLASH_POLICY_CAP, GRIDPROOF_MINIMUM_STAKE,
///      GRIDPROOF_WITHDRAW_COOLDOWN_SECONDS, GRIDPROOF_ZONE_IDS.
contract Deploy is Script {
    /// @dev Hourly epochs, matching `EPOCH_DURATION_MS` in the API pipeline service.
    uint64 private constant DEFAULT_EPOCH_DURATION_SECONDS = 3600;
    uint256 private constant DEFAULT_SLASH_POLICY_CAP = 0.5 ether;
    uint256 private constant DEFAULT_MINIMUM_STAKE = 0.1 ether;
    uint64 private constant DEFAULT_WITHDRAW_COOLDOWN_SECONDS = 3 days;

    struct Params {
        string network;
        address admin;
        address relayer;
        uint64 epochDurationSeconds;
        uint256 slashPolicyCap;
        uint256 minimumStake;
        uint64 withdrawCooldownSeconds;
        string[] zoneIds;
    }

    /// @notice Entry point for `forge script`: reads configuration from the environment.
    function run() external returns (NodeRegistry registry, UptimeAttestation attestation, ReputationEscrow escrow) {
        return deploy(readParams());
    }

    /// @notice Deploys with explicit parameters.
    /// @dev Separated from `run()` so tests can drive it deterministically. `vm.setEnv` mutates
    ///      process-global state that forge does not roll back between concurrently executed
    ///      test cases, so env-driven tests race; taking `Params` avoids that entirely.
    function deploy(
        Params memory p
    ) public returns (NodeRegistry registry, UptimeAttestation attestation, ReputationEscrow escrow) {
        require(p.admin != address(0), "GRIDPROOF_ADMIN_ADDRESS must not be the zero address");
        require(p.relayer != address(0), "GRIDPROOF_RELAYER_ADDRESS must not be the zero address");
        require(p.epochDurationSeconds > 0, "GRIDPROOF_EPOCH_DURATION_SECONDS must be > 0");

        vm.startBroadcast();

        registry = new NodeRegistry(p.admin);
        attestation = new UptimeAttestation(p.admin, p.relayer, p.epochDurationSeconds);
        escrow = new ReputationEscrow(
            p.admin, p.relayer, address(registry), p.slashPolicyCap, p.minimumStake, p.withdrawCooldownSeconds
        );

        // Seed the zone allowlist so providers can register immediately after deploy.
        // Only possible while the broadcasting account still holds DEFAULT_ADMIN_ROLE.
        // `vm.readCallers()` reports the sender override installed by `vm.startBroadcast()`,
        // so it reflects the account transactions are sent from rather than whoever called
        // `deploy()`. An external self-call would read the same value but requires
        // `address(this)`, which forge rejects outright in script contracts.
        (, address broadcastSender,) = vm.readCallers();
        bool canSeedZones = p.admin == broadcastSender;
        if (p.zoneIds.length > 0 && canSeedZones) {
            for (uint256 i = 0; i < p.zoneIds.length; i++) {
                registry.addZone(keccak256(bytes(p.zoneIds[i])));
            }
        }

        vm.stopBroadcast();

        _writeManifest(p, address(registry), address(attestation), address(escrow));

        if (p.zoneIds.length > 0 && !canSeedZones) {
            console2.log("WARNING: GRIDPROOF_ZONE_IDS ignored - broadcaster is not the admin.");
            console2.log("Call NodeRegistry.addZone from the admin multisig for each zone.");
        }
    }

    /// @notice Reads deploy parameters from the environment.
    function readParams() public view returns (Params memory p) {
        p.network = vm.envString("GRIDPROOF_NETWORK");
        p.admin = vm.envAddress("GRIDPROOF_ADMIN_ADDRESS");
        p.relayer = vm.envAddress("GRIDPROOF_RELAYER_ADDRESS");
        p.epochDurationSeconds =
            uint64(vm.envOr("GRIDPROOF_EPOCH_DURATION_SECONDS", uint256(DEFAULT_EPOCH_DURATION_SECONDS)));
        p.slashPolicyCap = vm.envOr("GRIDPROOF_SLASH_POLICY_CAP", DEFAULT_SLASH_POLICY_CAP);
        p.minimumStake = vm.envOr("GRIDPROOF_MINIMUM_STAKE", DEFAULT_MINIMUM_STAKE);
        p.withdrawCooldownSeconds =
            uint64(vm.envOr("GRIDPROOF_WITHDRAW_COOLDOWN_SECONDS", uint256(DEFAULT_WITHDRAW_COOLDOWN_SECONDS)));

        string memory zoneCsv = vm.envOr("GRIDPROOF_ZONE_IDS", string(""));
        p.zoneIds = bytes(zoneCsv).length > 0 ? vm.split(zoneCsv, ",") : new string[](0);
    }

    /// @dev Field order and string-encoded numerics mirror `deploymentManifestSchema` exactly:
    ///      chainId and every `params` value are decimal strings, timestamps are ISO-8601 UTC.
    function _writeManifest(
        Params memory p,
        address registry,
        address attestation,
        address escrow
    ) private {
        string memory dir = string.concat(vm.projectRoot(), "/deployments");
        vm.createDir(dir, true);
        string memory path = string.concat(dir, "/", p.network, ".json");

        // Appended in small steps: one large `string.concat` overflows the stack under solc 0.8.24.
        string memory json = string.concat('{\n  "network": "', p.network, '",\n');
        json = string.concat(json, '  "chainId": "', vm.toString(block.chainid), '",\n');
        json = string.concat(json, '  "deployedAt": "', _isoTimestamp(), '",\n');
        json = string.concat(json, '  "admin": "', vm.toString(p.admin), '",\n');
        json = string.concat(json, '  "relayer": "', vm.toString(p.relayer), '",\n');
        json = string.concat(json, '  "contracts": {\n');
        json = string.concat(json, '    "NodeRegistry": "', vm.toString(registry), '",\n');
        json = string.concat(json, '    "UptimeAttestation": "', vm.toString(attestation), '",\n');
        json = string.concat(json, '    "ReputationEscrow": "', vm.toString(escrow), '"\n');
        json = string.concat(json, "  },\n");
        json = string.concat(json, '  "params": {\n');
        json = string.concat(json, '    "epochDurationSeconds": "', vm.toString(p.epochDurationSeconds), '",\n');
        json = string.concat(json, '    "slashPolicyCap": "', vm.toString(p.slashPolicyCap), '",\n');
        json = string.concat(json, '    "minimumStake": "', vm.toString(p.minimumStake), '",\n');
        json = string.concat(json, '    "withdrawCooldownSeconds": "', vm.toString(p.withdrawCooldownSeconds), '"\n');
        json = string.concat(json, "  }\n}\n");

        vm.writeFile(path, json);
        console2.log("Deployment manifest written to:", path);
        console2.log("Verify with: GRIDPROOF_CONTRACT_MANIFEST_PATH=%s pnpm deployment:contracts", path);
    }

    /// @dev Renders `block.timestamp` as `YYYY-MM-DDTHH:MM:SSZ`, the offset-bearing ISO-8601
    ///      form `z.string().datetime({ offset: true })` accepts. Implemented inline because
    ///      Foundry has no date formatter and the manifest must be schema-valid on write.
    function _isoTimestamp() private view returns (string memory) {
        uint256 ts = block.timestamp;
        uint256 secsOfDay = ts % 86400;
        (uint256 year, uint256 month, uint256 day) = _civilFromDays(ts / 86400);

        return string.concat(
            vm.toString(year),
            "-",
            _pad2(month),
            "-",
            _pad2(day),
            "T",
            _pad2(secsOfDay / 3600),
            ":",
            _pad2((secsOfDay % 3600) / 60),
            ":",
            _pad2(secsOfDay % 60),
            "Z"
        );
    }

    /// @dev Howard Hinnant's `civil_from_days` algorithm, shifted to a 1970-01-01 epoch.
    function _civilFromDays(uint256 daysSinceEpoch) private pure returns (uint256, uint256, uint256) {
        uint256 z = daysSinceEpoch + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        return (m <= 2 ? y + 1 : y, m, d);
    }

    function _pad2(uint256 value) private pure returns (string memory) {
        return value < 10 ? string.concat("0", Strings.toString(value)) : Strings.toString(value);
    }
}
