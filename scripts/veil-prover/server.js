/**
 * Veil Prover HTTP Server
 * Exposes the prover CLI as a local REST API for the frontend.
 * Run: node server.js   (inside scripts/veil-prover/)
 *
 * POST /deposit  → { note: { nullifier, secret, commitment } }
 * POST /prove    → { note, recipient } → { proof, public_inputs, recipient_field }
 */

const http = require("http");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PORT = 3001;
const TS_NODE = path.join(__dirname, "node_modules/.bin/ts-node");
const PROVER = path.join(__dirname, "veil-prover.ts");
const HOME = process.env.HOME || "/home/dell1234";
const LINUX_PATH = `${HOME}/.nvm/versions/node/v20.20.2/bin:${HOME}/.nargo/bin:${HOME}/.bb:${HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin`;

function runProver(args, stdin) {
  return execFileSync(
    TS_NODE,
    [PROVER, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: LINUX_PATH },
      input: stdin,
      timeout: 120_000,
    }
  );
}

function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  let body = "";
  req.on("data", d => (body += d));
  req.on("end", () => {
    try {
      if (req.method === "POST" && req.url === "/deposit") {
        const output = runProver(["deposit"], "");
        const data = JSON.parse(output);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));

      } else if (req.method === "POST" && req.url === "/prove") {
        const { note, recipient } = JSON.parse(body);

        // Write note to a temp file
        const tmpNote = path.join("/tmp", `note-${crypto.randomBytes(4).toString("hex")}.json`);
        fs.writeFileSync(tmpNote, JSON.stringify({ note }));

        try {
          const output = runProver(["prove", "--note", tmpNote, "--recipient", String(recipient)], "");
          const data = JSON.parse(output);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        } finally {
          fs.unlinkSync(tmpNote);
        }

      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (e) {
      console.error("Prover error:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Veil prover server running at http://localhost:${PORT}`);
  console.log("  POST /deposit  — generate note");
  console.log("  POST /prove    — generate ZK proof");
});
