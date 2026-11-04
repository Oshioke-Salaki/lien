# Deployment

## The app

Deploy `web/` to any Next.js host. On Vercel, set the root directory to `web` and enable including files outside the root, because the app reads `deployments/`.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_NETWORK` | No | `testnet` (default) or `mainnet` |
| `GUEST_SPONSOR_ACCOUNT` | For guests | Testnet account that creates free accounts |
| `GUEST_SPONSOR_KEY` | For guests | Its private key. Server only, and never commit it |
| `ONECLICK_JWT` | No | NEAR Intents partner key, avoiding an extra 0.25% fee |

Each guest costs 0.45 NEAR, plus 0.6 if they start a business. Top up the sponsor from a testnet faucet as needed. The public faucet allows one account per IP about every 11 hours, and gives 10 NEAR.

## The testnet contracts

```bash
./scripts/build.sh
cd ops && npm install
export LIEN_NETWORK=testnet
ROOT_ACCOUNT=you.testnet npm run deploy
SIGNER=you.testnet VENDOR=vendor.testnet npm run publish-agent
ROLES=operator,lender1,lender2,customer npm run seed
```

Keys come from `~/.near-credentials`. Then commit the updated `deployments/testnet.json`.

## Going to mainnet

**Do not put real money in before an audit.** Beyond that, it needs:

1. A mainnet account holding about 60 NEAR. Publishing the global code burns about 42 NEAR, because global storage costs ten times normal storage.
2. `LIEN_NETWORK=mainnet ROOT_ACCOUNT=you.near npm run deploy`, which uses native USDC.
3. `npm run publish-agent`, then import `deployments/mainnet.json` in `web/src/lib/config.ts`.
4. Removing the deployer's key from the registry account, once you are sure.
5. Setting `NEXT_PUBLIC_NETWORK=mainnet`. Intents then quotes for real, with the inbox as recipient, and guests and the faucet switch off.
6. An OutLayer payment check: confirm `outlayer.near` runs your build, using a small job.

## Adding NEAR AI to Sentinel

Get a key at cloud.near.ai, and with no open loan on the business:

```bash
OPERATOR=you.testnet AGENT=sentinel.<registry> SECRET_NAME=NEAR_AI_API_KEY \
  SECRET_VALUE=... npm run store-secret
```

Then set `secrets_profile` to `default` with `update_service`. The secret is readable only by that exact build, called through that business. Changing the build means storing it again.
