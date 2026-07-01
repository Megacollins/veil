# Veil — ZK Private Payments on Stellar

> **Stellar Hacks: Real-World ZK** · DoraHacks submission · July 2026

Veil is a privacy-preserving payment protocol on Stellar Testnet. Users deposit a fixed denomination of XLM into a shared pool and withdraw to any address using a zero-knowledge proof — with no on-chain link between sender and recipient.

---

## Live Demo

**Frontend:** `https://veil-stellar.vercel.app`  
**Network:** Stellar Testnet  
**Mixer contract:** `CBOFMZOELXBTI4F2AMCTXCDYW3A2H5LMRDJNMCNVSLKKYLHF6YALLOHG`  
**Verifier contract:** `CDWE6YATFW6LN4DY7OCCJU46ZZHTS6NNLTYMD2KIW7EBAV2IJCABTVDG`

---

## How It Works

```
Sender ──deposit──► Mixer contract (Poseidon2 Merkle tree)
                         │
                    [commitment]
                         │
Prover ──ZK proof──► UltraHonk verifier (BN254 native host fns)
                         │
                    [verified]
                         │
Recipient ◄──withdraw─── Mixer contract
```

1. **Deposit** — A secret note `(nullifier, secret)` is generated client-side. The Poseidon2 hash `commitment = H(nullifier, secret)` is stored as a leaf in an on-chain incremental Merkle tree. The sender transfers 1 XLM to the mixer.

2. **Prove** — The Noir circuit proves: *"I know a (nullifier, secret) whose commitment is in the Merkle tree, and I have not spent this nullifier before."* UltraHonk generates a 14,592-byte proof in ~30 seconds. The recipient address is cryptographically bound into the proof via Fiat-Shamir.

3. **Withdraw** — The Soroban contract verifies the UltraHonk proof using Stellar Protocol 26's native BN254 elliptic curve host functions and Poseidon2 hash. If valid, 1 XLM is released to the recipient. The nullifier is marked spent. The sender is never linked.

---

## What the Chain Sees

| Field | Visible? |
|---|---|
| Merkle root | Public |
| Nullifier hash | Public |
| Recipient address | Public |
| ZK proof bytes | Public |
| **Sender address** | **Hidden** |
| **Transfer amount** | **Hidden** |
| **Note secret** | **Hidden** |
| **Merkle path** | **Hidden** |

---

## Tech Stack

| Layer | Technology |
|---|---|
| ZK Circuit | Noir v1.0.0-beta.9 |
| Proving system | UltraHonk (Barretenberg v0.87.0) |
| Curve | BN254 (native Stellar Protocol 26 host fns) |
| Hash | Poseidon2 |
| Smart contract | Soroban (Rust/WASM) |
| Frontend | React + Vite + Tailwind CSS v4 |
| Wallet | Freighter via @creit.tech/stellar-wallets-kit |
| Network | Stellar Testnet |

---

## Project Structure

```
veil/
├── circuits/               # Noir ZK circuit
│   └── tornado/
│       └── src/main.nr     # Merkle membership + nullifier proof
├── contracts/
│   └── tornado_classic/
│       └── contracts/src/
│           └── mixer.rs    # Soroban mixer contract
├── scripts/
│   └── veil-prover/
│       ├── veil-prover.ts  # CLI: deposit note generation + proving
│       └── server.ts       # HTTP prover server (port 3001)
└── frontend/
    └── src/
        ├── App.tsx         # Main dashboard (Send / Pool / Ledger / FAQ views)
        └── index.css       # Tailwind v4 + theme tokens
```

---

## Running Locally

### Prerequisites
- WSL2 (Ubuntu) with Node.js 20+
- Nargo v1.0.0-beta.9 (`noirup`)
- Barretenberg v0.87.0 (`bbup`)
- Stellar CLI (`cargo install stellar-cli`)
- Freighter browser extension

### 1. Start the frontend
```bash
cd ~/veil/frontend
npm run dev
```

Open `http://localhost:5173` in Chrome with Freighter installed and set to Testnet.

> **No local server required** — proof generation and note creation run fully in the browser via Barretenberg WASM. The optional prover server speeds up proving but is not needed.

### 2. (Optional) Start the prover server for faster proving
```bash
cd ~/veil/scripts/veil-prover
npx ts-node server.ts
```

### 3. Run the full flow
1. Click **Connect Wallet** — authenticate with Freighter
2. Click **Generate Note** — creates secret (nullifier, secret) pair
3. Click **Deposit 1 XLM** — sends commitment to on-chain Merkle tree
4. Click **Generate ZK Proof** — runs Noir + UltraHonk (~30s)
5. Click **Withdraw** — verifies proof on Soroban, releases 1 XLM

---

## ZK Circuit

The circuit proves Merkle membership and nullifier validity:

```noir
fn main(
    // Private inputs
    nullifier: Field,
    secret: Field,
    merkle_path: [Field; 20],
    merkle_indices: [u1; 20],
    // Public inputs
    root: pub Field,
    nullifier_hash: pub Field,
    recipient: pub Field,
) {
    let commitment = poseidon2([nullifier, secret]);
    let computed_root = merkle_root(commitment, merkle_path, merkle_indices);
    assert(computed_root == root);
    assert(poseidon2([nullifier]) == nullifier_hash);
    // recipient is bound via Fiat-Shamir in UltraHonk transcript
}
```

---

## Stellar Protocol 26 Integration

Veil uses Stellar Protocol 26's new cryptographic host functions:
- `crypto::bn254_g1_add`, `crypto::bn254_g1_mul`, `crypto::bn254_g1_multiexp` — for UltraHonk pairing checks
- `crypto::poseidon2_hash` — for on-chain Merkle tree computation

This enables full on-chain ZK proof verification without trusted setup, directly in the Soroban VM.

---

## Privacy Guarantees

- **Sender anonymity** — The withdrawal transaction has no link to the deposit transaction
- **Amount privacy** — Fixed denomination; no amount visible on-chain
- **Double-spend prevention** — Nullifier hash stored on-chain; cannot reuse a note
- **Recipient binding** — Recipient is bound into the proof; cannot redirect funds after proving

---

*Built for Stellar Hacks: Real-World ZK hackathon — DoraHacks, July 2026*
