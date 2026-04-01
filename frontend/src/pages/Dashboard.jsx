import { useEffect, useState, useCallback } from 'react';
import { BookOpen, CheckCircle, Clock, Star, Trophy, ChevronRight, Trash2, Loader2, Sparkles, CheckCircle2, Target, TrendingUp, Lock } from 'lucide-react';
import { progressAPI, assignmentAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { swalConfirm } from '../utils/swalTheme';

export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [tasks, setTasks] = useState([]);
    const [steps, setSteps] = useState([]);
    const [fetchingSteps, setFetchingSteps] = useState(false);

    const fetchAll = useCallback(async () => {
        try {
            const [dashRes, tasksRes] = await Promise.all([progressAPI.dashboard(), assignmentAPI.list()]);
            setData(dashRes.data);
            setTasks(tasksRes.data || []);
            if (dashRes.data.active_sessions?.length > 0 && !selectedSessionId) {
                setSelectedSessionId(dashRes.data.active_sessions[0].id);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    useEffect(() => {
        if (!selectedSessionId) { setSteps([]); return; }
        setFetchingSteps(true);
        progressAPI.steps(selectedSessionId)
            .then(res => setSteps(res.data || []))
            .catch(console.error)
            .finally(() => setFetchingSteps(false));
    }, [selectedSessionId]);

    const handleActivateStep = async (step) => {
        if (!step) return;
        try {
            const res = await progressAPI.activateStep(step.id);
            const chatSessionId = res.data.chat_session_id;
            const updatedTargetDate = res.data.target_date || step.target_date;
            const state = {
                topic: step.title,
                content: step.content,
                session_id: selectedSessionId,
                target_date: updatedTargetDate || null,
                completed_at: step.completed_at || null,
            };
            navigate(chatSessionId ? `/chat/${chatSessionId}` : '/chat', { state });
        } catch {
            navigate('/chat', { state: {
                topic: step.title,
                content: step.content,
                session_id: selectedSessionId,
                target_date: step.target_date || null,
                completed_at: step.completed_at || null,
            } });
        }
    };

    const handleToggleStep = async (e, stepId) => {
        e.stopPropagation();
        try {
            const res = await progressAPI.toggleStep(stepId);
            setSteps(prev => prev.map(s => s.id === stepId ? { ...s, is_complete: res.data.is_complete } : s));
            window.dispatchEvent(new CustomEvent('refresh-notifications'));
        } catch (err) { console.error(err); }
    };

    const handleDeleteSession = async (e, sessionId) => {
        e.stopPropagation();
        const result = await swalConfirm({
            title: 'Delete learning plan?',
            text: 'Delete this learning plan and all its data?',
            confirmText: 'Yes, delete it!'
        });
        if (!result.isConfirmed) return;
        try { await progressAPI.deleteSession(sessionId); fetchAll(); } catch (err) { console.error(err); }
    };

    if (loading) return (
        <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
            <div style={{ textAlign: 'center' }}>
                <Loader2 size={36} style={{ animation: 'spin 1s linear infinite', color: '#6366f1', marginBottom: '12px' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading your dashboard...</p>
            </div>
        </div>
    );

    const selectedSession = [...(data?.active_sessions || []), ...(data?.completed_sessions || [])].find(s => s.id === selectedSessionId);
    const nextStep = steps.find(s => !s.is_complete);
    const pendingTasks = tasks.filter(a => a.status === 'pending' && a.session_id === selectedSessionId);

    const stats = [
        { icon: BookOpen, value: data?.total_sessions || 0, label: 'Total Topics', color: '#6366f1' },
        { icon: Target, value: data?.completed_sessions_count || 0, label: 'Topics Mastered', color: '#8b5cf6' },
        { icon: TrendingUp, value: `${data?.completion_percentage || 0}%`, label: 'Completion Rate', color: '#10b981' },
        { icon: Star, value: data?.avg_score ? data.avg_score.toFixed(1) : '—', label: 'Average Score', color: '#f59e0b' },
        { icon: Clock, value: `${data?.total_focus_minutes || 0}m`, label: 'Focus Time', color: '#06b6d4' },
    ];

    return (
        <div className="page-content animate-fade-in">
            {/* Header */}
            <div style={{ marginBottom: '32px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: 800, margin: '0 0 4px' }}>
                    Welcome back, {user?.display_name?.split(' ')[0] || 'there'}! 👋
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>Here's your learning overview for today.</p>

                {/* Today's Goal Banner */}
                {nextStep && (
                    <div style={{
                        marginTop: '20px', padding: '18px 20px', borderRadius: '16px',
                        background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.06))',
                        border: '1px solid rgba(99,102,241,0.2)',
                        display: 'flex', alignItems: 'center', gap: '16px'
                    }}>
                        <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Trophy size={20} style={{ color: 'white' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>Today's Goal</div>
                            <div style={{ fontSize: '15px', fontWeight: 700 }}>{nextStep.title}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Continue your {selectedSession?.topic} journey</div>
                        </div>
                        <button onClick={() => handleActivateStep(nextStep)} className="btn btn-primary" style={{ height: '40px', fontSize: '13px', padding: '0 20px', flexShrink: 0 }}>
                            Start Lesson
                        </button>
                    </div>
                )}
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px', marginBottom: '28px' }}>
                {stats.map(({ icon: Icon, value, label, color }) => (
                    <div key={label} className="glass-card" style={{ padding: '20px 16px', textAlign: 'center', borderRadius: '16px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                            <Icon size={18} style={{ color }} />
                        </div>
                        <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1 }}>{value}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>{label}</div>
                    </div>
                ))}
            </div>

            {/* Main Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* In Progress Roadmaps */}
                <div className="glass-card" style={{ padding: '22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>In Progress Roadmaps</h3>
                        <Link to="/planner" style={{ fontSize: '12px', color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>View All →</Link>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '250px', paddingRight: '4px' }}>
                        {data?.active_sessions?.length > 0 ? data.active_sessions.map(s => (
                            <div key={s.id} onClick={() => setSelectedSessionId(s.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                                    borderRadius: '12px', cursor: 'pointer',
                                    background: selectedSessionId === s.id ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.01)',
                                    border: `1px solid ${selectedSessionId === s.id ? 'rgba(99,102,241,0.3)' : 'var(--border-glass)'}`,
                                    transition: 'all 0.15s'
                                }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 6px rgba(99,102,241,0.6)', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{s.completed_steps}/{s.total_steps} modules</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div style={{ width: '50px', height: '4px', borderRadius: '2px', background: 'var(--border-glass)', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${(s.completed_steps / Math.max(s.total_steps, 1)) * 100}%`, background: '#6366f1', borderRadius: '2px' }} />
                                    </div>
                                    <button onClick={e => handleDeleteSession(e, s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }}
                                        onMouseOver={e => e.currentTarget.style.color = '#ef4444'} onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}>
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        )) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', borderRadius: '12px', border: '1px dashed var(--border-glass)' }}>
                                No active roadmaps.{' '}
                                <Link to="/planner" style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>Create one →</Link>
                            </div>
                        )}
                    </div>
                </div>

                {/* Select Topic / Chapters */}
                <div className="glass-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                            {selectedSession ? `${selectedSession.topic} Chapters` : 'Select a Topic'}
                        </h3>
                        {selectedSession && <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '8px', background: 'rgba(99,102,241,0.1)', color: '#6366f1', fontWeight: 600 }}>{selectedSession.completed_steps}/{selectedSession.total_steps}</span>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', maxHeight: '220px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {!selectedSession ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px', color: 'var(--text-muted)', textAlign: 'center', gap: '8px' }}>
                                <BookOpen size={28} style={{ opacity: 0.4 }} />
                                <p style={{ fontSize: '13px', margin: 0 }}>Click a roadmap on the left to view its chapters</p>
                            </div>
                        ) : fetchingSteps ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /></div>
                        ) : steps.map((step, idx) => {
                            const prevStep = steps[idx - 1];
                            const isUnlocked = idx === 0 || (
                                prevStep?.is_complete && 
                                (prevStep.total_tasks === 0 || prevStep.completed_tasks >= prevStep.total_tasks)
                            );
                            return (
                            <div key={step.id} onClick={() => isUnlocked && handleActivateStep(step)}
                                title={!isUnlocked ? 'Complete the previous module and its tasks first' : ''}
                                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '10px', cursor: isUnlocked ? 'pointer' : 'not-allowed', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', transition: 'all 0.15s', opacity: isUnlocked ? 1 : 0.5 }}
                                onMouseOver={e => { if (isUnlocked) { e.currentTarget.style.background = 'rgba(99,102,241,0.06)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)'; } }}
                                onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'var(--border-glass)'; }}>
                                {isUnlocked ? (
                                    <button onClick={e => handleToggleStep(e, step.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}>
                                        {step.is_complete ? <CheckCircle2 size={16} style={{ color: '#10b981' }} /> : <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid var(--text-muted)' }} />}
                                    </button>
                                ) : (
                                    <Lock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                )}
                                <span style={{ flex: 1, fontSize: '12px', fontWeight: step.is_complete ? 400 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: step.is_complete ? 'line-through' : 'none', color: step.is_complete ? 'var(--text-muted)' : isUnlocked ? 'var(--text-primary)' : 'var(--text-muted)' }}>{step.title}</span>
                                {isUnlocked ? <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : null}
                            </div>
                        );
                        })}
                    </div>
                    {selectedSession && (
                        <button onClick={() => handleActivateStep(nextStep || steps[0])} className="btn btn-primary" style={{ marginTop: '14px', width: '100%', justifyContent: 'center', height: '38px', fontSize: '13px' }}>
                            Continue with InstructorAI →
                        </button>
                    )}
                </div>

                {/* Pending Tasks */}
                <div className="glass-card" style={{ padding: '22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Pending Tasks</h3>
                        <Link to="/tasks" style={{ fontSize: '12px', color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>View All →</Link>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '200px', paddingRight: '4px' }}>
                        {pendingTasks.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', background: 'rgba(16,185,129,0.05)', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.15)' }}>
                                <CheckCircle size={20} style={{ color: '#10b981', margin: '0 auto 6px' }} />
                                <p style={{ margin: 0 }}>All caught up! No pending tasks for this roadmap. 🎉</p>
                            </div>
                        ) : pendingTasks.slice(0, 4).map(a => (
                            <div key={a.id} onClick={() => navigate('/tasks')} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', border: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.01)', transition: 'all 0.15s' }}
                                onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.05)'}
                                onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.01)'}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(a.submitted_at).toLocaleDateString()}</div>
                                </div>
                                <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="glass-card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 4px' }}>Quick Actions</h3>
                    {[
                        { to: '/planner', label: 'Create New Roadmap', sub: 'Generate a learning plan', emoji: '🗺️', color: '#6366f1' },
                        { to: '/chat', label: 'Ask InstructorAI', sub: 'Get help with any topic', emoji: '🤖', color: '#8b5cf6' },
                        { to: '/timer', label: 'Start Focus Timer', sub: '30-min Pomodoro session', emoji: '⏱️', color: '#06b6d4' },
                    ].map(({ to, label, sub, emoji, color }) => (
                        <Link key={to} to={to} style={{ textDecoration: 'none' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', border: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'all 0.15s' }}
                                onMouseOver={e => { e.currentTarget.style.background = `${color}08`; e.currentTarget.style.borderColor = `${color}40`; }}
                                onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'var(--border-glass)'; }}>
                                <span style={{ fontSize: '22px' }}>{emoji}</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{label}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sub}</div>
                                </div>
                                <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}