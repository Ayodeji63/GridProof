// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IUptimeAttestation} from "./interfaces/IUptimeAttestation.sol";
import {EpochMath} from "./libraries/EpochMath.sol";

/// @notice The core append-only ledger of verified grid-uptime evidence. This is the
///         actual trust artifact GridProof exists to produce: a small, fixed-size,
///         tamper-evident commitment per (zone, epoch) — never the raw telemetry itself.
/// @dev Only `RELAYER_ROLE` (the single backend hot wallet, Part 3 "Wallet, roles, gas
///      and safety") may write. Individual sensor/reporter attribution intentionally
///      stays off-chain — `submittedBy` records the relayer, not the raw evidence source.
contract UptimeAttestation is IUptimeAttestation, AccessControl, Pausable {
    using EpochMath for uint16;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Length of one epoch in seconds. Admin-tunable pre-launch; changing it
    ///         does not affect already-committed epochs since their key is derived from
    ///         the literal `epochStart` value the relayer submitted, not from this setting.
    uint64 public epochDuration;

    /// @dev Keyed by `EpochMath.epochKey(zoneId, epochStart)`, NOT by zoneId alone —
    ///      this is what makes duplicate-submission protection a simple mapping check.
    mapping(bytes32 => Epoch) private epochs;

    event EpochDurationUpdated(uint64 previousDuration, uint64 newDuration);

    error EpochAlreadyCommitted(bytes32 zoneId, uint64 epochStart);
    error InvalidUptimeBps(uint16 uptimeBps);
    error EpochNotAligned(uint64 epochStart, uint64 epochDuration);
    error EpochNotYetElapsed(
        uint64 epochStart,
        uint64 epochDuration,
        uint256 nowTs
    );
    error ZeroEpochDuration();

    /// @param admin Multisig address that receives DEFAULT_ADMIN_ROLE and PAUSER_ROLE at deploy time.
    /// @param relayer Backend hot-wallet address that receives RELAYER_ROLE at deploy time.
    /// @param initialEpochDuration Epoch length in seconds (e.g. 3600 for hourly epochs).
    constructor(address admin, address relayer, uint64 initialEpochDuration) {
        if (initialEpochDuration == 0) revert ZeroEpochDuration();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(RELAYER_ROLE, relayer);
        epochDuration = initialEpochDuration;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setEpochDuration(
        uint64 newDuration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newDuration == 0) revert ZeroEpochDuration();
        emit EpochDurationUpdated(epochDuration, newDuration);
        epochDuration = newDuration;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Relayer write path
    // ---------------------------------------------------------------------

    /// @inheritdoc IUptimeAttestation
    /// @dev Validation order matches Part 3: duplicate check, bounds check, alignment
    ///      check, then past-epoch check — cheapest/most-common failure first to save
    ///      gas on the revert path.
    function commitEpoch(
        bytes32 zoneId,
        uint64 epochStart,
        uint16 uptimeBps,
        bytes32 evidenceHash
    ) external onlyRole(RELAYER_ROLE) whenNotPaused {
        bytes32 key = EpochMath.epochKey(zoneId, epochStart);

        if (epochs[key].submittedBy != address(0))
            revert EpochAlreadyCommitted(zoneId, epochStart);
        if (!EpochMath.isValidBps(uptimeBps))
            revert InvalidUptimeBps(uptimeBps);
        if (!EpochMath.isAlignedEpoch(epochStart, epochDuration)) {
            revert EpochNotAligned(epochStart, epochDuration);
        }
        if (
            !EpochMath.isPastEpoch(
                epochStart,
                epochDuration,
                uint64(block.timestamp)
            )
        ) {
            revert EpochNotYetElapsed(
                epochStart,
                epochDuration,
                block.timestamp
            );
        }

        epochs[key] = Epoch({
            zoneId: zoneId,
            epochStart: epochStart,
            uptimeBps: uptimeBps,
            evidenceHash: evidenceHash,
            submittedBy: msg.sender
        });

        emit EpochCommitted(zoneId, epochStart, uptimeBps, evidenceHash);
    }

    // ---------------------------------------------------------------------
    // Views (IUptimeAttestation)
    // ---------------------------------------------------------------------

    /// @inheritdoc IUptimeAttestation
    function getEpoch(
        bytes32 zoneId,
        uint64 epochStart
    ) external view returns (Epoch memory) {
        return epochs[EpochMath.epochKey(zoneId, epochStart)];
    }

    /// @inheritdoc IUptimeAttestation
    function isCommitted(
        bytes32 zoneId,
        uint64 epochStart
    ) external view returns (bool) {
        return
            epochs[EpochMath.epochKey(zoneId, epochStart)].submittedBy !=
            address(0);
    }
}
