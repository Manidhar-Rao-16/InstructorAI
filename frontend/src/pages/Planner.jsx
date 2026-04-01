import { useState, useEffect } from 'react';
import { Calendar, BookOpen, Target, Sparkles, Plus, Clock, ChevronRight, CheckCircle, CheckCircle2, Loader2, Trash2, Layout, Download, FileText, Lock, ClipboardList } from 'lucide-react';
import { progressAPI, exportAPI, assignmentAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { swalConfirm } from '../utils/swalTheme';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const LEVELS = [
    'Level 1. Foundation.',
    'Level 2 Basic Practitioner',
    'Level 3 Skilled',
    'Level 4 Professional',
    'Level 5 Architect / Master',
];

const POPULAR = ['Python', 'React.js', 'Data Science', 'Cloud Computing', 'Java', 'AI / ML', 'Web Development', 'SQL', 'Docker', 'TypeScript'];

export default function Planner() {
    const navigate = useNavigate();
    const [topic, setTopic] = useState('');
    const [level, setLevel] = useState(LEVELS[0]);
    const [days, setDays] = useState(7);
    const [startDate, setStartDate] = useState(new Date());

    const isSunday = (date) => date.getDay() !== 0;
    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    const getDayClassName = (date) => date.getDay() === 0 ? 'sunday-highlight' : undefined;
    const [holidays, setHolidays] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sessions, setSessions] = useState([]);
    const [fetchingSessions, setFetchingSessions] = useState(true);
    const [selectedSessionId, setSelectedSessionId] = useState(() => {
        const stored = localStorage.getItem('planner_selected_session');
        return stored ? parseInt(stored, 10) : null;
    });
    const [steps, setSteps] = useState([]);
    const [fetchingSteps, setFetchingSteps] = useState(false);
    const [loadingStepId, setLoadingStepId] = useState(null);
    const [allTasks, setAllTasks] = useState([]);

    const fetchSessions = async (autoSelect = false) => {
        try {
            const res = await progressAPI.sessions();
            const data = res.data || [];
            setSessions(data);

            if (autoSelect && data.length > 0) {
                setSelectedSessionId(data[0].id);
                localStorage.setItem('planner_selected_session', data[0].id);
            } else if (data.length > 0) {
                const storedId = selectedSessionId || parseInt(localStorage.getItem('planner_selected_session'), 10);
                const exists = data.find(s => s.id === storedId);

                if (!exists) {
                    setSelectedSessionId(data[0].id);
                    localStorage.setItem('planner_selected_session', data[0].id);
                } else if (!selectedSessionId) {
                    setSelectedSessionId(storedId);
                }
            }
        } catch { }
        finally { setFetchingSessions(false); }
    };

    useEffect(() => { fetchSessions(); }, []);

    useEffect(() => {
        if (!selectedSessionId) { setSteps([]); return; }
        setFetchingSteps(true);
        progressAPI.steps(selectedSessionId).then(r => setSteps(r.data || [])).catch(console.error).finally(() => setFetchingSteps(false));
    }, [selectedSessionId]);

    const handleGenerate = async (e) => {
        e.preventDefault();
        if (!topic.trim()) return;
        setLoading(true); setError('');
        try {
            const actualDays = days || 1;
            const durationStr = `${actualDays} day${actualDays !== 1 ? 's' : ''}`;
            const res = await progressAPI.generateRoadmap({ topic: topic.trim(), duration: durationStr, level, start_date: formatDate(startDate) });
            if (res.data.status === 'success') {
                setTopic('');
                await new Promise(r => setTimeout(r, 1200));
                await fetchSessions(true);
            } else {
                setError(res.data.detail || 'Roadmap generation failed. Please try again.');
            }
        } catch (err) {
            setError('Something went wrong. Please try again.');
        } finally { setLoading(false); }
    };

    const handleActivateStep = async (step) => {
        if (loadingStepId) return;
        setLoadingStepId(step.id);
        try {
            const res = await progressAPI.activateStep(step.id);
            const chatSessionId = res.data.chat_session_id;
            const updatedTargetDate = res.data.target_date || step.target_date;
            navigate(chatSessionId ? `/chat/${chatSessionId}` : '/chat', {
                state: {
                    topic: step.title,
                    content: step.content,
                    session_id: selectedSessionId,
                    target_date: updatedTargetDate || null,
                    completed_at: step.completed_at || null
                }
            });
        } catch {
            navigate('/chat', {
                state: {
                    topic: step.title,
                    content: step.content,
                    session_id: selectedSessionId,
                    target_date: step.target_date || null,
                    completed_at: step.completed_at || null
                }
            });
        } finally {
            setLoadingStepId(null);
        }
    };

    const handleToggleStep = async (e, stepId) => {
        e.stopPropagation();
        try {
            const res = await progressAPI.toggleStep(stepId);
            setSteps(prev => prev.map(s => s.id === stepId ? { ...s, is_complete: res.data.is_complete } : s));
            setSessions(prev => prev.map(s => s.id === selectedSessionId ? { ...s, completed_steps: res.data.completed_steps } : s));
            window.dispatchEvent(new CustomEvent('refresh-notifications'));
        } catch (err) { console.error(err); }
    };

    const handleDelete = async (e, sessionId) => {
        e.stopPropagation();
        const result = await swalConfirm({
            title: 'Delete learning plan?',
            text: 'Delete this learning plan?',
            confirmText: 'Yes, delete it!'
        });
        if (!result.isConfirmed) return;
        try {
            await progressAPI.deleteSession(sessionId);
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            if (selectedSessionId === sessionId) {
                setSelectedSessionId(null);
                localStorage.removeItem('planner_selected_session');
            }
        } catch { }
    };

    const handleDownload = async (type) => {
        if (!selectedSessionId) return;
        try {
            const res = await (type === 'pdf' ? exportAPI.pdf(selectedSessionId) : exportAPI.docx(selectedSessionId));
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `Roadmap_${selectedSession?.topic.replace(/ /g, '_')}.${type}`;
            document.body.appendChild(a); a.click(); a.remove();
        } catch { alert(`Failed to download ${type.toUpperCase()}`); }
    };

    const selectedSession = sessions.find(s => s.id === selectedSessionId);

    return (
        <div className="page-content animate-fade-in">
            <header style={{ marginBottom: '28px' }}>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '24px', fontWeight: 800, margin: 0 }}>
                    <Calendar size={28} style={{ color: '#6366f1' }} /> Learning Planner
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '6px 0 0' }}>
                    Generate personalized day-by-day learning roadmaps with holiday support.
                </p>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '20px', alignItems: 'start' }}>
                {/* Left Panel */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Generator Card */}
                    <div className="glass-card" style={{ padding: '28px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Sparkles size={16} style={{ color: '#6366f1' }} /> Generate New Roadmap
                        </h3>
                        <form onSubmit={handleGenerate}>
                            {/* Topic */}
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                                    <BookOpen size={12} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Core Topic
                                </label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                                    {POPULAR.map(t => (
                                        <button key={t} type="button" onClick={() => { setTopic(t); setError(''); }}
                                            style={{ padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', border: `1px solid ${topic === t ? '#6366f1' : 'var(--border-glass)'}`, background: topic === t ? 'rgba(99,102,241,0.12)' : 'transparent', color: topic === t ? '#6366f1' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                                            {t}
                                        </button>
                                    ))}
                                </div>
                                <input className="input" type="text" placeholder="Or type any skill (e.g. Kubernetes, Algorithms)" value={topic}
                                    onChange={e => { setTopic(e.target.value); setError(''); }} style={{ fontSize: '15px' }} required />
                            </div>

                            {/* Controls Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                                        <Target size={11} style={{ verticalAlign: 'middle', marginRight: '5px' }} />Proficiency
                                    </label>
                                    <select className="input" value={level} onChange={e => setLevel(e.target.value)} style={{ fontSize: '13px' }}>
                                        {LEVELS.map(l => <option key={l}>{l}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                                        <Clock size={11} style={{ verticalAlign: 'middle', marginRight: '5px' }} />Duration (days)
                                    </label>
                                    <input className="input" type="number" min="1" max="365" value={days}
                                        onChange={e => setDays(e.target.value === '' ? '' : parseInt(e.target.value, 10))} style={{ fontWeight: 600, fontSize: '15px' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                                        <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: '5px' }} />Start Date
                                    </label>
                                    <DatePicker
                                        selected={startDate}
                                        onChange={(date) => setStartDate(date)}
                                        minDate={new Date()}
                                        filterDate={isSunday}
                                        dayClassName={getDayClassName}
                                        dateFormat="yyyy-MM-dd"
                                        className="input"
                                        placeholderText="Select start date"
                                        portalId="datepicker-portal"
                                        popperProps={{ strategy: 'fixed' }}
                                    />
                                </div>
                            </div>

                            {/* Holidays note */}
                            <div style={{ marginBottom: '20px', padding: '12px 14px', borderRadius: '10px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', fontSize: '12px', color: 'var(--text-muted)' }}>
                                💡 <strong>Holiday support:</strong> Sundays are automatically skipped. The AI will distribute your {days} days of learning across working days from {formatDate(startDate)}.
                            </div>



                            <button type="submit" disabled={loading || !topic.trim()} className="btn btn-primary"
                                style={{ width: '100%', height: '48px', fontSize: '15px', fontWeight: 700, justifyContent: 'center', gap: '8px', opacity: loading || !topic.trim() ? 0.7 : 1 }}>
                                {loading ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Generating Roadmap...</> : <><Sparkles size={16} /> Generate Roadmap</>}
                            </button>
                        </form>
                    </div>

                    {/* Active Plans */}
                    <div className="glass-card" style={{ padding: '22px' }}>
                        <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Layout size={15} style={{ color: '#6366f1' }} /> Your Active Plans
                            <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>{sessions.length} plan{sessions.length !== 1 ? 's' : ''}</span>
                        </h3>
                        {fetchingSessions ? (
                            <div style={{ textAlign: 'center', padding: '24px' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /></div>
                        ) : sessions.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '28px', border: '1px dashed var(--border-glass)', borderRadius: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>
                                No plans yet. Generate one above!
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {sessions.map(s => (
                                    <div key={s.id} onClick={() => {
                                        setSelectedSessionId(s.id);
                                        localStorage.setItem('planner_selected_session', s.id);
                                    }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                                            borderRadius: '12px', cursor: 'pointer',
                                            border: `1px solid ${selectedSessionId === s.id ? 'rgba(99,102,241,0.3)' : 'var(--border-glass)'}`,
                                            background: selectedSessionId === s.id ? 'rgba(99,102,241,0.07)' : 'transparent',
                                            transition: 'all 0.15s'
                                        }}>
                                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <Target size={16} style={{ color: '#6366f1' }} />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic}</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{s.total_steps} chapters • {s.status.replace('_', ' ')}</div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', minWidth: '60px' }}>
                                            <button
                                                onClick={e => handleDelete(e, s.id)}
                                                style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', cursor: 'pointer', padding: '4px 8px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, transition: 'all 0.2s', marginLeft: 'auto' }}
                                                onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
                                                onMouseOut={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'}
                                            >
                                                <Trash2 size={12} /> Delete
                                            </button>
                                            <div style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'var(--border-glass)', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${(s.completed_steps / Math.max(s.total_steps, 1)) * 100}%`, background: '#6366f1' }} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel — Daily Modules */}
                <div style={{ position: 'sticky', top: '24px' }}>
                    {!selectedSession ? (
                        <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
                            <Sparkles size={36} style={{ color: '#6366f1', opacity: 0.5, marginBottom: '12px' }} />
                            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px' }}>Your Roadmap Appears Here</h3>
                            <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                                Generate a roadmap or select an existing plan to see your daily chapters.
                            </p>
                        </div>
                    ) : (
                        <div className="glass-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
                            {/* Session Header */}
                            <div style={{ padding: '20px', borderBottom: '1px solid var(--border-glass)', background: 'rgba(99,102,241,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>{selectedSession.topic}</h3>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>{selectedSession.total_steps} chapters • {selectedSession.status.replace('_', ' ')}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button onClick={() => handleDownload('pdf')} title="Download PDF" style={{ background: 'none', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '5px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                                            <FileText size={13} /> PDF
                                        </button>
                                        <button onClick={() => navigate('/chat')} className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '12px', height: 'auto' }}>
                                            Go to Lessons
                                        </button>
                                    </div>
                                </div>
                                {/* Progress bar */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{ width: `${(selectedSession.completed_steps / Math.max(selectedSession.total_steps, 1)) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', borderRadius: '3px', transition: 'width 0.4s ease' }} />
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#6366f1' }}>
                                        {Math.round((selectedSession.completed_steps / Math.max(selectedSession.total_steps, 1)) * 100)}%
                                    </span>
                                </div>
                            </div>

                            {/* Daily Modules */}
                            <div style={{ overflowY: 'auto', flex: 1, padding: '16px' }}>
                                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>Daily Modules</div>
                                {fetchingSteps ? (
                                    <div style={{ textAlign: 'center', padding: '20px' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /></div>
                                ) : steps.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>No modules found.</div>
                                ) : (() => {
                                    if (!steps || steps.length === 0) return [];
                                    const newSteps = [...steps].sort((a, b) => a.step_number - b.step_number);
                                    
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    let currentIncompleteDate = new Date(today);
                                    
                                    const firstIncomplete = newSteps.find(s => !s.is_complete);
                                    if (firstIncomplete && firstIncomplete.target_date) {
                                        const parts = firstIncomplete.target_date.split('-');
                                        const d = new Date(parts[0], parts[1] - 1, parts[2]);
                                        if (d > currentIncompleteDate) {
                                            currentIncompleteDate = d;
                                        }
                                    }
                                    while (currentIncompleteDate.getDay() === 0) currentIncompleteDate.setDate(currentIncompleteDate.getDate() + 1);

                                    return newSteps.map((step) => {
                                        if (step.is_complete) return step;
                                        
                                        const yyyy = currentIncompleteDate.getFullYear();
                                        const mm = String(currentIncompleteDate.getMonth() + 1).padStart(2, '0');
                                        const dd = String(currentIncompleteDate.getDate()).padStart(2, '0');
                                        const assignedDate = `${yyyy}-${mm}-${dd}`;
                                        
                                        currentIncompleteDate.setDate(currentIncompleteDate.getDate() + 1);
                                        while (currentIncompleteDate.getDay() === 0) currentIncompleteDate.setDate(currentIncompleteDate.getDate() + 1);
                                        
                                        return { ...step, target_date: assignedDate };
                                    });
                                })().map((step, index) => {
                                    const prevStep = steps[index - 1];
                                    const isUnlocked = index === 0 || (
                                        prevStep?.is_complete &&
                                        (prevStep.total_tasks === 0 || prevStep.completed_tasks >= prevStep.total_tasks)
                                    );
                                    const isLocked = !isUnlocked;
                                    const isNext = !step.is_complete && isUnlocked && steps.slice(0, index).every(s => s.is_complete);
                                    return (
                                        <div key={step.id} style={{ position: 'relative', paddingLeft: '24px', marginBottom: '10px' }}>
                                            {index !== steps.length - 1 && <div style={{ position: 'absolute', left: '7px', top: '22px', bottom: '-10px', width: '2px', background: step.is_complete ? 'rgba(99,102,241,0.3)' : 'var(--border-glass)' }} />}
                                            <button onClick={e => isUnlocked && handleToggleStep(e, step.id)} disabled={!isUnlocked} style={{ position: 'absolute', left: 0, top: '5px', width: '16px', height: '16px', borderRadius: '50%', background: step.is_complete ? '#6366f1' : 'var(--bg-secondary)', border: `2px solid ${step.is_complete ? '#6366f1' : !isUnlocked ? 'var(--border-glass)' : 'var(--border-glass)'}`, cursor: !isUnlocked ? 'not-allowed' : 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: !isUnlocked ? 0.4 : 1 }}>
                                                {step.is_complete && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white' }} />}
                                            </button>
                                            <div key={step.id}
                                                onClick={() => isUnlocked && handleActivateStep(step)}
                                                title={!isUnlocked ? 'Complete the previous module and its tasks first' : ''}
                                                style={{
                                                    padding: '12px', borderRadius: '12px', cursor: !isUnlocked ? 'not-allowed' : loadingStepId === step.id ? 'wait' : 'pointer',
                                                    border: `1px solid ${!isUnlocked ? 'var(--border-glass)' : !step.is_complete && isUnlocked && steps.slice(0, index).every(s => s.is_complete) ? 'rgba(99,102,241,0.4)' : 'var(--border-glass)'}`,
                                                    background: !isUnlocked ? 'rgba(128,128,128,0.04)' : !step.is_complete && isUnlocked && steps.slice(0, index).every(s => s.is_complete) ? 'rgba(99,102,241,0.06)' : step.is_complete ? 'rgba(16,185,129,0.04)' : 'transparent',
                                                    transition: 'all 0.15s',
                                                    opacity: !isUnlocked ? 0.5 : loadingStepId && loadingStepId !== step.id ? 0.6 : 1
                                                }}
                                                onMouseOver={e => { if (!isLocked && !step.is_complete && !loadingStepId) e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; }}
                                                onMouseOut={e => { if (!isLocked && !loadingStepId) e.currentTarget.style.background = isNext ? 'rgba(99,102,241,0.06)' : step.is_complete ? 'rgba(16,185,129,0.04)' : 'transparent'; }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: '13px', fontWeight: isNext && !isUnlocked ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: step.is_complete ? 'line-through' : 'none', color: isUnlocked ? 'var(--text-muted)' : step.is_complete ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                                                            {step.title}
                                                        </div>
                                                        {step.target_date && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>📅 {step.target_date}</div>}
                                                    </div>
                                                    {isLocked && <Lock size={14} style={{ color: 'var(--text-muted)', opacity: 0.6, flexShrink: 0 }} />}
                                                    {!isLocked && isNext && <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#6366f1', whiteSpace: 'nowrap', flexShrink: 0 }}>Next up</span>}
                                                    {loadingStepId === step.id ? <Loader2 size={14} className="animate-spin" style={{ color: '#6366f1', flexShrink: 0 }} /> : step.is_complete ? <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0 }} /> : null}
                                                </div>
                                                {step.content && <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.content.substring(0, 80)}...</p>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {/* Modal for Error */}
            {error && (
                <div className="modal-overlay" onClick={() => setError('')} style={{ zIndex: 10000 }}>
                    <div className="modal-box" onClick={e => e.stopPropagation()} style={{ padding: '24px', textAlign: 'center', maxWidth: '400px' }}>
                        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: '24px' }}>⚠️</span>
                            </div>
                        </div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '12px' }}>Generation Incomplete</h3>
                        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '24px' }}>
                            {error}
                        </p>
                        <button className="btn btn-primary" onClick={() => setError('')} style={{ width: '100%', justifyContent: 'center' }}>
                            Understood
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
