import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, ChevronRight, TrendingUp, Zap, Users, TrendingDown, Activity, Eye, Check } from 'lucide-react';
import { useAuth, DASHBOARD_PATH } from '../context/AuthContext';
import heroImage from './Hero.png';
import imageCard from './image-card.png';
import healthcareImage from './healthcare.png';

const stats = [
  { value: '10K+', label: 'NPIs Monitored' },
  { value: '5',    label: 'Physician Actions' },
  { value: '<1s',  label: 'SSE Alert Latency' },
  { value: '10+',  label: 'Fraud Detection Rules' },
];

const steps = [
  {
    num: '01',
    title: 'Physician Reviews Claims',
    desc: 'Doctors log in to see every claim filed under their NPI. They take one of five actions per claim: Confirm, Dispute, Flag Supplier, Unknown Patient, or Did Not Order.'
  },
  {
    num: '02',
    title: 'Real-time Alert Fires',
    desc: 'The moment a physician flags a supplier or reports an unknown patient, a live alert streams via Server-Sent Events to the Plan dashboard — under one second latency.'
  },
  {
    num: '03',
    title: 'Plan Investigates',
    desc: 'Investigators see alerts appear live with action badges and amounts. They drill into any NPI detail page to view all claims, fired fraud rules, and physician actions.'
  },
  {
    num: '04',
    title: 'Risk Scores Update',
    desc: 'The rules engine recalculates scores using 10+ weighted patterns — OIG hits, cross-NPI suppliers, volume spikes, geographic anomalies, and more. High-risk NPIs surface automatically.'
  },
];

const featuresList = [
  { title: 'Rules-Based Risk Scoring', desc: '10+ weighted fraud patterns: OIG LEIE hits, cross-NPI suppliers, geographic anomalies, volume spikes, duplicate billing, unbundling, impossible days, rapid patient cycling, and more.' },
  { title: 'Live Activity Feed', desc: 'SSE-powered feed streams every physician action in real time — Confirmed, Disputed, Flagged, Unknown Patient, or Denied. Filter by action type, sort by amount or time.' },
  { title: '5-Action Physician Loop', desc: 'Confirm, Dispute, Flag Supplier, Unknown Patient, Did Not Order. Each action feeds the risk engine and surfaces directly in the Plan investigator dashboard.' },
  { title: 'NPI Risk Leaderboard', desc: 'Color-coded 0–100 risk scores across all monitored NPIs. Filter by specialty, state, or fraud pattern. Drill into any NPI for full claim and rule history.' },
  { title: 'Claims Monitoring', desc: 'Full claim table with service categories (Home Health, Hospice, DME, Drugs, Hospital), patient names, supplier, amount, and review status. Filter, sort, and act in one view.' },
  { title: 'Supplier Watchlist', desc: 'Track suppliers billing across multiple NPIs. See OIG flag status, distinct NPI count, physician reports, total billed, and risk level (Critical → Low) at a glance.' },
];

const faqsList = [
  { q: 'What are the 5 physician actions?', a: 'Confirm (claim is legitimate), Dispute (amount or service is wrong), Flag Supplier (supplier is unknown or suspicious), Unknown Patient (patient not recognized), Did Not Order (service was never prescribed). Each action updates the risk engine instantly.' },
  { q: 'How fast do alerts reach investigators?', a: 'Alerts stream via Server-Sent Events (SSE) — the moment a physician takes an action, it appears live in the Plan dashboard in under one second. No polling, no batch jobs.' },
  { q: 'What fraud patterns does the risk engine detect?', a: 'The engine runs 10+ weighted rules: OIG LEIE hits, cross-NPI suppliers, geographic anomalies, volume spikes, duplicate billing, unbundling, new high-value suppliers, impossible days, rapid patient cycling, and supplier concentration.' },
  { q: 'Do physicians need training?', a: 'No. The physician dashboard shows their claims in a simple table. One click per claim — the five action buttons are labeled and color-coded. Most physicians complete their first review in minutes.' },
  { q: 'What does the Plan investigator see?', a: 'A live activity feed with every physician action, a risk leaderboard of all monitored NPIs, a supplier watchlist with OIG flags, and full drill-down into any NPI showing claims, fired rules, and physician responses.' },
  { q: 'Can we try it before committing?', a: 'Yes — use the demo credentials on the Sign In page for instant access to both the Physician and Plan Investigator portals loaded with synthetic Medicare claims.' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [openFaq, setOpenFaq] = useState(null);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobile = () => setMobileMenuOpen(false);

  const [fullName, setFullName] = useState('Jane Smith');
  const [email, setEmail] = useState('jane@healthcare.org');
  const [orgName, setOrgName] = useState('United Health Partners');
  const [jobTitle, setJobTitle] = useState('Director of Compliance');
  const [orgType, setOrgType] = useState('Government Agency');

  return (
    <div className="min-h-screen bg-surface-100 text-text-primary antialiased selection:bg-brand selection:text-white">

      {/* 1. Navbar */}
      <nav className="bg-[#0d1f35] text-white px-4 sm:px-6 lg:px-10 xl:px-16 py-3 sm:py-4 sticky top-0 z-50 shadow-lg border-b border-white/5">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2 sm:gap-2.5 cursor-pointer" onClick={() => navigate('/')}>
            <div className="bg-white p-1 sm:p-1.5 rounded-lg shadow-sm relative">
              <Shield size={16} className="sm:w-5 sm:h-5 text-[#1e3a8a]" fill="#1e3a8a" fillOpacity={0.1} />
              <Check size={10} className="sm:w-3 sm:h-3 text-[#1e3a8a] absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 font-bold" />
            </div>
            <span className="font-bold text-sm sm:text-lg tracking-tight">MedClaim Analytics</span>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6 lg:gap-8 text-[13px] font-semibold text-white/70">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how" className="hover:text-white transition-colors">How It Works</a>
            <a href="#plans" className="hover:text-white transition-colors">For Health Plans</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>

          {/* Right: sign in + hamburger */}
          <div className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <button onClick={() => { logout(); navigate('/welcome'); }}
                className="text-[12px] sm:text-[13px] font-semibold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-white/20 text-white/80 hover:bg-white/10 hover:text-white transition-all">
                Log Out
              </button>
            ) : (
              <button onClick={() => navigate('/login')}
                className="hidden md:inline-flex text-[12px] sm:text-[13px] font-semibold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-white/20 text-white/80 hover:bg-white/10 hover:text-white transition-all">
                Sign In
              </button>
            )}
            {/* Hamburger — mobile only */}
            <button onClick={() => setMobileMenuOpen(v => !v)}
              className="md:hidden flex flex-col justify-center items-center w-9 h-9 rounded-lg hover:bg-white/10 transition-all gap-1.5"
              aria-label="Toggle menu">
              <span className={`block w-5 h-0.5 bg-white transition-all duration-200 ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block w-5 h-0.5 bg-white transition-all duration-200 ${mobileMenuOpen ? 'opacity-0' : ''}`} />
              <span className={`block w-5 h-0.5 bg-white transition-all duration-200 ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-3 pb-3 border-t border-white/10 flex flex-col gap-1 pt-3">
            {[['#features','Features'],['#how','How It Works'],['#plans','For Health Plans'],['#faq','FAQ']].map(([href, label]) => (
              <a key={href} href={href} onClick={closeMobile}
                className="text-[14px] font-semibold text-white/80 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-lg transition-all">
                {label}
              </a>
            ))}
            {!user && (
              <button onClick={() => { navigate('/login'); closeMobile(); }}
                className="mt-1 text-[14px] font-semibold text-white bg-white/10 hover:bg-white/20 px-3 py-2.5 rounded-lg transition-all text-left">
                Sign In →
              </button>
            )}
          </div>
        )}
      </nav>

      {/* 2. Hero Section */}
      <header className="relative bg-gradient-to-r from-[#e8f2f8] via-[#f0f7fc] to-[#e3f0f8] text-gray-900 overflow-hidden min-h-[500px] sm:min-h-[680px] flex items-center">
        <div className="absolute inset-0 z-0 bg-cover bg-right pointer-events-none"
             style={{ backgroundImage: `url(${heroImage})` }} />
        <div className="absolute inset-0 bg-gradient-to-r from-white/50 via-white/40 to-white/20 z-0 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-white/60 via-transparent to-transparent z-0 pointer-events-none" />

        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10 xl:px-0 py-12 sm:py-20 relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-16 items-center">
          <div className="space-y-4 sm:space-y-6 text-left">
            <div className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 px-2.5 sm:px-3 py-1 rounded-full shadow-sm">
              <span className="w-1 sm:w-1.5 h-1 sm:h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
              <span className="text-[10px] sm:text-[12px] font-bold tracking-wider text-blue-700 uppercase">Healthcare Fraud Detection Platform</span>
            </div>
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] text-[#1a3d7c]">
              Protecting Healthcare Integrity Together
            </h1>
            <p className="text-gray-700 text-sm sm:text-base lg:text-lg leading-relaxed max-w-md font-normal">
              Empowering physicians and plan administrators with real-time fraud detection through intelligent risk scoring and collaborative feedback loops.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-3 sm:pt-4">
              <button
                onClick={() => navigate(user ? DASHBOARD_PATH[user.role] : '/login')}
                className="bg-[#1a3d7c] text-white font-semibold px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm tracking-wider uppercase hover:bg-[#142d5c] transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
              >
                Get Started <ChevronRight size={14} className="hidden sm:block" />
              </button>
            </div>
          </div>

          <div className="hidden lg:flex relative h-full justify-end items-center" />
        </div>
      </header>

      {/* 3. Stats Bar */}
      <section className="bg-white border-b border-blue-100 py-12 sm:py-20 shadow-sm relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-0">
          <p className="text-center text-[10px] sm:text-[12px] font-bold text-[#1a3d7c] uppercase tracking-widest mb-8 sm:mb-14">
            Trusted by Healthcare Organizations Nationwide
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 lg:gap-8">
            {stats.map((s, idx) => (
              <div key={idx} className={`rounded-lg sm:rounded-2xl border border-blue-100 p-4 sm:p-8 flex items-start gap-3 sm:gap-5 hover:shadow-lg transition-all ${idx === 3 ? 'bg-[#E2E8F0]' : 'bg-white'}`} style={{boxShadow:'0 2px 8px rgba(26,68,128,0.08)'}}>
                <div className="flex-1 min-w-0">
                  <div className="text-xl sm:text-3xl lg:text-4xl font-extrabold text-[#1a3d7c] tracking-tight">{s.value}</div>
                  <div className="text-[11px] sm:text-[14px] font-semibold text-gray-600 mt-1 sm:mt-2 leading-snug">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. How the Feedback Loop Works */}
      <section id="how" className="py-12 sm:py-20 bg-[#1a3d7c] text-surface relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-0 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-16">
            <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-blue-200 bg-blue-900/30 px-2.5 sm:px-3 py-1 rounded-full border border-blue-400/30">
              Our Process
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight mt-2 sm:mt-3 uppercase mb-2 sm:mb-3 text-white leading-snug">
              HOW THE<br />FEEDBACK LOOP WORKS
            </h2>
            <p className="text-blue-100 text-xs sm:text-sm lg:text-base leading-relaxed font-normal">
              A simple, visible process that turns physician input into actionable intelligence in real-time.
            </p>
          </div>

          <div className="relative mb-8 sm:mb-12">
            <div className="hidden lg:block absolute top-6 sm:top-8 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 via-blue-300 to-blue-400 z-0" />
            <div className="hidden sm:grid grid-cols-4 gap-0 relative z-10">
              {steps.map((s, i) => (
                <div key={i} className="flex flex-col items-center">
                  <div className={`w-12 sm:w-16 h-12 sm:h-16 rounded-full border-4 flex items-center justify-center mb-6 sm:mb-9 shadow-lg ${i === 0 ? 'bg-[#E2E8F0] border-[#E2E8F0]' : 'bg-white border-blue-200'}`}>
                    <span className="text-xl sm:text-2xl font-bold text-[#1a3d7c]">{i + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 lg:gap-6">
            {steps.map((s, i) => (
              <div key={i} className="bg-white rounded-lg sm:rounded-2xl p-4 sm:p-5 shadow-lg hover:shadow-xl transition-all flex flex-col">
                <div className="text-[#1a3d7c] font-bold text-sm sm:text-base mb-1.5 sm:mb-2">{s.num}</div>
                <h3 className="font-bold text-sm sm:text-base text-gray-900 mb-2 sm:mb-2.5 leading-snug">{s.title}</h3>
                <p className="text-gray-600 text-[11px] sm:text-xs leading-relaxed font-normal flex-grow">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Features Section */}
      <section id="features" className="py-16 sm:py-24 bg-gradient-to-b from-blue-50 to-white border-b border-blue-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-0">
          <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[#1a3d7c] tracking-tight mt-2 sm:mt-4 mb-3 sm:mb-4">
              Built for Healthcare Integrity
            </h2>
            <p className="text-gray-700 text-xs sm:text-sm lg:text-base leading-relaxed font-normal">
              Every feature designed to detect fraud quickly and give plan executives the visibility they need.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {featuresList.map((f, i) => {
              const icons = [TrendingUp, Zap, Users, TrendingDown, Activity, Eye];
              const IconComponent = icons[i % icons.length];
              const bgColor = i === 2 ? '#E2E8F0' : 'white';
              const borderColor = i === 2 ? 'border-blue-100' : 'border-blue-50';
              return (
                <div key={i} className={`rounded-lg sm:rounded-2xl p-5 sm:p-8 ${borderColor} border hover:shadow-lg transition-all`} style={{backgroundColor: bgColor, boxShadow:'0 2px 8px rgba(26,68,128,0.08)'}}>
                  <div className="w-9 sm:w-10 h-9 sm:h-10 rounded-lg flex items-center justify-center mb-3 sm:mb-5" style={{backgroundColor:'rgba(26, 68, 128, 0.6)'}}>
                    <IconComponent className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h4 className="font-bold text-gray-900 text-sm sm:text-base mb-2 sm:mb-3">{f.title}</h4>
                  <p className="text-gray-600 text-xs sm:text-sm leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. Built For Health Plans / Request Demo */}
      <section id="plans" className="py-12 sm:py-20 relative text-white overflow-hidden" style={{backgroundImage: `url(${imageCard})`, backgroundSize: 'cover', backgroundPosition: 'right center', backgroundRepeat: 'no-repeat'}}>
        <div className="absolute inset-0 bg-gradient-to-r from-[#1a3d7c]/90 via-[#1a3d7c]/70 to-[#1a3d7c]/30 z-0 pointer-events-none" />
        <div className="absolute inset-0 opacity-5 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-0 relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-16 items-center">
          <div className="space-y-3 sm:space-y-4 text-left">
            <span className="text-[9px] sm:text-[11px] font-bold text-blue-300 uppercase tracking-widest bg-blue-900/60 border border-blue-700/40 px-2.5 sm:px-3 py-1 rounded-md w-fit inline-block">
              BUILT FOR HEALTH PLANS
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight text-white">
              Your Physicians <br />Already Know <br />Something Is Wrong
            </h2>
            <div className="w-12 sm:w-16 h-1 bg-emerald-400 rounded" />
            <p className="text-blue-100 text-[11px] sm:text-xs lg:text-sm leading-relaxed max-w-md font-light">
              They see it in the claims. They feel it when a supplier keeps showing up. Give your investigators the same view — and a way to act on it before the money is gone.
            </p>
            <p className="text-emerald-300 text-[11px] sm:text-xs font-semibold tracking-wide pt-1 sm:pt-2">
              See how it works in 30 minutes.
            </p>
          </div>

          <div>
            <div className="bg-white text-slate-800 rounded-lg sm:rounded-xl p-5 sm:p-8 shadow-2xl border border-slate-100/10">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
                <div>
                  <label className="block text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Full Name</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs focus:outline-none focus:border-blue-500"
                    placeholder="Jane Smith" />
                </div>
                <div>
                  <label className="block text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Work Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs focus:outline-none focus:border-blue-500"
                    placeholder="jane@healthcare.org" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4">
                <div>
                  <label className="block text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Organization Name</label>
                  <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs focus:outline-none focus:border-blue-500"
                    placeholder="United Health Partners" />
                </div>
                <div>
                  <label className="block text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Job Title</label>
                  <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs focus:outline-none focus:border-blue-500"
                    placeholder="Director of Compliance" />
                </div>
              </div>

              <div className="mb-4 sm:mb-6">
                <label className="block text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Organization Type</label>
                <select value={orgType} onChange={(e) => setOrgType(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs focus:outline-none focus:border-blue-500">
                  <option value="Government Agency">Government Agency</option>
                  <option value="Insurance Provider">Insurance Provider</option>
                  <option value="Healthcare Organization">Healthcare Organization</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <button type="button" onClick={() => alert('Demo requested successfully')}
                className="w-full bg-[#1a3d7c] hover:bg-[#142d5c] text-white font-bold py-2.5 sm:py-3 rounded-lg text-[11px] sm:text-xs tracking-wider uppercase shadow-md transition-colors">
                Request Demo
              </button>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-[9px] sm:text-[10px] text-slate-400 font-medium mt-3 sm:mt-4 text-center">
                <span>✓ No setup fees</span>
                <span className="hidden sm:block">•</span>
                <span>✓ Works in your browser</span>
                <span className="hidden sm:block">•</span>
                <span>✓ HIPAA ready</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. FAQ Section */}
      <section id="faq" className="py-12 sm:py-20 bg-white border-b border-blue-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 xl:px-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-16 items-start">
            <div className="flex flex-col items-center lg:items-start">
              <div className="text-center lg:text-left mb-4 sm:mb-6 w-full">
                <h3 className="text-2xl font-bold text-[#1a3d7c] mb-2">Got Questions?</h3>
              </div>
              <div className="w-48 sm:w-56 mb-4 sm:mb-6 mx-auto lg:mx-0">
                <img src={healthcareImage} alt="Healthcare Professional" className="w-full h-auto rounded-lg sm:rounded-2xl shadow-lg" />
              </div>
              <div className="text-center lg:text-left space-y-3 sm:space-y-4 w-full">
                <p className="text-gray-600 text-xs sm:text-sm leading-relaxed">
                  Have questions about implementing fraud detection or want to learn more about our platform? Our team is here to help.
                </p>
                <div>
                  <span className="text-xs sm:text-sm text-slate-600">Can't find what you are looking for? </span>
                  <button className="text-xs sm:text-sm text-[#1a3d7c] font-bold hover:underline">Contact us</button>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 sm:space-y-3">
              {faqsList.map((f, i) => (
                <div key={i} className="border border-slate-200/70 rounded-lg overflow-hidden bg-white shadow-sm">
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full text-left px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors">
                    <span>{f.q}</span>
                    <span className={`text-blue-600 text-lg sm:text-2xl font-light transform transition-transform duration-200 ${openFaq === i ? 'rotate-45' : ''}`}>+</span>
                  </button>
                  {openFaq === i && (
                    <div className="px-4 sm:px-6 pb-3 sm:pb-4 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100 bg-slate-50/50 pt-2 sm:pt-3">
                      {f.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="bg-[#0d1f35] text-white py-12 sm:py-16 px-4 sm:px-6 lg:px-10 xl:px-0 border-t border-white/5">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate('/')}>
              <div className="bg-white p-1.5 rounded-lg shadow-sm relative">
                <Shield size={20} className="text-[#1e3a8a]" fill="#1e3a8a" fillOpacity={0.1} />
                <Check size={12} className="text-[#1e3a8a] absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 font-bold" />
              </div>
              <span className="font-bold text-lg text-white tracking-tight">MedClaim Analytics</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              Real-time programmatic operational health monitoring loops protecting medical transaction framework ecosystems.
            </p>
          </div>

          <div>
            <h5 className="text-white text-sm font-bold tracking-wider uppercase mb-3.5">Quick Links</h5>
            <ul className="space-y-2 text-[13px] font-medium text-slate-400">
              <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
              <li><a href="#how" className="hover:text-white transition-colors">How It Works</a></li>
              <li><a href="#plans" className="hover:text-white transition-colors">For Physicians</a></li>
              <li><a href="#plans" className="hover:text-white transition-colors">For Investigators</a></li>
              <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
            </ul>
          </div>

          <div>
            <h5 className="text-white text-sm font-bold tracking-wider uppercase mb-3.5">Support</h5>
            <ul className="space-y-2 text-[13px] font-medium text-slate-400">
              <li><button type="button" className="hover:text-white transition-colors text-left">Help Center</button></li>
              <li><button type="button" className="hover:text-white transition-colors text-left">API Docs</button></li>
              <li><button type="button" className="hover:text-white transition-colors text-left">Contact Support</button></li>
            </ul>
          </div>

          <div>
            <h5 className="text-white text-sm font-bold tracking-wider uppercase mb-3.5">Legal</h5>
            <ul className="space-y-2 text-[13px] font-medium text-slate-400">
              <li><button type="button" className="hover:text-white transition-colors text-left">Privacy Policy</button></li>
              <li><button type="button" className="hover:text-white transition-colors text-left">Terms of Service</button></li>
              <li><button type="button" className="hover:text-white transition-colors text-left">Compliance</button></li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto border-t border-slate-700/60 mt-10 sm:mt-12 pt-5 sm:pt-6 flex flex-col sm:flex-row items-center justify-between text-sm text-slate-400 font-medium gap-2">
          <span>© 2026 MedClaim Analytics. All rights reserved.</span>
          <span className="mt-2 sm:mt-0 tracking-wide uppercase text-xs bg-slate-700/40 border border-slate-600/30 px-2 py-0.5 rounded text-slate-300">
            HIPAA COMPLIANT ARCHITECTURE
          </span>
        </div>
      </footer>

    </div>
  );
}
