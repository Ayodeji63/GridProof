// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {UptimeAttestation} from "../src/UptimeAttestation.sol";
import {ReputationEscrow} from "../src/ReputationEscrow.sol";

/// @notice Exercises the deploy script in-process so wiring and manifest shape are verified
///         without needing a live RPC endpoint or a funded key.
/// @dev Parameters are passed as a struct rather than through `vm.setEnv`: env vars are
///      process-global and are not rolled back between forge's concurrently executed test
///      cases, which makes env-driven deploy tests order-dependent and flaky.
contract DeployTest is Test {
    Deploy private deployer;

    address private admin = address(0xA11CE);
    address private relayer = address(0xDEFEA7);

    function setUp() public {
        deployer = new Deploy();
        // Deterministic, clearly post-2020 timestamp so the ISO rendering is meaningful.
        vm.warp(1_754_740_800); // 2025-08-09T12:00:00Z
    }

    function _params(string memory network) private view returns (Deploy.Params memory p) {
        p.network = network;
        p.admin = admin;
        p.relayer = relayer;
        p.epochDurationSeconds = 3600;
        p.slashPolicyCap = 0.5 ether;
        p.minimumStake = 0.1 ether;
        p.withdrawCooldownSeconds = 3 days;
        p.zoneIds = new string[](0);
    }

    function _manifestPath(string memory network) private view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", network, ".json");
    }

    function testDeployWiresRolesAndPolicy() public {
        (NodeRegistry registry, UptimeAttestation attestation, ReputationEscrow escrow) =
            deployer.deploy(_params("test-wiring"));

        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(attestation.hasRole(attestation.RELAYER_ROLE(), relayer));
        assertTrue(escrow.hasRole(escrow.RELAYER_ROLE(), relayer));
        assertTrue(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), admin));

        // The relayer must never hold admin rights on the escrow (Part 3 access control).
        assertFalse(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), relayer));

        // The escrow must read the registry deployed in the same run, not an unrelated address.
        assertEq(address(escrow.nodeRegistry()), address(registry));

        assertEq(attestation.epochDuration(), 3600);
        assertEq(escrow.slashPolicyCap(), 0.5 ether);
        assertEq(escrow.minimumStake(), 0.1 ether);
        assertEq(escrow.withdrawCooldownSeconds(), 3 days);

        vm.removeFile(_manifestPath("test-wiring"));
    }

    function testDeployWritesSchemaValidManifest() public {
        deployer.deploy(_params("test-manifest"));

        string memory path = _manifestPath("test-manifest");
        string memory json = vm.readFile(path);

        assertEq(vm.parseJsonString(json, ".network"), "test-manifest");
        // chainId and every params value must be decimal *strings* per deploymentManifestSchema.
        assertEq(vm.parseJsonString(json, ".chainId"), vm.toString(block.chainid));
        assertEq(vm.parseJsonString(json, ".params.epochDurationSeconds"), "3600");
        assertEq(vm.parseJsonString(json, ".params.slashPolicyCap"), "500000000000000000");
        assertEq(vm.parseJsonString(json, ".params.minimumStake"), "100000000000000000");
        assertEq(vm.parseJsonString(json, ".params.withdrawCooldownSeconds"), "259200");

        assertEq(vm.parseJsonAddress(json, ".admin"), admin);
        assertEq(vm.parseJsonAddress(json, ".relayer"), relayer);
        assertTrue(vm.parseJsonAddress(json, ".contracts.NodeRegistry") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".contracts.UptimeAttestation") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".contracts.ReputationEscrow") != address(0));

        // Offset-bearing ISO-8601, matching z.string().datetime({ offset: true }).
        assertEq(vm.parseJsonString(json, ".deployedAt"), "2025-08-09T12:00:00Z");

        vm.removeFile(path);
    }

    function testDeploySeedsZoneAllowlistWhenBroadcasterIsAdmin() public {
        Deploy.Params memory p = _params("test-zones");
        // `vm.startBroadcast()` with no argument sends from forge's DEFAULT_SENDER, so that
        // is the account which must hold DEFAULT_ADMIN_ROLE for seeding to be possible.
        p.admin = DEFAULT_SENDER;
        p.zoneIds = new string[](2);
        p.zoneIds[0] = "ikeja-zone-1";
        p.zoneIds[1] = "lekki-zone-2";

        (NodeRegistry registry,,) = deployer.deploy(p);

        assertTrue(registry.validZones(keccak256("ikeja-zone-1")));
        assertTrue(registry.validZones(keccak256("lekki-zone-2")));
        assertFalse(registry.validZones(keccak256("never-added")));

        vm.removeFile(_manifestPath("test-zones"));
    }

    function testDeployPreservesExistingBytes32ZoneKeys() public {
        Deploy.Params memory p = _params("test-zone-keys");
        p.admin = DEFAULT_SENDER;
        p.zoneIds = new string[](1);
        p.zoneIds[0] = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

        (NodeRegistry registry,,) = deployer.deploy(p);

        assertTrue(registry.validZones(bytes32(uint256(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))));
        assertFalse(registry.validZones(keccak256(bytes(p.zoneIds[0]))));
        vm.removeFile(_manifestPath("test-zone-keys"));
    }

    /// @dev When the admin is a multisig the broadcaster cannot seed zones; the deploy must
    ///      still succeed and leave the allowlist empty rather than reverting mid-run.
    function testDeploySkipsZoneSeedingWhenAdminIsNotBroadcaster() public {
        Deploy.Params memory p = _params("test-zones-skipped");
        p.zoneIds = new string[](1);
        p.zoneIds[0] = "ikeja-zone-1";

        (NodeRegistry registry,,) = deployer.deploy(p);

        assertFalse(registry.validZones(keccak256("ikeja-zone-1")));

        vm.removeFile(_manifestPath("test-zones-skipped"));
    }

    function testDeployRevertsOnZeroAdmin() public {
        Deploy.Params memory p = _params("test-zero-admin");
        p.admin = address(0);
        vm.expectRevert("GRIDPROOF_ADMIN_ADDRESS must not be the zero address");
        deployer.deploy(p);
    }

    function testDeployRevertsOnZeroRelayer() public {
        Deploy.Params memory p = _params("test-zero-relayer");
        p.relayer = address(0);
        vm.expectRevert("GRIDPROOF_RELAYER_ADDRESS must not be the zero address");
        deployer.deploy(p);
    }

    function testDeployRevertsOnZeroEpochDuration() public {
        Deploy.Params memory p = _params("test-zero-epoch");
        p.epochDurationSeconds = 0;
        vm.expectRevert("GRIDPROOF_EPOCH_DURATION_SECONDS must be > 0");
        deployer.deploy(p);
    }

    function testDeployRevertsWhenAdminAndRelayerMatch() public {
        Deploy.Params memory p = _params("test-shared-actor");
        p.relayer = p.admin;
        vm.expectRevert("GRIDPROOF_ADMIN_ADDRESS must differ from GRIDPROOF_RELAYER_ADDRESS");
        deployer.deploy(p);
    }
}
