// Gives a business's code a secret, such as a NEAR AI key, encrypted so only the
// pinned build, run through this business, can read it.
//
//   LIEN_NETWORK=testnet OPERATOR=you.testnet AGENT=sentinel.v1... \
//     SECRET_NAME=NEAR_AI_API_KEY SECRET_VALUE=... npm run store-secret
//
// Then point the service at the row: set secrets_profile with update_service.

import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";
import { account, call, network, OUTLAYER_API, view } from "./lib.js";

const net = network();
const { OPERATOR: operatorId, AGENT: agent, SECRET_NAME: name, SECRET_VALUE: value } = process.env;
const profile = process.env.PROFILE ?? "default";
if (!operatorId || !agent || !name || !value) throw new Error("Set OPERATOR, AGENT, SECRET_NAME and SECRET_VALUE");

const state = await view<any>(agent, "get_agent", {}, net);
const hash = state.service.wasm.hash as string;
const accessor = { WasmHash: { hash } };
// Only this build, called through this business, can open the row.
const access = {
  Logic: {
    operator: "And",
    conditions: [{ WasmHash: { hash } }, { Predecessor: { condition: { Whitelist: { accounts: [agent] } } } }],
  },
};

const plaintext = JSON.stringify({ [name]: value });
const response = await fetch(`${OUTLAYER_API[net]}/secrets/pubkey`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  // The endpoint needs the shape of the secret, never its value.
  body: JSON.stringify({ accessor: { type: "WasmHash", hash }, owner: agent, profile, secrets_json: JSON.stringify({ [name]: "" }) }),
});
if (!response.ok) throw new Error(`Keystore answered ${response.status}: ${await response.text()}`);
const { pubkey } = (await response.json()) as { pubkey: string };

// ECIES v1, the wire format OutLayer's keystore expects:
// [ 0x01 | ephemeral_x25519_pub(32) | nonce(12) | ciphertext | tag(16) ]
const recipient = Buffer.from(pubkey, "hex");
const ephemeral = x25519.utils.randomSecretKey();
const shared = x25519.getSharedSecret(ephemeral, recipient);
const key = hkdf(sha256, shared, undefined, new TextEncoder().encode("outlayer-keystore-v1"), 32);
const nonce = randomBytes(12);
const sealed = chacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plaintext));
const encrypted = Buffer.concat([Buffer.from([1]), x25519.getPublicKey(ephemeral), nonce, sealed]).toString("base64");

const estimate = await view<string>(state.outlayer, "estimate_storage_cost", {
  accessor,
  profile,
  owner: agent,
  encrypted_secrets_base64: encrypted,
  access,
  vault_id: null,
}, net);
const { tx } = await call(account(operatorId, net), agent, "store_secrets", {
  accessor,
  profile,
  encrypted_secrets_base64: encrypted,
  access,
}, { deposit: BigInt(estimate) });
console.log(`Stored ${name} in profile "${profile}" for build ${hash.slice(0, 12)}… (${tx})`);
