/**
 * Veil Prover HTTP Server
 * Wraps the CLI prover as a local API at http://localhost:3001
 *
 * POST /deposit  → generates a fresh note (nullifier + secret + commitment)
 * POST /prove    → generates UltraHonk proof for a given note + recipient
 *
 * Run from WSL (where nargo, bb, cargo are installed):
 *   cd scripts/veil-prover && npm install && npx ts-node server.ts
 */

import * as http from "http";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { StrKey } from "@stellar/stellar-sdk";

const PORT = 3001;

const CIRCUIT_DIR = path.resolve(__dirname, "../../circuits/tornado");
const PROVER_TOML = path.join(CIRCUIT_DIR, "Prover.toml");
const TARGET_DIR  = path.join(CIRCUIT_DIR, "target");
const NARGO = `${process.env.HOME}/.nargo/bin/nargo`;
const BB    = `${process.env.HOME}/.bb/bb`;
const CARGO_MANIFEST = path.resolve(__dirname, "../../contracts/tornado_classic/contracts/Cargo.toml");

const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

function randomField(): bigint {
  return BigInt("0x" + crypto.randomBytes(32).toString("hex")) % BN254_PRIME;
}

function run(cmd: string, env?: NodeJS.ProcessEnv): string {
  const PATH = `${process.env.HOME}/.nargo/bin:${process.env.HOME}/.bb:${process.env.HOME}/.cargo/bin:${process.env.PATH}`;
  return execSync(cmd, {
    encoding: "utf8",
    env: { ...process.env, PATH, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
}

function writeProverToml(nullifier: bigint, secret: bigint, recipient: bigint): void {
  const zeros = Array(20).fill('"0"').join(", ");
  fs.writeFileSync(
    PROVER_TOML,
    `nullifier = "${nullifier}"\nsecret = "${secret}"\npath_siblings = [\n  ${zeros}\n]\npath_bits = [\n  ${zeros}\n]\nrecipient = "${recipient}"\n`
  );
}

function computeCommitment(nullifier: bigint, secret: bigint): string {
  writeProverToml(nullifier, secret, 1n);
  run(
    `cargo run --manifest-path ${CARGO_MANIFEST} --example populate_publics --features std`,
    { TORNADO_EMPTY_TREE: "1" }
  );
  const commitmentFile = path.join(TARGET_DIR, "e2e", "commitment");
  if (!fs.existsSync(commitmentFile)) throw new Error("commitment file not written by populate_publics");
  return fs.readFileSync(commitmentFile).toString("hex");
}

function addressToField(addr: string): bigint {
  if (addr.startsWith("G") && addr.length === 56) {
    const raw = StrKey.decodeEd25519PublicKey(addr);
    return BigInt("0x" + Buffer.from(raw).toString("hex")) % BN254_PRIME;
  }
  return BigInt(addr) % BN254_PRIME;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(data);
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = req.url?.split("?")[0];

  if (req.method === "POST" && url === "/deposit") {
    console.log("[deposit] generating fresh note...");
    try {
      const nullifier = randomField();
      const secret    = randomField();
      const commitment = computeCommitment(nullifier, secret);
      const note = { nullifier: nullifier.toString(), secret: secret.toString(), commitment };
      console.log(`[deposit] note ready — commitment: ${commitment.slice(0, 12)}...`);
      sendJson(res, 200, { note });
    } catch (e) {
      console.error("[deposit] error:", e);
      sendJson(res, 500, { error: (e as Error).message });
    }
    return;
  }

  if (req.method === "POST" && url === "/prove") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { note, recipient } = JSON.parse(body);
        if (!note || !recipient) throw new Error("Missing note or recipient");
        console.log(`[prove] generating proof for recipient ${recipient}...`);

        const nullifier     = BigInt(note.nullifier);
        const secret        = BigInt(note.secret);
        const recipientField = addressToField(recipient);

        writeProverToml(nullifier, secret, recipientField);

        run(
          `cargo run --manifest-path ${CARGO_MANIFEST} --example populate_publics --features std`,
          { TORNADO_EMPTY_TREE: "1" }
        );
        run(`${NARGO} execute --program-dir ${CIRCUIT_DIR}`);

        const PROVE_OUT = path.join(TARGET_DIR, "prover_out");
        if (!fs.existsSync(PROVE_OUT)) fs.mkdirSync(PROVE_OUT, { recursive: true });

        run(
          `${BB} prove --scheme ultra_honk --oracle_hash keccak -b ${TARGET_DIR}/tornado_classic.json -w ${TARGET_DIR}/tornado_classic.gz -o ${PROVE_OUT}`
        );

        const proofFile    = fs.existsSync(path.join(PROVE_OUT, "proof"))    ? path.join(PROVE_OUT, "proof")         : path.join(TARGET_DIR, "proof");
        const pubInputsFile = fs.existsSync(path.join(PROVE_OUT, "public_inputs")) ? path.join(PROVE_OUT, "public_inputs") : path.join(TARGET_DIR, "public_inputs");

        const proof        = "0x" + fs.readFileSync(proofFile).toString("hex");
        const public_inputs = "0x" + fs.readFileSync(pubInputsFile).toString("hex");

        console.log("[prove] done.");
        sendJson(res, 200, { proof, public_inputs });
      } catch (e) {
        console.error("[prove] error:", e);
        sendJson(res, 500, { error: (e as Error).message });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Veil prover server listening on http://localhost:${PORT}`);
  console.log("  POST /deposit  — generate a fresh note");
  console.log("  POST /prove    — generate UltraHonk proof");
});
