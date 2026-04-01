import { useEffect, useState } from 'react';
import { ShieldCheck, Users, BarChart3, TrendingDown, MoreHorizontal, Mail, ExternalLink } from 'lucide-react';
import { adminAPI } from '../services/api';

export default function Admin() {
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([adminAPI.users(), adminAPI.stats()])
            .then(([uRes, sRes]) => {
                setUsers(uRes.data);
                setStats(sRes.data);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="page-content">Loading administrator dashboard...</div>;

    return (
        <div className="page-content animate-fade-in">
            <div style={{ marginBottom: '32px' }}>
                <h1 className="page-title">Admin Monitoring</h1>
                <p className="page-subtitle">Monitor user activity, track platform-wide performance, and identify areas for platform improvement.</p>
            </div>

            {/* Admin Stats */}
            <div className="grid-4" style={{ marginBottom: '32px' }}>
                <div className="glass-card stat-card">
                    <Users size={20} className="badge-purple" />
                    <div className="stat-value">{stats?.total_users || 0}</div>
                    <div className="stat-label">Total Learners</div>
                </div>
                <div className="glass-card stat-card">
                    <BarChart3 size={20} className="badge-green" />
                    <div className="stat-value">{stats?.total_sessions || 0}</div>
                    <div className="stat-label">Learning Sessions</div>
                </div>
                <div className="glass-card stat-card">
                    <TrendingDown size={20} className={stats?.avg_platform_score < 70 ? 'badge-rose' : 'badge-green'} />
                    <div className="stat-value">{stats?.avg_platform_score || '0.0'}</div>
                    <div className="stat-label">Avg. Platform Grade</div>
                </div>
                <div className="glass-card stat-card">
                    <ShieldCheck size={20} className="badge-cyan" />
                    <div className="stat-value">Active</div>
                    <div className="stat-label">System Integrity</div>
                </div>
            </div>

            {/* User Table */}
            <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
                <div style={{ padding: '24px', borderBottom: '1px solid var(--border-glass)' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 700 }}>User Activity Report</h3>
                </div>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Learner</th>
                            <th>Progress</th>
                            <th>Avg Score</th>
                            <th>Focus Time</th>
                            <th>Last Active</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => (
                            <tr key={u.user_id}>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div className="avatar avatar-user" style={{ width: '32px', height: '32px' }}>
                                            {u.display_name?.[0]?.toUpperCase() || 'U'}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{u.display_name}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{u.email}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <div style={{ width: '120px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                                            <span>Done</span>
                                            <span>{u.completed_sessions}/{u.total_sessions}</span>
                                        </div>
                                        <div className="progress-bar-wrap" style={{ height: '4px' }}>
                                            <div className="progress-bar-fill" style={{ width: `${(u.completed_sessions / Math.max(u.total_sessions, 1)) * 100}%` }} />
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <span className={`badge ${u.avg_score >= 80 ? 'badge-green' : u.avg_score >= 60 ? 'badge-amber' : 'badge-rose'}`}>
                                        {u.avg_score || 'N/A'}
                                    </span>
                                </td>
                                <td>{u.total_focus_minutes}m</td>
                                <td>
                                    <div style={{ fontSize: '12px' }}>
                                        {u.last_activity ? new Date(u.last_activity).toLocaleDateString() : 'Never'}
                                    </div>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="btn btn-ghost" style={{ padding: '6px' }} title="Email User">
                                            <Mail size={14} />
                                        </button>
                                        <button className="btn btn-ghost" style={{ padding: '6px' }} title="View Profile">
                                            <ExternalLink size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
