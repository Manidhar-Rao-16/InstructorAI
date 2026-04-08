import { useState } from 'react';
import { X, Mail, Lock, User, Eye, EyeOff, Loader2, ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { authAPI } from '../services/api';

// Backend API URL — Google redirect goes through the backend
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export default function AuthModal({ isOpen, onClose, initialMode = 'login' }) {
    const { theme } = useTheme();
    const { login, signup } = useAuth();
    const [mode, setMode] = useState(initialMode);
    const [form, setForm] = useState({ email: '', password: '', display_name: '' });
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [fpEmail, setFpEmail] = useState('');
    const [fpToken, setFpToken] = useState('');
    const [fpEnteredToken, setFpEnteredToken] = useState('');
    const [fpNewPass, setFpNewPass] = useState('');
    const [fpLoading, setFpLoading] = useState(false);
    const [fpError, setFpError] = useState('');
    const [fpSuccess, setFpSuccess] = useState('');

    if (!isOpen) return null;

    const update = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
    const switchMode = (m) => { setMode(m); setError(''); setFpError(''); setFpSuccess(''); };

    const submit = async (e) => {
        e.preventDefault();
        setLoading(true); setError('');
        try {
            if (mode === 'login') await login(form.email, form.password);
            else await signup(form.email, form.password, form.display_name);
            setForm({ email: '', password: '', display_name: '' });
            onClose();
        } catch (err) {
            setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
        } finally { setLoading(false); }
    };

    const handleGoogleRedirect = () => {
        // Redirect through the backend's server-side OAuth flow.
        // This works from BOTH localhost AND network IPs (192.168.x.x)
        // because Google only checks the redirect_uri (localhost:8000),
        // not the page the user clicked the button from.
        const origin = encodeURIComponent(window.location.origin);
        window.location.href = `${API_BASE}/auth/google/redirect?role=user&frontend_origin=${origin}`;
    };

    const sendForgot = async () => {
        if (!fpEmail.trim()) { setFpError('Enter your email address.'); return; }
        setFpLoading(true); setFpError('');
        try {
            const res = await authAPI.forgotPassword(fpEmail.trim().toLowerCase());
            if (res.data.reset_token) { setFpToken(res.data.reset_token); setFpSuccess('Token issued! Enter it below.'); }
            else setFpSuccess(res.data.detail || 'Check your email.');
        } catch { setFpError('Email not found.'); }
        finally { setFpLoading(false); }
    };

    const doReset = async () => {
        const token = fpEnteredToken.trim() || fpToken;
        if (!token || fpNewPass.length < 6) { setFpError('Enter the token and a password (min 6 chars).'); return; }
        setFpLoading(true); setFpError('');
        try {
            await authAPI.resetPassword(token, fpNewPass);
            setFpSuccess('Password updated! You can now sign in.');
            setTimeout(() => switchMode('login'), 2000);
        } catch (err) { setFpError(err.response?.data?.detail || 'Reset failed. Token may be expired.'); }
        finally { setFpLoading(false); }
    };

    const inputStyle = {
        width: '100%', padding: '12px 14px', borderRadius: '12px',
        border: '1.5px solid var(--border-glass)', background: 'var(--input-bg)',
        fontSize: '14px', color: 'var(--text-primary)', outline: 'none',
        transition: 'border-color 0.2s',
        boxSizing: 'border-box',
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)'
        }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{
                width: '100%', maxWidth: '420px', margin: '16px',
                background: 'var(--modal-bg)', borderRadius: '24px',
                padding: '32px', boxShadow: 'var(--shadow-modal)',
                border: '1px solid var(--border-glass)',
                animation: 'scaleIn 0.2s ease'
            }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
                    <div>
                        {mode === 'forgot' || mode === 'reset' ? (
                            <button onClick={() => switchMode('login')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', padding: 0 }}>
                                <ArrowLeft size={14} /> Back to sign in
                            </button>
                        ) : null}
                        <h2 style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>
                            {mode === 'login' ? 'Welcome back 👋' : mode === 'signup' ? 'Create your account' : 'Reset password'}
                        </h2>
                        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                            {mode === 'login' ? 'Sign in to continue your learning journey'
                                : mode === 'signup' ? 'Start learning with AI-powered guidance'
                                    : 'Enter your email to get a reset token'}
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '8px', color: 'var(--text-muted)' }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Forgot/Reset flow */}
                {(mode === 'forgot' || mode === 'reset') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {mode === 'forgot' && (
                            <>
                                <div style={{ position: 'relative' }}>
                                    <Mail size={15} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                                    <input style={{ ...inputStyle, paddingLeft: '40px' }} type="email" placeholder="Your email" value={fpEmail} onChange={e => setFpEmail(e.target.value)} />
                                </div>
                                {fpError && <p style={{ color: '#ef4444', fontSize: '12px', margin: 0 }}>{fpError}</p>}
                                {fpSuccess && <p style={{ color: 'var(--accent-green)', fontSize: '12px', margin: 0 }}>{fpSuccess}</p>}
                                <button onClick={sendForgot} disabled={fpLoading} style={{ width: '100%', padding: '13px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', fontWeight: 700, fontSize: '15px', cursor: 'pointer' }}>
                                    {fpLoading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : 'Send Reset Token'}
                                </button>
                                {fpToken && <button onClick={() => switchMode('reset')} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>I have a token → Reset now</button>}
                            </>
                        )}
                        {mode === 'reset' && (
                            <>
                                <input style={inputStyle} placeholder="Paste reset token" value={fpEnteredToken} onChange={e => setFpEnteredToken(e.target.value)} />
                                <input style={inputStyle} type="password" placeholder="New password (min 6 chars)" value={fpNewPass} onChange={e => setFpNewPass(e.target.value)} />
                                {fpError && <p style={{ color: '#ef4444', fontSize: '12px', margin: 0 }}>{fpError}</p>}
                                {fpSuccess && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-green)', fontSize: '13px' }}><CheckCircle2 size={16} />{fpSuccess}</div>}
                                <button onClick={doReset} disabled={fpLoading} style={{ width: '100%', padding: '13px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', fontWeight: 700, fontSize: '15px', cursor: 'pointer' }}>
                                    {fpLoading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : 'Update Password'}
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* Login/Signup form */}
                {(mode === 'login' || mode === 'signup') && (
                    <>
                        {/* Google Sign-In — uses server-side redirect, works on localhost AND network IPs */}
                        <button
                            type="button"
                            onClick={handleGoogleRedirect}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                gap: '10px', padding: '12px 16px', marginBottom: '16px',
                                borderRadius: '12px', border: '1.5px solid var(--border-glass)',
                                background: theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff',
                                color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600,
                                cursor: 'pointer', transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.10)' : '#f5f5f5'}
                            onMouseLeave={e => e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff'}
                        >
                            <svg width="18" height="18" viewBox="0 0 48 48">
                                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                            </svg>
                            {mode === 'login' ? 'Sign in with Google' : 'Sign up with Google'}
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                            <div style={{ flex: 1, height: '1px', background: 'var(--border-glass)' }} />
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>or with email</span>
                            <div style={{ flex: 1, height: '1px', background: 'var(--border-glass)' }} />
                        </div>

                        <form onSubmit={submit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {mode === 'signup' && (
                                <div style={{ position: 'relative' }}>
                                    <User size={15} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                                    <input style={{ ...inputStyle, paddingLeft: '40px' }} type="text" placeholder="Display name" value={form.display_name} onChange={update('display_name')} autoComplete="off" required />
                                </div>
                            )}
                            <div style={{ position: 'relative' }}>
                                <Mail size={15} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                                <input style={{ ...inputStyle, paddingLeft: '40px' }} type="email" placeholder="Email address" value={form.email} onChange={update('email')} autoComplete="off" required />
                            </div>
                            <div style={{ position: 'relative' }}>
                                <Lock size={15} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                                <input style={{ ...inputStyle, paddingLeft: '40px', paddingRight: '44px' }} type={showPass ? 'text' : 'password'} placeholder="Password" value={form.password} onChange={update('password')} autoComplete="new-password" required />
                                <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>

                            {error && <p style={{ color: '#ef4444', fontSize: '12px', margin: 0, padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)' }}>{error}</p>}

                            {mode === 'login' && (
                                <div style={{ textAlign: 'right' }}>
                                    <button type="button" onClick={() => switchMode('forgot')} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                                        Forgot password?
                                    </button>
                                </div>
                            )}

                            <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', fontWeight: 700, fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: loading ? 0.8 : 1, boxShadow: '0 6px 20px rgba(99,102,241,0.35)' }}>
                                {loading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : mode === 'login' ? 'Sign In' : 'Create Account'}
                            </button>
                        </form>

                        <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', marginTop: '20px' }}>
                            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                            <button onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
                                {mode === 'login' ? 'Sign up free' : 'Sign in'}
                            </button>
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
