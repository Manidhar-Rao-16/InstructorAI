import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { swalConfirm } from '../utils/swalTheme';
import { Plus, MessageSquare, Trash2, Loader2, FileText } from 'lucide-react';
import { chatAPI, progressAPI } from '../services/api';
import { useChat } from '../contexts/ChatContext';

export default function Sidebar({ width }) {
    const { 
        sessions, 
        updateSessionsLocally, 
        lastSessionId: activeSessionId, 
        setLastSessionId: setActiveSessionId,
        generatingTopic
    } = useChat();
    const [loading, setLoading] = useState(true);
    const { pathname } = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        chatAPI.sessions()
            .then(r => updateSessionsLocally(r.data || []))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const createNew = async () => {
        try {
            const existingEmpty = sessions.find(s => s.title === 'New Chat' || s.title === 'Empty Chat');
            if (existingEmpty) {
                setActiveSessionId(existingEmpty.id);
                navigate(`/chat/${existingEmpty.id}`);
                return;
            }

            const res = await chatAPI.createSession('New Chat');
            const s = res.data;
            updateSessionsLocally(prev => [s, ...prev]);
            setActiveSessionId(s.id);
            navigate(`/chat/${s.id}`);
        } catch (err) { console.error(err); }
    };

    const deleteSession = async (e, id) => {
        e.stopPropagation();
        e.preventDefault();
        try {
            await chatAPI.deleteSession(id);
            updateSessionsLocally(prev => prev.filter(s => s.id !== id));
            if (activeSessionId === id) {
                navigate('/chat');
                setActiveSessionId(null);
            }
        } catch (err) { console.error(err); }
    };

    const groupByDate = (sessions) => {
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        const groups = {};
        sessions.forEach(s => {
            const d = new Date(s.created_at).toDateString();
            const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(s.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            if (!groups[label]) groups[label] = [];
            groups[label].push(s);
        });
        return groups;
    };

    const currentSession = pathname.match(/\/chat\/(\d+)/);
    const currentId = currentSession ? parseInt(currentSession[1]) : null;

    const deleteModule = async (e, sessionId, moduleId) => {
        e.stopPropagation();
        const result = await swalConfirm({
            title: 'Remove module from chat?',
            text: 'Are you sure you want to remove this module from the chat?',
            confirmText: 'Yes, remove it!'
        });
        if (!result.isConfirmed) return;
        try {
            await chatAPI.removeModule(sessionId, moduleId);
            updateSessionsLocally(prev => prev.map(s => {
                if (String(s.id) === String(sessionId) && s.modules) {
                    return { ...s, modules: s.modules.filter(m => String(m.id) !== String(moduleId)) };
                }
                return s;
            }));
        } catch (err) {
            console.error(err);
        }
    };

    /* Build a flat list: roadmap sessions are expanded into individual module entries */
    const buildFlatItems = () => {
        const flat = [];
        sessions.forEach(s => {
            if (s.is_roadmap && s.modules && s.modules.length > 0) {
                s.modules.forEach(mod => {
                    const moduleDate = mod.completed_at || mod.target_date || s.created_at;
                    flat.push({ type: 'module', session: s, module: mod, created_at: moduleDate });
                });
            } else {
                flat.push({ type: 'chat', session: s, created_at: s.updated_at || s.created_at });
            }
        });
        
        // Sort items by date descending
        flat.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return flat;
    };

    const flatItems = buildFlatItems();

    const groupFlatByDate = () => {
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        const groups = {};
        flatItems.forEach(item => {
            const d = new Date(item.created_at).toDateString();
            const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(item.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
            if (!groups[label]) groups[label] = [];
            groups[label].push(item);
        });
        return groups;
    };

    return (
        <div style={{
            position: 'fixed', top: '64px', left: 0, bottom: 0,
            width: `${width}px`, background: 'var(--bg-sidebar)',
            borderRight: '1px solid var(--border-glass)',
            display: 'flex', flexDirection: 'column', zIndex: 50,
            overflow: 'hidden'
        }}>
            {/* New Chat button */}
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-glass)' }}>
                <button onClick={createNew} style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '10px 16px', borderRadius: '12px', border: '1.5px dashed rgba(99,102,241,0.3)',
                    background: 'rgba(99,102,241,0.04)', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    color: '#6366f1', transition: 'all 0.2s'
                }}
                    onMouseOver={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; e.currentTarget.style.borderColor = '#6366f1'; }}
                    onMouseOut={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.04)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}>
                    <Plus size={15} /> New Chat
                </button>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
                        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
                    </div>
                ) : flatItems.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        <MessageSquare size={28} style={{ opacity: 0.3, marginBottom: '8px' }} />
                        <p style={{ margin: 0 }}>No conversations yet.</p>
                        <p style={{ margin: '4px 0 0' }}>Start a new chat!</p>
                    </div>
                ) : (
                    <>
                        {Object.entries(groupFlatByDate()).map(([label, items]) => (
                            <div key={label} style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '4px 10px 6px' }}>
                                    {label}
                                </div>
                                {items.map(item => {
                                    if (item.type === 'module') {
                                        const { session: s, module: mod } = item;
                                        const currentTopic = location.state?.topic || localStorage.getItem(`topic_${s.id}`);
                                        const isActive = String(currentId) === String(s.id) && currentTopic === mod.title;
                                        const isGeneratingThis = generatingTopic && typeof generatingTopic === 'string' && generatingTopic.includes(mod.title);
                                        return (
                                            <div key={`mod-${mod.id}`}
                                                onClick={() => {
                                                    setActiveSessionId(s.id);
                                                    
                                                    let isFuture = false;
                                                    let targetDate = mod.target_date;
                                                    
                                                    if (targetDate) {
                                                        const mDate = new Date(targetDate);
                                                        const tDate = new Date();
                                                        mDate.setHours(0,0,0,0);
                                                        tDate.setHours(0,0,0,0);
                                                        if (mDate > tDate) {
                                                            isFuture = true;
                                                            // Format as YYYY-MM-DD to avoid timezone shifting issues
                                                            const year = tDate.getFullYear();
                                                            const month = String(tDate.getMonth() + 1).padStart(2, '0');
                                                            const day = String(tDate.getDate()).padStart(2, '0');
                                                            targetDate = `${year}-${month}-${day}`;
                                                        }
                                                    }
                                                    
                                                    navigate(`/chat/${s.id}`, {
                                                        state: {
                                                            topic: mod.title,
                                                            content: mod.content,
                                                            completed_at: mod.completed_at || null,
                                                            target_date: targetDate,
                                                            session_id: s.learning_session_id
                                                        }
                                                    });
                                                    
                                                    if (isFuture) {
                                                        // Auto-activate to sync the new date with the backend, then refresh the sidebar
                                                        progressAPI.activateStep(mod.id)
                                                            .then(() => chatAPI.sessions())
                                                            .then(r => updateSessionsLocally(r.data || []))
                                                            .catch(err => console.error("Auto-reschedule error:", err));
                                                    }
                                                }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '8px 10px', borderRadius: '10px', cursor: 'pointer',
                                                    background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                                                    border: isActive ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
                                                    marginBottom: '2px', transition: 'all 0.15s'
                                                }}
                                                onMouseOver={e => { if (!isActive) e.currentTarget.style.background = 'rgba(99,102,241,0.05)'; }}
                                                onMouseOut={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                                            >
                                                <span style={{ display: 'flex', flexShrink: 0, opacity: isGeneratingThis ? 1 : 0.6 }}>
                                                    {isGeneratingThis ? (
                                                        <Loader2 size={13} className="animate-spin" style={{ color: '#6366f1' }} />
                                                    ) : mod.is_complete ? (
                                                        <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '13px' }}>✓</span>
                                                    ) : (
                                                        <FileText size={13} style={{ color: 'var(--text-muted)' }} />
                                                    )}
                                                </span>
                                                <span style={{ 
                                                    flex: 1, fontSize: '12.5px', fontWeight: isActive ? 600 : 500, 
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    color: mod.is_complete ? 'var(--text-muted)' : 'var(--text-secondary)',
                                                    textDecoration: mod.is_complete ? 'line-through' : 'none'
                                                }}>
                                                    {mod.title} <span style={{ opacity: 0.5 }}>—</span> <span style={{ opacity: 0.6, fontSize: '11.5px' }}>{s.title}</span>
                                                </span>
                                                <button onClick={(e) => deleteModule(e, s.id, mod.id)} 
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', borderRadius: '4px', color: 'var(--text-muted)', opacity: 0, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                                                    onMouseOver={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#ef4444'; e.stopPropagation(); }}
                                                    onMouseOut={e => { e.currentTarget.style.opacity = 0; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        );
                                    } else {
                                        const s = item.session;
                                        return (
                                            <div key={s.id}
                                                onClick={() => { setActiveSessionId(s.id); navigate(`/chat/${s.id}`); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '9px 10px', borderRadius: '10px', cursor: 'pointer',
                                                    background: currentId === s.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                                                    border: currentId === s.id ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
                                                    marginBottom: '2px', transition: 'all 0.15s'
                                                }}
                                                onMouseOver={e => { if (currentId !== s.id) e.currentTarget.style.background = 'rgba(99,102,241,0.05)'; }}
                                                onMouseOut={e => { if (currentId !== s.id) e.currentTarget.style.background = 'transparent'; }}
                                            >
                                                <MessageSquare size={13} style={{ color: currentId === s.id ? '#6366f1' : 'var(--text-muted)', flexShrink: 0 }} />
                                                <span style={{ flex: 1, fontSize: '13px', fontWeight: currentId === s.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: currentId === s.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                                    {s.title || 'New Chat'}
                                                </span>
                                                <button onClick={(e) => deleteSession(e, s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', borderRadius: '5px', color: 'var(--text-muted)', opacity: 0, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                                                    onMouseOver={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#ef4444'; e.stopPropagation(); }}
                                                    onMouseOut={e => { e.currentTarget.style.opacity = 0; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        );
                                    }
                                })}
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
