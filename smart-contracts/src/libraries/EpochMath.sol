// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EpochMath
/// @notice Pure helper functions for GridProof's fixed-cadence epoch model.
/// @dev Kept dependency-free and stateless so it can be unit tested in isolation
///      and reused by any contract that needs to key or validate an epoch.
library EpochMath {
    /// @notice Basis-points denominator used for `uptimeBps` (0 = 0% uptime, 10_000 = 100% uptime).
    uint16 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Derives the composite storage key for a (zoneId, epochStart) pair.
    /// @dev This is the single source of truth for how `UptimeAttestation` addresses
    ///      its `epochs` mapping — duplicate-submission protection depends on every
    ///      caller deriving the key the same way.
    function epochKey(bytes32 zoneId, uint64 epochStart) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(zoneId, epochStart));
    }

    /// @notice True if `epochStart` falls exactly on an epoch boundary for the given duration.
    /// @param epochStart Unix timestamp (seconds) marking the start of the epoch being committed.
    /// @param epochDuration Length of one epoch in seconds (e.g. 3600 for hourly epochs).
    function isAlignedEpoch(uint64 epochStart, uint64 epochDuration) internal pure returns (bool) {
        if (epochDuration == 0) return false;
        return epochStart % epochDuration == 0;
    }

    /// @notice True if `epochStart` (plus its duration) lies fully in the past relative to `nowTs`.
    /// @dev Prevents committing an epoch that hasn't finished yet, which would let a relayer
    ///      front-run the evidence that's still being collected off-chain.
    function isPastEpoch(uint64 epochStart, uint64 epochDuration, uint64 nowTs) internal pure returns (bool) {
        unchecked {
            return epochStart + epochDuration <= nowTs;
        }
    }

    /// @notice True if `bps` is a valid basis-points value (0–10,000 inclusive).
    function isValidBps(uint16 bps) internal pure returns (bool) {
        return bps <= BPS_DENOMINATOR;
    }
}
