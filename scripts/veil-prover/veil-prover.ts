/**
 * Veil off-chain prover CLI
 *
 * Usage:
 *   ts-node veil-prover.ts deposit
 *     Generates a random note (nullifier + secret), computes the Poseidon2 commitment,
 *     and prints the note + commitment in JSON. Save the note; it's your spending key.
 *
 *   ts-node veil-prover.ts prove \
 *     --note <note.json>         \
 *     --recipient <STELLAR_ADDRESS>
 *     Generates a Noir/UltraHonk proof binding the note to a specific recipient address.
 *     Outputs proof hex + public_inputs hex to stdout (JSON), ready to submit to the contract.
 *
 * How recipient binding works:
 *   The Stellar address is decoded to its 32-byte raw public key, treated as a
 *   big-endian uint256, then taken mod BN254 prime to yield a valid field element.
 *   The proof cryptographically commits to this value — changing the recipient after
 *   proof generation invalidates the proof, preventing front-running.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync, spawnSync } from "child_process";
import { StrKey } from "@stellar/stellar-sdk";

// ── Constants ────────────────────────────────────────────────────────────────

const CIRCUIT_DIR = path.resolve(__dirname, "../../circuits/tornado");
const PROVER_TOML = path.join(CIRCUIT_DIR, "Prover.toml");
const TARGET_DIR = path.join(CIRCUIT_DIR, "target");
const NARGO = `${process.env.HOME}/.nargo/bin/nargo`;
const BB = `${process.env.HOME}/.bb/bb`;

// BN254 scalar field prime
const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomField(): bigint {
  // 32 random bytes, taken mod BN254 prime to ensure valid field element
  const bytes = crypto.randomBytes(32);
  return BigInt("0x" + bytes.toString("hex")) % BN254_PRIME;
}

function fieldToToml(value: bigint): string {
  return `"${value.toString()}"`;
}

function addressToField(input: string): bigint {
  // Accept either a Stellar G... strkey OR a plain decimal/hex integer (for testing)
  if (input.startsWith("G") && input.length === 56) {
    const raw: Buffer = StrKey.decodeEd25519PublicKey(input);
    if (raw.length !== 32) throw new Error("Unexpected key length");
    const n = BigInt("0x" + raw.toString("hex")) % BN254_PRIME;
    if (n === 0n) throw new Error("Recipient maps to zero field element");
    return n;
  }
  // Fallback: treat as decimal or 0x-prefixed hex integer (for local testing)
  const n = input.startsWith("0x") ? BigInt(input) % BN254_PRIME : BigInt(input) % BN254_PRIME;
  if (n === 0n) throw new Error("Recipient field element is zero");
  return n;
}

function run(cmd: string, env?: NodeJS.ProcessEnv): string {
  const PATH = `${process.env.HOME}/.nargo/bin:${process.env.HOME}/.bb:${process.env.HOME}/.cargo/bin:${process.env.PATH}`;
  return execSync(cmd, {
    encoding: "utf8",
    env: { ...process.env, PATH, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function readBytesHex(filePath: string): string {
  return fs.readFileSync(filePath).toString("hex");
}

// ── Commands ─────────────────────────────────────────────────────────────────

interface Note {
  nullifier: string;
  secret: string;
  commitment: string; // Poseidon2(nullifier, secret) as decimal field string
}

function cmdDeposit(): void {
  const nullifier = randomField();
  const secret = randomField();

  // Compute commitment by running nargo with TORNADO_GENERATE=1 and TORNADO_EMPTY_TREE=1
  // then reading the commitment from target/e2e/commitment. We do this by setting the
  // Prover.toml private inputs and asking populate_publics to compute the leaf.
  // Simpler approach: shell out to the existing populate_publics binary which computes
  // Poseidon2(nullifier, secret) using the real Soroban host functions.

  // Write a minimal Prover.toml with our chosen nullifier/secret and all-zero path
  // (empty tree), then run populate_publics with TORNADO_EMPTY_TREE=1 to compute
  // the commitment (leaf = hash(nullifier,secret)) and store it in target/e2e/commitment.
  const zeroSiblings = Array(20).fill('"0"').join(", ");
  const zeroBits = Array(20).fill('"0"').join(", ");
  const toml = `nullifier = "${nullifier}"\nsecret = "${secret}"\npath_siblings = [\n  ${zeroSiblings}\n]\npath_bits = [\n  ${zeroBits}\n]\nrecipient = "1"\n`;
  fs.writeFileSync(PROVER_TOML, toml);

  // Build the populate_publics binary and run it to get the commitment
  run(
    `cargo build --manifest-path ${CIRCUIT_DIR}/../../contracts/tornado_classic/contracts/Cargo.toml --example populate_publics --features std 2>&1 || true`,
    { TORNADO_EMPTY_TREE: "1" }
  );

  run(
    `cargo run --manifest-path ${CIRCUIT_DIR}/../../contracts/tornado_classic/contracts/Cargo.toml --example populate_publics --features std`,
    { TORNADO_EMPTY_TREE: "1" }
  );

  // Read commitment from Prover.toml output (nullifier_hash field is computed from nullifier)
  // Commitment itself is in target/e2e/commitment
  const commitmentFile = path.join(TARGET_DIR, "e2e", "commitment");
  let commitmentHex = "N/A";
  if (fs.existsSync(commitmentFile)) {
    commitmentHex = fs.readFileSync(commitmentFile).toString("hex");
  }

  const note: Note = {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    commitment: commitmentHex,
  };

  console.log(JSON.stringify({ note, instructions: "Save this note. It is your spending key. commitment is what you deposit on-chain." }, null, 2));
}

function cmdProve(noteFile: string, recipientAddress: string): void {
  if (!fs.existsSync(noteFile)) {
    throw new Error(`Note file not found: ${noteFile}`);
  }

  const raw = JSON.parse(fs.readFileSync(noteFile, "utf8"));
  const note: Note = raw.note ?? raw;
  const { nullifier, secret } = note;

  console.error("[veil] Encoding recipient address as field element...");
  const recipientField = addressToField(recipientAddress);
  console.error(`[veil] recipient field: ${recipientField}`);

  // Write Prover.toml with TORNADO_EMPTY_TREE=1 path (leaf at index 0, empty tree)
  // so the proof is valid for a single-note pool in an empty tree.
  const zeroSiblings = Array(20).fill('"0"').join(", ");
  const zeroBits = Array(20).fill('"0"').join(", ");
  const toml = `nullifier = "${nullifier}"\nsecret = "${secret}"\npath_siblings = [\n  ${zeroSiblings}\n]\npath_bits = [\n  ${zeroBits}\n]\nrecipient = "${recipientField}"\n`;
  fs.writeFileSync(PROVER_TOML, toml);

  // Run populate_publics to compute root + nullifier_hash
  console.error("[veil] Computing Merkle root and nullifier hash...");
  run(
    `cargo run --manifest-path ${CIRCUIT_DIR}/../../contracts/tornado_classic/contracts/Cargo.toml --example populate_publics --features std`,
    { TORNADO_EMPTY_TREE: "1" }
  );
  console.error("[veil] Prover.toml updated with computed public inputs.");

  // Execute circuit (generate witness)
  console.error("[veil] Executing Noir circuit to generate witness...");
  run(`${NARGO} execute --program-dir ${CIRCUIT_DIR}`);
  console.error("[veil] Witness generated.");

  // Use a dedicated output directory so we don't conflict with existing target/proof file
  const PROVE_OUT = path.join(TARGET_DIR, "prover_out");
  if (!fs.existsSync(PROVE_OUT)) fs.mkdirSync(PROVE_OUT, { recursive: true });

  // Generate proof
  console.error("[veil] Generating UltraHonk proof (this takes ~10-30 seconds)...");
  run(
    `${BB} prove --scheme ultra_honk --oracle_hash keccak -b ${TARGET_DIR}/tornado_classic.json -w ${TARGET_DIR}/tornado_classic.gz -o ${PROVE_OUT}`
  );
  console.error("[veil] Proof generated.");

  const fieldsJson = JSON.parse(
    fs.readFileSync(path.join(TARGET_DIR, "public_inputs_fields.json"), "utf8")
  );

  // bb writes proof to PROVE_OUT/proof, public_inputs to PROVE_OUT/public_inputs
  const proofFile = fs.existsSync(path.join(PROVE_OUT, "proof"))
    ? path.join(PROVE_OUT, "proof")
    : path.join(TARGET_DIR, "proof");
  const pubInputsFile = fs.existsSync(path.join(PROVE_OUT, "public_inputs"))
    ? path.join(PROVE_OUT, "public_inputs")
    : path.join(TARGET_DIR, "public_inputs");

  const proofHex = readBytesHex(proofFile);
  const pubInputsHex = readBytesHex(pubInputsFile);

  console.log(
    JSON.stringify(
      {
        proof: "0x" + proofHex,
        public_inputs: "0x" + pubInputsHex,
        recipient: recipientAddress,
        recipient_field: recipientField.toString(),
        note_nullifier_hash: fieldsJson[1] ?? "see public_inputs_fields.json",
      },
      null,
      2
    )
  );
  console.error("[veil] Done. Submit proof and public_inputs to the Veil contract withdraw().");
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [, , command, ...rest] = process.argv;

if (command === "deposit") {
  cmdDeposit();
} else if (command === "prove") {
  // parse --note and --recipient flags
  const noteIdx = rest.indexOf("--note");
  const recipIdx = rest.indexOf("--recipient");
  if (noteIdx === -1 || recipIdx === -1) {
    console.error("Usage: ts-node veil-prover.ts prove --note <note.json> --recipient <STELLAR_ADDRESS>");
    process.exit(1);
  }
  cmdProve(rest[noteIdx + 1], rest[recipIdx + 1]);
} else {
  console.error("Commands: deposit | prove");
  console.error("  deposit                                        Generate a new note");
  console.error("  prove --note <note.json> --recipient <ADDR>   Generate withdrawal proof");
  process.exit(1);
}
