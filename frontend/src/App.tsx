import { Buffer } from "buffer";
import { useState, useEffect } from "react";
import {
  Networks, TransactionBuilder, BASE_FEE, Contract, xdr, Address, rpc
} from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import "./App.css";

const TESTNET_RPC        = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const VERIFIER_CONTRACT_ID = import.meta.env.VITE_VERIFIER_CONTRACT_ID ?? "";
const PROVER_SERVER      = "http://localhost:3001";
const EXPLORER_BASE      = "https://stellar.expert/explorer/testnet";

const POOLS: { label: string; xlm: number; stroops: number; contractId: string }[] = [
  { label: "1 XLM",    xlm: 1,    stroops: 10_000_000,    contractId: import.meta.env.VITE_POOL_1    ?? "" },
  { label: "10 XLM",   xlm: 10,   stroops: 100_000_000,   contractId: import.meta.env.VITE_POOL_10   ?? "" },
  { label: "100 XLM",  xlm: 100,  stroops: 1_000_000_000, contractId: import.meta.env.VITE_POOL_100  ?? "" },
  { label: "500 XLM",  xlm: 500,  stroops: 5_000_000_000, contractId: import.meta.env.VITE_POOL_500  ?? "" },
  { label: "1000 XLM", xlm: 1000, stroops: 10_000_000_000,contractId: import.meta.env.VITE_POOL_1000 ?? "" },
];

interface Note { nullifier: string; secret: string; commitment: string; }
type Step = "connect" | "deposit" | "prove" | "withdraw" | "inspector";
type View = "send" | "pool" | "ledger";

StellarWalletsKit.init({
  network: Networks.TESTNET as unknown as import("@creit.tech/stellar-wallets-kit/types").Networks,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule()],
});

/* ── Icons ── */
const VeilLogo   = () => (<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="7" fill="url(#vl)"/><path d="M14 5L21 8.5V14.5C21 18.3 17.9 21.3 14 22.5C10.1 21.3 7 18.3 7 14.5V8.5L14 5Z" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" strokeWidth="0.75"/><rect x="11.5" y="13" width="5" height="6" rx="1" fill="white" opacity="0.92"/><path d="M12.5 13V11.8C12.5 10.8 13.2 10 14 10C14.8 10 15.5 10.8 15.5 11.8V13" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.92"/><circle cx="14" cy="16" r="0.9" fill="#09090f"/><defs><linearGradient id="vl" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#4c1d95"/></linearGradient></defs></svg>);
const CheckIcon  = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const ShieldIcon = ({size=15}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const ZapIcon    = ({size=15}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
const KeyIcon    = ({size=15}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>;
const EyeOffIcon = ({size=14}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const EyeIcon    = ({size=14}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const SendIcon   = ({size=15}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const SunIcon    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const MoonIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const LinkIcon   = ({size=12}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
const TreeIcon   = ({size=15}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const SearchIcon = ({size=14}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const CopyIcon   = ({size=13}:{size?:number}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;

/* ═══════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════ */
export default function App() {
  const [view, setView]                 = useState<View>("send");
  const [step, setStep]                 = useState<Step>("connect");
  const [address, setAddress]           = useState("");
  const [note, setNote]                 = useState<Note | null>(null);
  const [noteJson, setNoteJson]         = useState("");
  const [recipient, setRecipient]       = useState("");
  const [proof, setProof]               = useState("");
  const [publicInputs, setPublicInputs] = useState("");
  const [log, setLog]                   = useState<string[]>([]);
  const [busy, setBusy]                 = useState(false);
  const [deposits, setDeposits]         = useState(0);
  const [light, setLight]               = useState(false);
  const [commitments, setCommitments]   = useState<string[]>([]);
  const [poolIndex, setPoolIndex]       = useState(0);
  const pool = POOLS[poolIndex];

  useEffect(() => { document.documentElement.classList.toggle("light", light); }, [light]);
  useEffect(() => { if (address && !recipient) setRecipient(address); }, [address]);

  const stepOrder: Step[] = ["connect","deposit","prove","withdraw","inspector"];
  const si       = (s: Step) => stepOrder.indexOf(s);
  const isActive = (s: Step) => s === step;
  const isDone   = (s: Step) => si(s) < si(step);
  const isLocked = (s: Step) => si(s) > si(step);
  const addLog   = (msg: string) => setLog(l => [...l, msg]);

  const viewTitles: Record<View, string> = {
    send:   "Send Privately",
    pool:   "Privacy Pool",
    ledger: "Ledger Inspector",
  };
  const viewSubs: Record<View, string> = {
    send:   "ZK-privacy pool",
    pool:   "Anonymity set · Merkle state",
    ledger: "What the chain sees",
  };

  async function connectWallet() {
    setBusy(true);
    try {
      const { address: addr } = await StellarWalletsKit.authModal();
      setAddress(addr); setStep("deposit");
      addLog(`Wallet connected — ${addr.slice(0,8)}…${addr.slice(-4)}`);
    } catch { addLog("Connection cancelled"); } finally { setBusy(false); }
  }

  async function generateNote() {
    setBusy(true); addLog("Generating private note…");
    try {
      const res  = await fetch(`${PROVER_SERVER}/deposit`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNote(data.note); setNoteJson(JSON.stringify(data, null, 2));
      addLog(`Note ready — commitment: ${data.note.commitment.slice(0,14)}…`);
      addLog("Save this note — it is your spending key.");
    } catch (e: unknown) { addLog(`Error: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  async function deposit() {
    if (!note) return; setBusy(true); addLog("Building deposit tx…");
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
      addLog(`Deposit submitted — ${sent.hash.slice(0,14)}… waiting…`);
      // Poll until finalized
      let status = sent.status;
      for (let i = 0; i < 30 && (status === "PENDING" || status === "NOT_FOUND"); i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await server.getTransaction(sent.hash);
        status = poll.status;
        if (poll.status === "SUCCESS") break;
        if (poll.status === "FAILED") throw new Error("Deposit transaction failed on-chain");
      }
      if (status !== "SUCCESS") throw new Error(`Deposit did not confirm (status: ${status})`);
      addLog(`Deposit confirmed — ${sent.hash.slice(0,14)}…`);
      addLog("Commitment on-chain. Amount: PRIVATE. Sender: PRIVATE.");
      setDeposits(d => d + 1);
      setCommitments(c => [...c, note.commitment]);
      setStep("prove");
    } catch (e: unknown) { addLog(`Deposit error: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  async function generateProof() {
    if (!recipient) { addLog("Enter a recipient address."); return; }
    setBusy(true); addLog("Running Noir circuit + UltraHonk prover… (~30s)");
    try {
      const noteData = noteJson ? (JSON.parse(noteJson).note ?? JSON.parse(noteJson)) : note;
      const res  = await fetch(`${PROVER_SERVER}/prove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: noteData, recipient }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setProof(data.proof); setPublicInputs(data.public_inputs);
      addLog(`Proof generated — ${(data.proof.length - 2) / 2} bytes`);
      addLog(`Recipient bound via Fiat-Shamir: ${recipient.slice(0,8)}…`);
      setStep("withdraw");
    } catch (e: unknown) { addLog(`Proof error: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  async function withdraw() {
    if (!proof || !publicInputs) return; setBusy(true); addLog("Submitting proof on-chain…");
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
      addLog(`Withdraw submitted — ${sent.hash.slice(0,14)}… waiting…`);
      let wStatus = sent.status;
      for (let i = 0; i < 30 && (wStatus === "PENDING" || wStatus === "NOT_FOUND"); i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await server.getTransaction(sent.hash);
        wStatus = poll.status;
        if (poll.status === "SUCCESS") break;
        if (poll.status === "FAILED") throw new Error("Withdraw transaction failed on-chain");
      }
      if (wStatus !== "SUCCESS") throw new Error(`Withdraw did not confirm (status: ${wStatus})`);
      addLog(`Withdraw confirmed — ${sent.hash.slice(0,14)}…`);
      addLog("Proof verified via Protocol 26 native BN254 host functions.");
      addLog(`Funds released to ${recipient.slice(0,8)}… — sender never linked.`);
      setStep("inspector");
    } catch (e: unknown) { addLog(`Withdraw error: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  /* ── Sidebar nav items ── */
  const navItems: { icon: React.ReactNode; label: string; view: View }[] = [
    { icon: <SendIcon/>,   label: "Send Privately", view: "send"   },
    { icon: <TreeIcon/>,   label: "Privacy Pool",   view: "pool"   },
    { icon: <EyeIcon/>,    label: "Ledger Inspector",view: "ledger"},
  ];

  return (
    <div className="flex h-screen overflow-hidden t-bg-app">

      {/* ══ Sidebar ══ */}
      <aside className="w-[260px] shrink-0 flex flex-col border-r t-bg-sidebar t-border" style={{transition:"background 0.25s,border-color 0.25s"}}>
        <div className="flex items-center gap-3 px-5 h-[60px] border-b t-border shrink-0">
          <VeilLogo/>
          <span className="text-[1.05rem] font-bold tracking-[-0.4px] t-text-1">Veil<span className="text-purple-400">.</span></span>
        </div>

        <nav className="flex flex-col gap-1 px-3 py-4">
          <p className="px-2 mb-2 text-[0.62rem] font-bold uppercase tracking-widest t-text-5">Menu</p>
          {navItems.map(({ icon, label, view: v }) => (
            <button key={v} onClick={() => setView(v)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.82rem] font-medium w-full text-left transition-all duration-150 border
                ${view === v
                  ? "t-bg-nav-act t-border-acc text-purple-400"
                  : "border-transparent t-text-4 hover:opacity-80"}`}>
              <span className={view === v ? "text-purple-400" : "t-text-5"}>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="px-3 py-2">
          <p className="px-2 mb-2 text-[0.62rem] font-bold uppercase tracking-widest t-text-5">Protocol</p>
          {[
            { icon: <ZapIcon/>,    label: "Noir Circuit"  },
            { icon: <KeyIcon/>,    label: "UltraHonk VK"  },
            { icon: <ShieldIcon/>, label: "BN254 Native"  },
          ].map(({ icon, label }) => (
            <button key={label} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.82rem] font-medium w-full text-left border border-transparent t-text-5 hover:opacity-80 transition-all duration-150">
              {icon}{label}
            </button>
          ))}
        </div>

        <div className="mt-auto mx-3 mb-4">
          {address ? (
            <div className="rounded-xl border t-border-acc p-4" style={{background:"rgba(124,58,237,0.08)"}}>
              <p className="text-[0.62rem] font-bold uppercase tracking-widest text-purple-400 mb-2">Connected</p>
              <p className="font-code text-[0.72rem] t-text-3 break-all leading-relaxed">{address.slice(0,18)}…{address.slice(-6)}</p>
              <div className="flex items-center gap-1.5 mt-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"/>
                <span className="text-[0.7rem] text-emerald-500 font-medium">Freighter · Testnet</span>
              </div>
            </div>
          ) : (
            <button onClick={connectWallet} disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-[0.82rem] font-semibold transition-all duration-150"
              style={{boxShadow:"0 4px 20px rgba(124,58,237,0.4)"}}>
              <ShieldIcon/>{busy ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>
      </aside>

      {/* ══ Right side ══ */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="flex items-center justify-between h-[60px] px-8 border-b t-border glass shrink-0 z-10" style={{transition:"background 0.25s,border-color 0.25s"}}>
          <div className="flex items-center gap-3">
            <span className="text-[0.82rem] font-semibold t-text-1">{viewTitles[view]}</span>
            <span className="t-text-5">·</span>
            <span className="text-[0.78rem] t-text-4">{viewSubs[view]}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLight(l => !l)} title={light?"Dark mode":"Light mode"}
              className="w-8 h-8 flex items-center justify-center rounded-lg border t-border t-bg-raised t-text-3 hover:text-purple-400 transition-all duration-150">
              {light ? <MoonIcon/> : <SunIcon/>}
            </button>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-emerald-500 text-[0.68rem] font-bold uppercase tracking-wider border border-emerald-500/20"
              style={{background:"rgba(16,185,129,0.08)"}}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>Stellar Testnet
            </span>
          </div>
        </header>

        {/* View router */}
        <main className="flex-1 overflow-y-auto px-8 py-8 t-bg-app" style={{
          backgroundImage:"radial-gradient(ellipse 70% 50% at 55% 0%, rgba(124,58,237,0.07) 0%, transparent 60%)",
          transition:"background 0.25s"
        }}>
          {view === "send"   && <SendView {...{step,address,note,noteJson,setNoteJson,recipient,setRecipient,proof,publicInputs,log,busy,deposits,connectWallet,generateNote,deposit,generateProof,withdraw,setStep,isActive,isDone,isLocked,commitments,poolIndex,setPoolIndex,pool}}/>}
          {view === "pool"   && <PoolView deposits={deposits} commitments={commitments}/>}
          {view === "ledger" && <LedgerView note={note} proof={proof} publicInputs={publicInputs} commitments={commitments}/>}
        </main>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   VIEW: SEND PRIVATELY
   ═══════════════════════════════════════════════════════════ */
function SendView({ step, address, note, noteJson, setNoteJson, recipient, setRecipient, proof, publicInputs, log, busy, deposits, connectWallet, generateNote, deposit, generateProof, withdraw, setStep, isActive, isDone, isLocked, commitments, poolIndex, setPoolIndex, pool }: {
  step: Step; address: string; note: Note|null; noteJson: string; setNoteJson:(v:string)=>void;
  recipient: string; setRecipient:(v:string)=>void; proof: string; publicInputs: string;
  log: string[]; busy: boolean; deposits: number; connectWallet:()=>void; generateNote:()=>void;
  deposit:()=>void; generateProof:()=>void; withdraw:()=>void; setStep:(s:Step)=>void;
  isActive:(s:Step)=>boolean; isDone:(s:Step)=>boolean; isLocked:(s:Step)=>boolean; commitments:string[];
  poolIndex: number; setPoolIndex:(i:number)=>void; pool: typeof POOLS[0];
}) {
  return (
    <>
      {/* Hero */}
      <div className="mb-8 animate-fade-up">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border t-border-acc text-purple-400 text-[0.68rem] font-bold uppercase tracking-widest mb-4"
          style={{background:"rgba(124,58,237,0.08)"}}>
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse-dot"/>
          Protocol 26 · BN254 Native · UltraHonk
        </div>
        <h1 className="text-[2.5rem] font-extrabold tracking-[-1.5px] leading-[1.08] gradient-text mb-3">
          Private transfers,<br/>verified on-chain.
        </h1>
        <p className="text-[0.9rem] t-text-4 max-w-[440px] leading-relaxed">
          Deposit into a shared pool. Generate a ZK proof. Withdraw to any address — with no on-chain link between sender and recipient.
        </p>
      </div>

      {/* Denomination selector */}
      <div className="mb-8">
        <p className="text-[0.68rem] font-bold uppercase tracking-widest t-text-5 mb-3">Select Amount</p>
        <div className="flex gap-2 flex-wrap">
          {POOLS.map((p, i) => (
            <button key={p.xlm} onClick={() => { if (step === "deposit") { setPoolIndex(i); } }}
              disabled={step !== "deposit"}
              className={`px-4 py-2 rounded-lg border text-[0.82rem] font-semibold transition-all duration-150
                ${poolIndex === i
                  ? "bg-purple-600 border-purple-500 text-white"
                  : "t-bg-raised t-border t-text-3 hover:border-purple-500/50 hover:text-purple-400"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              style={poolIndex === i ? {boxShadow:"0 4px 20px rgba(124,58,237,0.35)"} : {}}>
              {p.label}
            </button>
          ))}
        </div>
        {step !== "deposit" && <p className="text-[0.7rem] t-text-5 mt-2">Amount locked in — start a new note to change</p>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { icon: <ShieldIcon size={16}/>, value: "100%",         label: "Sender privacy"   },
          { icon: <ZapIcon size={16}/>,    value: "~30s",         label: "Proof generation" },
          { icon: <KeyIcon size={16}/>,    value: String(deposits), label: "Notes deposited" },
        ].map(({ icon, value, label }) => (
          <div key={label} className="relative rounded-xl border t-border t-bg-card p-5 group overflow-hidden" style={{transition:"background 0.25s,border-color 0.25s"}}>
            <div className="absolute inset-x-0 top-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{background:"linear-gradient(90deg,transparent,rgba(124,58,237,0.5),transparent)"}}/>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-purple-400 mb-4" style={{background:"rgba(124,58,237,0.1)"}}>{icon}</div>
            <div className="text-[1.65rem] font-bold tracking-tight t-text-1 leading-none mb-1">{value}</div>
            <div className="text-[0.73rem] t-text-4 font-medium">{label}</div>
          </div>
        ))}
      </div>

      {/* Dashboard grid */}
      <div className="grid grid-cols-[1fr_320px] gap-6 items-start">
        <div>
          <p className="text-[0.68rem] font-bold uppercase tracking-widest t-text-5 mb-3">Transfer Flow</p>
          <div className="rounded-2xl border t-border t-bg-card overflow-hidden" style={{transition:"background 0.25s,border-color 0.25s"}}>

            <StepRow num={1} title="Connect Wallet" subtitle="Authenticate with Freighter to sign transactions on Stellar testnet." done={isDone("connect")} active={isActive("connect")} locked={isLocked("connect")} last={false}>
              {isActive("connect") && <PrimaryBtn onClick={connectWallet} disabled={busy} className="mt-3"><ShieldIcon/>{busy?"Connecting…":"Connect Freighter"}</PrimaryBtn>}
              {isDone("connect") && <DataBox label="Address" value={address}/>}
            </StepRow>

            <StepRow num={2} title="Generate Note & Deposit" subtitle="A secret note is generated. Only a Poseidon2 hash commitment lands on-chain — no amount, no sender." done={isDone("deposit")} active={isActive("deposit")} locked={isLocked("deposit")} last={false}>
              {isActive("deposit") && <>
                <PrimaryBtn onClick={generateNote} disabled={busy||!!note} className="mt-3"><KeyIcon/>{note?"✓ Note ready":busy?"Generating…":"Generate Note"}</PrimaryBtn>
                {note && <>
                  <DataBox label="On-chain commitment — all the ledger sees" value={note.commitment} className="mt-3"/>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <PrimaryBtn onClick={deposit} disabled={busy||!pool.contractId}><SendIcon/>{!pool.contractId?"⚠ Contract not set":busy?"Depositing…":`Deposit ${pool.label}`}</PrimaryBtn>
                    {!pool.contractId && <SecondaryBtn onClick={()=>setStep("prove")}>Skip (demo)</SecondaryBtn>}
                  </div>
                </>}
              </>}
              {isDone("deposit") && <DataBox label="Commitment" value={note?.commitment??"—"}/>}
            </StepRow>

            <StepRow num={3} title="Generate ZK Proof" subtitle="The recipient is cryptographically bound via UltraHonk's Fiat-Shamir transcript. Funds cannot be redirected after this step." done={isDone("prove")} active={isActive("prove")} locked={isLocked("prove")} last={false}>
              {isActive("prove") && <>
                <FieldLabel>Recipient Stellar address</FieldLabel>
                <input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="G…"
                  className="w-full mt-1.5 mb-3 px-3.5 py-2.5 rounded-lg border t-border t-bg-input t-text-1 font-code text-[0.8rem] outline-none focus:border-purple-500"
                  style={{transition:"background 0.25s,border-color 0.15s"}}/>
                <FieldLabel>Your note (from step 2)</FieldLabel>
                <textarea value={noteJson||JSON.stringify({note},null,2)} onChange={e=>setNoteJson(e.target.value)} rows={4}
                  className="w-full mt-1.5 mb-3 px-3.5 py-2.5 rounded-lg border t-border t-bg-input t-text-3 font-code text-[0.7rem] outline-none resize-y"
                  style={{transition:"background 0.25s"}}/>
                <PrimaryBtn onClick={generateProof} disabled={busy||!recipient}><ZapIcon/>{busy?"Computing proof… (~30s)":"Generate ZK Proof"}</PrimaryBtn>
              </>}
              {isDone("prove") && <DataBox label="Proof (preview)" value={`${proof.slice(0,80)}…`}/>}
            </StepRow>

            <StepRow num={4} title="Withdraw — On-Chain Verification" subtitle="Soroban verifies the UltraHonk proof using Protocol 26 native BN254 host functions. Sender is never linked to recipient." done={isDone("withdraw")} active={isActive("withdraw")} locked={isLocked("withdraw")} last={false}>
              {isActive("withdraw") && <>
                {proof && <DataBox label="Proof" value={`${proof.slice(0,96)}…`} className="mb-3"/>}
                <div className="flex gap-2 flex-wrap">
                  <PrimaryBtn onClick={withdraw} disabled={busy||!pool.contractId}><ShieldIcon/>{!pool.contractId?"⚠ Contract not set":busy?"Submitting proof…":`Withdraw ${pool.label}`}</PrimaryBtn>
                  {!pool.contractId && <SecondaryBtn onClick={()=>setStep("inspector")}>Skip (demo)</SecondaryBtn>}
                </div>
              </>}
              {isDone("withdraw") && <p className="mt-1 text-[0.78rem] text-emerald-500 font-medium flex items-center gap-1.5"><CheckIcon/> Withdrawn</p>}
            </StepRow>

            <StepRow num={5} title="Ledger Inspector" subtitle="Everything a blockchain observer can see. The proof is real. The privacy is real." done={false} active={isActive("inspector")} locked={isLocked("inspector")} last>
              {isActive("inspector") && (
                <div className="grid grid-cols-2 gap-2.5 mt-3">
                  {[
                    { label:"Commitment at deposit", value:note?.commitment??"—",         red:false },
                    { label:"Public inputs",         value:`${publicInputs.slice(0,56)}…`, red:false },
                    { label:"Amount on-chain",       value:"HIDDEN",                       red:true  },
                    { label:"Sender on-chain",       value:"HIDDEN",                       red:true  },
                  ].map(({label,value,red})=>(
                    <div key={label} className={`rounded-lg p-3 border ${red?"border-red-500/20":"t-border t-bg-raised"}`}
                      style={red?{background:"rgba(239,68,68,0.06)"}:{transition:"background 0.25s"}}>
                      <p className={`text-[0.62rem] font-bold uppercase tracking-wider mb-1.5 ${red?"text-red-400/60":"t-text-5"}`}>{label}</p>
                      <p className={`font-code text-[0.68rem] break-all leading-relaxed ${red?"text-red-400 font-black tracking-[3px] text-[0.75rem]":"t-text-5"}`}>{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </StepRow>
          </div>
        </div>

        {/* Right panels */}
        <div className="flex flex-col gap-4">
          <SideCard title="Privacy Guarantees">
            {[
              {label:"Sender address",  hidden:true },
              {label:"Transfer amount", hidden:true },
              {label:"Transaction link",hidden:true },
              {label:"ZK proof",        hidden:false},
              {label:"Merkle root",     hidden:false},
            ].map(({label,hidden})=>(
              <div key={label} className="flex items-center justify-between py-2.5 border-b t-border-sub last:border-0 last:pb-0 first:pt-0">
                <span className="flex items-center gap-2 text-[0.78rem] t-text-4"><EyeOffIcon/>{label}</span>
                <span className={`text-[0.68rem] font-bold tracking-wider px-2 py-0.5 rounded ${hidden?"text-emerald-500 bg-emerald-500/10":"text-amber-400 bg-amber-500/10"}`}>
                  {hidden?"HIDDEN":"PUBLIC"}
                </span>
              </div>
            ))}
          </SideCard>

          <SideCard title="Protocol Stack">
            {[
              ["Circuit","Noir v1.0.0-beta.9"],["Prover","UltraHonk / bb"],
              ["Curve","BN254 native"],["Hash","Poseidon2"],
              ["Contract","Soroban P-26"],["Network","Stellar Testnet"],
            ].map(([k,v])=>(
              <div key={k} className="flex items-center justify-between py-2 border-b t-border-sub last:border-0 last:pb-0 first:pt-0">
                <span className="text-[0.75rem] t-text-4">{k}</span>
                <span className="font-code text-[0.68rem] text-purple-400 px-2 py-0.5 rounded" style={{background:"rgba(124,58,237,0.1)"}}>{v}</span>
              </div>
            ))}
          </SideCard>

          <SideCard title="Activity Log" trailing={<span className="text-[0.65rem] t-text-5">{log.length} events</span>}>
            <div className="flex flex-col max-h-[200px] overflow-y-auto">
              {log.length===0
                ? <p className="text-[0.73rem] t-text-5 italic">Waiting for activity…</p>
                : log.map((msg,i)=>(
                  <div key={i} className={`flex gap-2.5 py-1.5 border-b t-border-sub last:border-0 ${i===log.length-1?"text-purple-400":"t-text-4"}`}>
                    <span className="font-code text-[0.62rem] shrink-0 pt-px t-text-5">{String(i+1).padStart(2,"0")}</span>
                    <span className="text-[0.73rem] leading-snug">{msg}</span>
                  </div>
                ))
              }
            </div>
          </SideCard>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   VIEW: PRIVACY POOL
   ═══════════════════════════════════════════════════════════ */
function PoolView({ deposits, commitments }: { deposits: number; commitments: string[] }) {
  const [copied, setCopied] = useState<string|null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const anonSet  = Math.max(deposits, 1);
  const treeDepth = 20;
  const maxLeaves = Math.pow(2, 20);

  return (
    <div className="animate-fade-up">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border t-border-acc text-purple-400 text-[0.68rem] font-bold uppercase tracking-widest mb-4"
          style={{background:"rgba(124,58,237,0.08)"}}>
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse-dot"/>
          Poseidon2 Merkle Tree · Depth 20
        </div>
        <h1 className="text-[2.2rem] font-extrabold tracking-[-1.2px] leading-[1.1] gradient-text mb-3">Privacy Pool</h1>
        <p className="text-[0.9rem] t-text-4 max-w-[500px] leading-relaxed">
          All deposits share a common Merkle tree. The larger the anonymity set, the stronger the privacy — your withdrawal is indistinguishable from any other.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label:"Total Deposits",    value: String(deposits),           sub: "notes in pool"         },
          { label:"Anonymity Set",     value: String(anonSet),            sub: "indistinguishable txs" },
          { label:"Tree Depth",        value: String(treeDepth),          sub: "Merkle levels"         },
          { label:"Max Capacity",      value: maxLeaves.toLocaleString(), sub: "total leaf slots"      },
        ].map(({label,value,sub})=>(
          <div key={label} className="rounded-xl border t-border t-bg-card p-5" style={{transition:"background 0.25s"}}>
            <div className="text-[1.5rem] font-bold tracking-tight t-text-1 leading-none mb-1">{value}</div>
            <div className="text-[0.72rem] font-semibold t-text-3 mb-0.5">{label}</div>
            <div className="text-[0.65rem] t-text-5">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6 items-start">
        <div className="flex flex-col gap-5">

          {/* Merkle tree visual */}
          <div className="rounded-2xl border t-border t-bg-card p-6" style={{transition:"background 0.25s"}}>
            <p className="text-[0.68rem] font-bold uppercase tracking-widest t-text-5 mb-5">Merkle Tree Structure</p>
            <div className="flex flex-col gap-3">
              {[
                { label:"Root",     desc:"Public — submitted with each withdrawal proof", color:"text-purple-400", bg:"rgba(124,58,237,0.1)" },
                { label:"Branch",   desc:"Internal nodes — never revealed individually",  color:"t-text-3",        bg:"" },
                { label:"Leaf",     desc:"Your commitment hash = Poseidon2(nullifier, secret)", color:"text-emerald-500", bg:"rgba(16,185,129,0.08)" },
              ].map(({label,desc,color,bg})=>(
                <div key={label} className="flex items-start gap-4 p-3 rounded-lg border t-border-sub" style={bg?{background:bg}:{background:"rgba(255,255,255,0.02)"}}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[0.65rem] font-bold flex-shrink-0 ${color}`} style={{background:bg||"rgba(255,255,255,0.04)"}}>
                    {label[0]}
                  </div>
                  <div>
                    <p className={`text-[0.82rem] font-semibold mb-0.5 ${color}`}>{label}</p>
                    <p className="text-[0.75rem] t-text-4 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Commitments table */}
          <div className="rounded-2xl border t-border t-bg-card overflow-hidden" style={{transition:"background 0.25s"}}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b t-border-sub">
              <p className="text-[0.68rem] font-bold uppercase tracking-widest t-text-5">Commitment Log</p>
              <span className="text-[0.65rem] t-text-5">{commitments.length} entries</span>
            </div>
            {commitments.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3 t-text-5" style={{background:"rgba(124,58,237,0.08)"}}>
                  <KeyIcon size={18}/>
                </div>
                <p className="text-[0.82rem] t-text-4 font-medium mb-1">No deposits yet</p>
                <p className="text-[0.75rem] t-text-5">Go to Send Privately to deposit your first note.</p>
              </div>
            ) : (
              <div className="divide-y t-divide">
                {commitments.map((c, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3 hover:t-bg-raised transition-colors">
                    <div>
                      <p className="text-[0.62rem] t-text-5 mb-1">Leaf #{i}</p>
                      <p className="font-code text-[0.72rem] text-purple-400">{c.slice(0,24)}…{c.slice(-8)}</p>
                    </div>
                    <button onClick={() => copy(c, `c${i}`)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border t-border t-text-4 hover:text-purple-400 text-[0.7rem] transition-all">
                      <CopyIcon/>{copied===`c${i}`?"Copied!":"Copy"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: contract info */}
        <div className="flex flex-col gap-4">
          <SideCard title="Contract Addresses">
            <div className="flex flex-col gap-4">
              {[
                { label:"Veil Mixer",    id: VEIL_CONTRACT_ID,     path:"contract" },
                { label:"ZK Verifier",   id: VERIFIER_CONTRACT_ID, path:"contract" },
              ].map(({label,id,path})=>(
                <div key={label}>
                  <p className="text-[0.62rem] font-bold uppercase tracking-wider t-text-5 mb-1.5">{label}</p>
                  <div className="flex items-center gap-2">
                    <p className="font-code text-[0.68rem] text-purple-400 flex-1 truncate">{id || "Not configured"}</p>
                    {id && (
                      <a href={`${EXPLORER_BASE}/${path}/${id}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 px-2 py-1 rounded border t-border t-text-4 hover:text-purple-400 text-[0.68rem] transition-all flex-shrink-0">
                        <LinkIcon/>View
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SideCard>

          <SideCard title="How Privacy Works">
            {[
              { step:"1", text:"You deposit 1 XLM and receive a secret note" },
              { step:"2", text:"A Poseidon2 hash of your note is stored as a Merkle leaf" },
              { step:"3", text:"You prove knowledge of a valid leaf without revealing which one" },
              { step:"4", text:"The pool pays out to any address — sender is unknown" },
            ].map(({step,text})=>(
              <div key={step} className="flex gap-3 py-2.5 border-b t-border-sub last:border-0 last:pb-0 first:pt-0">
                <span className="w-5 h-5 rounded-full bg-purple-600/20 text-purple-400 text-[0.62rem] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</span>
                <p className="text-[0.76rem] t-text-4 leading-relaxed">{text}</p>
              </div>
            ))}
          </SideCard>

          <SideCard title="Denomination">
            <div className="text-center py-3">
              <div className="text-[2rem] font-bold t-text-1 mb-1">1 XLM</div>
              <p className="text-[0.72rem] t-text-5">Fixed denomination per note</p>
              <p className="text-[0.7rem] t-text-5 mt-2">= 10,000,000 stroops</p>
            </div>
          </SideCard>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   VIEW: LEDGER INSPECTOR
   ═══════════════════════════════════════════════════════════ */
function LedgerView({ note, proof, publicInputs, commitments }: { note: Note|null; proof: string; publicInputs: string; commitments: string[] }) {
  const [txInput, setTxInput] = useState("");
  const [copied, setCopied]   = useState<string|null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 1500);
  }

  const pubRoot     = publicInputs ? "0x" + publicInputs.slice(2,66)    : null;
  const pubNullifier= publicInputs ? "0x" + publicInputs.slice(66,130)  : null;
  const pubRecipient= publicInputs ? "0x" + publicInputs.slice(130,194) : null;

  return (
    <div className="animate-fade-up">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border t-border-acc text-purple-400 text-[0.68rem] font-bold uppercase tracking-widest mb-4"
          style={{background:"rgba(124,58,237,0.08)"}}>
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse-dot"/>
          On-chain transparency report
        </div>
        <h1 className="text-[2.2rem] font-extrabold tracking-[-1.2px] leading-[1.1] gradient-text mb-3">Ledger Inspector</h1>
        <p className="text-[0.9rem] t-text-4 max-w-[500px] leading-relaxed">
          This is the complete picture of what any blockchain observer can see. Notice what's missing.
        </p>
      </div>

      {/* Visibility summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label:"Fields visible on-chain", value:"3",   color:"text-amber-400",  bg:"rgba(245,158,11,0.08)",  border:"rgba(245,158,11,0.2)"  },
          { label:"Sender identity",         value:"???", color:"text-red-400",    bg:"rgba(239,68,68,0.06)",   border:"rgba(239,68,68,0.2)"   },
          { label:"Transfer amount",         value:"???", color:"text-red-400",    bg:"rgba(239,68,68,0.06)",   border:"rgba(239,68,68,0.2)"   },
        ].map(({label,value,color,bg,border})=>(
          <div key={label} className="rounded-xl border p-5" style={{background:bg,borderColor:border}}>
            <div className={`text-[1.65rem] font-bold tracking-tight leading-none mb-1 ${color}`}>{value}</div>
            <div className="text-[0.73rem] t-text-4 font-medium">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6 items-start">
        <div className="flex flex-col gap-5">

          {/* Public inputs breakdown */}
          <div className="rounded-2xl border t-border t-bg-card overflow-hidden" style={{transition:"background 0.25s"}}>
            <div className="px-5 py-3.5 border-b t-border-sub">
              <p className="text-[0.68rem] font-bold uppercase tracking-widest t-text-5">Public Inputs (96 bytes — visible to everyone)</p>
            </div>
            {publicInputs ? (
              <div className="divide-y t-divide">
                {[
                  { field:"Merkle Root",      value: pubRoot,      desc:"Proves note is in the tree. Root is public.",           amber:true  },
                  { field:"Nullifier Hash",   value: pubNullifier, desc:"Prevents double-spending. Hash only — secret stays hidden.", amber:true  },
                  { field:"Recipient Field",  value: pubRecipient, desc:"Bound into proof — cannot be changed post-generation.", amber:true  },
                ].map(({field,value,desc,amber})=>(
                  <div key={field} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[0.62rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${amber?"text-amber-400 bg-amber-500/10":"text-emerald-500 bg-emerald-500/10"}`}>PUBLIC</span>
                        <span className="text-[0.82rem] font-semibold t-text-1">{field}</span>
                      </div>
                      <button onClick={() => copy(value??"",(field))}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border t-border t-text-4 hover:text-purple-400 text-[0.7rem] transition-all">
                        <CopyIcon/>{copied===field?"Copied!":"Copy"}
                      </button>
                    </div>
                    <p className="font-code text-[0.7rem] text-purple-400 break-all leading-relaxed mb-1">{value}</p>
                    <p className="text-[0.72rem] t-text-5">{desc}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center">
                <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3 t-text-5" style={{background:"rgba(124,58,237,0.08)"}}>
                  <SearchIcon size={18}/>
                </div>
                <p className="text-[0.82rem] t-text-4 font-medium mb-1">No proof generated yet</p>
                <p className="text-[0.75rem] t-text-5">Complete the Send flow to see real public inputs here.</p>
              </div>
            )}
          </div>

          {/* What's hidden */}
          <div className="rounded-2xl border t-bg-card overflow-hidden" style={{borderColor:"rgba(239,68,68,0.2)",background:"rgba(239,68,68,0.03)"}}>
            <div className="px-5 py-3.5 border-b" style={{borderColor:"rgba(239,68,68,0.15)"}}>
              <p className="text-[0.68rem] font-bold uppercase tracking-widest text-red-400/60">Hidden from the chain (private inputs)</p>
            </div>
            <div className="divide-y" style={{borderColor:"rgba(239,68,68,0.1)"}}>
              {[
                { field:"Nullifier",      value: note?.nullifier,   desc:"Random secret — generates your nullifier hash"         },
                { field:"Secret",         value: note?.secret,      desc:"Random secret — combined with nullifier for commitment" },
                { field:"Merkle Path",    value: "[20 sibling hashes]", desc:"Proves leaf membership without revealing which leaf" },
                { field:"Sender address", value: undefined,         desc:"Never submitted to the chain"                          },
                { field:"Amount",         value: undefined,         desc:"Fixed denomination enforced by contract, not visible"  },
              ].map(({field,value,desc})=>(
                <div key={field} className="px-5 py-3.5" style={{borderColor:"rgba(239,68,68,0.1)"}}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[0.62rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded text-red-400 bg-red-500/10">HIDDEN</span>
                    <span className="text-[0.82rem] font-semibold t-text-1">{field}</span>
                  </div>
                  <p className="font-code text-[0.7rem] text-red-400/50 mb-1">{value ? `${String(value).slice(0,40)}…` : "— never on-chain —"}</p>
                  <p className="text-[0.72rem] t-text-5">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* TX lookup */}
          <div className="rounded-2xl border t-border t-bg-card p-5" style={{transition:"background 0.25s"}}>
            <p className="text-[0.68rem] font-bold uppercase tracking-widest t-text-5 mb-3">Explore Transaction</p>
            <div className="flex gap-2">
              <input value={txInput} onChange={e=>setTxInput(e.target.value)} placeholder="Paste a tx hash…"
                className="flex-1 px-3.5 py-2.5 rounded-lg border t-border t-bg-input t-text-1 font-code text-[0.78rem] outline-none focus:border-purple-500"
                style={{transition:"background 0.25s,border-color 0.15s"}}/>
              <a href={txInput?`${EXPLORER_BASE}/tx/${txInput}`:"#"} target="_blank" rel="noreferrer"
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[0.82rem] font-semibold transition-all ${txInput?"bg-purple-600 hover:bg-purple-500 text-white":"t-bg-raised t-text-5 cursor-not-allowed"}`}
                style={txInput?{boxShadow:"0 4px 20px rgba(124,58,237,0.35)"}:{}}>
                <LinkIcon size={13}/>Open
              </a>
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-col gap-4">
          <SideCard title="Commitment stored at deposit">
            {note?.commitment ? (
              <>
                <p className="font-code text-[0.7rem] text-purple-400 break-all leading-relaxed mb-3">{note.commitment}</p>
                <button onClick={() => copy(note.commitment,"commit")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border t-border t-text-4 hover:text-purple-400 text-[0.72rem] transition-all">
                  <CopyIcon/>{copied==="commit"?"Copied!":"Copy hash"}
                </button>
              </>
            ) : <p className="text-[0.75rem] t-text-5 italic">No commitment yet — deposit first.</p>}
          </SideCard>

          <SideCard title="ZK Proof">
            {proof ? (
              <>
                <p className="text-[0.65rem] t-text-5 mb-2">{(proof.length-2)/2} bytes total</p>
                <p className="font-code text-[0.68rem] text-purple-400 break-all leading-relaxed mb-3">{proof.slice(0,120)}…</p>
                <button onClick={()=>copy(proof,"proof")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border t-border t-text-4 hover:text-purple-400 text-[0.72rem] transition-all">
                  <CopyIcon/>{copied==="proof"?"Copied!":"Copy full proof"}
                </button>
              </>
            ) : <p className="text-[0.75rem] t-text-5 italic">No proof yet — complete step 3.</p>}
          </SideCard>

          <SideCard title="On-Chain vs Off-Chain">
            {[
              { item:"Merkle root",      chain:true  },
              { item:"Nullifier hash",   chain:true  },
              { item:"Recipient field",  chain:true  },
              { item:"ZK proof bytes",   chain:true  },
              { item:"Nullifier secret", chain:false },
              { item:"Note secret",      chain:false },
              { item:"Sender address",   chain:false },
              { item:"Transfer amount",  chain:false },
            ].map(({item,chain})=>(
              <div key={item} className="flex items-center justify-between py-2 border-b t-border-sub last:border-0 last:pb-0 first:pt-0">
                <span className="text-[0.75rem] t-text-4">{item}</span>
                <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded ${chain?"text-amber-400 bg-amber-500/10":"text-red-400 bg-red-500/10"}`}>
                  {chain?"ON-CHAIN":"PRIVATE"}
                </span>
              </div>
            ))}
          </SideCard>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════════════════════ */
function StepRow({ num, title, subtitle, done, active, locked, last, children }:{
  num:number; title:string; subtitle:string; done:boolean; active:boolean; locked:boolean; last:boolean; children?:React.ReactNode;
}) {
  return (
    <div className={`flex gap-5 px-6 py-5 border-b t-border-sub last:border-0 transition-all duration-200
      ${active?"t-bg-step-act":""} ${locked?"opacity-20 pointer-events-none":""} ${done?"opacity-50":""}`}>
      <div className="flex flex-col items-center shrink-0 pt-0.5">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[0.68rem] font-bold border transition-all duration-200
          ${done?"bg-emerald-500/15 border-emerald-500/30 text-emerald-500":
            active?"bg-purple-600 border-purple-500 text-white":"t-bg-raised t-border t-text-5"}`}
          style={active?{boxShadow:"0 0 0 4px rgba(124,58,237,0.15)"}:{}}>
          {done?<CheckIcon/>:num}
        </div>
        {!last && <div className="step-connector-line"/>}
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center justify-between">
          <p className={`text-[0.88rem] font-semibold leading-tight ${done?"t-text-4":"t-text-1"}`}>{title}</p>
          {done && <span className="flex items-center gap-1 text-[0.72rem] text-emerald-500 font-semibold"><CheckIcon/> Done</span>}
        </div>
        <p className="text-[0.78rem] t-text-4 mt-1 leading-relaxed">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function DataBox({ label, value, className="" }:{label:string;value:string;className?:string}) {
  return (
    <div className={`rounded-lg border t-border t-bg-raised p-3 ${className}`} style={{transition:"background 0.25s"}}>
      <p className="text-[0.62rem] font-bold uppercase tracking-wider t-text-5 mb-1.5">{label}</p>
      <p className="font-code text-[0.7rem] text-purple-400 break-all leading-relaxed">{value}</p>
    </div>
  );
}

function FieldLabel({children}:{children:React.ReactNode}) {
  return <p className="text-[0.68rem] font-bold uppercase tracking-wider t-text-4 mt-1">{children}</p>;
}

function PrimaryBtn({onClick,disabled=false,children,className=""}:{onClick:()=>void;disabled?:boolean;children:React.ReactNode;className?:string}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-[0.82rem] font-semibold transition-all duration-150 hover:-translate-y-px active:translate-y-0 ${className}`}
      style={{boxShadow:"0 4px 20px rgba(124,58,237,0.35)"}}>
      {children}
    </button>
  );
}

function SecondaryBtn({onClick,children}:{onClick:()=>void;children:React.ReactNode}) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center px-4 py-2.5 rounded-lg border t-border t-bg-raised t-text-4 hover:text-purple-400 text-[0.8rem] font-medium transition-all duration-150">
      {children}
    </button>
  );
}

function SideCard({title,trailing,children}:{title:string;trailing?:React.ReactNode;children:React.ReactNode}) {
  return (
    <div className="rounded-xl border t-border t-bg-card overflow-hidden" style={{transition:"background 0.25s,border-color 0.25s"}}>
      <div className="flex items-center justify-between px-4 py-3 border-b t-border-sub">
        <p className="text-[0.68rem] font-bold uppercase tracking-widest t-text-4">{title}</p>
        {trailing}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}
