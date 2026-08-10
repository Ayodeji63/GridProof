// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {INodeRegistry} from "./interfaces/INodeRegistry.sol";

/// @title ReputationEscrow
/// @notice Stake, reward, and slash logic for GridProof Evidence Providers — primarily for the
///         human-reporter fallback mode, but reusable to economically incentivise honest hardware
///         operators too (Part 3).
/// @dev Two invariants drive the whole design:
///
///      1. **The relayer can never drain stakes.** `reward()` pays *only* out of `rewardPool`,
///         a balance that must be funded explicitly by the admin via `fundRewardPool()`. Staked
///         principal and the reward pool are tracked as separate accounting buckets over one
///         contract balance, so a compromised RELAYER_ROLE key can pay out at most whatever the
///         admin deliberately pre-funded.
///      2. **Slashing is bounded by admin-set policy.** `slash()` reverts above `slashPolicyCap`,
///         which only DEFAULT_ADMIN_ROLE can change. Slashed principal moves into `rewardPool`
///         rather than to the caller, so slashing is never profitable for the relayer.
///
///      Reputation is an `int256` score adjusted alongside rewards/slashes. It is deliberately
///      *not* a token and carries no transfer semantics. Only this contract's relayer path writes
///      it — the AI agents (Part 6) may never mutate stake or reputation directly.
contract ReputationEscrow is AccessControl, Pausable {
    /// @notice Backend relayer role. The only role permitted to reward or slash.
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Emergency-stop role, admin-assignable, distinct from DEFAULT_ADMIN_ROLE.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Read-only view of the provider allowlist. Never written by this contract.
    INodeRegistry public immutable nodeRegistry;

    /// @notice Staked principal per provider.
    mapping(address => uint256) public stakes;

    /// @notice Reputation score per provider. May go negative after repeated slashing.
    mapping(address => int256) public reputationScore;

    /// @notice Timestamp of each provider's most recent stake, used for the withdraw cool-down.
    mapping(address => uint64) public lastStakedAt;

    /// @notice Funds explicitly earmarked by the admin for reward payouts.
    /// @dev `address(this).balance == totalStaked + rewardPool` always holds.
    uint256 public rewardPool;

    /// @notice Sum of all provider stakes. Tracked so the two buckets can never be conflated.
    uint256 public totalStaked;

    /// @notice Maximum amount a single `slash()` call may take. Set by DEFAULT_ADMIN_ROLE.
    uint256 public slashPolicyCap;

    /// @notice Stake floor a provider must retain while still `active` in `NodeRegistry`.
    uint256 public minimumStake;

    /// @notice Seconds a provider must wait after their latest stake before withdrawing.
    uint64 public withdrawCooldownSeconds;

    event Staked(address indexed provider, uint256 amount, uint256 newBalance);
    event Rewarded(address indexed provider, uint256 amount, bytes32 indexed evidenceHash, int256 newReputation);
    event Slashed(address indexed provider, uint256 amount, bytes32 indexed reasonHash, int256 newReputation);
    event Withdrawn(address indexed provider, uint256 amount, uint256 newBalance);
    event RewardPoolFunded(address indexed funder, uint256 amount, uint256 newPool);
    event RewardPoolWithdrawn(address indexed to, uint256 amount, uint256 newPool);
    event PolicyUpdated(uint256 slashPolicyCap, uint256 minimumStake, uint64 withdrawCooldownSeconds);

    error ZeroAmount();
    error ZeroAddress();
    error ProviderNotActive(address provider);
    error InsufficientStake(address provider, uint256 requested, uint256 available);
    error SlashExceedsPolicyCap(uint256 requested, uint256 cap);
    error RewardPoolExhausted(uint256 requested, uint256 available);
    error WithdrawCooldownActive(address provider, uint64 availableAt);
    error MinimumStakeNotMet(address provider, uint256 remaining, uint256 minimum);
    error TransferFailed(address to, uint256 amount);

    /// @param admin Multisig address receiving DEFAULT_ADMIN_ROLE and PAUSER_ROLE at deploy time.
    /// @param relayer Backend relayer address receiving RELAYER_ROLE.
    /// @param registry `NodeRegistry` address whose `isActive` gates stake/withdraw.
    /// @param initialSlashPolicyCap Maximum single-slash amount.
    /// @param initialMinimumStake Stake floor enforced while a provider is active.
    /// @param initialWithdrawCooldownSeconds Cool-down between staking and withdrawing.
    constructor(
        address admin,
        address relayer,
        address registry,
        uint256 initialSlashPolicyCap,
        uint256 initialMinimumStake,
        uint64 initialWithdrawCooldownSeconds
    ) {
        if (admin == address(0) || relayer == address(0) || registry == address(0)) revert ZeroAddress();

        nodeRegistry = INodeRegistry(registry);
        slashPolicyCap = initialSlashPolicyCap;
        minimumStake = initialMinimumStake;
        withdrawCooldownSeconds = initialWithdrawCooldownSeconds;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(RELAYER_ROLE, relayer);

        emit PolicyUpdated(initialSlashPolicyCap, initialMinimumStake, initialWithdrawCooldownSeconds);
    }

    // ---------------------------------------------------------------------
    // Admin: policy + reward pool
    // ---------------------------------------------------------------------

    /// @notice Updates the slashing cap, minimum-stake floor, and withdraw cool-down.
    function setPolicy(uint256 newSlashPolicyCap, uint256 newMinimumStake, uint64 newWithdrawCooldownSeconds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        slashPolicyCap = newSlashPolicyCap;
        minimumStake = newMinimumStake;
        withdrawCooldownSeconds = newWithdrawCooldownSeconds;
        emit PolicyUpdated(newSlashPolicyCap, newMinimumStake, newWithdrawCooldownSeconds);
    }

    /// @notice Funds the reward pool. This is the *only* balance `reward()` can pay from.
    function fundRewardPool() external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        if (msg.value == 0) revert ZeroAmount();
        rewardPool += msg.value;
        emit RewardPoolFunded(msg.sender, msg.value, rewardPool);
    }

    /// @notice Recovers unspent reward-pool funds. Cannot touch staked principal.
    function withdrawRewardPool(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > rewardPool) revert RewardPoolExhausted(amount, rewardPool);

        rewardPool -= amount;
        emit RewardPoolWithdrawn(to, amount, rewardPool);
        _send(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Provider self-service
    // ---------------------------------------------------------------------

    /// @notice Stakes the sent value. Requires an active `NodeRegistry` registration.
    /// @dev Restarts the withdraw cool-down, so topping up cannot be used to dodge it.
    function stake() external payable whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        if (!nodeRegistry.isActive(msg.sender)) revert ProviderNotActive(msg.sender);

        stakes[msg.sender] += msg.value;
        totalStaked += msg.value;
        lastStakedAt[msg.sender] = uint64(block.timestamp);

        emit Staked(msg.sender, msg.value, stakes[msg.sender]);
    }

    /// @notice Withdraws own staked principal, subject to the cool-down and — while the caller is
    ///         still active in `NodeRegistry` — the minimum-stake floor.
    /// @dev A provider deactivated in the registry may withdraw in full once the cool-down elapses;
    ///      the floor exists to keep *active* providers economically bonded.
    function withdraw(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        uint256 balance = stakes[msg.sender];
        if (amount > balance) revert InsufficientStake(msg.sender, amount, balance);

        uint64 availableAt = lastStakedAt[msg.sender] + withdrawCooldownSeconds;
        if (block.timestamp < availableAt) revert WithdrawCooldownActive(msg.sender, availableAt);

        uint256 remaining = balance - amount;
        if (remaining < minimumStake && nodeRegistry.isActive(msg.sender)) {
            revert MinimumStakeNotMet(msg.sender, remaining, minimumStake);
        }

        // State updated before the external call (checks-effects-interactions).
        stakes[msg.sender] = remaining;
        totalStaked -= amount;

        emit Withdrawn(msg.sender, amount, remaining);
        _send(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Relayer: outcome settlement
    // ---------------------------------------------------------------------

    /// @notice Credits a reward to `provider`, paid strictly from the admin-funded reward pool.
    /// @param evidenceHash keccak256 of the off-chain evidence bundle justifying the reward.
    /// @dev Rewards are credited to the provider's stake rather than transferred out, so they
    ///      remain subject to the same cool-down and slashing rules as principal.
    function reward(address provider, uint256 amount, bytes32 evidenceHash)
        external
        onlyRole(RELAYER_ROLE)
        whenNotPaused
    {
        if (provider == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > rewardPool) revert RewardPoolExhausted(amount, rewardPool);

        rewardPool -= amount;
        stakes[provider] += amount;
        totalStaked += amount;
        reputationScore[provider] += 1;

        emit Rewarded(provider, amount, evidenceHash, reputationScore[provider]);
    }

    /// @notice Slashes up to `slashPolicyCap` from a provider's stake.
    /// @param reasonHash keccak256 of the off-chain governance decision justifying the slash.
    /// @dev Slashed principal moves into `rewardPool`, never to the caller — slashing can never
    ///      profit the relayer. Reverts rather than clamping, so an over-cap request is a visible
    ///      failure the backend must handle instead of a silent partial slash.
    function slash(address provider, uint256 amount, bytes32 reasonHash)
        external
        onlyRole(RELAYER_ROLE)
        whenNotPaused
    {
        if (provider == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > slashPolicyCap) revert SlashExceedsPolicyCap(amount, slashPolicyCap);

        uint256 balance = stakes[provider];
        if (amount > balance) revert InsufficientStake(provider, amount, balance);

        stakes[provider] = balance - amount;
        totalStaked -= amount;
        rewardPool += amount;
        reputationScore[provider] -= 1;

        emit Slashed(provider, amount, reasonHash, reputationScore[provider]);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Timestamp at which `provider` may next withdraw.
    function withdrawAvailableAt(address provider) external view returns (uint64) {
        return lastStakedAt[provider] + withdrawCooldownSeconds;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }
}
