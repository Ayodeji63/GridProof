// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EpochMath} from "../src/libraries/EpochMath.sol";

contract EpochMathHarness {
    function epochKey(bytes32 zoneId, uint64 epochStart) external pure returns (bytes32) {
        return EpochMath.epochKey(zoneId, epochStart);
    }

    function isAlignedEpoch(uint64 epochStart, uint64 epochDuration) external pure returns (bool) {
        return EpochMath.isAlignedEpoch(epochStart, epochDuration);
    }

    function isPastEpoch(uint64 epochStart, uint64 epochDuration, uint64 nowTs) external pure returns (bool) {
        return EpochMath.isPastEpoch(epochStart, epochDuration, nowTs);
    }

    function isValidBps(uint16 bps) external pure returns (bool) {
        return EpochMath.isValidBps(bps);
    }
}

contract EpochMathTest is Test {
    EpochMathHarness private harness;

    bytes32 private constant ZONE_A = keccak256("zone-a");

    function setUp() public {
        harness = new EpochMathHarness();
    }

    function testEpochKeyMatchesPackedEncoding() public view {
        uint64 epochStart = 3_600;

        bytes32 key = harness.epochKey(ZONE_A, epochStart);

        assertEq(key, keccak256(abi.encodePacked(ZONE_A, epochStart)));
    }

    function testEpochKeyChangesAcrossZonesAndEpochs() public view {
        bytes32 zoneB = keccak256("zone-b");

        assertNotEq(harness.epochKey(ZONE_A, 3_600), harness.epochKey(zoneB, 3_600));
        assertNotEq(harness.epochKey(ZONE_A, 3_600), harness.epochKey(ZONE_A, 7_200));
    }

    function testIsAlignedEpochReturnsTrueForExactBoundaries() public view {
        assertTrue(harness.isAlignedEpoch(0, 3_600));
        assertTrue(harness.isAlignedEpoch(7_200, 3_600));
    }

    function testIsAlignedEpochRejectsMisalignedOrZeroDuration() public view {
        assertFalse(harness.isAlignedEpoch(3_601, 3_600));
        assertFalse(harness.isAlignedEpoch(3_600, 0));
    }

    function testIsPastEpochRequiresFullEpochToHaveElapsed() public view {
        assertTrue(harness.isPastEpoch(3_600, 3_600, 7_200));
        assertFalse(harness.isPastEpoch(3_600, 3_600, 7_199));
    }

    function testIsValidBpsAllowsInclusiveBoundsOnly() public view {
        assertTrue(harness.isValidBps(0));
        assertTrue(harness.isValidBps(10_000));
        assertFalse(harness.isValidBps(10_001));
    }
}
