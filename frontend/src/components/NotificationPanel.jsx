import { useEffect, useState } from 'react';
import { X, Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notifAPI } from '../services/api';

const ICON_MAP = {
    morning_plan: '🌅', eod_reminder: '🌙',
    missed_topic: '⚠️', tomorrow_reminder: '📅', general: '🔔',
};

export default function NotificationPanel({ onClose }) {
    const [notifs, setNotifs] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        notifAPI.list().then(r => setNotifs(r.data || [])).finally(() => setLoading(false));
    }, []);

    const handleClick = async (n) => {
        if (!n.is_read) {
            setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
            await notifAPI.markRead(n.id);
        }
        if (n.action_url) {
            navigate(n.action_url);
            onClose();
        }
    };

    const markAll = async () => {
        await notifAPI.markAllRead();
        setNotifs(n => n.map(x => ({ ...x, is_read: true })));
    };

    const unread = notifs.filter(n => !n.is_read).length;

    return (
        <div style={{
            width: '360px', borderRadius: '18px',
            background: 'var(--dropdown-bg)',
            border: '1px solid var(--border-glass)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.16)',
            overflow: 'hidden',
            animation: 'scaleIn 0.15s ease'
        }}>
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', background: 'rgba(99,102,241,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Bell size={16} style={{ color: '#6366f1' }} />
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>Notifications</span>
                    {unread > 0 && (
                        <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#6366f1', color: 'white', fontSize: '10px', fontWeight: 700 }}>{unread} new</span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {unread > 0 && (
                        <button onClick={markAll} title="Mark all read" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                            <CheckCheck size={16} />
                        </button>
                    )}
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* List */}
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Loading...</div>
                ) : notifs.length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <Bell size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
                        <p style={{ fontSize: '13px', margin: 0 }}>No notifications yet.</p>
                    </div>
                ) : (
                    notifs.map(n => (
                        <div key={n.id}
                            onClick={() => handleClick(n)}
                            style={{
                                padding: '14px 18px', display: 'flex', gap: '12px', alignItems: 'flex-start',
                                cursor: n.action_url ? 'pointer' : 'default',
                                background: n.is_read ? 'transparent' : 'rgba(99,102,241,0.05)',
                                borderBottom: '1px solid var(--border-glass)',
                                transition: 'background 0.15s'
                            }}
                            onMouseOver={e => { if (n.action_url) e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; }}
                            onMouseOut={e => { e.currentTarget.style.background = n.is_read ? 'transparent' : 'rgba(99,102,241,0.05)'; }}
                        >
                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                                {ICON_MAP[n.type] || '📢'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: n.is_read ? 500 : 700, lineHeight: 1.3 }}>{n.title}</span>
                                    {!n.is_read && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1', flexShrink: 0, marginTop: '3px' }} />}
                                </div>
                                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>{n.message}</p>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                        {new Date(n.sent_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    {n.action_url && <ExternalLink size={11} style={{ color: 'var(--accent-primary)' }} />}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
