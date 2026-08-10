# GridProof provider registry API

GridProof treats sensor nodes and human reporters as evidence providers. The registry API gives the demo app a first-class way to register and list those providers before evidence starts flowing.

## List providers

```http
GET /api/v1/providers
```

Public read endpoint. Response:

```json
{
  "providers": [
    {
      "id": "2084fca3-725c-4a2d-b521-bc82de112c64",
      "userId": null,
      "walletAddress": "0x1111111111111111111111111111111111111111",
      "providerType": "reporter",
      "zoneId": "8a27f3e2-2608-4a88-b8db-efce68be2a59",
      "reputationCache": 0,
      "active": true,
      "lastSeenAt": null
    }
  ]
}
```

## Register or reactivate a provider

```http
POST /api/v1/providers
Authorization: Bearer <reporter|reviewer|admin JWT>
Content-Type: application/json

{
  "walletAddress": "0x1111111111111111111111111111111111111111",
  "providerType": "reporter",
  "zoneId": "8a27f3e2-2608-4a88-b8db-efce68be2a59"
}
```

Authentication requires role `reporter` or higher. The route is idempotent by `walletAddress`:

- A new provider returns `201` and `"duplicate": false`.
- An unchanged provider returns `200` and `"duplicate": true`.
- A changed provider type/zone reactivates and updates the existing provider, returning `201` and `"duplicate": false`.

Response:

```json
{
  "provider": {
    "id": "2084fca3-725c-4a2d-b521-bc82de112c64",
    "userId": "c9674aa0-5116-476e-9c26-92b7692893b7",
    "walletAddress": "0x1111111111111111111111111111111111111111",
    "providerType": "reporter",
    "zoneId": "8a27f3e2-2608-4a88-b8db-efce68be2a59",
    "reputationCache": 0,
    "active": true,
    "lastSeenAt": null
  },
  "duplicate": false,
  "chainRegistration": {
    "configured": true,
    "mode": "wallet_self_service",
    "chainId": "12345",
    "contractAddress": "0x9999999999999999999999999999999999999999",
    "explorerUrl": "https://explorer.botchain.test/address/0x1111111111111111111111111111111111111111",
    "providerWallet": "0x1111111111111111111111111111111111111111",
    "providerType": "reporter",
    "providerTypeId": 1,
    "zoneId": "8a27f3e2-2608-4a88-b8db-efce68be2a59",
    "zoneKey": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "registerCall": {
      "to": "0x9999999999999999999999999999999999999999",
      "functionName": "register",
      "args": ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 1],
      "data": "0x610b0a4a..."
    },
    "onChain": null,
    "reason": "Provider must call NodeRegistry.register from their own wallet; the backend cannot register a different msg.sender."
  }
}
```

## On-chain registration intent

`NodeRegistry.register(bytes32 zoneId, uint8 providerType)` is self-service: the provider wallet must be `msg.sender`. The backend intentionally does not register arbitrary provider wallets with the relayer key, because that would make the relayer the on-chain provider.

For that reason, `POST /api/v1/providers` saves the local provider mirror and returns a `chainRegistration` object for the frontend/demo operator:

- `providerTypeId` mirrors the Solidity enum: `0` = sensor node, `1` = human reporter.
- `zoneKey` is the bytes32 zone identifier that must already be allow-listed in `NodeRegistry`.
- `registerCall` contains the target contract, function name, args, and encoded calldata for a wallet/MetaMask transaction.
- `onChain` is populated only when the API has enough BOT Chain RPC and contract env vars to read the current `NodeRegistry.getProvider(wallet)` status.

In local demo mode, `configured` is `false` and `registerCall.to`/`registerCall.data` are `null`. After testnet deployment, set:

- `BOTCHAIN_NODE_REGISTRY_ADDRESS`
- `BOTCHAIN_CHAIN_ID`
- `BOTCHAIN_EXPLORER_BASE_URL`, optional
- `BOTCHAIN_RPC_URL`, `RELAYER_PRIVATE_KEY`, `BOTCHAIN_UPTIME_ATTESTATION_ADDRESS`, and `BOTCHAIN_REPUTATION_ESCROW_ADDRESS`, optional for read-back status

## Persistence behavior

When `DATABASE_URL` is configured, registrations are stored in the `providers` table and missing demo zones are created automatically. Without `DATABASE_URL`, the API uses an in-memory provider store for local demo runs and tests.

Provider registration and updates append audit records:

- `provider.registered`
- `provider.registration_updated`

Ingestion can still auto-create providers when evidence arrives first, but the registry API is the preferred path for demo setup and reviewer-visible provider management.
