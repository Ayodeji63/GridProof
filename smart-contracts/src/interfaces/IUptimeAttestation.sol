// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IUptimeAttestation
/// @notice Read surface + event shape for GridProof's append-only epoch ledger.
/// @dev Consumed by off-chain indexers (Part 4 Blockchain Service) and by any future
///      contract (e.g. the stretch-goal `DisputeWindow`) that needs to reference a
///      committed epoch without depending on the full implementation.
interface IUptimeAttestation {
    struct Epoch {
        bytes32 zoneId;
        uint64 epochStart;
        uint16 uptimeBps;
        bytes32 evidenceHash;
        address submittedBy;
    }

    event EpochCommitted(
        bytes32 indexed zoneId,
        uint64 indexed epochStart,
        uint16 uptimeBps,
        bytes32 evidenceHash
    );

    /// @notice Commits a verified epoch score + evidence hash for a zone. RELAYER_ROLE only.
    function commitEpoch(
        bytes32 zoneId,
        uint64 epochStart,
        uint16 uptimeBps,
        bytes32 evidenceHash
    ) external;

    /// @notice Returns the committed epoch for a (zoneId, epochStart) pair.
    /// @dev Returns a zero-valued struct if no epoch has been committed yet — callers
    ///      should check `submittedBy != address(0)` to distinguish "not committed" from
    ///      a genuine (impossible) zero-address submission.
    function getEpoch(
        bytes32 zoneId,
        uint64 epochStart
    ) external view returns (Epoch memory);

    /// @notice True if an epoch has already been committed for (zoneId, epochStart).
    function isCommitted(
        bytes32 zoneId,
        uint64 epochStart
    ) external view returns (bool);
}
