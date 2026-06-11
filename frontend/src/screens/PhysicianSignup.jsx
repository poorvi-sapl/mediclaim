import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, User, Badge, CheckCircle2, ArrowLeft, Upload, FileText, X, Zap } from 'lucide-react';

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

function FileUploadBox({ label, hint, accept, file, onChange, inputRef }) {
  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) onChange(dropped);
  };
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">{label}</label>
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer rounded-lg border-2 border-dashed transition-all px-4 py-5 flex flex-col items-center gap-2 text-center
          ${file ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-[#1a3d7c]/40 hover:bg-white'}`}>
        <input ref={inputRef} type="file" accept={accept} className="hidden"
          onChange={e => { if (e.target.files[0]) onChange(e.target.files[0]); }} />
        {file ? (
          <>
            <FileText size={20} className="text-emerald-600 flex-shrink-0" />
            <span className="text-[12px] font-semibold text-emerald-700 break-all leading-tight">{file.name}</span>
            <span className="text-[10px] text-emerald-500">{(file.size / 1024).toFixed(0)} KB · click to replace</span>
          </>
        ) : (
          <>
            <Upload size={20} className="text-slate-400" />
            <span className="text-[12px] font-semibold text-slate-600">Click or drag to upload</span>
            <span className="text-[10px] text-slate-400">{hint}</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function PhysicianSignup() {
  const navigate = useNavigate();
  const deaFileRef = useRef(null);
  const licenseFileRef = useRef(null);
  const [phase, setPhase] = useState('form'); // 'form' | 'verifying' | 'success'
  const [steps, setSteps] = useState([]);
  const [validationError, setValidationError] = useState('');
  const [deaFile, setDeaFile] = useState(null);
  const [licenseFile, setLicenseFile] = useState(null);
  const [formData, setFormData] = useState({
    email: '', password: '', firstName: '', lastName: '',
    npiNumber: '', deaNumber: '', stateLicense: '', licenseState: '', ptan: '', acceptTerms: false,
  });

  const DEMO = {
    email: 'physician@mediclaim.com', password: 'demo1234',
    firstName: 'Sarah', lastName: 'Mitchell', npiNumber: '1003000126',
    deaNumber: 'BM1234563', stateLicense: 'A123456', licenseState: 'CA',
    ptan: '1A2B3C', acceptTerms: true,
  };

  const fillDemoValues = () => setFormData({ ...DEMO });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const missing = [];
    if (!formData.email.trim())        missing.push('Email Address');
    if (!formData.password.trim())     missing.push('Password');
    if (!formData.firstName.trim())    missing.push('First Name');
    if (!formData.lastName.trim())     missing.push('Last Name');
    if (!formData.npiNumber.trim())    missing.push('NPI Number');
    if (!formData.deaNumber.trim())    missing.push('DEA Number');
    if (!formData.stateLicense.trim()) missing.push('State License');
    if (!formData.licenseState)        missing.push('License State');
    if (!formData.ptan.trim())         missing.push('PTAN');
    if (!deaFile)                      missing.push('DEA Certificate');
    if (!licenseFile)                  missing.push('State License Document');
    if (!formData.acceptTerms)         missing.push('Attestation checkbox');
    if (missing.length) {
      setValidationError(`Please fill in all required fields: ${missing.join(', ')}.`);
      return;
    }
    setValidationError('');
    const name = `${formData.firstName} ${formData.lastName}`.trim() || 'the provider';
    const STEPS = [
      { label: 'Validating NPI with NPPES…',       result: `NPI verified — ${name}` },
      { label: 'Checking OIG exclusion list…',      result: 'No exclusions found' },
      { label: 'Checking Medicare enrollment…',     result: 'Eligible to order Medicare services' },
      { label: 'Creating your account…',            result: 'Account created successfully' },
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
    setTimeout(() => navigate('/login', { state: { email: formData.email } }), 4000);
  }

  /* ── Verifying screen ── */
  if (phase === 'verifying') {
    return (
      <div className="min-h-screen bg-[#f5f9fc] flex items-center justify-center py-8 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 sm:p-10">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Step 2 of 2 — Verifying credentials</p>
          <h1 className="text-2xl font-bold text-[#1B3A5C]">Verifying your credentials</h1>
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
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-semibold text-emerald-700 tracking-wide">Account Created</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1B3A5C]">Account created ✓</h1>
          <p className="text-[15px] text-slate-600 mt-2">
            Welcome to MediClaim, {formData.firstName || 'Doctor'}.
          </p>
          <p className="text-sm text-slate-400 mt-3 leading-relaxed">
            Your physician account is ready. You'll be redirected to login in a few seconds.
          </p>
          <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Spinner />
            <span>Redirecting to login…</span>
          </div>
          <button
            onClick={() => navigate('/login', { state: { email: formData.email } })}
            className="mt-6 w-full py-3 rounded-lg text-white font-semibold text-sm hover:opacity-90 transition-all"
            style={{ backgroundColor: '#1B3A5C' }}>
            Login Now →
          </button>
          <p className="text-[11px] text-slate-400 mt-3">Now login into your account to get started.</p>
        </div>
      </div>
    );
  }

  /* ── Form ── */
  return (
    <div className="min-h-screen bg-[#f5f9fc] antialiased flex items-center justify-center py-8 px-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="max-w-4xl w-full">
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="p-8 sm:p-10 space-y-5">

            {/* Fill demo values */}
            <div className="flex justify-end -mb-4">
              <button type="button" onClick={fillDemoValues}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#1B3A5C]/30 text-[#1B3A5C] hover:bg-[#1B3A5C]/5 transition-all flex items-center gap-1.5">
                <Zap size={13} /> Fill demo values
              </button>
            </div>

            {/* Account */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <button type="button" onClick={() => navigate(-1)} className="flex-shrink-0 text-slate-600 hover:text-slate-900 transition-colors">
                  <ArrowLeft size={16} className="text-slate-700" />
                </button>
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0">
                  <Mail size={14} className="text-white" />
                </div>
                <h2 className="text-[13px] font-bold text-[#1a3d7c] uppercase tracking-wider">Account</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Email Address</label>
                  <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="physician@mediclaim.com"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Password</label>
                  <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder="demo1234"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                  <p className="text-[11px] text-slate-400 mt-1">Minimum 8 characters</p>
                </div>
              </div>
            </div>

            {/* Identity Verification */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0"><User size={14} className="text-white" /></div>
                <h2 className="text-[13px] font-bold text-[#1a3d7c] uppercase tracking-wider">Identity Verification</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">First Name</label>
                  <input type="text" name="firstName" value={formData.firstName} onChange={handleChange} placeholder="Sarah"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">Last Name</label>
                  <input type="text" name="lastName" value={formData.lastName} onChange={handleChange} placeholder="Mitchell"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">NPI Number</label>
                  <input type="text" name="npiNumber" value={formData.npiNumber} onChange={handleChange} placeholder="1003000126"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                  <p className="text-[11px] text-slate-400 mt-1">10-digit NPI from your Medicare enrollment</p>
                </div>
              </div>
            </div>

            {/* Licenses & Enrollment */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0"><Badge size={14} className="text-white" /></div>
                <h2 className="text-[13px] font-bold text-[#1a3d7c] uppercase tracking-wider">Licenses & Enrollment</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">DEA Number</label>
                  <input type="text" name="deaNumber" value={formData.deaNumber} onChange={handleChange} placeholder="BM1234563"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                  <p className="text-[11px] text-slate-400 mt-1">Your DEA registration number</p>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">State License</label>
                  <input type="text" name="stateLicense" value={formData.stateLicense} onChange={handleChange} placeholder="A123456"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">License State</label>
                  <select name="licenseState" value={formData.licenseState} onChange={handleChange}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white">
                    <option value="">Select State</option>
                    <option value="CA">CA</option><option value="NY">NY</option>
                    <option value="TX">TX</option><option value="FL">FL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">PTAN</label>
                  <input type="text" name="ptan" value={formData.ptan} onChange={handleChange} placeholder="1A2B3C"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3d7c]/20 focus:border-[#1a3d7c] transition-all bg-slate-50 focus:bg-white" />
                  <p className="text-[11px] text-slate-400 mt-1">Medicare Provider Transaction Access Number</p>
                </div>
              </div>
            </div>

            {/* Document Uploads */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-[#1a3d7c] rounded-lg flex-shrink-0"><Upload size={14} className="text-white" /></div>
                <h2 className="text-[13px] font-bold text-[#1a3d7c] uppercase tracking-wider">Document Uploads</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FileUploadBox
                  label="DEA Certificate *"
                  hint="PDF or image, max 10 MB"
                  accept=".pdf,.jpg,.jpeg,.png"
                  file={deaFile}
                  onChange={setDeaFile}
                  inputRef={deaFileRef}
                />
                <FileUploadBox
                  label="State License Document *"
                  hint="PDF or image, max 10 MB"
                  accept=".pdf,.jpg,.jpeg,.png"
                  file={licenseFile}
                  onChange={setLicenseFile}
                  inputRef={licenseFileRef}
                />
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
                  I confirm that I am a licensed physician and that the information provided is accurate. I agree to comply with all HIPAA regulations and terms of service.
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
