import { Buffer } from "buffer";
import { useState, useEffect, useRef } from "react";
import {
  Networks, TransactionBuilder, BASE_FEE, Contract, xdr, Address, rpc, StrKey
} from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import "./index.css";

const TESTNET_RPC        = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const VERIFIER_CONTRACT_ID = import.meta.env.VITE_VERIFIER_CONTRACT_ID ?? "";
const PROVER_SERVER      = import.meta.env.VITE_PROVER_SERVER ?? "http://localhost:3001";
const EXPLORER_BASE      = "https://stellar.expert/explorer/testnet";

const POOLS = [
  { label: "1",    xlm: 1,    stroops: 10_000_000,    contractId: import.meta.env.VITE_POOL_1    ?? "" },
  { label: "10",   xlm: 10,   stroops: 100_000_000,   contractId: import.meta.env.VITE_POOL_10   ?? "" },
  { label: "100",  xlm: 100,  stroops: 1_000_000_000, contractId: import.meta.env.VITE_POOL_100  ?? "" },
  { label: "500",  xlm: 500,  stroops: 5_000_000_000, contractId: import.meta.env.VITE_POOL_500  ?? "" },
  { label: "1000", xlm: 1000, stroops: 10_000_000_000,contractId: import.meta.env.VITE_POOL_1000 ?? "" },
];

StellarWalletsKit.init({
  network: Networks.TESTNET as unknown as import("@creit.tech/stellar-wallets-kit/types").Networks,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});

interface Note { nullifier: string; secret: string; commitment: string; nullifier_hash?: string; leafIndex?: number; contractId?: string; }

const BN254_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Precomputed Poseidon2 zero siblings for BN254 (depth 20)
const ZEROS: bigint[] = [
  0n,
  BigInt("5151499478991301833156025595048985053689893395646836724335623777508747990769"),
  BigInt("6425444215191838285069835781607981895589384041954338275956759438530131468944"),
  BigInt("15366428887851194658173001994030115403889500460316803633813719685335613213216"),
  BigInt("16035753591704748209377180686147291356460509756602580601938195381349806255502"),
  BigInt("8144004172175511637373287007127031310278744323254585308703615193240287509983"),
  BigInt("796074195456137668475057404256202455048248910468542119987582633322559749494"),
  BigInt("20567739078944838550556895816409602128127282297589578747131836752205066334747"),
  BigInt("2915761020738377646169465098196184536995852317462848975418156916828302972897"),
  BigInt("10985760690611977917867463287126968335324276333731556907069004868774077204850"),
  BigInt("19208047717975195819992968481289292904158208618635067144381052124352153142918"),
  BigInt("6873111190261103763395069460662520014470628472871405490586772273844549690535"),
  BigInt("5894139036143562089612233756205231544611692010506775540918923829608719739507"),
  BigInt("12794319561613039897672261721253788651586435024857268094532550402122135778769"),
  BigInt("720777601321551456724742356376872832235514487302799006897322578639686749258"),
  BigInt("19726607866286112953874979389205149577323021278529259017954198462517737418473"),
  BigInt("9477901871732605408863140319391985875503693577321165842544029785283526188723"),
  BigInt("3218243980816964110015535469652973420290887819006413761652914020854170460131"),
  BigInt("21647471328696313483506044180817939310547082363167430262013183074005768690677"),
  BigInt("14513543603428597604998785424833526732416414663942895493375066920249255152069"),
];
type Step = "connect" | "deposit" | "prove" | "withdraw" | "done";
type View = "send" | "pool" | "ledger";

const Logo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="9" fill="url(#vl)"/>
    <path d="M16 6L23 9.5V15.5C23 19.9 19.5 23.2 16 24.5C12.5 23.2 9 19.9 9 15.5V9.5L16 6Z"
      fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.75"/>
    <rect x="13" y="15" width="6" height="7" rx="1.5" fill="white" opacity="0.95"/>
    <path d="M14 15V13.5C14 12.1 14.9 11 16 11C17.1 11 18 12.1 18 13.5V15"
      stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.95"/>
    <circle cx="16" cy="18.5" r="1" fill="#09090f"/>
    <defs>
      <linearGradient id="vl" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stopColor="#7c3aed"/><stop offset="1" stopColor="#3730a3"/>
      </linearGradient>
    </defs>
  </svg>
);

const IC = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);

const icons = {
  send:    "M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z",
  pool:    "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  ledger:  "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z",
  shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  key:     "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  zap:     "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  link:    "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3",
  check:   "M20 6L9 17L4 12",
  sun:     "M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 7a5 5 0 100 10A5 5 0 0012 7z",
  moon:    "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
};

function Panel({ title, trailing, children }: { title:string; trailing?:React.ReactNode; children:React.ReactNode }) {
  return (
    <div className="rounded-2xl border t-border t-bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b t-border-sub">
        <p className="text-[0.65rem] font-bold uppercase tracking-widest t-text-4">{title}</p>
        {trailing}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function TopNav({ address, light, setLight, connectWallet, busy, step }: {
  address: string; light: boolean; setLight:(v:boolean)=>void;
  connectWallet:()=>void; busy: boolean; step: Step;
}) {
  const steps: Step[] = ["connect","deposit","prove","withdraw","done"];
  const si = steps.indexOf(step);
  return (
    <header className="shrink-0 h-[60px] flex items-center justify-between px-6 border-b t-border glass z-20">
      <div className="flex items-center gap-3">
        <Logo/>
        <span className="text-[1.1rem] font-bold tracking-[-0.5px] t-text-1">Veil<span className="text-purple-400">.</span></span>
      </div>
      <div className="flex items-center gap-2">
        {steps.slice(0,4).map((s,i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full transition-all duration-300 ${i < si ? "bg-emerald-500" : i === si ? "bg-purple-500" : "t-bg-raised border t-border"}`}
              style={i === si ? {boxShadow:"0 0 8px rgba(139,92,246,0.6)"} : {}}/>
            {i < 3 && <div className={`w-8 h-px ${i < si ? "bg-emerald-500/40" : "t-bg-raised"}`}/>}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setLight(!light)} className="w-8 h-8 rounded-lg flex items-center justify-center t-bg-raised border t-border t-text-3 hover:text-purple-400 transition-all">
          <IC d={light ? icons.moon : icons.sun} size={14}/>
        </button>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border t-border t-bg-raised">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"/>
          <span className="text-[0.7rem] font-semibold text-emerald-500 tracking-wide">TESTNET</span>
        </div>
        {address ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border t-border-acc t-bg-raised" style={{background:"rgba(124,58,237,0.08)"}}>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"/>
            <span className="font-code text-[0.72rem] text-purple-300">{address.slice(0,6)}...{address.slice(-4)}</span>
          </div>
        ) : (
          <button onClick={connectWallet} disabled={busy}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-[0.78rem] font-semibold transition-all"
            style={{boxShadow:"0 4px 16px rgba(124,58,237,0.4)"}}>
            <IC d={icons.shield} size={13}/>{busy ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
    </header>
  );
}

function Sidebar({ view, setView }: { view: View; setView:(v:View)=>void }) {
  const nav = [
    { v:"send" as View,   icon: icons.send,   label: "Send Privately"   },
    { v:"pool" as View,   icon: icons.pool,   label: "Privacy Pool"     },
    { v:"ledger" as View, icon: icons.ledger, label: "Ledger Inspector" },
  ];
  const proto = [
    { icon: icons.zap,    label: "Noir Circuit", href: "https://github.com/Megacollins/veil/blob/main/circuits/src/main.nr" },
    { icon: icons.key,    label: "UltraHonk VK", href: `${EXPLORER_BASE}/contract/${VERIFIER_CONTRACT_ID}` },
    { icon: icons.shield, label: "BN254 Native",  href: "https://developers.stellar.org/docs/learn/encyclopedia/cryptography/bn254" },
  ];
  return (
    <aside className="w-[220px] shrink-0 flex flex-col border-r t-border t-bg-sidebar py-4">
      <div className="px-3 mb-2">
        <p className="px-3 text-[0.6rem] font-bold uppercase tracking-widest t-text-5 mb-1">Menu</p>
        {nav.map(({ v, icon, label }) => (
          <button key={v} onClick={() => setView(v)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[0.82rem] font-medium mb-0.5 border transition-all duration-150
              ${view === v ? "t-bg-nav-act t-border-acc text-purple-400" : "border-transparent t-text-3 hover:t-text-1 hover:t-bg-raised"}`}>
            <span className={view === v ? "text-purple-400" : "t-text-4"}><IC d={icon} size={15}/></span>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-auto px-3">
        <p className="px-3 text-[0.6rem] font-bold uppercase tracking-widest t-text-5 mb-1">Protocol</p>
        {proto.map(({ icon, label, href }) => (
          <a key={label} href={href} target="_blank" rel="noreferrer"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[0.78rem] font-medium mb-0.5 border border-transparent t-text-4 hover:text-purple-400 hover:t-bg-raised transition-all duration-150 group">
            <span className="t-text-5 group-hover:text-purple-400 transition-colors"><IC d={icon} size={13}/></span>
            {label}
            <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity t-text-5"><IC d={icons.link} size={10}/></span>
          </a>
        ))}
      </div>
    </aside>
  );
}

function StepConnect({ connectWallet, busy }: { connectWallet:()=>void; busy: boolean }) {
  return (
    <div className="p-8 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 text-purple-400"
        style={{background:"rgba(124,58,237,0.12)",boxShadow:"0 0 0 1px rgba(124,58,237,0.2)"}}>
        <IC d={icons.shield} size={28}/>
      </div>
      <h2 className="text-[1.3rem] font-bold t-text-1 mb-2">Connect your wallet</h2>
      <p className="text-[0.85rem] t-text-4 mb-6 max-w-[320px] mx-auto leading-relaxed">
        Authenticate with Freighter to sign on Stellar Testnet. Your identity stays private.
      </p>
      <button onClick={connectWallet} disabled={busy}
        className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold text-[0.9rem] transition-all"
        style={{boxShadow:"0 8px 32px rgba(124,58,237,0.45)"}}>
        <IC d={icons.shield} size={16}/>{busy ? "Connecting..." : "Connect Freighter"}
      </button>
    </div>
  );
}

function StepDeposit({ note, busy, pool, generateNote, deposit }: {
  note: Note|null; busy: boolean; pool: typeof POOLS[0]; generateNote:()=>void; deposit:()=>void;
}) {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-purple-400" style={{background:"rgba(124,58,237,0.1)"}}>
          <IC d={icons.key} size={16}/>
        </div>
        <div>
          <h2 className="text-[1rem] font-bold t-text-1">Generate Note & Deposit</h2>
          <p className="text-[0.75rem] t-text-4">Only a Poseidon2 commitment lands on-chain</p>
        </div>
      </div>
      <div className="rounded-2xl p-6 mb-5 border t-border-sub text-center" style={{background:"rgba(124,58,237,0.04)"}}>
        <p className="text-[0.65rem] font-bold uppercase tracking-widest text-purple-400/60 mb-1">Deposit Amount</p>
        <p className="text-[3.5rem] font-extrabold tracking-tight t-text-1 leading-none">{pool.label}</p>
        <p className="text-[0.85rem] t-text-4 mt-1">XLM · Fixed denomination</p>
      </div>
      {note ? (
        <>
          <div className="rounded-xl border t-border t-bg-raised p-4 mb-4">
            <p className="text-[0.6rem] font-bold uppercase tracking-wider text-emerald-500 mb-2">On-chain commitment</p>
            <p className="font-code text-[0.7rem] text-purple-400 break-all leading-relaxed">{note.commitment}</p>
          </div>
          <button onClick={deposit} disabled={busy || !pool.contractId}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold text-[0.9rem] transition-all"
            style={{boxShadow:"0 8px 32px rgba(124,58,237,0.4)"}}>
            <IC d={icons.send} size={16}/>{!pool.contractId ? "Contract not set" : busy ? "Depositing..." : `Deposit ${pool.label} XLM`}
          </button>
        </>
      ) : (
        <button onClick={generateNote} disabled={busy}
          className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl border t-border t-bg-raised t-text-1 hover:border-purple-500/50 hover:text-purple-400 disabled:opacity-40 font-semibold text-[0.9rem] transition-all">
          <IC d={icons.key} size={16}/>{busy ? "Generating..." : "Generate Secret Note"}
        </button>
      )}
    </div>
  );
}

function StepProve({ note, noteJson, setNoteJson, recipient, setRecipient, busy, generateProof }: {
  note: Note|null; noteJson: string; setNoteJson:(v:string)=>void;
  recipient: string; setRecipient:(v:string)=>void; busy: boolean; generateProof:()=>void;
}) {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-amber-400" style={{background:"rgba(245,158,11,0.1)"}}>
          <IC d={icons.zap} size={16}/>
        </div>
        <div>
          <h2 className="text-[1rem] font-bold t-text-1">Generate ZK Proof</h2>
          <p className="text-[0.75rem] t-text-4">Recipient is bound via UltraHonk Fiat-Shamir</p>
        </div>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-[0.65rem] font-bold uppercase tracking-widest t-text-4 mb-1.5">Recipient Stellar Address</label>
          <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="G..."
            className="w-full px-4 py-3 rounded-xl border t-border t-bg-raised t-text-1 font-code text-[0.8rem] outline-none focus:border-purple-500 transition-all"/>
        </div>
        <div>
          <label className="block text-[0.65rem] font-bold uppercase tracking-widest t-text-4 mb-1.5">Your Note (from deposit)</label>
          <textarea value={noteJson || JSON.stringify({note}, null, 2)} onChange={e => setNoteJson(e.target.value)} rows={5}
            className="w-full px-4 py-3 rounded-xl border t-border t-bg-raised t-text-3 font-code text-[0.7rem] outline-none resize-none"/>
        </div>
        <button onClick={generateProof} disabled={busy || !recipient}
          className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white font-bold text-[0.9rem] transition-all"
          style={{boxShadow:"0 8px 32px rgba(245,158,11,0.35)"}}>
          <IC d={icons.zap} size={16}/>{busy ? "Proving in browser (~60s)..." : "Generate ZK Proof"}
        </button>
      </div>
    </div>
  );
}

function StepWithdraw({ proof, pool, busy, withdraw }: {
  proof: string; pool: typeof POOLS[0]; busy: boolean; withdraw:()=>void;
}) {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-emerald-400" style={{background:"rgba(16,185,129,0.1)"}}>
          <IC d={icons.shield} size={16}/>
        </div>
        <div>
          <h2 className="text-[1rem] font-bold t-text-1">Withdraw — On-Chain Verification</h2>
          <p className="text-[0.75rem] t-text-4">Soroban verifies the UltraHonk proof via BN254 host fns</p>
        </div>
      </div>
      {proof && (
        <div className="rounded-xl border t-border t-bg-raised p-4 mb-4">
          <p className="text-[0.6rem] font-bold uppercase tracking-wider text-emerald-500 mb-2">Proof ready — {(proof.length-2)/2} bytes</p>
          <p className="font-code text-[0.65rem] t-text-4 break-all leading-relaxed">{proof.slice(0,120)}...</p>
        </div>
      )}
      <button onClick={withdraw} disabled={busy || !pool.contractId}
        className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-[0.9rem] transition-all"
        style={{boxShadow:"0 8px 32px rgba(16,185,129,0.35)"}}>
        <IC d={icons.shield} size={16}/>{busy ? "Submitting proof..." : `Withdraw ${pool.label} XLM`}
      </button>
    </div>
  );
}

function StepDone({ txHash, recipient, pool, reset }: {
  txHash: string; recipient: string; pool: typeof POOLS[0]; reset:()=>void;
}) {
  return (
    <div className="p-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 text-emerald-400"
        style={{background:"rgba(16,185,129,0.12)",boxShadow:"0 0 0 1px rgba(16,185,129,0.25),0 0 32px rgba(16,185,129,0.15)"}}>
        <IC d={icons.check} size={28}/>
      </div>
      <h2 className="text-[1.4rem] font-bold t-text-1 mb-2">Transfer complete</h2>
      <p className="text-[0.85rem] text-emerald-500 font-semibold mb-1">{pool.label} XLM withdrawn</p>
      <p className="text-[0.78rem] t-text-4 mb-5">Sender was never linked to recipient on-chain</p>
      <div className="rounded-xl border t-border t-bg-raised p-4 text-left mb-5">
        {txHash && (
          <div className="mb-3">
            <p className="text-[0.6rem] font-bold uppercase tracking-wider t-text-5 mb-1">Transaction</p>
            <a href={`${EXPLORER_BASE}/tx/${txHash}`} target="_blank" rel="noreferrer"
              className="font-code text-[0.7rem] text-purple-400 hover:text-purple-300 flex items-center gap-1.5 transition-colors">
              {txHash.slice(0,32)}... <IC d={icons.link} size={10}/>
            </a>
          </div>
        )}
        <div>
          <p className="text-[0.6rem] font-bold uppercase tracking-wider t-text-5 mb-1">Recipient</p>
          <p className="font-code text-[0.72rem] t-text-3">{recipient.slice(0,16)}...{recipient.slice(-8)}</p>
        </div>
      </div>
      <button onClick={reset}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border t-border t-bg-raised t-text-3 hover:text-purple-400 font-semibold text-[0.85rem] transition-all">
        <IC d={icons.refresh} size={14}/>New Transfer
      </button>
    </div>
  );
}

function SendPage({ step, address, note, noteJson, setNoteJson, recipient, setRecipient, proof, publicInputs, log, busy, deposits, connectWallet, generateNote, deposit, generateProof, withdraw, reset, poolIndex, setPoolIndex, pool, txHash, commitments }: {
  step: Step; address: string; note: Note|null; noteJson: string; setNoteJson:(v:string)=>void;
  recipient: string; setRecipient:(v:string)=>void; proof: string; publicInputs: string;
  log: string[]; busy: boolean; deposits: number; connectWallet:()=>void; generateNote:()=>void;
  deposit:()=>void; generateProof:()=>void; withdraw:()=>void; reset:()=>void;
  poolIndex: number; setPoolIndex:(i:number)=>void; pool: typeof POOLS[0];
  txHash: string; commitments: string[];
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="mb-8 animate-fade-up">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border t-border-acc text-purple-400 text-[0.65rem] font-bold uppercase tracking-widest mb-4"
          style={{background:"rgba(124,58,237,0.08)"}}>
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse-dot"/>
          Protocol 26 · BN254 Native · UltraHonk
        </div>
        <h1 className="text-[2.8rem] font-extrabold tracking-[-1.5px] leading-[1.05] gradient-text mb-2">
          Private transfers,<br/>verified on-chain.
        </h1>
        <p className="text-[0.92rem] t-text-3 max-w-[480px] leading-relaxed">
          Deposit XLM into a shared pool. Prove ownership with ZK. Withdraw to any address — sender never linked.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "Sender Privacy",  value: "100%",           icon: icons.shield, color: "text-purple-400"  },
          { label: "Proof Time",      value: "~30s",           icon: icons.zap,    color: "text-amber-400"   },
          { label: "Notes Deposited", value: String(deposits), icon: icons.key,    color: "text-emerald-400" },
          { label: "ZK Curve",        value: "BN254",          icon: icons.pool,   color: "text-sky-400"     },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="rounded-2xl border t-border t-bg-card p-5 relative overflow-hidden group">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{background:"radial-gradient(ellipse 80% 60% at 50% 0%, rgba(124,58,237,0.06), transparent)"}}/>
            <p className={`text-[0.7rem] font-bold uppercase tracking-widest mb-3 ${color}`}>{label}</p>
            <div className="flex items-end justify-between">
              <span className="text-[1.8rem] font-bold tracking-tight t-text-1 leading-none">{value}</span>
              <span className={`${color} opacity-40`}><IC d={icon} size={20}/></span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="flex flex-col gap-4">
          {step === "deposit" && (
            <div className="rounded-2xl border t-border t-bg-card p-5">
              <p className="text-[0.65rem] font-bold uppercase tracking-widest t-text-5 mb-3">Select Amount</p>
              <div className="flex gap-2">
                {POOLS.map((p, i) => (
                  <button key={p.xlm} onClick={() => setPoolIndex(i)}
                    className={`flex-1 py-2.5 rounded-xl border text-[0.85rem] font-bold transition-all duration-150
                      ${poolIndex === i ? "bg-purple-600 border-purple-500 text-white" : "t-bg-raised t-border t-text-3 hover:border-purple-500/40 hover:text-purple-400"}`}
                    style={poolIndex === i ? {boxShadow:"0 4px 20px rgba(124,58,237,0.4)"} : {}}>
                    {p.label}
                    <span className="block text-[0.6rem] font-medium opacity-60 mt-0.5">XLM</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-2xl border t-border t-bg-card overflow-hidden animate-fade-up">
            {step === "connect"  && <StepConnect connectWallet={connectWallet} busy={busy}/>}
            {step === "deposit"  && <StepDeposit note={note} busy={busy} pool={pool} generateNote={generateNote} deposit={deposit}/>}
            {step === "prove"    && <StepProve note={note} noteJson={noteJson} setNoteJson={setNoteJson} recipient={recipient} setRecipient={setRecipient} busy={busy} generateProof={generateProof}/>}
            {step === "withdraw" && <StepWithdraw proof={proof} pool={pool} busy={busy} withdraw={withdraw}/>}
            {step === "done"     && <StepDone txHash={txHash} recipient={recipient} pool={pool} reset={reset}/>}
          </div>
          {(step === "withdraw" || step === "done") && publicInputs && (
            <div className="rounded-2xl border t-border t-bg-card p-5">
              <p className="text-[0.65rem] font-bold uppercase tracking-widest t-text-5 mb-3">Public Inputs (96 bytes)</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label:"Merkle Root",    value: publicInputs.slice(2, 66)   },
                  { label:"Nullifier Hash", value: publicInputs.slice(66, 130) },
                  { label:"Recipient",      value: publicInputs.slice(130,194) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl p-3 border t-border-sub t-bg-raised">
                    <p className="text-[0.6rem] font-bold uppercase tracking-wider text-amber-400/70 mb-1.5">{label}</p>
                    <p className="font-code text-[0.62rem] text-amber-400 break-all leading-relaxed">{value.slice(0,24)}...</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Panel title="Privacy Guarantees">
            {[
              { label:"Sender address",   hidden:true  },
              { label:"Transfer amount",  hidden:true  },
              { label:"Transaction link", hidden:true  },
              { label:"ZK proof",         hidden:false },
              { label:"Merkle root",      hidden:false },
            ].map(({ label, hidden }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b t-border-sub last:border-0">
                <span className="text-[0.78rem] t-text-3">{label}</span>
                <span className={`text-[0.62rem] font-bold tracking-wider px-2 py-0.5 rounded-md ${hidden ? "text-emerald-500 bg-emerald-500/10" : "text-amber-400 bg-amber-400/10"}`}>
                  {hidden ? "HIDDEN" : "PUBLIC"}
                </span>
              </div>
            ))}
          </Panel>
          <Panel title="Protocol Stack">
            {[["Circuit","Noir v1.0.0-beta.9"],["Prover","UltraHonk / bb"],["Curve","BN254 native"],["Hash","Poseidon2"],["Contract","Soroban P-26"],["Network","Stellar Testnet"]].map(([k,v]) => (
              <div key={k} className="flex items-center justify-between py-2 border-b t-border-sub last:border-0">
                <span className="text-[0.75rem] t-text-4">{k}</span>
                <span className="font-code text-[0.68rem] text-purple-400 px-2 py-0.5 rounded-lg" style={{background:"rgba(124,58,237,0.1)"}}>{v}</span>
              </div>
            ))}
          </Panel>
          <Panel title="Activity Log" trailing={<span className="text-[0.62rem] t-text-5">{log.length} events</span>}>
            <div ref={logRef} className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
              {log.length === 0
                ? <p className="text-[0.72rem] t-text-5 italic py-2">Waiting for activity...</p>
                : log.map((msg, i) => (
                  <div key={i} className={`flex gap-2 py-1 ${i === log.length - 1 ? "text-purple-400" : "t-text-4"}`}>
                    <span className="font-code text-[0.6rem] t-text-5 shrink-0 pt-px">{String(i+1).padStart(2,"0")}</span>
                    <span className="text-[0.72rem] leading-snug">{msg}</span>
                  </div>
                ))
              }
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function PoolPage({ deposits, commitments }: { deposits: number; commitments: string[] }) {
  const pools = [
    { label:"1 XLM",    id: import.meta.env.VITE_POOL_1    ?? "" },
    { label:"10 XLM",   id: import.meta.env.VITE_POOL_10   ?? "" },
    { label:"100 XLM",  id: import.meta.env.VITE_POOL_100  ?? "" },
    { label:"500 XLM",  id: import.meta.env.VITE_POOL_500  ?? "" },
    { label:"1000 XLM", id: import.meta.env.VITE_POOL_1000 ?? "" },
  ];
  return (
    <div className="p-8 max-w-[1100px] mx-auto">
      <div className="mb-8">
        <h1 className="text-[2.2rem] font-extrabold tracking-[-1.2px] gradient-text mb-2">Privacy Pool</h1>
        <p className="text-[0.9rem] t-text-4 leading-relaxed max-w-[500px]">
          All deposits share a common Poseidon2 Merkle tree (depth 20). The larger the anonymity set, the stronger the privacy.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label:"Total Deposits",  value: String(deposits) },
          { label:"Anonymity Set",   value: String(Math.max(deposits,1)) },
          { label:"Tree Depth",      value: "20" },
          { label:"Max Capacity",    value: "1,048,576" },
        ].map(({label,value}) => (
          <div key={label} className="rounded-2xl border t-border t-bg-card p-5">
            <p className="text-[0.65rem] font-bold uppercase tracking-widest t-text-5 mb-2">{label}</p>
            <p className="text-[1.8rem] font-bold t-text-1 tracking-tight leading-none">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Panel title="Pool Contracts">
          <div className="flex flex-col gap-3">
            {pools.map(({ label, id }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[0.78rem] font-semibold t-text-3">{label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-code text-[0.65rem] text-purple-400">{id.slice(0,8)}...{id.slice(-6)}</span>
                  <a href={`${EXPLORER_BASE}/contract/${id}`} target="_blank" rel="noreferrer"
                    className="t-text-5 hover:text-purple-400 transition-colors"><IC d={icons.link} size={11}/></a>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Commitment Log" trailing={<span className="text-[0.62rem] t-text-5">{commitments.length} entries</span>}>
          {commitments.length === 0
            ? <p className="text-[0.78rem] t-text-5 italic py-2">No deposits yet</p>
            : commitments.map((c,i) => (
              <div key={i} className="py-2 border-b t-border-sub last:border-0">
                <p className="text-[0.6rem] t-text-5 mb-0.5">Leaf #{i}</p>
                <p className="font-code text-[0.7rem] text-purple-400">{c.slice(0,20)}...{c.slice(-8)}</p>
              </div>
            ))
          }
        </Panel>
      </div>
    </div>
  );
}

function LedgerPage({ note, proof, publicInputs }: { note: Note|null; proof: string; publicInputs: string }) {
  const root      = publicInputs ? publicInputs.slice(2,66)    : null;
  const nullifier = publicInputs ? publicInputs.slice(66,130)  : null;
  const recipient = publicInputs ? publicInputs.slice(130,194) : null;
  return (
    <div className="p-8 max-w-[1100px] mx-auto">
      <div className="mb-8">
        <h1 className="text-[2.2rem] font-extrabold tracking-[-1.2px] gradient-text mb-2">Ledger Inspector</h1>
        <p className="text-[0.9rem] t-text-4 leading-relaxed max-w-[500px]">
          What any blockchain observer can see — notice what is missing.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label:"Fields on-chain", value:"3",   color:"text-amber-400", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.2)"  },
          { label:"Sender identity", value:"???", color:"text-red-400",   bg:"rgba(239,68,68,0.06)",  border:"rgba(239,68,68,0.2)"   },
          { label:"Transfer amount", value:"???", color:"text-red-400",   bg:"rgba(239,68,68,0.06)",  border:"rgba(239,68,68,0.2)"   },
        ].map(({label,value,color,bg,border}) => (
          <div key={label} className="rounded-2xl border p-5" style={{background:bg,borderColor:border}}>
            <p className={`text-[0.65rem] font-bold uppercase tracking-widest mb-2 ${color}`}>{label}</p>
            <p className={`text-[2rem] font-bold leading-none ${color}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Panel title="Public Inputs (visible to everyone)">
          {publicInputs ? (
            <div className="flex flex-col gap-3">
              {[
                { field:"Merkle Root",    value: root      },
                { field:"Nullifier Hash", value: nullifier },
                { field:"Recipient",      value: recipient },
              ].map(({ field, value }) => (
                <div key={field} className="p-3 rounded-xl border t-border-sub t-bg-raised">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded text-amber-400 bg-amber-400/10">PUBLIC</span>
                    <span className="text-[0.78rem] font-semibold t-text-2">{field}</span>
                  </div>
                  <p className="font-code text-[0.68rem] text-purple-400 break-all leading-relaxed">{value}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-[0.78rem] t-text-5 italic py-4 text-center">Complete the Send flow first</p>}
        </Panel>
        <Panel title="Hidden from chain (private inputs)">
          <div className="flex flex-col gap-3">
            {[
              { field:"Nullifier",      value: note?.nullifier,       desc:"Random secret" },
              { field:"Secret",         value: note?.secret,          desc:"Combined with nullifier for commitment" },
              { field:"Merkle Path",    value: "[20 sibling hashes]", desc:"Proves membership without revealing which leaf" },
              { field:"Sender address", value: undefined,             desc:"Never submitted to chain" },
            ].map(({ field, value, desc }) => (
              <div key={field} className="p-3 rounded-xl" style={{background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.12)"}}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded text-red-400 bg-red-400/10">HIDDEN</span>
                  <span className="text-[0.78rem] font-semibold t-text-2">{field}</span>
                </div>
                <p className="font-code text-[0.65rem] text-red-400/50 mb-0.5">{value ? String(value).slice(0,36) + "..." : "— never on-chain —"}</p>
                <p className="text-[0.65rem] t-text-5">{desc}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView]         = useState<View>("send");
  const [step, setStep]         = useState<Step>("connect");
  const [address, setAddress]   = useState("");
  const [note, setNote]         = useState<Note | null>(null);
  const [noteJson, setNoteJson] = useState("");
  const [recipient, setRecipient]       = useState("");
  const [proof, setProof]               = useState("");
  const [publicInputs, setPublicInputs] = useState("");
  const [log, setLog]           = useState<string[]>([]);
  const [busy, setBusy]         = useState(false);
  const [deposits, setDeposits] = useState(0);
  const [light, setLight]       = useState(false);
  const [commitments, setCommitments] = useState<string[]>([]);
  const [poolIndex, setPoolIndex]     = useState(0);
  const [txHash, setTxHash]     = useState("");
  const pool = POOLS[poolIndex];

  useEffect(() => { document.documentElement.classList.toggle("light", light); }, [light]);
  useEffect(() => { if (address && !recipient) setRecipient(address); }, [address]);

  const addLog = (msg: string) => setLog(l => [...l, msg]);

  async function connectWallet() {
    setBusy(true);
    try {
      const { address: addr } = await StellarWalletsKit.authModal();
      setAddress(addr); setStep("deposit");
      addLog(`Connected ${addr.slice(0,8)}...${addr.slice(-4)}`);
    } catch { addLog("Connection cancelled"); } finally { setBusy(false); }
  }

  async function generateNote() {
    setBusy(true); addLog("Generating secret note...");
    try {
      const res  = await fetch(`${PROVER_SERVER}/deposit?t=${Date.now()}`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNote(data.note); setNoteJson(JSON.stringify(data, null, 2));
      addLog(`Note ready — ${data.note.commitment.slice(0,12)}...`);
    } catch (e: unknown) { addLog(`Error: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  async function deposit() {
    if (!note) return; setBusy(true); addLog(`Depositing ${pool.label} XLM...`);
    try {
      const server     = new rpc.Server(TESTNET_RPC);
      const account    = await server.getAccount(address);
      const commitment = Buffer.from(note.commitment, "hex");
      const contract   = new Contract(pool.contractId);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(contract.call("deposit", new Address(address).toScVal(), xdr.ScVal.scvBytes(commitment)))
        .setTimeout(30).build();
      const simResult = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simResult)) throw new Error(simResult.error);
      const assembled = rpc.assembleTransaction(tx, simResult).build();
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(assembled.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE, address });
      const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
      addLog(`Submitted — ${sent.hash.slice(0,12)}... confirming...`);
      let status = sent.status;
      let leafIndex = 0;
      for (let i = 0; i < 30 && (status === "PENDING" || status === "NOT_FOUND"); i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await server.getTransaction(sent.hash);
        status = poll.status;
        if (poll.status === "SUCCESS") {
          try { if (poll.returnValue) leafIndex = poll.returnValue.u32(); } catch {}
          break;
        }
        if (poll.status === "FAILED") throw new Error("Deposit failed on-chain");
      }
      if (status !== "SUCCESS") throw new Error(`Not confirmed (${status})`);
      setTxHash(sent.hash); addLog(`Deposit confirmed — leaf #${leafIndex}`);
      setNote({ ...note, leafIndex, contractId: pool.contractId } as typeof note);
      // Cache commitment in localStorage so Merkle path can be rebuilt without RPC
      try {
        const cacheKey = `veil_commits_${pool.contractId}`;
        const cached: { idx: number; hex: string }[] = JSON.parse(localStorage.getItem(cacheKey) ?? "[]");
        if (!cached.find(c => c.idx === leafIndex)) {
          cached.push({ idx: leafIndex, hex: note.commitment });
          localStorage.setItem(cacheKey, JSON.stringify(cached));
        }
      } catch {}
      setDeposits(d => d + 1); setCommitments(c => [...c, note.commitment]);
      setStep("prove");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      addLog(`Deposit error: ${msg}`);
      if (msg.includes("#1") || msg.toLowerCase().includes("commitmentexists")) {
        addLog("Commitment already used — auto-generating fresh note...");
        setNote(null); setNoteJson("");
        setTimeout(() => generateNote(), 300);
      }
    } finally { setBusy(false); }
  }

  async function readFrontiersFromContract(contractId: string, levels: number[]): Promise<Map<number, bigint>> {
    const result = new Map<number, bigint>();
    try {
      const server = new rpc.Server(TESTNET_RPC);
      const contractAddr = Address.fromString(contractId);
      // Instance storage is read via the special scvLedgerKeyContractInstance key
      const instanceKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: contractAddr.toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        })
      );
      const resp = await server.getLedgerEntries(instanceKey);
      if (!resp.entries?.length) return result;
      const storage: xdr.ScMapEntry[] = (resp.entries[0].val as any)
        .contractData().val().instance().storage() ?? [];
      for (const entry of storage) {
        const k = entry.key();
        if (k.switch().name !== "scvVec") continue;
        const vec = k.vec() ?? [];
        if (vec.length !== 2) continue;
        const sym: string = (vec[0].sym() as unknown as Buffer | string).toString();
        if (sym !== "fr") continue;
        const lvl: number = vec[1].u32();
        if (!levels.includes(lvl)) continue;
        const bytes = entry.val().bytes();
        result.set(lvl, BigInt("0x" + Buffer.from(bytes).toString("hex")));
      }
    } catch (err) { addLog(`Frontier read error: ${(err as Error).message}`); }
    return result;
  }

  async function readRootFromContract(contractId: string): Promise<bigint | null> {
    try {
      const server = new rpc.Server(TESTNET_RPC);
      const contractAddr = Address.fromString(contractId);
      const instanceKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: contractAddr.toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        })
      );
      const resp = await server.getLedgerEntries(instanceKey);
      if (!resp.entries?.length) return null;
      const storage: xdr.ScMapEntry[] = (resp.entries[0].val as any)
        .contractData().val().instance().storage() ?? [];
      for (const entry of storage) {
        const k = entry.key();
        if (k.switch().name === "scvSymbol") {
          const sym: string = (k.sym() as unknown as Buffer | string).toString();
          if (sym === "root") {
            const bytes = entry.val().bytes();
            return BigInt("0x" + Buffer.from(bytes).toString("hex"));
          }
        }
      }
    } catch (err) { addLog(`Root read error: ${(err as Error).message}`); }
    return null;
  }

  async function fetchDepositCommitments(contractId: string, leafIndex: number): Promise<string[]> {
    if (leafIndex === 0) return [];

    // 1) localStorage cache (filled at deposit time)
    const cacheKey = `veil_commits_${contractId}`;
    const cached: { idx: number; hex: string }[] = JSON.parse(localStorage.getItem(cacheKey) ?? "[]");
    const prior = cached.filter(c => c.idx < leafIndex).sort((a, b) => a.idx - b.idx);
    if (prior.length >= leafIndex) {
      addLog(`Using ${prior.length} cached commitments`);
      return prior.map(c => c.hex);
    }

    // 2) stellar.expert REST API — indexes all Soroban events
    addLog("Fetching deposit events from stellar.expert...");
    try {
      const url = `https://api.stellar.expert/explorer/testnet/contract-events?contract=${contractId}&after=0&limit=200&order=asc`;
      const r = await fetch(url);
      const j = await r.json();
      const records: any[] = j?._embedded?.records ?? j?.records ?? [];
      addLog(`stellar.expert: ${records.length} events`);
      for (const rec of records) {
        try {
          const topics: string[] = rec.topics ?? rec.topic ?? [];
          if (topics.length < 2) continue;
          const t0 = xdr.ScVal.fromXDR(topics[0], "base64");
          const sym: string = (t0.sym() as unknown as Buffer | string).toString();
          if (sym !== "deposit") continue;
          const t1 = xdr.ScVal.fromXDR(topics[1], "base64");
          const idx: number = t1.u32();
          if (idx >= leafIndex) continue;
          const valXdr: string = rec.value ?? rec.data;
          const dataVal = xdr.ScVal.fromXDR(valXdr, "base64");
          for (const entry of dataVal.map() ?? []) {
            const k: string = (entry.key().sym() as unknown as Buffer | string).toString();
            if (k === "commitment") {
              const hex = Buffer.from(entry.val().bytes()).toString("hex");
              if (!cached.find(x => x.idx === idx)) cached.push({ idx, hex });
            }
          }
        } catch {}
      }
      localStorage.setItem(cacheKey, JSON.stringify(cached));
      const result = cached.filter(c => c.idx < leafIndex).sort((a, b) => a.idx - b.idx);
      addLog(`Found ${result.length} prior commitments`);
      if (result.length >= leafIndex) return result.map(c => c.hex);
    } catch (err) { addLog(`stellar.expert failed: ${(err as Error).message}`); }

    // 3) Raw Soroban RPC getEvents fallback
    addLog("Trying Soroban RPC getEvents...");
    try {
      const server = new rpc.Server(TESTNET_RPC);
      const latest = await server.getLatestLedger();
      const startLedger = Math.max(1, latest.sequence - 100_000);
      const rpcResp = await fetch(TESTNET_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "getEvents",
          params: { startLedger, filters: [{ contractIds: [contractId] }], limit: 200 }
        })
      });
      const rpcData = await rpcResp.json();
      const events: any[] = rpcData?.result?.events ?? [];
      addLog(`RPC returned ${events.length} events`);
      for (const ev of events) {
        try {
          const topics: string[] = ev.topic ?? [];
          if (topics.length < 2) continue;
          const t0 = xdr.ScVal.fromXDR(topics[0], "base64");
          const sym: string = (t0.sym() as unknown as Buffer | string).toString();
          if (sym !== "deposit") continue;
          const t1 = xdr.ScVal.fromXDR(topics[1], "base64");
          const idx: number = t1.u32();
          if (idx >= leafIndex) continue;
          const rawVal = ev.value;
          const dataVal = xdr.ScVal.fromXDR(typeof rawVal === "string" ? rawVal : rawVal?.xdr ?? rawVal, "base64");
          for (const entry of dataVal.map() ?? []) {
            const k: string = (entry.key().sym() as unknown as Buffer | string).toString();
            if (k === "commitment") {
              const hex = Buffer.from(entry.val().bytes()).toString("hex");
              if (!cached.find(x => x.idx === idx)) cached.push({ idx, hex });
            }
          }
        } catch {}
      }
      localStorage.setItem(cacheKey, JSON.stringify(cached));
    } catch {}

    const final = cached.filter(c => c.idx < leafIndex).sort((a, b) => a.idx - b.idx);
    addLog(`Total prior commitments found: ${final.length} / ${leafIndex} needed`);
    return final.map(c => c.hex);
  }

  async function generateProof() {
    if (!recipient) { addLog("Enter recipient address."); return; }
    setBusy(true); addLog("Starting browser ZK proof...");
    try {
      const noteData   = noteJson ? (JSON.parse(noteJson).note ?? JSON.parse(noteJson)) : note;
      const leafIndex  = (note as any)?.leafIndex  ?? noteData?.leafIndex  ?? 0;
      const contractId = (note as any)?.contractId ?? noteData?.contractId ?? pool.contractId;

      const nullifierHex: string | undefined = noteData?.nullifier_hash;
      if (!nullifierHex) throw new Error("Note missing nullifier_hash — please generate a fresh note");

      // Build Merkle path: frontier values for bit=1 levels, hardcoded zeros for bit=0
      const neededLevels: number[] = [];
      for (let i = 0; i < 20; i++) if ((leafIndex >> i) & 1) neededLevels.push(i);

      let frontierMap = new Map<number, bigint>();
      if (neededLevels.length > 0) {
        addLog(`Reading Merkle frontier from contract (leaf #${leafIndex})...`);
        frontierMap = await readFrontiersFromContract(contractId, neededLevels);
        if (frontierMap.size < neededLevels.length)
          throw new Error(`Frontier incomplete: ${frontierMap.size}/${neededLevels.length} levels`);
        addLog(`Frontier ready (${frontierMap.size} levels)`);
      }

      const bits: number[] = [];
      const siblings: bigint[] = [];
      for (let i = 0; i < 20; i++) {
        const bit = (leafIndex >> i) & 1;
        bits.push(bit);
        siblings.push(bit === 1 ? frontierMap.get(i)! : ZEROS[i]);
      }

      // Read current Merkle root from contract storage
      addLog("Reading Merkle root from contract...");
      const root = await readRootFromContract(contractId);
      if (root === null) throw new Error("Could not read Merkle root from contract");
      addLog(`Root: ${root.toString(16).slice(0, 16)}...`);

      // Convert Stellar address to BN254 field element
      const recipientField = (() => {
        if (recipient.startsWith("G") && recipient.length === 56) {
          const raw = StrKey.decodeEd25519PublicKey(recipient);
          return BigInt("0x" + Buffer.from(raw).toString("hex")) % BN254_PRIME;
        }
        return BigInt(recipient) % BN254_PRIME;
      })();

      const nullifierHash = BigInt("0x" + nullifierHex);

      // Lazy-load WASM packages only when proving
      addLog("Loading WASM prover...");
      const { Noir } = await import("@noir-lang/noir_js");
      const { UltraHonkBackend } = await import("@aztec/bb.js");
      const circuitJson = await fetch("/tornado_classic.json").then(r => r.json());

      const backend = new UltraHonkBackend(circuitJson.bytecode);
      const noir = new Noir(circuitJson);

      addLog("Generating witness...");
      const { witness } = await noir.execute({
        root: root.toString(),
        nullifier_hash: nullifierHash.toString(),
        recipient: recipientField.toString(),
        nullifier: noteData.nullifier.toString(),
        secret: noteData.secret.toString(),
        path_siblings: siblings.map(s => s.toString()),
        path_bits: bits.map(b => b.toString()),
      });

      addLog("Running UltraHonk prover (~30–60s)...");
      const { proof: proofBytes, publicInputs: pubInArr } = await backend.generateProof(witness);

      const proofHex = "0x" + Buffer.from(proofBytes).toString("hex");
      // publicInputs is Uint8Array[] — each element is one 32-byte field (root, nullifier_hash, recipient)
      const pubHex = "0x" + pubInArr.map((b: Uint8Array | string) =>
        (typeof b === "string" ? b.replace("0x", "") : Buffer.from(b).toString("hex")).padStart(64, "0")
      ).join("");

      setProof(proofHex); setPublicInputs(pubHex);
      addLog(`Proof ready — ${proofBytes.length} bytes`);
      setStep("withdraw");
    } catch (e: unknown) { addLog(`Proof error: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  async function withdraw() {
    if (!proof || !publicInputs) return; setBusy(true); addLog("Submitting proof on-chain...");
    try {
      const server   = new rpc.Server(TESTNET_RPC);
      const account  = await server.getAccount(address);
      const contract = new Contract(pool.contractId);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(contract.call("withdraw",
          new Address(recipient).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(publicInputs.replace("0x",""),"hex")),
          xdr.ScVal.scvBytes(Buffer.from(proof.replace("0x",""),"hex"))))
        .setTimeout(30).build();
      const simResult = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simResult)) throw new Error(simResult.error);
      const assembled = rpc.assembleTransaction(tx, simResult).build();
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(assembled.toXDR(), { networkPassphrase: NETWORK_PASSPHRASE, address });
      const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE));
      addLog(`Submitted — ${sent.hash.slice(0,12)}... confirming...`);
      let wStatus = sent.status;
      for (let i = 0; i < 30 && (wStatus === "PENDING" || wStatus === "NOT_FOUND"); i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await server.getTransaction(sent.hash);
        wStatus = poll.status;
        if (poll.status === "SUCCESS") break;
        if (poll.status === "FAILED") throw new Error("Withdraw failed on-chain");
      }
      if (wStatus !== "SUCCESS") throw new Error(`Not confirmed (${wStatus})`);
      setTxHash(sent.hash); addLog("Withdrawn — sender unlinked");
      setStep("done");
    } catch (e: unknown) { addLog(`Withdraw error: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  function reset() {
    setStep("deposit"); setNote(null); setNoteJson(""); setProof("");
    setPublicInputs(""); setTxHash(""); addLog("--- new transfer ---");
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden t-bg-app font-sans">
      <TopNav address={address} light={light} setLight={setLight} connectWallet={connectWallet} busy={busy} step={step}/>
      <div className="flex flex-1 min-h-0">
        <Sidebar view={view} setView={setView}/>
        <main className="flex-1 overflow-y-auto">
          {view === "send"   && <SendPage {...{step,address,note,noteJson,setNoteJson,recipient,setRecipient,proof,publicInputs,log,busy,deposits,connectWallet,generateNote,deposit,generateProof,withdraw,reset,poolIndex,setPoolIndex,pool,txHash,commitments}}/>}
          {view === "pool"   && <PoolPage deposits={deposits} commitments={commitments}/>}
          {view === "ledger" && <LedgerPage note={note} proof={proof} publicInputs={publicInputs}/>}
        </main>
      </div>
    </div>
  );
}
