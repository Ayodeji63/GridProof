// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";

contract NodeRegistryTest is Test {
    NodeRegistry private registry;

    address private admin = address(0xA11CE);
    address private provider = address(0xB0B);
    address private stranger = address(0xE0E);

    bytes32 private constant ZONE_A = keccak256("zone-a");
    bytes32 private constant ZONE_B = keccak256("zone-b");
    uint8 private constant SENSOR_NODE = 0;
    uint8 private constant HUMAN_REPORTER = 1;

    event ProviderRegistered(address indexed provider, bytes32 indexed zoneId, uint8 providerType);
    event ProviderDeactivated(address indexed provider, address indexed actor);
    event ZoneAdded(bytes32 indexed zoneId);
    event ZoneRemoved(bytes32 indexed zoneId);

    function setUp() public {
        registry = new NodeRegistry(admin);
    }

    function testConstructorGrantsAdminAndPauserRoles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), admin));
    }

    function testAdminCanAddAndRemoveZones() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit ZoneAdded(ZONE_A);
        vm.prank(admin);
        registry.addZone(ZONE_A);
        assertTrue(registry.validZones(ZONE_A));

        vm.expectEmit(true, false, false, true, address(registry));
        emit ZoneRemoved(ZONE_A);
        vm.prank(admin);
        registry.removeZone(ZONE_A);
        assertFalse(registry.validZones(ZONE_A));
    }

    function testNonAdminCannotManageZones() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, registry.DEFAULT_ADMIN_ROLE())
        );
        vm.prank(stranger);
        registry.addZone(ZONE_A);
    }

    function testProviderCanRegisterForAllowedZone() public {
        _addZone(ZONE_A);
        vm.warp(123);

        vm.expectEmit(true, true, false, true, address(registry));
        emit ProviderRegistered(provider, ZONE_A, SENSOR_NODE);
        vm.prank(provider);
        registry.register(ZONE_A, SENSOR_NODE);

        NodeRegistry.Provider memory stored = registry.getProvider(provider);
        assertEq(stored.zoneId, ZONE_A);
        assertEq(stored.providerType, SENSOR_NODE);
        assertEq(stored.registeredAt, 123);
        assertTrue(stored.active);
        assertTrue(registry.isActive(provider));
        assertEq(registry.zoneOf(provider), ZONE_A);
    }

    function testRegisterRejectsUnknownZoneInvalidTypeAndDuplicateActiveRegistration() public {
        vm.expectRevert(abi.encodeWithSelector(NodeRegistry.ZoneNotAllowed.selector, ZONE_A));
        vm.prank(provider);
        registry.register(ZONE_A, SENSOR_NODE);

        _addZone(ZONE_A);

        vm.expectRevert(abi.encodeWithSelector(NodeRegistry.InvalidProviderType.selector, 2));
        vm.prank(provider);
        registry.register(ZONE_A, 2);

        vm.prank(provider);
        registry.register(ZONE_A, HUMAN_REPORTER);

        vm.expectRevert(abi.encodeWithSelector(NodeRegistry.AlreadyRegisteredAndActive.selector, provider));
        vm.prank(provider);
        registry.register(ZONE_A, SENSOR_NODE);
    }

    function testProviderCanDeactivateSelfAndReregister() public {
        _registerProvider(provider, ZONE_A, SENSOR_NODE);

        vm.expectEmit(true, true, false, true, address(registry));
        emit ProviderDeactivated(provider, provider);
        vm.prank(provider);
        registry.deactivate(provider);
        assertFalse(registry.isActive(provider));

        _addZone(ZONE_B);

        vm.prank(provider);
        registry.register(ZONE_B, HUMAN_REPORTER);

        NodeRegistry.Provider memory stored = registry.getProvider(provider);
        assertEq(stored.zoneId, ZONE_B);
        assertEq(stored.providerType, HUMAN_REPORTER);
        assertTrue(stored.active);
    }

    function testAdminCanDeactivateProvider() public {
        _registerProvider(provider, ZONE_A, SENSOR_NODE);

        vm.expectEmit(true, true, false, true, address(registry));
        emit ProviderDeactivated(provider, admin);
        vm.prank(admin);
        registry.deactivate(provider);

        assertFalse(registry.isActive(provider));
    }

    function testDeactivateRejectsUnauthorizedMissingAndInactiveProviders() public {
        vm.expectRevert(abi.encodeWithSelector(NodeRegistry.NotAuthorizedToDeactivate.selector, stranger, provider));
        vm.prank(stranger);
        registry.deactivate(provider);

        vm.expectRevert(abi.encodeWithSelector(NodeRegistry.NotRegistered.selector, provider));
        vm.prank(admin);
        registry.deactivate(provider);

        _registerProvider(provider, ZONE_A, SENSOR_NODE);

        vm.prank(provider);
        registry.deactivate(provider);

        vm.expectRevert(abi.encodeWithSelector(NodeRegistry.AlreadyInactive.selector, provider));
        vm.prank(provider);
        registry.deactivate(provider);
    }

    function testPauseBlocksRegistrationUntilUnpaused() public {
        _addZone(ZONE_A);

        vm.prank(admin);
        registry.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(provider);
        registry.register(ZONE_A, SENSOR_NODE);

        vm.prank(admin);
        registry.unpause();

        vm.prank(provider);
        registry.register(ZONE_A, SENSOR_NODE);
        assertTrue(registry.isActive(provider));
    }

    function testNonPauserCannotPause() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, registry.PAUSER_ROLE())
        );
        vm.prank(stranger);
        registry.pause();
    }

    function _addZone(bytes32 zoneId) private {
        vm.prank(admin);
        registry.addZone(zoneId);
    }

    function _registerProvider(address account, bytes32 zoneId, uint8 providerType) private {
        _addZone(zoneId);
        vm.prank(account);
        registry.register(zoneId, providerType);
    }
}
