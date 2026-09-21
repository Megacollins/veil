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
type View = "landing" | "send" | "pool" | "ledger" | "faq";

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
    <div className="rounded-2xl overflow-hidden relative" style={{
      background:"var(--bg-card)",
      border:"1px solid var(--border-main)",
      boxShadow:"0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)"
    }}>
      {/* top accent line */}
      <div className="absolute top-0 left-0 right-0 h-[1px]"
        style={{background:"linear-gradient(90deg,transparent,rgba(124,58,237,0.4),rgba(167,139,250,0.2),transparent)"}}/>
      <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{borderColor:"var(--border-subtle)"}}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-full" style={{background:"linear-gradient(180deg,var(--p500),var(--p700))"}}/>
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.12em]" style={{color:"var(--text-faint)"}}>{title}</p>
        </div>
        {trailing}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function TopNav({ address, light, setLight, connectWallet, disconnectWallet, busy, step, onLogoClick, view, onLaunch, sidebarOpen, setSidebarOpen, showSidebarToggle }: {
  address: string; light: boolean; setLight:(v:boolean)=>void;
  connectWallet:()=>void; disconnectWallet:()=>void; busy: boolean; step: Step; onLogoClick:()=>void; view: View; onLaunch:()=>void;
  sidebarOpen: boolean; setSidebarOpen:(v:boolean)=>void; showSidebarToggle: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const steps: Step[] = ["connect","deposit","prove","withdraw","done"];
  const si = steps.indexOf(step);
  return (
    <header className="shrink-0 h-[60px] flex items-center justify-between px-4 sm:px-6 border-b t-border glass z-20">
      <div className="flex items-center gap-2">
        {showSidebarToggle && (
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center t-bg-raised border t-border t-text-3 hover:text-purple-400 transition-all">
            <IC d={sidebarOpen ? "M18 6L6 18M6 6l12 12" : "M3 12h18M3 6h18M3 18h18"} size={15}/>
          </button>
        )}
        <button onClick={onLogoClick} className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity">
          <Logo/>
          <span className="text-[1.1rem] font-bold tracking-[-0.5px] t-text-1">Veil<span className="text-purple-400">.</span></span>
        </button>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button onClick={() => setLight(!light)} className="w-8 h-8 rounded-lg flex items-center justify-center t-bg-raised border t-border t-text-3 hover:text-purple-400 transition-all">
          <IC d={light ? icons.moon : icons.sun} size={14}/>
        </button>
        {view !== "landing" && <>
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border t-border t-bg-raised">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"/>
            <span className="text-[0.7rem] font-semibold text-emerald-500 tracking-wide">TESTNET</span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border" style={{background:"rgba(124,58,237,0.08)",borderColor:"rgba(124,58,237,0.3)"}}>
            <IC d={icons.shield} size={11}/>
            <span className="text-[0.65rem] font-bold text-purple-400 tracking-wide">NO TRUSTED SETUP</span>
          </div>
        </>}
        {view === "landing" && (
          <button onClick={onLaunch}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-[0.8rem] transition-all"
            style={{background:"#ffffff", color:"#000000"}}
            onMouseEnter={e=>(e.currentTarget.style.background="#e5e5e5")}
            onMouseLeave={e=>(e.currentTarget.style.background="#ffffff")}>
            <IC d={icons.shield} size={13}/>Launch App
          </button>
        )}
        {view !== "landing" && address ? (
          <div className="relative">
            {/* Wallet chip — click to toggle dropdown */}
            <button
              onClick={() => setShowMenu(v => !v)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border transition-all duration-150 group"
              style={{
                background: showMenu ? "rgba(124,58,237,0.14)" : "rgba(124,58,237,0.08)",
                borderColor: showMenu ? "rgba(124,58,237,0.55)" : "rgba(124,58,237,0.3)",
                boxShadow: showMenu ? "0 0 0 3px rgba(124,58,237,0.1)" : "none",
              }}>
              {/* Avatar circle */}
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[0.5rem] font-bold text-white"
                style={{background:"linear-gradient(135deg,#7c3aed,#3730a3)"}}>
                {address.slice(0,1)}
              </span>
              <span className="font-code text-[0.72rem] text-purple-300">{address.slice(0,6)}...{address.slice(-4)}</span>
              {/* Chevron */}
              <span className="t-text-5 transition-transform duration-200" style={{transform: showMenu ? "rotate(180deg)" : "rotate(0deg)"}}>
                <IC d="M6 9l6 6 6-6" size={11}/>
              </span>
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <>
                {/* Click-away backdrop */}
                <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)}/>
                <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[220px] rounded-2xl border overflow-hidden"
                  style={{
                    background:"rgba(13,11,22,0.97)",
                    borderColor:"rgba(124,58,237,0.25)",
                    boxShadow:"0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.1), inset 0 1px 0 rgba(255,255,255,0.04)",
                    backdropFilter:"blur(20px)",
                  }}>
                  {/* Account info header */}
                  <div className="px-4 py-3.5 border-b" style={{borderColor:"rgba(255,255,255,0.06)"}}>
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-[0.65rem] font-bold text-white shrink-0"
                        style={{background:"linear-gradient(135deg,#7c3aed,#3730a3)"}}>
                        {address.slice(0,1)}
                      </span>
                      <div>
                        <p className="text-[0.7rem] font-semibold text-purple-300 leading-none mb-0.5">Connected</p>
                        <p className="font-code text-[0.65rem] t-text-5">{address.slice(0,10)}...{address.slice(-6)}</p>
                      </div>
                    </div>
                  </div>
                  {/* Copy address */}
                  <button
                    onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-[0.78rem] t-text-3 hover:text-purple-400 transition-colors group"
                    style={{borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                    <IC d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" size={14}/>
                    Copy address
                  </button>
                  {/* View on explorer */}
                  <a href={`https://stellar.expert/explorer/testnet/account/${address}`} target="_blank" rel="noreferrer"
                    onClick={() => setShowMenu(false)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-[0.78rem] t-text-3 hover:text-purple-400 transition-colors"
                    style={{borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                    <IC d={icons.link} size={14}/>
                    View on Explorer
                  </a>
                  {/* Disconnect */}
                  <button
                    onClick={() => { disconnectWallet(); setShowMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-[0.78rem] text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-all">
                    <IC d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" size={14}/>
                    Disconnect
                  </button>
                </div>
              </>
            )}
          </div>
        ) : view !== "landing" ? (
          <button onClick={connectWallet} disabled={busy}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl disabled:opacity-40 text-white text-[0.78rem] font-semibold transition-all"
            style={{
              background:"linear-gradient(135deg,#7c3aed,#5b21b6)",
              boxShadow:"0 0 0 1px rgba(124,58,237,0.4), 0 4px 16px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.08)"
            }}>
            <IC d={icons.shield} size={13}/>{busy ? "Connecting..." : "Connect Wallet"}
          </button>
        ) : null}
      </div>
    </header>
  );
}

function Sidebar({ view, setView, open, onClose }: { view: View; setView:(v:View)=>void; open: boolean; onClose:()=>void }) {
  const nav = [
    { v:"send" as View,   icon: icons.send,   label: "Send Privately"   },
    { v:"pool" as View,   icon: icons.pool,   label: "Privacy Pool"     },
    { v:"ledger" as View, icon: icons.ledger, label: "Ledger Inspector" },
    { v:"faq" as View,    icon: icons.key,    label: "FAQ"              },
  ];
  const proto = [
    { icon: icons.zap,    label: "Noir Circuit", href: "https://github.com/Megacollins/veil/blob/main/circuits/tornado/src/main.nr" },
    { icon: icons.key,    label: "UltraHonk VK", href: `${EXPLORER_BASE}/contract/${VERIFIER_CONTRACT_ID}` },
    { icon: icons.shield, label: "BN254 Native",  href: "https://developers.stellar.org/docs/learn/encyclopedia/cryptography/bn254" },
  ];
  return (
    <>
      {/* Mobile overlay backdrop */}
      {open && <div className="lg:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" onClick={onClose}/>}
      <aside className={`w-[220px] shrink-0 flex flex-col py-5
        lg:static lg:translate-x-0 lg:opacity-100 lg:z-auto lg:h-auto
        fixed top-[60px] left-0 bottom-0 z-40 transition-all duration-300
        ${open ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0 lg:opacity-100 lg:translate-x-0"}`}
        style={{
          background:"linear-gradient(180deg,var(--bg-sidebar) 0%,rgba(5,5,14,0.95) 100%)",
          borderRight:"1px solid var(--border-main)"
        }}>
      <div className="px-3 mb-2">
        <p className="px-3 text-[0.6rem] font-bold uppercase tracking-widest t-text-5 mb-1">Menu</p>
        {nav.map(({ v, icon, label }) => (
          <button key={v} onClick={() => setView(v)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[0.82rem] font-medium mb-0.5 transition-all duration-200 relative group`}
            style={view === v ? {
              background:"linear-gradient(135deg,rgba(124,58,237,0.18),rgba(67,56,202,0.08))",
              border:"1px solid rgba(124,58,237,0.3)",
              color:"var(--p300)",
              boxShadow:"inset 0 1px 0 rgba(255,255,255,0.05), 0 0 12px rgba(124,58,237,0.08)"
            } : {
              border:"1px solid transparent",
              color:"var(--text-muted)"
            }}>
            {view === v && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full" style={{background:"var(--p400)"}}/>}
            <span style={{color: view === v ? "var(--p400)" : "var(--text-faint)", marginLeft: view === v ? "6px" : "0"}}><IC d={icon} size={15}/></span>
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
    </>
  );
}

function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="flex-1" style={{background:"var(--bg-app)"}}>

      {/* ── HERO ── */}
      <section className="relative flex flex-col items-center justify-center text-center px-4 sm:px-6 pt-16 sm:pt-24 pb-20 sm:pb-28 overflow-hidden">
        {/* Subtle top separator line */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1px] h-24 pointer-events-none" style={{background:"linear-gradient(180deg,rgba(255,255,255,0.12),transparent)"}}/>
        <div className="relative z-10 flex flex-col items-center max-w-[1100px] w-full mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border mb-8"
            style={{borderColor:"rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.03)"}}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{background:"#a78bfa"}}/>
            <span className="text-[0.62rem] font-medium uppercase tracking-[0.16em]" style={{color:"rgba(255,255,255,0.4)"}}>Stellar Protocol 26 · Zero-Knowledge · Testnet</span>
          </div>
          <h1 className="text-[2.8rem] sm:text-[4rem] md:text-[5.4rem] font-black tracking-[-2px] sm:tracking-[-3px] md:tracking-[-4px] leading-[1] mb-6 max-w-[860px]" style={{color:"#ffffff"}}>
            Private transfers,<br/>verified on-chain.
          </h1>
          <p className="text-[0.98rem] sm:text-[1.08rem] max-w-[480px] leading-[1.85] mb-10 font-light" style={{color:"var(--text-secondary)"}}>
            Deposit XLM into a shared anonymity pool. Prove ownership with a zero-knowledge proof. Withdraw to any address — the chain never sees a link.
          </p>
          <div className="flex items-center gap-2.5 mb-10 flex-wrap justify-center">
            {[
              { label:"UltraHonk", sub:"No trusted setup" },
              { label:"BN254 Native", sub:"Protocol 26" },
              { label:"Poseidon2", sub:"ZK hash" },
            ].map(({ label, sub }) => (
              <div key={label} className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border"
                style={{borderColor:"rgba(255,255,255,0.08)", background:"rgba(255,255,255,0.03)"}}>
                <span className="text-[0.75rem] font-medium" style={{color:"rgba(255,255,255,0.6)"}}>{label}</span>
                <span className="text-[0.68rem]" style={{color:"rgba(255,255,255,0.25)"}}>{sub}</span>
              </div>
            ))}
          </div>
          <button onClick={onLaunch}
            className="group inline-flex items-center gap-3 px-9 py-3.5 rounded-xl font-semibold text-[0.95rem] transition-all mb-5"
            style={{
              background:"#ffffff",
              color:"#000000",
            }}
            onMouseEnter={e=>(e.currentTarget.style.background="#e5e5e5")}
            onMouseLeave={e=>(e.currentTarget.style.background="#ffffff")}>
            <IC d={icons.shield} size={16}/>Launch App
          </button>
          <p className="text-[0.7rem] tracking-wide" style={{color:"var(--text-ultrafaint)"}}>Freighter wallet · Stellar Testnet · Non-custodial</p>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="relative border-y overflow-hidden" style={{borderColor:"rgba(124,58,237,0.12)"}}>
        <div className="absolute inset-0" style={{background:"linear-gradient(135deg,rgba(124,58,237,0.07) 0%,rgba(67,56,202,0.04) 100%)"}}/>
        <div className="relative max-w-[1100px] mx-auto px-4 sm:px-8 grid grid-cols-2 md:grid-cols-4">
          {[
            { value:"14,592", label:"Proof bytes",         note:"bytes" },
            { value:"~30s",   label:"Browser proving",     note:"avg" },
            { value:"BN254",  label:"Elliptic curve",      note:"native" },
            { value:"2²⁰",    label:"Merkle tree depth",  note:"leaves" },
          ].map(({ value, label }, i) => (
            <div key={label} className={`flex flex-col items-center px-4 sm:px-8 py-6 sm:py-7 relative ${i > 0 ? "border-t md:border-t-0 md:border-l" : ""}`}
              style={{borderColor:"rgba(124,58,237,0.1)"}}>
              <span className="text-[2rem] sm:text-[2.2rem] font-black tracking-tight leading-none mb-1.5"
                style={{background:"linear-gradient(135deg,#c4b5fd,#a78bfa)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>
                {value}
              </span>
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.1em]" style={{color:"var(--text-faint)"}}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-4 sm:px-8 py-14 sm:py-20" style={{background:"var(--bg-app)"}}>
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-8 sm:mb-14">
            <div className="section-label justify-center mb-4">How it works</div>
            <h2 className="text-[2rem] sm:text-[2.8rem] font-black tracking-[-1.6px] gradient-text">Three steps. No trace.</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { step:"01", accent:"#7c3aed", glow:"rgba(124,58,237,0.5)", icon: icons.key,    title:"Deposit",  desc:"Generate a secret note client-side. A Poseidon2 commitment hash is stored in the on-chain Merkle tree. Your identity is never submitted." },
              { step:"02", accent:"#f59e0b", glow:"rgba(245,158,11,0.45)", icon: icons.zap,   title:"Prove",    desc:"Your browser runs the UltraHonk prover via WASM. It generates a 14,592-byte proof that you own a note — without revealing which one." },
              { step:"03", accent:"#10b981", glow:"rgba(16,185,129,0.45)", icon: icons.shield,title:"Withdraw", desc:"The Soroban contract verifies your proof using Stellar's native BN254 host functions. XLM is released to the recipient. Sender: unknown." },
            ].map(({ step, accent, glow, icon, title, desc }) => (
              <div key={step} className="relative flex flex-col p-7 rounded-2xl overflow-hidden group hover:translate-y-[-2px] transition-transform duration-300"
                style={{
                  background:`linear-gradient(160deg,rgba(255,255,255,0.025) 0%,var(--bg-card) 100%)`,
                  border:`1px solid ${accent}22`,
                  boxShadow:`0 0 0 1px ${accent}0a, 0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`
                }}>
                {/* Top accent line */}
                <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
                  style={{background:`linear-gradient(90deg,transparent 0%,${accent} 40%,${accent}80 70%,transparent 100%)`}}/>
                {/* Step number watermark */}
                <div className="absolute top-5 right-6 font-black text-[3rem] leading-none select-none pointer-events-none"
                  style={{color:`${accent}08`,fontVariantNumeric:"tabular-nums"}}>{step}</div>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 relative"
                  style={{background:`${accent}15`,border:`1px solid ${accent}30`}}>
                  <div className="absolute inset-0 rounded-xl" style={{boxShadow:`0 0 20px ${glow}`}}/>
                  <span className="relative" style={{color:accent}}><IC d={icon} size={19}/></span>
                </div>
                <span className="section-label mb-3" style={{"--p400":accent,"--p500":accent} as React.CSSProperties}>{step} — {title}</span>
                <h3 className="text-[1.15rem] font-bold t-text-1 mb-3 leading-snug">{title}</h3>
                <p className="text-[0.8rem] leading-[1.78]" style={{color:"var(--text-secondary)"}}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY VEIL ── */}
      <section className="px-4 sm:px-8 py-14 sm:py-20 border-t" style={{borderColor:"var(--border-main)",background:"var(--bg-card)"}}>
        <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-10 md:gap-16 items-center">
          <div>
            <div className="section-label mb-4">Why Veil</div>
            <h2 className="text-[2rem] sm:text-[2.6rem] font-black tracking-[-1.4px] gradient-text mb-5 leading-[1.08]">
              The chain sees proof.<br/>Not you.
            </h2>
            <p className="text-[0.92rem] leading-[1.8]" style={{color:"var(--text-muted)"}}>
              Every withdrawal is verified mathematically on-chain — no trusted relayer, no centralised mixer, no wrapped assets. Just cryptographic proof that you own a note, and nothing else.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {[
              { icon: icons.shield, title:"Sender anonymity",  desc:"Deposit and withdrawal share zero on-chain data. No link exists — ever.",          color:"#7c3aed" },
              { icon: icons.key,    title:"No trusted setup",  desc:"UltraHonk requires no MPC ceremony. Every proof is trustless by construction.",    color:"#f59e0b" },
              { icon: icons.zap,    title:"Fully on-chain ZK", desc:"Proof verification runs inside Soroban via Stellar's native BN254 host functions.", color:"#38bdf8" },
              { icon: icons.pool,   title:"Non-custodial",     desc:"No private keys leave your device. Veil holds nothing — not your note, not your funds.", color:"#10b981" },
            ].map(({ icon, title, desc, color }) => (
              <div key={title} className="flex items-start gap-4 p-4 rounded-2xl transition-all duration-200 hover:translate-x-[2px] group"
                style={{
                  background:`linear-gradient(135deg,${color}07 0%,transparent 100%)`,
                  border:`1px solid ${color}18`,
                  boxShadow:`inset 0 1px 0 rgba(255,255,255,0.03)`
                }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 relative"
                  style={{background:`${color}14`,border:`1px solid ${color}28`}}>
                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" style={{boxShadow:`0 0 16px ${color}50`}}/>
                  <span className="relative" style={{color}}><IC d={icon} size={16}/></span>
                </div>
                <div>
                  <p className="text-[0.88rem] font-semibold t-text-1 mb-1">{title}</p>
                  <p className="text-[0.76rem] leading-[1.7]" style={{color:"var(--text-secondary)"}}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT THE CHAIN SEES ── */}
      <section className="px-4 sm:px-8 py-14 sm:py-20 border-t" style={{borderColor:"var(--border-main)",background:"var(--bg-app)"}}>
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <div className="section-label justify-center mb-4">Transparency by design</div>
            <h2 className="text-[2rem] sm:text-[2.8rem] font-black tracking-[-1.6px] gradient-text">What the chain sees.</h2>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{border:"1px solid var(--border-main)",background:"var(--bg-card)"}}>
            {[
              { field:"Merkle root",       vis:true,  note:"Shared across deposits"       },
              { field:"Nullifier hash",    vis:true,  note:"Prevents double-spend"            },
              { field:"Recipient address", vis:true,  note:"Who receives the funds"           },
              { field:"ZK proof bytes",    vis:true,  note:"14,592 bytes of cryptography"     },
              { field:"Sender address",    vis:false, note:"Never submitted to chain"         },
              { field:"Transfer amount",   vis:false, note:"Fixed denomination hides value"   },
              { field:"Deposit note",      vis:false, note:"Stays in your browser only"       },
              { field:"Merkle path",       vis:false, note:"Proves membership, stays private" },
            ].map(({ field, vis, note }, i) => (
              <div key={field} className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b last:border-0"
                style={{borderColor:"var(--border-subtle)",background: i >= 4 ? "rgba(16,185,129,0.02)" : "transparent"}}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${vis ? "bg-amber-400" : "bg-emerald-500"}`}/>
                  <span className="text-[0.82rem] sm:text-[0.88rem] font-semibold t-text-1">{field}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-5 shrink-0 ml-2">
                  <span className="hidden sm:block text-[0.75rem]" style={{color:"var(--text-muted)"}}>{note}</span>
                  <span className={`text-[0.62rem] font-bold tracking-wider px-2 sm:px-2.5 py-1 rounded-lg min-w-[54px] text-center ${vis ? "text-amber-400 bg-amber-400/10 border border-amber-400/20" : "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20"}`}>
                    {vis ? "PUBLIC" : "HIDDEN"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TECH HIGHLIGHTS ── */}
      <section className="px-4 sm:px-8 py-14 sm:py-20 border-t" style={{borderColor:"var(--border-main)",background:"var(--bg-card)"}}>
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <div className="section-label justify-center mb-4">Under the hood</div>
            <h2 className="text-[2rem] sm:text-[2.8rem] font-black tracking-[-1.6px] gradient-text">Built on real cryptography.</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: icons.zap,    color:"#7c3aed", glow:"rgba(124,58,237,0.4)", title:"UltraHonk proving system", desc:"No trusted setup required. Proofs are generated entirely in your browser using Barretenberg WASM — no server, no ceremony, no compromise." },
              { icon: icons.shield, color:"#38bdf8", glow:"rgba(56,189,248,0.35)",  title:"Stellar Protocol 26",    desc:"Native BN254 elliptic curve host functions and Poseidon2 hashing run directly inside the Soroban VM — no EVM bridge, no off-chain oracle." },
              { icon: icons.pool,   color:"#10b981", glow:"rgba(16,185,129,0.35)",  title:"Poseidon2 Merkle tree",  desc:"Depth-20 incremental Merkle tree with Poseidon2 hashing. Commitments are stored on-chain; the path that proves membership stays private." },
              { icon: icons.key,    color:"#f59e0b", glow:"rgba(245,158,11,0.35)",  title:"Noir ZK circuit",        desc:"Written in Noir v1.0.0-beta.9. The circuit proves Merkle membership and nullifier validity — recipient is bound via the Fiat-Shamir transcript." },
              { icon: icons.send,   color:"#a78bfa", glow:"rgba(167,139,250,0.35)", title:"Soroban smart contract", desc:"Rust/WASM contract manages the Merkle tree, tracks spent nullifiers, and calls the Soroban verifier. Immutable once deployed." },
              { icon: icons.ledger, color:"#38bdf8", glow:"rgba(56,189,248,0.35)",  title:"Keccak Fiat-Shamir",     desc:"Both the on-chain verifier and the browser WASM prover use the keccak transcript — matching transcripts ensure the proof always verifies." },
            ].map(({ icon, color, glow, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl transition-all duration-300 group hover:translate-y-[-2px]"
                style={{
                  background:`linear-gradient(160deg,${color}06 0%,var(--bg-card) 100%)`,
                  border:`1px solid ${color}1a`,
                  boxShadow:`inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.3)`
                }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 relative"
                  style={{background:`${color}14`,border:`1px solid ${color}30`}}>
                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" style={{boxShadow:`0 0 20px ${glow}`}}/>
                  <span className="relative" style={{color}}><IC d={icon} size={18}/></span>
                </div>
                <h3 className="text-[0.92rem] font-bold t-text-1 mb-2.5 leading-snug">{title}</h3>
                <p className="text-[0.76rem] leading-[1.78]" style={{color:"var(--text-secondary)"}}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative overflow-hidden border-t" style={{borderColor:"var(--border-main)",background:"var(--bg-app)"}}>
        <div className="landing-final-glow absolute inset-0 pointer-events-none"
          style={{background:"radial-gradient(ellipse 70% 90% at 50% 100%, rgba(124,58,237,0.18), transparent)"}}/>
        <div className="relative z-10 max-w-[600px] mx-auto px-6 py-24 text-center flex flex-col items-center">
          <h2 className="text-[2.2rem] sm:text-[3rem] font-extrabold tracking-[-1.8px] gradient-text mb-4 leading-[1.06]">
            Ready to send privately?
          </h2>
          <p className="text-[0.95rem] leading-[1.75] mb-10 max-w-[420px]" style={{color:"var(--text-muted)"}}>
            No account. No KYC. No server. Just a Freighter wallet and a zero-knowledge proof.
          </p>
          <button onClick={onLaunch}
            className="group inline-flex items-center gap-3 px-10 py-4 rounded-2xl text-white font-bold text-[1rem] transition-all mb-6 relative overflow-hidden"
            style={{
              background:"linear-gradient(135deg,#7c3aed,#5b21b6)",
              boxShadow:"0 0 0 1px rgba(124,58,237,0.5), 0 8px 40px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.08)"
            }}>
            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}/>
            <span className="relative flex items-center gap-3"><IC d={icons.shield} size={18}/>Launch App</span>
          </button>
          <div className="flex items-center gap-6 text-[0.7rem]" style={{color:"var(--text-ultrafaint)"}}>
            <span>Mixer: <a href={`${EXPLORER_BASE}/contract/${import.meta.env.VITE_POOL_1 ?? ""}`} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-300 font-code transition-colors">{(import.meta.env.VITE_POOL_1 ?? "").slice(0,8)}...{(import.meta.env.VITE_POOL_1 ?? "").slice(-6)}</a></span>
            <span className="opacity-30">·</span>
            <span>Verifier: <a href={`${EXPLORER_BASE}/contract/${VERIFIER_CONTRACT_ID}`} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-300 font-code transition-colors">{VERIFIER_CONTRACT_ID.slice(0,8)}...{VERIFIER_CONTRACT_ID.slice(-6)}</a></span>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t" style={{borderColor:"var(--border-main)",background:"var(--bg-sidebar)"}}>
        <div className="max-w-[900px] mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-8">

          {/* Top row — brand + columns */}
          <div className="grid grid-cols-2 md:grid-cols-[1.8fr_1fr_1fr_1fr] gap-6 sm:gap-10 mb-12">

            {/* Brand */}
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <Logo/>
                <span className="text-[1.05rem] font-bold tracking-[-0.5px] t-text-1">Veil<span className="text-purple-400">.</span></span>
              </div>
              <p className="text-[0.78rem] leading-[1.75] mb-5" style={{color:"var(--text-muted)"}}>
                Privacy-preserving payments on Stellar Testnet. Deposit, prove, withdraw — sender never linked.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border" style={{background:"rgba(16,185,129,0.06)",borderColor:"rgba(16,185,129,0.2)"}}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"/>
                  <span className="text-[0.62rem] font-bold text-emerald-500 tracking-wide">TESTNET LIVE</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border" style={{background:"rgba(124,58,237,0.06)",borderColor:"rgba(124,58,237,0.2)"}}>
                  <span className="text-[0.62rem] font-bold text-purple-400 tracking-wide">PROTOCOL 26</span>
                </div>
              </div>
            </div>

            {/* Product */}
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] mb-4" style={{color:"var(--text-ultrafaint)"}}>Product</p>
              <div className="flex flex-col gap-2.5">
                {[
                  { label:"Launch App",       action:true  },
                  { label:"Privacy Pool",     action:true  },
                  { label:"Ledger Inspector", action:true  },
                  { label:"FAQ",              action:true  },
                ].map(({ label }) => (
                  <span key={label} onClick={onLaunch}
                    className="text-[0.8rem] cursor-pointer transition-colors duration-150 hover:text-purple-400"
                    style={{color:"var(--text-muted)"}}>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Protocol */}
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] mb-4" style={{color:"var(--text-ultrafaint)"}}>Protocol</p>
              <div className="flex flex-col gap-2.5">
                {[
                  { label:"Noir Circuit",   href:"https://github.com/Megacollins/veil/blob/main/circuits/tornado/src/main.nr" },
                  { label:"Mixer Contract", href:`${EXPLORER_BASE}/contract/${import.meta.env.VITE_POOL_1 ?? ""}` },
                  { label:"Verifier",       href:`${EXPLORER_BASE}/contract/${VERIFIER_CONTRACT_ID}` },
                  { label:"GitHub",         href:"https://github.com/Megacollins/veil" },
                ].map(({ label, href }) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer"
                    className="text-[0.8rem] transition-colors duration-150 hover:text-purple-400 flex items-center gap-1.5 group w-fit"
                    style={{color:"var(--text-muted)"}}>
                    {label}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity"><IC d={icons.link} size={10}/></span>
                  </a>
                ))}
              </div>
            </div>

            {/* Stellar */}
            <div>
              <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] mb-4" style={{color:"var(--text-ultrafaint)"}}>Stellar</p>
              <div className="flex flex-col gap-2.5">
                {[
                  { label:"Stellar Expert",   href:"https://stellar.expert/explorer/testnet" },
                  { label:"Soroban Docs",     href:"https://developers.stellar.org/docs/smart-contracts" },
                  { label:"Protocol 26",      href:"https://developers.stellar.org/docs/learn/encyclopedia/cryptography/bn254" },
                  { label:"Freighter Wallet", href:"https://www.freighter.app" },
                ].map(({ label, href }) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer"
                    className="text-[0.8rem] transition-colors duration-150 hover:text-purple-400 flex items-center gap-1.5 group w-fit"
                    style={{color:"var(--text-muted)"}}>
                    {label}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity"><IC d={icons.link} size={10}/></span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px mb-6" style={{background:"var(--border-subtle)"}}/>

          {/* Bottom row */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-6">
              <span className="text-[0.7rem]" style={{color:"var(--text-ultrafaint)"}}>© 2026 Veil. Built for Stellar Hacks: Real-World ZK.</span>
              <span className="text-[0.7rem]" style={{color:"var(--text-ultrafaint)"}}>Non-custodial · Open source · No warranties</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Stellar Hacks badge */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
                style={{background:"rgba(124,58,237,0.06)",borderColor:"rgba(124,58,237,0.18)"}}>
                <IC d={icons.zap} size={11}/>
                <span className="text-[0.62rem] font-semibold text-purple-400">Stellar Hacks 2026</span>
              </div>
              {/* GitHub link */}
              <a href="https://github.com/Megacollins/veil" target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-lg border flex items-center justify-center transition-all hover:border-purple-500/40 hover:text-purple-400"
                style={{borderColor:"var(--border-main)",color:"var(--text-muted)"}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
              </a>
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}

function StepConnect({ connectWallet, busy }: { connectWallet:()=>void; busy: boolean }) {
  return (
    <div className="p-8 text-center relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" style={{background:"radial-gradient(ellipse 80% 60% at 50% 0%,rgba(124,58,237,0.08),transparent)"}}/>
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 relative"
          style={{background:"linear-gradient(135deg,rgba(124,58,237,0.2),rgba(67,56,202,0.12))",border:"1px solid rgba(124,58,237,0.3)"}}>
          <div className="absolute inset-0 rounded-2xl" style={{boxShadow:"0 0 32px rgba(124,58,237,0.25)"}}/>
          <span className="relative" style={{color:"var(--p400)"}}><IC d={icons.shield} size={26}/></span>
        </div>
        <h2 className="text-[1.2rem] font-bold t-text-1 mb-2">Connect your wallet</h2>
        <p className="text-[0.83rem] mb-6 max-w-[300px] mx-auto leading-relaxed" style={{color:"var(--text-secondary)"}}>
          Authenticate with Freighter to sign on Stellar Testnet. Your keys never leave your device.
        </p>
        <button onClick={connectWallet} disabled={busy}
          className="group inline-flex items-center gap-2.5 px-7 py-3 rounded-xl disabled:opacity-40 text-white font-semibold text-[0.9rem] transition-all relative overflow-hidden"
          style={{
            background:"linear-gradient(135deg,#7c3aed,#5b21b6)",
            boxShadow:"0 0 0 1px rgba(124,58,237,0.4), 0 8px 32px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.08)"
          }}>
          <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{background:"linear-gradient(135deg,#8b5cf6,#7c3aed)"}}/>
          <span className="relative flex items-center gap-2.5"><IC d={icons.shield} size={16}/>{busy ? "Connecting..." : "Connect Freighter"}</span>
        </button>
      </div>
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
    <div className="p-8 text-center relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" style={{background:"radial-gradient(ellipse 80% 60% at 50% 0%,rgba(16,185,129,0.07),transparent)"}}/>
      <div className="relative">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 relative"
        style={{background:"rgba(16,185,129,0.12)",border:"1px solid rgba(16,185,129,0.25)"}}>
        <div className="absolute inset-0 rounded-full" style={{boxShadow:"0 0 32px rgba(16,185,129,0.2)"}}/>
        <span className="relative text-emerald-400"><IC d={icons.check} size={28}/></span>
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
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[0.85rem] transition-all"
        style={{background:"var(--bg-raised)",border:"1px solid var(--border-main)",color:"var(--text-muted)"}}>
        <IC d={icons.refresh} size={14}/>New Transfer
      </button>
      </div>
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
    <div className="p-4 sm:p-8 max-w-[1200px] mx-auto">
      <div className="mb-6 sm:mb-8 animate-fade-up">
        <h1 className="text-[1.4rem] sm:text-[1.6rem] font-bold tracking-[-0.5px] t-text-1">Send Privately</h1>
        <p className="text-[0.85rem] mt-1" style={{color:"var(--text-muted)"}}>Deposit → prove → withdraw. Sender never linked.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {[
          { label: "Sender Privacy",  value: "100%",           icon: icons.shield, color: "text-purple-400"  },
          { label: "Proof Time",      value: "~30s",           icon: icons.zap,    color: "text-amber-400"   },
          { label: "Notes Deposited", value: String(deposits), icon: icons.key,    color: "text-emerald-400" },
          { label: "ZK Curve",        value: "BN254",          icon: icons.pool,   color: "text-sky-400"     },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="rounded-2xl p-5 relative overflow-hidden group hover:translate-y-[-1px] transition-transform duration-200"
            style={{
              background:"var(--bg-card)",
              border:"1px solid var(--border-main)",
              boxShadow:"0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)"
            }}>
            <div className="absolute top-0 left-0 right-0 h-[1px]"
              style={{background:"linear-gradient(90deg,transparent,rgba(124,58,237,0.3),transparent)"}}/>
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-400"
              style={{background:"radial-gradient(ellipse 100% 100% at 0% 0%, rgba(124,58,237,0.07), transparent)"}}/>
            <p className={`text-[0.6rem] font-bold uppercase tracking-[0.12em] mb-3 ${color}`}>{label}</p>
            <div className="flex items-end justify-between">
              <span className="text-[1.9rem] font-black tracking-tight t-text-1 leading-none">{value}</span>
              <span className={`${color} opacity-25 group-hover:opacity-50 transition-opacity`}><IC d={icon} size={22}/></span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="flex flex-col gap-4 self-stretch">
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
    <div className="p-4 sm:p-8 max-w-[1100px] mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[1.8rem] sm:text-[2.2rem] font-extrabold tracking-[-1.2px] gradient-text mb-2">Privacy Pool</h1>
        <p className="text-[0.9rem] t-text-4 leading-relaxed max-w-[500px]">
          All deposits share a common Poseidon2 Merkle tree (depth 20). The larger the anonymity set, the stronger the privacy.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {[
          { label:"Total Deposits",  value: String(deposits) },
          { label:"Anonymity Set",   value: String(Math.max(deposits,1)) },
          { label:"Tree Depth",      value: "20" },
          { label:"Max Capacity",    value: "1,048,576" },
        ].map(({label,value}) => (
          <div key={label} className="rounded-2xl p-5 relative overflow-hidden" style={{
            background:"var(--bg-card)",
            border:"1px solid var(--border-main)",
            boxShadow:"0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)"
          }}>
            <div className="absolute top-0 left-0 right-0 h-[1px]" style={{background:"linear-gradient(90deg,transparent,rgba(124,58,237,0.3),transparent)"}}/>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] mb-2" style={{color:"var(--text-faint)"}}>{label}</p>
            <p className="text-[1.9rem] font-black t-text-1 tracking-tight leading-none">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
    <div className="p-4 sm:p-8 max-w-[1100px] mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[1.8rem] sm:text-[2.2rem] font-extrabold tracking-[-1.2px] gradient-text mb-2">Ledger Inspector</h1>
        <p className="text-[0.9rem] t-text-4 leading-relaxed max-w-[500px]">
          What any blockchain observer can see — notice what is missing.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {[
          { label:"Fields on-chain", value:"3",   color:"text-amber-400", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.2)"  },
          { label:"Sender identity", value:"???", color:"text-red-400",   bg:"rgba(239,68,68,0.06)",  border:"rgba(239,68,68,0.2)"   },
          { label:"Transfer amount", value:"???", color:"text-red-400",   bg:"rgba(239,68,68,0.06)",  border:"rgba(239,68,68,0.2)"   },
        ].map(({label,value,color,bg,border}) => (
          <div key={label} className="rounded-2xl p-5 relative overflow-hidden" style={{
            background:bg,
            border:`1px solid ${border}`,
            boxShadow:"0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)"
          }}>
            <div className="absolute top-0 left-0 right-0 h-[1px]" style={{background:`linear-gradient(90deg,transparent,${border},transparent)`}}/>
            <p className={`text-[0.6rem] font-bold uppercase tracking-[0.12em] mb-2 ${color}`}>{label}</p>
            <p className={`text-[2.2rem] font-black leading-none ${color}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

const FAQ_ITEMS = [
  {
    tag: "ZK", tagColor: "text-purple-400 bg-purple-400/10",
    q: "What is a ZK proof and why does Veil use it?",
    a: "A zero-knowledge proof lets you prove you know a secret (your deposit note) without revealing the secret itself. Veil uses an UltraHonk proof over BN254 — generated entirely in your browser — so the Soroban contract can verify your withdrawal is legitimate without ever learning which deposit it belongs to.",
  },
  {
    tag: "Privacy", tagColor: "text-emerald-400 bg-emerald-400/10",
    q: "Can anyone trace my deposit to my withdrawal?",
    a: "No. Your deposit adds a Poseidon2 commitment to a shared Merkle tree — only the hash lands on-chain. Withdrawal proves Merkle membership via ZK and spends a nullifier hash. No link between sender and recipient exists anywhere on the ledger.",
  },
  {
    tag: "Stellar", tagColor: "text-sky-400 bg-sky-400/10",
    q: "How does proof verification work on Stellar?",
    a: "Stellar Protocol 26 added native BN254 host functions. Veil's Soroban verifier contract calls these directly to verify the UltraHonk proof — no EVM, no trusted relay, just math running inside the Stellar VM.",
  },
  {
    tag: "ZK", tagColor: "text-purple-400 bg-purple-400/10",
    q: "What is my note and why must I save it?",
    a: "Your note contains a random nullifier and secret. Together they hash to the on-chain commitment. Without the note you cannot generate a valid proof and your deposit is unrecoverable. Save it somewhere safe — Veil never stores it.",
  },
  {
    tag: "Privacy", tagColor: "text-emerald-400 bg-emerald-400/10",
    q: "What happens if I lose my note?",
    a: "Your deposit is permanently unrecoverable. There is no way to regenerate the nullifier and secret from on-chain data alone. Always back up your note immediately after generating it.",
  },
  {
    tag: "Privacy", tagColor: "text-emerald-400 bg-emerald-400/10",
    q: "What is a nullifier and why does it prevent double-spending?",
    a: "The nullifier hash is a public output of your proof. The contract stores it after a successful withdrawal — any future proof using the same nullifier is rejected. This prevents you from withdrawing the same deposit twice.",
  },
  {
    tag: "Stellar", tagColor: "text-sky-400 bg-sky-400/10",
    q: "Does Veil work without a local server?",
    a: "Yes. Proof generation runs fully in the browser using Barretenberg WASM (bb.js). The optional local prover server speeds things up, but the app works end-to-end on the deployed URL with no setup required.",
  },
  {
    tag: "Privacy", tagColor: "text-emerald-400 bg-emerald-400/10",
    q: "What are the known limitations?",
    a: "Two things are visible on-chain: the fee-payer address (the account that pays the withdrawal transaction fee — this may be the recipient) and the ZK proof bytes. The sender address, transfer amount, and link between deposit and withdrawal remain completely hidden. Relayer support to hide the fee-payer is planned.",
  },
];

function FAQPage() {
  const [open, setOpen] = useState<number | null>(0);
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="p-4 sm:p-8 max-w-[780px] mx-auto">

      {/* ── Header ── */}
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border mb-5"
          style={{background:"rgba(124,58,237,0.08)",borderColor:"rgba(124,58,237,0.3)"}}>
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" style={{boxShadow:"0 0 6px rgba(139,92,246,0.8)"}}/>
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-purple-400">FAQ</span>
        </div>
        <h1 className="text-[2.4rem] font-extrabold tracking-[-1.5px] gradient-text leading-[1.08] mb-3">
          How does Veil work?
        </h1>
        {/* Subtle descriptor row */}
        <div className="flex items-center gap-3">
          {["UltraHonk Proofs","BN254 Curve","Stellar Protocol 26"].map(t => (
            <span key={t} className="text-[0.68rem] font-semibold t-text-5 px-2.5 py-1 rounded-lg border t-border"
              style={{background:"rgba(255,255,255,0.03)"}}>{t}</span>
          ))}
        </div>
      </div>

      {/* ── FAQ list ── */}
      <div className="flex flex-col gap-2.5">
        {FAQ_ITEMS.map(({ tag, tagColor, q, a }, i) => {
          const isOpen = open === i;
          const isHov  = hovered === i && !isOpen;
          return (
            <div key={i}
              onClick={() => setOpen(isOpen ? null : i)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                /* Elevated card — slightly lighter than page bg */
                background: isOpen
                  ? "linear-gradient(135deg,rgba(124,58,237,0.10) 0%,rgba(124,58,237,0.04) 100%)"
                  : isHov
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(255,255,255,0.025)",
                border: isOpen
                  ? "1px solid rgba(124,58,237,0.45)"
                  : isHov
                    ? "1px solid rgba(124,58,237,0.28)"
                    : "1px solid rgba(255,255,255,0.07)",
                /* Premium depth: two-layer shadow */
                boxShadow: isOpen
                  ? "0 0 0 1px rgba(124,58,237,0.12), 0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)"
                  : isHov
                    ? "0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)"
                    : "0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.03)",
                borderRadius: "18px",
                cursor: "pointer",
                transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
                overflow: "hidden",
              }}>

              {/* Question row */}
              <div className="flex items-center justify-between px-6 py-5 gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  {/* Refined tag — pill with left accent bar feel */}
                  <span style={{
                    fontSize:"0.58rem", fontWeight:700, letterSpacing:"0.1em",
                    textTransform:"uppercase", padding:"3px 10px", borderRadius:"99px",
                    border:"1px solid",
                    ...(tag === "ZK"
                      ? {color:"#c4b5fd", background:"rgba(124,58,237,0.15)", borderColor:"rgba(124,58,237,0.35)"}
                      : tag === "Privacy"
                        ? {color:"#6ee7b7", background:"rgba(16,185,129,0.12)", borderColor:"rgba(16,185,129,0.3)"}
                        : {color:"#7dd3fc", background:"rgba(56,189,248,0.1)",  borderColor:"rgba(56,189,248,0.28)"}),
                  }}>{tag}</span>
                  {/* Question — heavier weight for hierarchy */}
                  <span style={{
                    fontSize:"0.85rem", fontWeight: isOpen ? 700 : 600,
                    color: isOpen ? "#f3f4f6" : "#d1d5db",
                    lineHeight:1.4, transition:"color 0.15s, font-weight 0.15s",
                  }}>{q}</span>
                </div>
                {/* Animated chevron */}
                <span style={{
                  display:"flex", alignItems:"center", justifyContent:"center",
                  width:28, height:28, borderRadius:"50%", flexShrink:0,
                  background: isOpen ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.05)",
                  border: isOpen ? "1px solid rgba(124,58,237,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  color: isOpen ? "#a78bfa" : "#6b7280",
                  transition:"all 0.2s ease",
                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}>
                  <IC d="M6 9l6 6 6-6" size={13}/>
                </span>
              </div>

              {/* Answer panel — smooth reveal via max-height trick */}
              <div style={{
                maxHeight: isOpen ? "300px" : "0px",
                opacity: isOpen ? 1 : 0,
                overflow:"hidden",
                transition:"max-height 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease",
              }}>
                {/* Hairline divider with purple tint when open */}
                <div style={{
                  height:"1px", margin:"0 24px",
                  background: isOpen
                    ? "linear-gradient(90deg,rgba(124,58,237,0.5),rgba(124,58,237,0.1),transparent)"
                    : "rgba(255,255,255,0.06)",
                }}/>
                <p style={{
                  padding:"18px 24px 22px",
                  fontSize:"0.81rem", lineHeight:1.75,
                  color:"#9ca3af",
                }}>{a}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer note ── */}
      <div className="mt-8 flex items-center gap-2.5 px-5 py-3.5 rounded-2xl border"
        style={{background:"rgba(255,255,255,0.015)",borderColor:"rgba(255,255,255,0.06)"}}>
        <IC d={icons.shield} size={14}/>
        <p className="text-[0.72rem] t-text-5 leading-relaxed">
          Veil is non-custodial. Your keys, your note, your funds — no recovery possible if lost.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView]         = useState<View>("landing");
  const [step, setStep]         = useState<Step>("connect");
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  useEffect(() => {
    const contractId = import.meta.env.VITE_POOL_1 ?? "";
    if (!contractId) return;
    (async () => {
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
        if (!resp.entries?.length) return;
        const storage: xdr.ScMapEntry[] = (resp.entries[0].val as any)
          .contractData().val().instance().storage() ?? [];
        for (const entry of storage) {
          const k = entry.key();
          if (k.switch().name === "scvSymbol") {
            const sym: string = (k.sym() as unknown as Buffer | string).toString();
            if (sym === "next_index") {
              setDeposits(entry.val().u32());
              break;
            }
          }
        }
      } catch {}
    })();
  }, []);

  const addLog = (msg: string) => setLog(l => [...l, msg]);

  async function connectWallet() {
    setBusy(true);
    try {
      const { address: addr } = await StellarWalletsKit.authModal();
      setAddress(addr); setStep("deposit");
      addLog(`Connected ${addr.slice(0,8)}...${addr.slice(-4)}`);
    } catch { addLog("Connection cancelled"); } finally { setBusy(false); }
  }

  function disconnectWallet() {
    setAddress(""); setStep("connect"); setNote(null); setNoteJson("");
    setProof(""); setPublicInputs(""); setTxHash("");
    addLog("Wallet disconnected");
  }

  async function generateNote() {
    setBusy(true); addLog("Generating secret note...");
    try {
      // Try server first
      try {
        const res = await fetch(`${PROVER_SERVER}/deposit?t=${Date.now()}`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          setNote(data.note); setNoteJson(JSON.stringify(data, null, 2));
          addLog(`Note ready — ${data.note.commitment.slice(0,12)}...`);
          return;
        }
      } catch (serverErr: unknown) {
        const msg = (serverErr as Error).message;
        if (!msg.includes("aborted") && !msg.includes("Failed to fetch") && !msg.includes("NetworkError")) {
          throw serverErr;
        }
        addLog("Prover server unreachable — generating note in browser...");
      }

      // Browser fallback: use Barretenberg Poseidon2
      const { Barretenberg, Fr } = await import("@aztec/bb.js");
      addLog("Loading Barretenberg WASM...");
      const bb = await Barretenberg.new({ threads: 1 });
      const nullifierFr = Fr.random();
      const secretFr    = Fr.random();
      const commitmentFr    = await bb.poseidon2Hash([nullifierFr, secretFr]);
      const nullifierHashFr = await bb.poseidon2Hash([nullifierFr, Fr.ZERO]);
      await bb.destroy();

      const commitment    = Buffer.from(commitmentFr.toBuffer()).toString("hex");
      const nullifier_hash = Buffer.from(nullifierHashFr.toBuffer()).toString("hex");
      const nullifier = BigInt("0x" + Buffer.from(nullifierFr.toBuffer()).toString("hex")).toString();
      const secret    = BigInt("0x" + Buffer.from(secretFr.toBuffer()).toString("hex")).toString();

      const noteObj = { nullifier, secret, commitment, nullifier_hash };
      setNote(noteObj); setNoteJson(JSON.stringify({ note: noteObj }, null, 2));
      addLog(`Note ready (browser) — ${commitment.slice(0,12)}...`);
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
    setBusy(true); addLog("Generating ZK proof...");
    try {
      const noteData   = noteJson ? (JSON.parse(noteJson).note ?? JSON.parse(noteJson)) : note;
      const leafIndex  = (note as any)?.leafIndex  ?? noteData?.leafIndex  ?? 0;
      const contractId = (note as any)?.contractId ?? noteData?.contractId ?? pool.contractId;

      const nullifierHex: string | undefined = noteData?.nullifier_hash;
      if (!nullifierHex) throw new Error("Note missing nullifier_hash — please generate a fresh note");

      // Build frontier map (bit=1 levels only)
      const neededLevels: number[] = [];
      for (let i = 0; i < 20; i++) if ((leafIndex >> i) & 1) neededLevels.push(i);

      let frontierMap = new Map<number, bigint>();
      if (neededLevels.length > 0) {
        addLog(`Reading Merkle frontier (leaf #${leafIndex})...`);
        frontierMap = await readFrontiersFromContract(contractId, neededLevels);
        if (frontierMap.size < neededLevels.length)
          throw new Error(`Frontier incomplete: ${frontierMap.size}/${neededLevels.length}`);
      }

      // Build frontiers object for server (only the levels where bit=1)
      const frontiers: Record<number, string> = {};
      for (const [lvl, val] of frontierMap) frontiers[lvl] = val.toString();

      // ── Try server-side proving first (correct keccak transcript) ──────────
      addLog("Requesting proof from prover server...");
      try {
        const res = await fetch(`${PROVER_SERVER}/prove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: noteData, recipient, leafIndex, frontiers }),
          signal: AbortSignal.timeout(180_000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          setProof(data.proof); setPublicInputs(data.public_inputs);
          addLog(`Server proof ready — ${(data.proof.length - 2) / 2} bytes`);
          setStep("withdraw");
          return;
        }
        addLog(`Server returned ${res.status}, falling back to browser prover...`);
      } catch (serverErr: unknown) {
        const msg = (serverErr as Error).message;
        if (msg.includes("aborted") || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
          addLog("Prover server unreachable — using browser WASM prover...");
        } else {
          throw serverErr; // real error from server, propagate
        }
      }

      // ── Browser-side WASM fallback ─────────────────────────────────────────
      addLog("Loading WASM prover...");
      const bits: number[] = [];
      const siblings: bigint[] = [];
      for (let i = 0; i < 20; i++) {
        const bit = (leafIndex >> i) & 1;
        bits.push(bit);
        siblings.push(bit === 1 ? frontierMap.get(i)! : ZEROS[i]);
      }

      addLog("Reading Merkle root from contract...");
      const root = await readRootFromContract(contractId);
      if (root === null) throw new Error("Could not read Merkle root from contract");
      addLog(`Root: 0x${root.toString(16).slice(0, 16)}...`);

      const recipientField = (() => {
        if (recipient.startsWith("G") && recipient.length === 56) {
          const raw = StrKey.decodeEd25519PublicKey(recipient);
          return BigInt("0x" + Buffer.from(raw).toString("hex")) % BN254_PRIME;
        }
        return BigInt(recipient) % BN254_PRIME;
      })();

      const nullifierHash = BigInt("0x" + nullifierHex);

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
      const { proof: proofBytes, publicInputs: bbPubInputs } = await backend.generateProof(witness, { keccak: true }) as any;

      // Use bb.js public inputs directly (correct format for the prover)
      const pubHex = (() => {
        if (Array.isArray(bbPubInputs) && bbPubInputs.length >= 3) {
          const buf = new Uint8Array(96);
          for (let i = 0; i < 3; i++) {
            const hexStr = (typeof bbPubInputs[i] === "string" ? bbPubInputs[i] : "0x" + Buffer.from(bbPubInputs[i]).toString("hex")).replace("0x","").padStart(64, "0");
            buf.set(new Uint8Array(Buffer.from(hexStr, "hex")), i * 32);
          }
          return "0x" + Buffer.from(buf).toString("hex");
        }
        // fallback: manual construction
        const fieldToBE32 = (n: bigint) => new Uint8Array(Buffer.from(n.toString(16).padStart(64,"0"),"hex"));
        const buf = new Uint8Array(96);
        buf.set(fieldToBE32(root), 0);
        buf.set(fieldToBE32(nullifierHash), 32);
        buf.set(fieldToBE32(recipientField), 64);
        return "0x" + Buffer.from(buf).toString("hex");
      })();

      const proofHex = "0x" + Buffer.from(proofBytes).toString("hex");
      setProof(proofHex); setPublicInputs(pubHex);
      addLog(`Browser proof ready — ${proofBytes.length} bytes`);
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
      <TopNav address={address} light={light} setLight={setLight} connectWallet={connectWallet} disconnectWallet={disconnectWallet} busy={busy} step={step} onLogoClick={() => { setView("landing"); setSidebarOpen(false); }} view={view} onLaunch={() => setView("send")} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} showSidebarToggle={view !== "landing"}/>
      <div className="flex flex-1 min-h-0 relative">
        {view !== "landing" && <Sidebar view={view} setView={(v) => { setView(v); setSidebarOpen(false); }} open={sidebarOpen} onClose={() => setSidebarOpen(false)}/>}
        <main className="flex flex-1 flex-col overflow-y-auto relative">
          {/* Ambient glow orbs for depth */}
          <div className="pointer-events-none fixed top-0 right-0 w-[600px] h-[600px] rounded-full opacity-[0.04]" style={{background:"radial-gradient(circle,#7c3aed,transparent 70%)",transform:"translate(30%,-20%)"}}/>
          <div className="pointer-events-none fixed bottom-0 left-[220px] w-[400px] h-[400px] rounded-full opacity-[0.03]" style={{background:"radial-gradient(circle,#3730a3,transparent 70%)",transform:"translate(-20%,20%)"}}/>
          <div className="relative z-10 flex flex-1 flex-col">
          {view === "landing" && <LandingPage onLaunch={() => setView("send")}/>}
          {view === "send"   && <SendPage {...{step,address,note,noteJson,setNoteJson,recipient,setRecipient,proof,publicInputs,log,busy,deposits,connectWallet,generateNote,deposit,generateProof,withdraw,reset,poolIndex,setPoolIndex,pool,txHash,commitments}}/>}
          {view === "pool"   && <PoolPage deposits={deposits} commitments={commitments}/>}
          {view === "ledger" && <LedgerPage note={note} proof={proof} publicInputs={publicInputs}/>}
          {view === "faq"    && <FAQPage/>}
          </div>
        </main>
      </div>
    </div>
  );
}
