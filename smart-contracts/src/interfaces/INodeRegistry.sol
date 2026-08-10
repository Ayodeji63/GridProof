// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NodeRegistry
/// @notice Minimal read surface `ReputationEscrow` needs from `NodeRegistry`.
/// @dev Kept intentionally small — the escrow contract should only ever be able to
///      *read* registry state, never write it. Deploy-time wiring should point at the
///      real `NodeRegistry` address; this interface exists so `ReputationEscrow` never
///      needs to import the full implementation.
interface INodeRegistry {
    /// @notice Returns true if `provider` currently holds an active registration.
    function isActive(address provider) external view returns (bool);

    /// @notice Returns the zone a provider is registered against.
    /// @dev Returns bytes32(0) if the provider has never registered.
    function zoneOf(address provider) external view returns (bytes32);
}