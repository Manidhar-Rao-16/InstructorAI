import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Coffee, Brain, Loader2, Pause, X, Clock, Zap } from 'lucide-react';
import { useTimer } from '../contexts/TimerContext';

export default function Timer() {
    const {
        isActive, isPaused, timeLeft, topic, setTopic, loading,
        start, startBreak, pause, resume, stop, skip, duration,
        isBreak, finished, setFinished
    } = useTimer();
    const [showModal, setShowModal] = useState(false);
    const audioRef = useRef(null);

    const fmt = (s) => `${Math.floor(s / 60)}:${((s % 60) || 0).toString().padStart(2, '0')}`;
    const pct = (timeLeft / duration) * 100;
    const r = 90, circ = 2 * Math.PI * r;
    const dashOffset = circ * (1 - pct / 100);

    // Play alarm when session finishes
    useEffect(() => {
        if (finished) {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(e => console.log("Audio play failed:", e));
            }
        } else {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
        }
    }, [finished]);

    return (
        <div className="page-content animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '40px' }}>
            <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" loop preload="auto" />

            <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Clock size={26} style={{ color: '#6366f1' }} /> Pomodoro Focus Timer
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '40px' }}>Stay focused. 30 minutes on, then break.</p>

            {/* Timer Ring */}
            <div style={{ position: 'relative', width: '220px', height: '220px', marginBottom: '36px' }}>
                <svg width="220" height="220" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="110" cy="110" r={r} fill="none" stroke="var(--border-glass)" strokeWidth="8" />
                    <circle cx="110" cy="110" r={r} fill="none"
                        stroke={isPaused ? '#f59e0b' : isBreak ? '#10b981' : '#6366f1'}
                        strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={circ} strokeDashoffset={dashOffset}
                        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s' }} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '44px', fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-2px', color: isPaused ? '#f59e0b' : isBreak ? '#10b981' : 'var(--text-primary)' }}>
                        {fmt(timeLeft)}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>
                        {!isActive ? 'Ready' : isPaused ? '⏸ Paused' : isBreak ? '☕ Break Time' : '🔥 Focus mode'}
                    </div>
                </div>
            </div>

            {/* Topic Input */}
            {!isActive && !finished && (
                <div style={{ width: '100%', maxWidth: '400px', marginBottom: '24px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textAlign: 'center' }}>
                        What are you focusing on?
                    </label>
                    <input
                        className="input"
                        type="text"
                        placeholder="e.g. Python Basics, React Hooks..."
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                        style={{ textAlign: 'center', fontSize: '14px' }}
                    />
                </div>
            )}

            {isActive && topic && (
                <div style={{ marginBottom: '24px', padding: '8px 20px', borderRadius: '20px', background: isBreak ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)', border: isBreak ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(99,102,241,0.2)', fontSize: '13px', fontWeight: 600, color: isBreak ? '#10b981' : '#6366f1', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isBreak ? <Coffee size={14} /> : <Brain size={14} />} {topic}
                </div>
            )}

            {/* Controls */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {!isActive ? (
                    <button onClick={() => start()} disabled={loading} className="btn btn-primary"
                        style={{ height: '52px', padding: '0 32px', fontSize: '15px', fontWeight: 700, gap: '10px', borderRadius: '14px' }}>
                        {loading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <><Play size={18} /> Start 30-min Focus</>}
                    </button>
                ) : (
                    <>
                        {!isPaused ? (
                            !isBreak && (
                                <button onClick={() => setShowModal(true)} style={{ height: '48px', padding: '0 24px', borderRadius: '12px', border: '1.5px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', cursor: 'pointer', fontWeight: 700, fontSize: '14px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Pause size={16} /> Add Break
                                </button>
                            )
                        ) : (
                            <button onClick={resume} className="btn btn-primary" style={{ height: '48px', padding: '0 24px', fontSize: '14px', fontWeight: 700, gap: '8px', borderRadius: '12px' }}>
                                <Play size={16} /> Resume
                            </button>
                        )}
                        <button onClick={() => stop(false)} style={{ height: '48px', padding: '0 24px', borderRadius: '12px', border: '1.5px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', cursor: 'pointer', fontWeight: 700, fontSize: '14px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Square size={16} /> {isBreak ? 'End Break' : 'Stop'}
                        </button>
                        {!isBreak && (
                            <button onClick={() => skip()} style={{ height: '48px', padding: '0 20px', borderRadius: '12px', border: '1px solid var(--border-glass)', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Coffee size={15} /> Skip to Break
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Info Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '48px', width: '100%', maxWidth: '400px' }}>
                {/* {[
                    // { icon: Zap, label: 'Focus', value: '30 min', color: '#6366f1', action: () => !isActive && start() },
                    // { icon: Coffee, label: 'Break', value: '5 min', color: '#10b981', action: () => isActive ? setShowModal(true) : startBreak(5) },
                ].map(({ icon: Icon, label, value, color, action }) => (
                    <div
                        key={label}
                        className={`glass-card ${action && (!isActive || (isActive && label === 'Break' && !isBreak)) ? 'hover-scale' : ''}`}
                        onClick={action}
                        style={{ padding: '20px', textAlign: 'center', borderRadius: '16px', cursor: action && (!isActive || (isActive && label === 'Break' && !isBreak)) ? 'pointer' : 'default' }}>
                        <Icon size={20} style={{ color, marginBottom: '8px' }} />
                        <div style={{ fontSize: '16px', fontWeight: 700 }}>{value}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
                    </div>
                ))} */}
            </div>

            {/* Pause Modal (Zen Overlay) */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', backdropFilter: 'blur(40px)' }}>
                    <div className="glass-card" style={{ padding: '40px', maxWidth: '400px', width: '90%', borderRadius: '24px', textAlign: 'center', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-modal)', background: 'var(--bg-secondary)' }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'rgba(245, 159, 11, 0.13)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                            <Coffee size={32} style={{ color: '#f59e0b' }} />
                        </div>
                        <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '12px' }}>Take a Break?</h2>
                        <p style={{ fontSize: '15px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '32px' }}>
                            Focusing for long periods is great, but a 5-minute breather will keep your mind sharp. Ready to recharge?
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <button onClick={() => { startBreak(5); setShowModal(false); }} disabled={loading} className="btn btn-primary" style={{ height: '56px', borderRadius: '16px', fontWeight: 700, fontSize: '16px', background: '#f59e0b', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                {loading ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : 'Start 5-min Break'}
                            </button>
                            <button onClick={() => setShowModal(false)} style={{ height: '56px', color: 'var(--text-muted)', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '16px' }}>
                                Keep Focusing
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Completion Popup */}
            {finished && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', backdropFilter: 'blur(20px)' }}>
                    <div className="glass-card" style={{ padding: '40px', maxWidth: '400px', width: '90%', borderRadius: '24px', textAlign: 'center', boxShadow: 'var(--shadow-modal)', background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)' }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                            <Zap size={28} style={{ color: '#6366f1' }} />
                        </div>
                        <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '12px' }}>Session Complete!</h2>
                        <p style={{ fontSize: '15px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '32px' }}>
                            {isBreak ? "Your break is over. Ready to dive back in?" : "Great job staying focused! Time for a well-deserved break."}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* <button onClick={() => { setFinished(false); start(); }} className="btn btn-primary" style={{ height: '52px', borderRadius: '14px', fontWeight: 700 }}>
                                Start Next Focus
                            </button> */}
                            <button onClick={() => setFinished(false)} style={{ height: '52px', color: 'var(--text-muted)', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '14px' }}>
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
