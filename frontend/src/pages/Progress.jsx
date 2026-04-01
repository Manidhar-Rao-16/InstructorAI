import { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, Calendar, Zap, Target, BookOpen, CheckCircle, Clock, Award, Flame, Info } from 'lucide-react';
import { progressAPI } from '../services/api';

const TT = {
    contentStyle: { background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)', borderRadius: '8px', fontSize: '12px' },
    itemStyle: { color: 'var(--accent-primary)' },
    labelStyle: { color: 'var(--text-muted)', marginBottom: '4px' },
};

export default function Progress() {
    const [logs, setLogs] = useState([]);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([progressAPI.logs(30), progressAPI.dashboard()])
            .then(([lr, dr]) => { setLogs(lr.data || []); setDashboard(dr.data || null); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <TrendingUp size={36} style={{ opacity: 0.4, marginBottom: '12px' }} />
                <p style={{ fontSize: '14px', margin: 0 }}>Loading your progress...</p>
            </div>
        </div>
    );

    const activeDays = logs.filter(l => l.focus_minutes > 0).length;
    const totalFocusMin = logs.reduce((a, l) => a + (l.focus_minutes || 0), 0);
    const totalTopics = logs.reduce((a, l) => a + (l.topics_completed || 0), 0);
    const avgFocus = activeDays > 0 ? Math.round(totalFocusMin / activeDays) : 0;

    const focusData = logs.slice(-14).map(l => ({ date: l.log_date?.slice(5), focus: l.focus_minutes || 0 }));
    const chapterData = logs.slice(-14).map(l => ({ date: l.log_date?.slice(5), chapters: l.topics_completed || 0 }));
    const scoreData = logs.slice(-14).filter(l => l.avg_score).map(l => ({ date: l.log_date?.slice(5), score: Math.round(l.avg_score || 0) }));

    const stats = [
        { icon: Flame, label: 'Active Days', value: activeDays, color: '#f97316' },
        { icon: Clock, label: 'Total Focus Time', value: `${totalFocusMin}m`, color: '#6366f1' },
        { icon: BookOpen, label: 'Topics Completed', value: totalTopics, color: '#8b5cf6' },
        { icon: Zap, label: 'Avg Focus/Day', value: `${avgFocus}m`, color: '#06b6d4' },
        { icon: Target, label: 'Active Roadmaps', value: dashboard?.active_sessions?.length || 0, color: '#10b981' },
        { icon: Award, label: 'Avg Score', value: dashboard?.avg_score ? `${dashboard.avg_score.toFixed(1)}` : '—', color: '#f59e0b' },
        { icon: CheckCircle, label: 'Completed Roadmaps', value: dashboard?.completed_sessions_count || 0, color: '#10b981' },
        { icon: Calendar, label: 'Streak Days', value: dashboard?.streak_days || 0, color: '#f43f5e', tooltip: 'Your streak counts consecutive days where you completed at least one topic or logged focus time. Missing a day resets your streak to 0.' },
    ];

    return (
        <div className="page-content animate-fade-in">
            <header style={{ marginBottom: '28px' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <TrendingUp size={26} style={{ color: '#6366f1' }} /> Progress Analytics
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '6px 0 0' }}>Your learning activity over the last 30 days.</p>
            </header>

            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '28px' }}>
                {stats.map(({ icon: Icon, label, value, color, tooltip }) => (
                    <div key={label} className="glass-card" style={{ padding: '18px', borderRadius: '14px', position: 'relative' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                            <Icon size={16} style={{ color }} />
                        </div>
                        <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1 }}>{value}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {label}
                            {tooltip && (
                                <span style={{ position: 'relative', display: 'inline-flex', cursor: 'help' }} className="streak-tooltip-wrap">
                                    <Info size={11} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
                                    <span className="streak-tooltip" style={{
                                        display: 'none', position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
                                        background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)', borderRadius: '8px',
                                        padding: '8px 12px', fontSize: '11px', color: 'var(--text-secondary)', width: '200px',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100, lineHeight: 1.4, fontWeight: 400, textAlign: 'left'
                                    }}>{tooltip}</span>
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                {/* Focus Time */}
                <div className="glass-card" style={{ padding: '22px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Clock size={15} style={{ color: '#6366f1' }} /> Focus Time (minutes)
                    </h3>
                    {focusData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={160}>
                            <AreaChart data={focusData}>
                                <defs>
                                    <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-glass)" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                                <Tooltip {...TT} formatter={v => [`${v}m`, 'Focus']} />
                                <Area type="monotone" dataKey="focus" stroke="#6366f1" fill="url(#fg)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>No focus data yet.</div>}
                </div>

                {/* Chapters per day */}
                <div className="glass-card" style={{ padding: '22px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <BookOpen size={15} style={{ color: '#8b5cf6' }} /> Chapters Completed / Day
                    </h3>
                    {chapterData.some(d => d.chapters > 0) ? (
                        <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={chapterData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-glass)" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                                <Tooltip {...TT} formatter={v => [v, 'Chapters']} />
                                <Bar dataKey="chapters" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Complete chapters to see data.</div>}
                </div>
            </div>

            {/* Active & Completed Roadmaps */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="glass-card" style={{ padding: '22px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Target size={15} style={{ color: '#10b981' }} /> Active Roadmaps
                    </h3>
                    {(dashboard?.active_sessions || []).length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '16px' }}>No active roadmaps.</p>
                    ) : dashboard.active_sessions.map(s => (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic}</div>
                                <div style={{ height: '4px', background: 'var(--border-glass)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${(s.completed_steps / Math.max(s.total_steps, 1)) * 100}%`, background: '#6366f1', borderRadius: '2px' }} />
                                </div>
                            </div>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>{s.completed_steps}/{s.total_steps}</span>
                        </div>
                    ))}
                </div>

                <div className="glass-card" style={{ padding: '22px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle size={15} style={{ color: '#10b981' }} /> Completed Topics
                    </h3>
                    {(dashboard?.completed_sessions || []).length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '16px' }}>No completed topics yet. Keep going!</p>
                    ) : dashboard.completed_sessions.map(s => (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '8px 12px', borderRadius: '10px', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)' }}>
                            <CheckCircle size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                            <span style={{ fontSize: '13px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>{s.total_steps} chapters</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
