// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReputationEscrow} from "../src/ReputationEscrow.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";

contract ReputationEscrowTest is Test {
    ReputationEscrow private escrow;
    NodeRegistry private registry;

    address private admin = address(0xA11CE);
    address private relayer = address(0xDEFEA7);
    address private provider = address(0xB0B);
    address private stranger = address(0xE0E);

    bytes32 private constant ZONE_A = keccak256("zone-a");
    uint8 private constant HUMAN_REPORTER = 1;

    uint256 private constant SLASH_CAP = 0.5 ether;
    uint256 private constant MIN_STAKE = 0.1 ether;
    uint64 private constant COOLDOWN = 3 days;

    bytes32 private constant EVIDENCE_HASH = keccak256("evidence-bundle");
    bytes32 private constant REASON_HASH = keccak256("governance-decision");

    event Staked(address indexed provider, uint256 amount, uint256 newBalance);
    event Rewarded(address indexed provider, uint256 amount, bytes32 indexed evidenceHash, int256 newReputation);
    event Slashed(address indexed provider, uint256 amount, bytes32 indexed reasonHash, int256 newReputation);
    event Withdrawn(address indexed provider, uint256 amount, uint256 newBalance);

    function setUp() public {
        registry = new NodeRegistry(admin);
        vm.prank(admin);
        registry.addZone(ZONE_A);
        vm.prank(provider);
        registry.register(ZONE_A, HUMAN_REPORTER);

        escrow = new ReputationEscrow(admin, relayer, address(registry), SLASH_CAP, MIN_STAKE, COOLDOWN);

        vm.deal(admin, 100 ether);
        vm.deal(provider, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    // ---------------------------------------------------------------------
    // Construction & roles
    // ---------------------------------------------------------------------

    function testConstructorGrantsRolesAndPolicy() public view {
        assertTrue(escrow.hasRole(escrow.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(escrow.hasRole(escrow.PAUSER_ROLE(), admin));
        assertTrue(escrow.hasRole(escrow.RELAYER_ROLE(), relayer));
        assertFalse(escrow.hasRole(escrow.RELAYER_ROLE(), admin));
        assertEq(escrow.slashPolicyCap(), SLASH_CAP);
        assertEq(escrow.minimumStake(), MIN_STAKE);
        assertEq(escrow.withdrawCooldownSeconds(), COOLDOWN);
        assertEq(address(escrow.nodeRegistry()), address(registry));
    }

    function testConstructorRejectsZeroAddresses() public {
        vm.expectRevert(ReputationEscrow.ZeroAddress.selector);
        new ReputationEscrow(address(0), relayer, address(registry), SLASH_CAP, MIN_STAKE, COOLDOWN);

        vm.expectRevert(ReputationEscrow.ZeroAddress.selector);
        new ReputationEscrow(admin, address(0), address(registry), SLASH_CAP, MIN_STAKE, COOLDOWN);

        vm.expectRevert(ReputationEscrow.ZeroAddress.selector);
        new ReputationEscrow(admin, relayer, address(0), SLASH_CAP, MIN_STAKE, COOLDOWN);
    }

    // ---------------------------------------------------------------------
    // stake()
    // ---------------------------------------------------------------------

    function testActiveProviderCanStake() public {
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Staked(provider, 1 ether, 1 ether);
        vm.prank(provider);
        escrow.stake{value: 1 ether}();

        assertEq(escrow.stakes(provider), 1 ether);
        assertEq(escrow.totalStaked(), 1 ether);
        assertEq(escrow.lastStakedAt(provider), uint64(block.timestamp));
    }

    function testStakeRevertsForUnregisteredProvider() public {
        vm.expectRevert(abi.encodeWithSelector(ReputationEscrow.ProviderNotActive.selector, stranger));
        vm.prank(stranger);
        escrow.stake{value: 1 ether}();
    }

    function testStakeRevertsAfterRegistryDeactivation() public {
        vm.prank(provider);
        registry.deactivate(provider);

        vm.expectRevert(abi.encodeWithSelector(ReputationEscrow.ProviderNotActive.selector, provider));
        vm.prank(provider);
        escrow.stake{value: 1 ether}();
    }

    function testStakeRevertsOnZeroAmount() public {
        vm.expectRevert(ReputationEscrow.ZeroAmount.selector);
        vm.prank(provider);
        escrow.stake{value: 0}();
    }

    function testStakeRevertsWhenPaused() public {
        vm.prank(admin);
        escrow.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(provider);
        escrow.stake{value: 1 ether}();
    }

    function testToppingUpStakeRestartsCooldown() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();

        skip(COOLDOWN + 1);
        vm.prank(provider);
        escrow.stake{value: 1 ether}();

        uint64 availableAt = escrow.withdrawAvailableAt(provider);
        assertEq(availableAt, uint64(block.timestamp) + COOLDOWN);

        vm.expectRevert(
            abi.encodeWithSelector(ReputationEscrow.WithdrawCooldownActive.selector, provider, availableAt)
        );
        vm.prank(provider);
        escrow.withdraw(0.5 ether);
    }

    // ---------------------------------------------------------------------
    // withdraw()
    // ---------------------------------------------------------------------

    function testWithdrawAfterCooldownRespectingFloor() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();
        skip(COOLDOWN);

        uint256 before = provider.balance;
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Withdrawn(provider, 0.9 ether, 0.1 ether);
        vm.prank(provider);
        escrow.withdraw(0.9 ether);

        assertEq(escrow.stakes(provider), MIN_STAKE);
        assertEq(escrow.totalStaked(), MIN_STAKE);
        assertEq(provider.balance, before + 0.9 ether);
    }

    function testWithdrawRevertsDuringCooldown() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();

        uint64 availableAt = uint64(block.timestamp) + COOLDOWN;
        vm.expectRevert(
            abi.encodeWithSelector(ReputationEscrow.WithdrawCooldownActive.selector, provider, availableAt)
        );
        vm.prank(provider);
        escrow.withdraw(0.1 ether);
    }

    function testWithdrawRevertsBelowMinimumStakeWhileActive() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();
        skip(COOLDOWN);

        vm.expectRevert(
            abi.encodeWithSelector(
                ReputationEscrow.MinimumStakeNotMet.selector, provider, 0.05 ether, MIN_STAKE
            )
        );
        vm.prank(provider);
        escrow.withdraw(0.95 ether);
    }

    function testDeactivatedProviderMayWithdrawInFull() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();
        skip(COOLDOWN);

        vm.prank(provider);
        registry.deactivate(provider);

        vm.prank(provider);
        escrow.withdraw(1 ether);

        assertEq(escrow.stakes(provider), 0);
        assertEq(escrow.totalStaked(), 0);
    }

    function testWithdrawRevertsAboveBalance() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();
        skip(COOLDOWN);

        vm.expectRevert(
            abi.encodeWithSelector(ReputationEscrow.InsufficientStake.selector, provider, 2 ether, 1 ether)
        );
        vm.prank(provider);
        escrow.withdraw(2 ether);
    }

    // ---------------------------------------------------------------------
    // reward()
    // ---------------------------------------------------------------------

    function testRelayerCanRewardFromPool() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();
        vm.prank(admin);
        escrow.fundRewardPool{value: 2 ether}();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit Rewarded(provider, 0.4 ether, EVIDENCE_HASH, 1);
        vm.prank(relayer);
        escrow.reward(provider, 0.4 ether, EVIDENCE_HASH);

        assertEq(escrow.stakes(provider), 1.4 ether);
        assertEq(escrow.rewardPool(), 1.6 ether);
        assertEq(escrow.reputationScore(provider), 1);
    }

    function testRewardRevertsForNonRelayer() public {
        vm.prank(admin);
        escrow.fundRewardPool{value: 1 ether}();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, escrow.RELAYER_ROLE()
            )
        );
        vm.prank(admin);
        escrow.reward(provider, 0.1 ether, EVIDENCE_HASH);
    }

    /// @dev The core economic invariant: a compromised relayer cannot reach staked principal.
    function testRewardCannotDrainStakedPrincipal() public {
        vm.prank(provider);
        escrow.stake{value: 5 ether}();

        assertEq(escrow.rewardPool(), 0);
        vm.expectRevert(abi.encodeWithSelector(ReputationEscrow.RewardPoolExhausted.selector, 1 wei, 0));
        vm.prank(relayer);
        escrow.reward(stranger, 1 wei, EVIDENCE_HASH);
    }

    function testRewardRevertsAboveRewardPool() public {
        vm.prank(admin);
        escrow.fundRewardPool{value: 1 ether}();

        vm.expectRevert(
            abi.encodeWithSelector(ReputationEscrow.RewardPoolExhausted.selector, 1 ether + 1, 1 ether)
        );
        vm.prank(relayer);
        escrow.reward(provider, 1 ether + 1, EVIDENCE_HASH);
    }

    // ---------------------------------------------------------------------
    // slash()
    // ---------------------------------------------------------------------

    function testRelayerCanSlashWithinCap() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit Slashed(provider, SLASH_CAP, REASON_HASH, -1);
        vm.prank(relayer);
        escrow.slash(provider, SLASH_CAP, REASON_HASH);

        assertEq(escrow.stakes(provider), 0.5 ether);
        assertEq(escrow.reputationScore(provider), -1);
        // Slashed principal is recycled into the reward pool, never paid to the caller.
        assertEq(escrow.rewardPool(), SLASH_CAP);
        assertEq(escrow.totalStaked(), 0.5 ether);
    }

    function testSlashRevertsAbovePolicyCap() public {
        vm.prank(provider);
        escrow.stake{value: 5 ether}();

        vm.expectRevert(
            abi.encodeWithSelector(ReputationEscrow.SlashExceedsPolicyCap.selector, SLASH_CAP + 1, SLASH_CAP)
        );
        vm.prank(relayer);
        escrow.slash(provider, SLASH_CAP + 1, REASON_HASH);
    }

    function testSlashRevertsForNonRelayer() public {
        vm.prank(provider);
        escrow.stake{value: 1 ether}();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.RELAYER_ROLE()
            )
        );
        vm.prank(stranger);
        escrow.slash(provider, 0.1 ether, REASON_HASH);
    }

    function testSlashRevertsAboveProviderStake() public {
        vm.prank(provider);
        escrow.stake{value: 0.2 ether}();

        vm.expectRevert(
            abi.encodeWithSelector(ReputationEscrow.InsufficientStake.selector, provider, 0.3 ether, 0.2 ether)
        );
        vm.prank(relayer);
        escrow.slash(provider, 0.3 ether, REASON_HASH);
    }

    function testAdminCanRaiseSlashCapAndRelayerCannot() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, relayer, escrow.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(relayer);
        escrow.setPolicy(10 ether, MIN_STAKE, COOLDOWN);

        vm.prank(admin);
        escrow.setPolicy(2 ether, MIN_STAKE, COOLDOWN);
        assertEq(escrow.slashPolicyCap(), 2 ether);
    }

    // ---------------------------------------------------------------------
    // Reward pool accounting
    // ---------------------------------------------------------------------

    function testAdminCanWithdrawOnlyRewardPoolNotStakes() public {
        vm.prank(provider);
        escrow.stake{value: 3 ether}();
        vm.prank(admin);
        escrow.fundRewardPool{value: 1 ether}();

        vm.expectRevert(
            abi.encodeWithSelector(ReputationEscrow.RewardPoolExhausted.selector, 1 ether + 1, 1 ether)
        );
        vm.prank(admin);
        escrow.withdrawRewardPool(admin, 1 ether + 1);

        vm.prank(admin);
        escrow.withdrawRewardPool(admin, 1 ether);
        assertEq(escrow.rewardPool(), 0);
        assertEq(escrow.stakes(provider), 3 ether);
        assertEq(address(escrow).balance, 3 ether);
    }

    function testFundRewardPoolRequiresAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, escrow.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(stranger);
        escrow.fundRewardPool{value: 1 ether}();
    }

    /// @dev Balance must always equal the two accounting buckets, across every mutating path.
    function testContractBalanceAlwaysMatchesBuckets() public {
        vm.prank(provider);
        escrow.stake{value: 2 ether}();
        vm.prank(admin);
        escrow.fundRewardPool{value: 1 ether}();
        vm.prank(relayer);
        escrow.reward(provider, 0.5 ether, EVIDENCE_HASH);
        vm.prank(relayer);
        escrow.slash(provider, 0.25 ether, REASON_HASH);

        assertEq(address(escrow).balance, escrow.totalStaked() + escrow.rewardPool());

        skip(COOLDOWN);
        vm.prank(provider);
        escrow.withdraw(1 ether);

        assertEq(address(escrow).balance, escrow.totalStaked() + escrow.rewardPool());
    }

    function testFuzzBalanceInvariantHoldsAcrossStakeAndSlash(uint96 stakeAmount, uint96 slashAmount) public {
        stakeAmount = uint96(bound(stakeAmount, 1, 50 ether));
        slashAmount = uint96(bound(slashAmount, 1, SLASH_CAP));
        vm.assume(slashAmount <= stakeAmount);

        vm.prank(provider);
        escrow.stake{value: stakeAmount}();
        vm.prank(relayer);
        escrow.slash(provider, slashAmount, REASON_HASH);

        assertEq(address(escrow).balance, escrow.totalStaked() + escrow.rewardPool());
        assertEq(escrow.stakes(provider), uint256(stakeAmount) - slashAmount);
    }
}
