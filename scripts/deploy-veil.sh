#!/usr/bin/env bash
# Veil testnet deployment script
# Deploys:
#   1. UltraHonk verifier contract (with tornado circuit VK)
#   2. Veil mixer contract (with verifier + XLM SAC + denomination)
# Outputs: .veil_contract_ids with both contract IDs ready for .env
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TORNADO_VK="$ROOT_DIR/circuits/tornado/target/vk"
VERIFIER_WASM="$ROOT_DIR/target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm"
MIXER_WASM="$ROOT_DIR/target/wasm32v1-none/release/tornado_classic_contracts.wasm"
IDS_FILE="$ROOT_DIR/.veil_contract_ids"

DENOMINATION=10000000  # 1 XLM in stroops

echo -e "${BLUE}=== Veil Testnet Deployment ===${NC}"

# 1. Fund source account
echo -e "${BLUE}[1/6] Funding source account...${NC}"
bash "$ROOT_DIR/scripts/fund_account.sh"

# 2. Rebuild tornado circuit to get fresh VK
echo -e "${BLUE}[2/6] Building tornado circuit...${NC}"
export PATH="$HOME/.nargo/bin:$HOME/.bb:$HOME/.cargo/bin:$PATH"
bash "$ROOT_DIR/circuits/scripts/build_all.sh" tornado

# 3. Build all contracts (workspace build produces both WASMs)
echo -e "${BLUE}[3/6] Building Soroban contracts...${NC}"
stellar contract build --optimize

# 4. Deploy verifier contract with tornado VK
echo -e "${BLUE}[4/6] Deploying UltraHonk verifier with tornado VK...${NC}"
VERIFIER_ID=$(stellar contract deploy \
  --wasm "$VERIFIER_WASM" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK_NAME" \
  -- \
  --vk_bytes-file-path "$TORNADO_VK")

echo -e "${GREEN}  Verifier deployed: $VERIFIER_ID${NC}"

# 5. Get XLM native SAC address
echo -e "${BLUE}[5/6] Resolving XLM native SAC address...${NC}"
XLM_SAC=$(stellar contract id asset \
  --asset native \
  --network "$STELLAR_NETWORK_NAME")
echo -e "${GREEN}  XLM SAC: $XLM_SAC${NC}"

# 6. Deploy Veil mixer contract
echo -e "${BLUE}[6/6] Deploying Veil mixer contract...${NC}"
MIXER_ID=$(stellar contract deploy \
  --wasm "$MIXER_WASM" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK_NAME" \
  -- \
  --verifier "$VERIFIER_ID" \
  --token "$XLM_SAC" \
  --denomination "$DENOMINATION")

echo -e "${GREEN}  Mixer deployed: $MIXER_ID${NC}"

# Save IDs
cat > "$IDS_FILE" << EOF
VERIFIER_CONTRACT_ID=$VERIFIER_ID
VEIL_CONTRACT_ID=$MIXER_ID
XLM_SAC=$XLM_SAC
EOF

echo ""
echo -e "${GREEN}=== Deployment complete! ===${NC}"
echo ""
echo "Add these to frontend/.env:"
echo "  VITE_VEIL_CONTRACT_ID=$MIXER_ID"
echo "  VITE_VERIFIER_CONTRACT_ID=$VERIFIER_ID"
echo ""
echo "(Also saved to $IDS_FILE)"
