// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {INodeRegistry} from "./interfaces/INodeRegistry.sol";

/// @title NodeRegistry
/// @notice Registers sensor nodes and human reporters as "Evidence Providers" for a zone.
///         Source of truth for "who is allowed to be evidence for a zone" — read by
///         `ReputationEscrow` before it allows a stake/withdraw action.
/// @dev Individual provider identity stays on-chain as a wallet address + pseudonymous
///      zone assignment only; PII (phone numbers, names) lives off-chain (Part 9).
contract NodeRegistry is INodeRegistry, AccessControl, Pausable {
    /// @notice Emergency-stop role, admin-assignable, distinct from DEFAULT_ADMIN_ROLE.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev Provider-type enum values, mirrored off-chain in `shared-types` (Part 2 Actors).
    uint8 public constant PROVIDER_TYPE_SENSOR_NODE = 0;
    uint8 public constant PROVIDER_TYPE_HUMAN_REPORTER = 1;

    struct Provider {
        bytes32 zoneId;
        uint8 providerType;
        uint64 registeredAt;
        bool active;
    }

    /// @notice One provider record per address. A previously-deactivated address may
    ///         re-register (into the same or a different allow-listed zone).
    mapping(address => Provider) public providers;

    /// @notice Admin-governed allowlist of zone IDs that may be registered against.
    mapping(bytes32 => bool) public validZones;

    event ProviderRegistered(address indexed provider, bytes32 indexed zoneId, uint8 providerType);
    event ProviderDeactivated(address indexed provider, address indexed actor);
    event ZoneAdded(bytes32 indexed zoneId);
    event ZoneRemoved(bytes32 indexed zoneId);

    error ZoneNotAllowed(bytes32 zoneId);
    error InvalidProviderType(uint8 providerType);
    error AlreadyRegisteredAndActive(address provider);
    error NotRegistered(address provider);
    error AlreadyInactive(address provider);
    error NotAuthorizedToDeactivate(address caller, address provider);

    /// @param admin Multisig address that receives DEFAULT_ADMIN_ROLE and PAUSER_ROLE at deploy time.
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Admin: zone allowlist
    // ---------------------------------------------------------------------

    /// @notice Adds a zone to the allowlist. Idempotent — adding an already-listed zone is a no-op event.
    function addZone(bytes32 zoneId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        validZones[zoneId] = true;
        emit ZoneAdded(zoneId);
    }

    /// @notice Removes a zone from the allowlist. Existing registrations in that zone are unaffected;
    ///         only *new* registrations are blocked.
    function removeZone(bytes32 zoneId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        validZones[zoneId] = false;
        emit ZoneRemoved(zoneId);
    }

    // ---------------------------------------------------------------------
    // Admin: emergency stop
    // ---------------------------------------------------------------------

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Provider self-service
    // ---------------------------------------------------------------------

    /// @notice Self-service registration as an Evidence Provider for `zoneId`.
    /// @dev Enforces one *active* registration per address. A caller who was previously
    ///      deactivated may call this again to re-register (possibly into a different zone).
    function register(bytes32 zoneId, uint8 providerType) external whenNotPaused {
        if (!validZones[zoneId]) revert ZoneNotAllowed(zoneId);
        if (providerType != PROVIDER_TYPE_SENSOR_NODE && providerType != PROVIDER_TYPE_HUMAN_REPORTER) {
            revert InvalidProviderType(providerType);
        }
        if (providers[msg.sender].active) revert AlreadyRegisteredAndActive(msg.sender);

        providers[msg.sender] = Provider({
            zoneId: zoneId,
            providerType: providerType,
            registeredAt: uint64(block.timestamp),
            active: true
        });

        emit ProviderRegistered(msg.sender, zoneId, providerType);
    }

    /// @notice Deactivates a provider. Callable by the provider themself or DEFAULT_ADMIN_ROLE
    ///         (e.g. following a governance-approved slashing decision).
    function deactivate(address provider) external {
        if (msg.sender != provider && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotAuthorizedToDeactivate(msg.sender, provider);
        }
        Provider storage p = providers[provider];
        if (p.registeredAt == 0) revert NotRegistered(provider);
        if (!p.active) revert AlreadyInactive(provider);

        p.active = false;
        emit ProviderDeactivated(provider, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views (INodeRegistry)
    // ---------------------------------------------------------------------

    /// @inheritdoc INodeRegistry
    function isActive(address provider) external view returns (bool) {
        return providers[provider].active;
    }

    /// @inheritdoc INodeRegistry
    function zoneOf(address provider) external view returns (bytes32) {
        return providers[provider].zoneId;
    }

    function getProvider(address provider) external view returns (Provider memory) {
        return providers[provider];
    }
}
