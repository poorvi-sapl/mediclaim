import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Building, Users, CheckCircle2, ArrowLeft, Clock, Zap } from 'lucide-react';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function Spinner() {
  return (
    <svg className="animate-spin text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

const STATUS_ICON = {
  pending: <span className="text-slate-300 text-sm leading-none">○</span>,
  spin:    <Spinner />,
  ok:      <span className="text-emerald-600 font-bold text-sm">✓</span>,
  fail:    <span className="text-rose-600 font-bold text-sm">✗</span>,
}

export default function PayerSignup() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('form'); // 'form' | 'verifying' | 'success'
  const [steps, setSteps] = useState([]);
  const [validationError, setValidationError] = useState('');
  const [formData, setFormData] = useState({
    email: '', password: '', organizationName: '', uei: '',
    fullName: '', title: '', acceptTerms: false,
  });

  const DEMO = {
    email: 'payer@mediclaim.com', password: 'demo1234',
    organizationName: 'Meridian Health Plan', uei: 'ABC123DEF456',
    fullName: 'Dr. James Thornton', title: 'Chief Compliance Officer',
    acceptTerms: true,
  };

  const fillDemoValues = () => setFormData({ ...DEMO });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const missing = [];
    if (!formData.email.trim())            missing.push('Email Address');
    if (!formData.password.trim())         missing.push('Password');
    if (!formData.organizationName.trim()) missing.push('Organization Name');
    if (!formData.uei.trim())              missing.push('UEI');
    if (!formData.fullName.trim())         missing.push('Full Name');
    if (!formData.title.trim())            missing.push('Title');
    if (!formData.acceptTerms)             missing.push('Attestation checkbox');
    if (missing.length) {
      setValidationError(`Please fill in all required fields: ${missing.join(', ')}.`);
      return;
    }
    setValidationError('');
    const orgName = formData.organizationName || 'your organization';
    const STEPS = [
      { label: 'Validating UEI format…',                  result: 'UEI format valid' },
      { label: 'Looking up organization in SAM.gov…',     result: `Organization verified — ${orgName}` },
      { label: 'Recording authorized signatory…',         result: `Attestation recorded — ${formData.fullName || 'Signatory'}, ${formData.title || 'Officer'}` },
      { label: 'Submitting registration request…',        result: 'Registration submitted for activation' },
    ];
    setSteps(STEPS.map(s => ({ label: s.label, status: 'pending' })));
    setPhase('verifying');
    for (let i = 0; i < STEPS.length; i++) {
      setSteps(prev => prev.map((st, idx) => idx === i ? { ...st, status: 'spin' } : st));
      await sleep(750);
      setSteps(prev => prev.map((st, idx) => idx === i ? { ...st, status: 'ok', text: STEPS[i].result } : st));
    }
    await sleep(400);
    setPhase('success');
    setTimeout(() => navigate('/login'), 5000);
  }

  /* ── Verifying screen ── */
  if (phase === 'verifying') {
    return (
      <div className="min-h-screen bg-[#f5f9fc] flex items-center justify-center py-8 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 sm:p-10">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Step 2 of 2 — Verifying organization</p>
          <h1 className="text-2xl font-bold text-[#1B3A5C]">Verifying your organization</h1>
          <p className="text-sm text-slate-500 mt-1">This takes just a moment…</p>
          <div className="mt-8 space-y-4">
            {steps.map((s, i) => (
              <div key={i} className={`flex items-center gap-3 text-sm transition-opacity duration-300 ${s.status === 'pending' ? 'opacity-35' : ''}`}>
                <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{STATUS_ICON[s.status]}</span>
                <span className={s.status === 'ok' ? 'text-slate-800' : 'text-slate-500'}>{s.text || s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Success screen ── */
  if (phase === 'success') {
    return (
      <div className="min-h-screen bg-[#f5f9fc] flex items-center justify-center py-8 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 sm:p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-5">
            <Clock size={30} className="text-amber-600" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 ring-1 ring-amber-200 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[11px] font-semibold text-amber-700 tracking-wide">Pending Activation</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1B3A5C]">Registration submitted ✓</h1>
          <p className="text-[15px] text-slate-600 mt-2">
            Your account has been created successfully.
          </p>
          <div className="mt-4 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-left">
            <p className="text-sm text-amber-800 font-semibold mb-1">Awaiting activation</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Your account will be activated once an administrator from your organization approves it. You'll receive an email notification at <span className="font-semibold">{formData.email || 'your email'}</span> when it's ready.
            </p>
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Spinner />
            <span>Redirecting to login…</span>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="mt-5 w-full py-3 rounded-lg text-white font-semibold text-sm hover:opacity-90 transition-all"
            style={{ backgroundColor: '#1B3A5C' }}>
            Back to Login →
          </button>
        </div>
      </div>
    );
  }

  /* ── Form ── */
  return (
    <div className="min-h-screen bg-[#f5f9fc] antialiased flex items-center justify-center py-8 px-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="max-w-4xl w-full">
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="p-8 sm:p-10 space-y-8">

            {/* Fill demo values */}
            <div className="flex justify-end -mb-4">
              <button type="button" onClick={fillDemoValues}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#1B3A5C]/30 text-[#1B3A5C] hover:bg-[#1B3A5C]/5 transition-all flex items-center gap-1.5">
                <Zap size={13} /> Fill demo values
              </button>
            </div>

            {/* Account Information */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <button type="button" onClick={() => navigate(-1)} className="flex-shrink-0 text-slate-600 hover:text-slate-900 transition-colors">
                  <ArrowLeft size={16} className="text-slate-700" />
                </button>
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0"><Mail size={14} className="text-white" /></div>
                <h2 className="text-[15px] font-bold text-[#1a3d7c] uppercase tracking-wider">Account Information</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Email Address <span className="text-red-500">*</span></label>
                  <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="payer@mediclaim.com"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Password <span className="text-red-500">*</span></label>
                  <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder="Demo@12345!"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                  <p className="text-[9px] text-slate-500 mt-0.5">Minimum 8 characters.</p>
                </div>
              </div>
            </div>

            {/* Organization Details */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0"><Building size={14} className="text-white" /></div>
                <h2 className="text-[13px] font-bold text-[#1a3d7c] uppercase tracking-wider">Organization Details</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Organization Name <span className="text-red-500">*</span></label>
                  <input type="text" name="organizationName" value={formData.organizationName} onChange={handleChange} placeholder="Meridian Health Plan"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">UEI (Unique Entity Identifier) <span className="text-red-500">*</span></label>
                  <input type="text" name="uei" value={formData.uei} onChange={handleChange} placeholder="ABC123DEF456"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                  <p className="text-[9px] text-slate-500 mt-0.5">Your UEI is a unique 12-character identifier.</p>
                </div>
              </div>
            </div>

            {/* Authorized Signatory */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0"><Users size={14} className="text-white" /></div>
                <h2 className="text-[13px] font-bold text-[#1a3d7c] uppercase tracking-wider">Authorized Signatory</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Full Name <span className="text-red-500">*</span></label>
                  <input type="text" name="fullName" value={formData.fullName} onChange={handleChange} placeholder="Dr. James Thornton"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Title <span className="text-red-500">*</span></label>
                  <input type="text" name="title" value={formData.title} onChange={handleChange} placeholder="Chief Compliance Officer"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                  <p className="text-[9px] text-slate-500 mt-0.5">e.g., Chief Compliance Officer, VP of Operations</p>
                </div>
              </div>
            </div>

            {/* Attestation */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0"><CheckCircle2 size={14} className="text-white" /></div>
                <h2 className="text-[13px] font-bold text-[#1a3d7c] uppercase tracking-wider">Attestation</h2>
              </div>
              <div className="flex items-start gap-2">
                <input type="checkbox" name="acceptTerms" checked={formData.acceptTerms} onChange={handleChange}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-[#1a3d7c] focus:ring-[#1a3d7c] cursor-pointer" />
                <label className="text-xs text-slate-700">
                  I confirm that I am authorized to register this organization on ClaimLens and that the information provided is accurate.
                </label>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-200 bg-slate-50 px-8 sm:px-10 py-4 space-y-3">
            {validationError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-700 font-medium">
                {validationError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => navigate('/')}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-semibold text-sm hover:bg-slate-100 transition-all">
                Cancel
              </button>
              <button type="submit"
                className="px-6 py-2 bg-[#1a3d7c] text-white font-semibold text-sm rounded-lg hover:bg-[#142d5c] transition-all flex items-center gap-2">
                Create Account →
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
