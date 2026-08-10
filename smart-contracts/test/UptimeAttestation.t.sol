// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IUptimeAttestation} from "../src/interfaces/IUptimeAttestation.sol";
import {UptimeAttestation} from "../src/UptimeAttestation.sol";

contract UptimeAttestationTest is Test {
    UptimeAttestation private attestation;

    address private admin = address(0xA11CE);
    address private relayer = address(0xBEEF);
    address private stranger = address(0xE0E);

    uint64 private constant EPOCH_DURATION = 3_600;
    bytes32 private constant ZONE_A = keccak256("zone-a");
    bytes32 private constant EVIDENCE_HASH = keccak256("evidence");

    event EpochCommitted(bytes32 indexed zoneId, uint64 indexed epochStart, uint16 uptimeBps, bytes32 evidenceHash);
    event EpochDurationUpdated(uint64 previousDuration, uint64 newDuration);

    function setUp() public {
        attestation = new UptimeAttestation(admin, relayer, EPOCH_DURATION);
    }

    function testConstructorGrantsRolesAndSetsDuration() public view {
        assertTrue(attestation.hasRole(attestation.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(attestation.hasRole(attestation.PAUSER_ROLE(), admin));
        assertTrue(attestation.hasRole(attestation.RELAYER_ROLE(), relayer));
        assertEq(attestation.epochDuration(), EPOCH_DURATION);
    }

    function testConstructorRejectsZeroEpochDuration() public {
        vm.expectRevert(UptimeAttestation.ZeroEpochDuration.selector);
        new UptimeAttestation(admin, relayer, 0);
    }

    function testAdminCanUpdateEpochDuration() public {
        vm.expectEmit(false, false, false, true, address(attestation));
        emit EpochDurationUpdated(EPOCH_DURATION, 7_200);
        vm.prank(admin);
        attestation.setEpochDuration(7_200);

        assertEq(attestation.epochDuration(), 7_200);
    }

    function testSetEpochDurationRejectsUnauthorizedAndZeroDuration() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                attestation.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(stranger);
        attestation.setEpochDuration(7_200);

        vm.expectRevert(UptimeAttestation.ZeroEpochDuration.selector);
        vm.prank(admin);
        attestation.setEpochDuration(0);
    }

    function testRelayerCanCommitPastAlignedEpoch() public {
        uint64 epochStart = 3_600;
        vm.warp(7_200);

        vm.expectEmit(true, true, false, true, address(attestation));
        emit EpochCommitted(ZONE_A, epochStart, 9_500, EVIDENCE_HASH);
        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, epochStart, 9_500, EVIDENCE_HASH);

        IUptimeAttestation.Epoch memory stored = attestation.getEpoch(ZONE_A, epochStart);
        assertEq(stored.zoneId, ZONE_A);
        assertEq(stored.epochStart, epochStart);
        assertEq(stored.uptimeBps, 9_500);
        assertEq(stored.evidenceHash, EVIDENCE_HASH);
        assertEq(stored.submittedBy, relayer);
        assertTrue(attestation.isCommitted(ZONE_A, epochStart));
    }

    function testUncommittedEpochReturnsZeroValues() public view {
        IUptimeAttestation.Epoch memory stored = attestation.getEpoch(ZONE_A, 3_600);

        assertEq(stored.zoneId, bytes32(0));
        assertEq(stored.epochStart, 0);
        assertEq(stored.uptimeBps, 0);
        assertEq(stored.evidenceHash, bytes32(0));
        assertEq(stored.submittedBy, address(0));
        assertFalse(attestation.isCommitted(ZONE_A, 3_600));
    }

    function testCommitRejectsUnauthorizedCaller() public {
        vm.warp(7_200);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                attestation.RELAYER_ROLE()
            )
        );
        vm.prank(stranger);
        attestation.commitEpoch(ZONE_A, 3_600, 9_500, EVIDENCE_HASH);
    }

    function testCommitRejectsDuplicateForSameZoneAndEpoch() public {
        uint64 epochStart = 3_600;
        vm.warp(7_200);

        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, epochStart, 9_500, EVIDENCE_HASH);

        vm.expectRevert(abi.encodeWithSelector(UptimeAttestation.EpochAlreadyCommitted.selector, ZONE_A, epochStart));
        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, epochStart, 8_000, keccak256("new evidence"));
    }

    function testCommitAllowsSameEpochForDifferentZones() public {
        uint64 epochStart = 3_600;
        bytes32 zoneB = keccak256("zone-b");
        vm.warp(7_200);

        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, epochStart, 9_500, EVIDENCE_HASH);

        vm.prank(relayer);
        attestation.commitEpoch(zoneB, epochStart, 8_000, keccak256("zone-b evidence"));

        assertTrue(attestation.isCommitted(ZONE_A, epochStart));
        assertTrue(attestation.isCommitted(zoneB, epochStart));
    }

    function testCommitAllowsBoundaryBpsValues() public {
        vm.warp(10_800);

        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, 3_600, 0, EVIDENCE_HASH);

        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, 7_200, 10_000, keccak256("perfect uptime"));

        assertTrue(attestation.isCommitted(ZONE_A, 3_600));
        assertTrue(attestation.isCommitted(ZONE_A, 7_200));
    }

    function testCommitRejectsInvalidBpsMisalignedAndUnelapsedEpochs() public {
        vm.warp(7_200);

        vm.expectRevert(abi.encodeWithSelector(UptimeAttestation.InvalidUptimeBps.selector, 10_001));
        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, 3_600, 10_001, EVIDENCE_HASH);

        vm.expectRevert(abi.encodeWithSelector(UptimeAttestation.EpochNotAligned.selector, 3_601, EPOCH_DURATION));
        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, 3_601, 9_500, EVIDENCE_HASH);

        vm.expectRevert(
            abi.encodeWithSelector(UptimeAttestation.EpochNotYetElapsed.selector, 3_600, EPOCH_DURATION, uint256(7_199))
        );
        vm.warp(7_199);
        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, 3_600, 9_500, EVIDENCE_HASH);
    }

    function testPauseBlocksCommitUntilUnpaused() public {
        vm.warp(7_200);

        vm.prank(admin);
        attestation.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, 3_600, 9_500, EVIDENCE_HASH);

        vm.prank(admin);
        attestation.unpause();

        vm.prank(relayer);
        attestation.commitEpoch(ZONE_A, 3_600, 9_500, EVIDENCE_HASH);
        assertTrue(attestation.isCommitted(ZONE_A, 3_600));
    }

    function testNonPauserCannotPause() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, attestation.PAUSER_ROLE())
        );
        vm.prank(stranger);
        attestation.pause();
    }
}
