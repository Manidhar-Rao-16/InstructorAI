import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { swalConfirm } from '../utils/swalTheme';
import { CheckCircle, FileText, Send, Loader2, Star, ChevronRight, BookOpen, History, Trash2, Upload, X, Clock, Folder } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { assignmentAPI, notifAPI, chatAPI } from '../services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Tasks() {
    const location = useLocation();
    const navigate = useNavigate();
    const autoSelect = location.state?.autoSelect;

    const [tasks, setTasks] = useState([]);
    const [localSessions, setLocalSessions] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState('pending');
    const [textContent, setTextContent] = useState('');
    const [files, setFiles] = useState([]);
    const [submitSuccess, setSubmitSuccess] = useState('');
    const [expandedGroups, setExpandedGroups] = useState({});

    const toggleGroup = (groupTitle) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupTitle]: prev[groupTitle] === false ? true : false
        }));
    };

    const [leftWidth, setLeftWidth] = useState(300);
    const [isResizing, setIsResizing] = useState(false);

    const startResizing = (e) => {
        setIsResizing(true);
        e.preventDefault();
    };

    const stopResizing = () => {
        setIsResizing(false);
    };

    const resize = (e) => {
        if (isResizing) {
            const newWidth = e.clientX - 100;
            if (newWidth > 200 && newWidth < 600) {
                setLeftWidth(newWidth);
            }
        }
    };

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        } else {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing]);

    const fetchTasks = async (forceLatest = false) => {
        setLoading(true);
        try {
            const [rTasks, rSessions] = await Promise.all([
                assignmentAPI.list(),
                chatAPI.sessions()
            ]);
            const all = rTasks.data || [];
            setLocalSessions(rSessions.data || []);
            setTasks(all);
            const pending = all.filter(a => a.status === 'pending');

            if (forceLatest && pending.length > 0) {
                const latest = [...pending].sort((a, b) => b.id - a.id)[0];
                setSelectedTask(latest);
                setActiveTab('pending');
            } else if (selectedTask) {
                // Check if the currently selected task has been evaluated/submitted
                const refreshed = all.find(t => t.id === selectedTask.id);
                if (refreshed && refreshed.status !== 'pending' && activeTab === 'pending') {
                    // Task was just evaluated — auto-advance to next pending task
                    if (pending.length > 0) {
                        setSelectedTask(pending[0]);
                    } else {
                        setSelectedTask(null);
                    }
                } else if (refreshed) {
                    // Update the selected task with fresh data
                    setSelectedTask(refreshed);
                }
            } else if (pending.length > 0) {
                setSelectedTask(pending[0]);
            } else if (all.length > 0) {
                setSelectedTask(all[0]);
            }
        } finally { setLoading(false); }
    };

    useEffect(() => { fetchTasks(autoSelect === 'latest'); }, []);

    // Reset files and text submission state when the selected task changes
    useEffect(() => {
        setFiles([]);
        setTextContent('');
        setSubmitSuccess('');
    }, [selectedTask?.id]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: (acceptedFiles) => setFiles(prev => [...prev, ...acceptedFiles]),
        multiple: true,
        accept: {
            'application/pdf': ['.pdf'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'text/plain': ['.txt', '.md', '.py', '.c', '.cpp', '.java', '.js', '.ts']
        }
    });

    const handleTextSubmit = async () => {
        if (!selectedTask || !textContent.trim()) return;
        setSubmitting(true);
        try {
            await assignmentAPI.submitText({
                assignment_id: selectedTask.id,
                title: selectedTask.title,
                description: selectedTask.description,
                content: textContent,
                session_id: selectedTask.session_id,
            });
            setTextContent('');
            setSubmitSuccess('Your solution has been submitted and is being evaluated!');
            setTimeout(() => setSubmitSuccess(''), 4000);
            await fetchTasks();
        } catch (err) { console.error(err); }
        finally { setSubmitting(false); }
    };

    const handleFileSubmit = async () => {
        if (!selectedTask || files.length === 0) return;
        setSubmitting(true);
        const form = new FormData();
        files.forEach(f => form.append('files', f));
        form.append('title', selectedTask.title);
        if (selectedTask.session_id) {
            form.append('session_id', selectedTask.session_id);
        }
        if (selectedTask.id) {
            form.append('assignment_id', selectedTask.id);
        }
        try {
            await assignmentAPI.submitFile(form);
            setFiles([]);
            setTextContent('');
            setSubmitSuccess('File submitted! Evaluating your solution...');
            setTimeout(() => setSubmitSuccess(''), 4000);
            await fetchTasks();
        } catch (err) { console.error(err); }
        finally { setSubmitting(false); }
    };

    const handleDelete = async (id) => {
        const result = await swalConfirm({
            title: 'Delete this task?',
            text: 'This action cannot be undone.',
            confirmText: 'Yes, delete it!'
        });
        if (!result.isConfirmed) return;
        await assignmentAPI.delete(id);
        if (selectedTask?.id === id) setSelectedTask(null);
        await fetchTasks();
    };

    const handleDeleteTopic = async (topicTitle, modulesObj) => {
        const result = await swalConfirm({
            title: `Delete all tasks in ${topicTitle}?`,
            text: 'This action cannot be undone and will remove all tasks inside this topic.',
            confirmText: 'Yes, delete all!'
        });
        if (!result.isConfirmed) return;

        // Disable UI while deleting
        setLoading(true);
        try {
            for (const modTasks of Object.values(modulesObj)) {
                for (const t of modTasks) {
                    await assignmentAPI.delete(t.id).catch(console.error);
                }
            }
            setSelectedTask(null);
            await fetchTasks();
        } finally {
            setLoading(false);
        }
    };

    const pendingTasks = tasks.filter(a => a.status === 'pending');
    const gradedTasks = tasks.filter(a => a.status === 'evaluated' || a.status === 'submitted');
    const displayedTasks = activeTab === 'pending' ? pendingTasks : gradedTasks;

    const groupedTasks = displayedTasks.reduce((acc, task) => {
        const topicTitle = task.topic_title || 'General Tasks';

        // Extract module from title (e.g. "Task 1: ... - Module Name")
        let moduleName = 'General';
        if (task.title.includes(' - ')) {
            moduleName = task.title.split(' - ').pop();
        } else if (task.title.includes(': ')) {
            moduleName = task.title.split(': ').pop();
        }

        if (!acc[topicTitle]) acc[topicTitle] = {};
        if (!acc[topicTitle][moduleName]) acc[topicTitle][moduleName] = [];
        acc[topicTitle][moduleName].push(task);
        return acc;
    }, {});

    const sortedTopics = Object.keys(groupedTasks).sort((a, b) => {
        if (a === 'General Tasks') return 1;
        if (b === 'General Tasks') return -1;
        return a.localeCompare(b);
    });

    const scoreColor = (score) => {
        if (!score) return 'var(--text-muted)';
        if (score >= 80) return '#10b981';
        if (score >= 60) return '#f59e0b';
        return '#ef4444';
    };

    return (
        <div className="page-content animate-fade-in">
            <header style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <FileText size={26} style={{ color: '#6366f1' }} /> Tasks
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '6px 0 0' }}>
                    {pendingTasks.length} pending · {gradedTasks.length} graded
                </p>
            </header>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', minHeight: 'calc(100vh - 160px)' }}>
                {/* Task List Panel */}
                <div className="glass-card" style={{ padding: 0, overflow: 'hidden', borderRadius: '16px', flexShrink: 0, width: leftWidth, display: 'flex', flexDirection: 'column' }}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-glass)' }}>
                        {[['pending', 'Pending', pendingTasks.length], ['graded', 'Graded', gradedTasks.length]].map(([t, label, count]) => (
                            <button key={t} onClick={() => setActiveTab(t)}
                                style={{ flex: 1, padding: '12px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '13px', borderBottom: `2px solid ${activeTab === t ? '#6366f1' : 'transparent'}`, color: activeTab === t ? '#6366f1' : 'var(--text-muted)', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                {label}
                                <span style={{ padding: '1px 7px', borderRadius: '8px', background: activeTab === t ? 'rgba(99,102,241,0.15)' : 'var(--border-glass)', fontSize: '11px', fontWeight: 700 }}>{count}</span>
                            </button>
                        ))}
                    </div>

                    {/* Task Items */}
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        {loading ? (
                            <div style={{ padding: '32px', textAlign: 'center' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /></div>
                        ) : displayedTasks.length === 0 ? (
                            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                                {activeTab === 'pending' ? (
                                    <>
                                        <CheckCircle size={28} style={{ color: '#10b981', marginBottom: '8px' }} />
                                        <p style={{ margin: 0 }}>No pending tasks! 🎉</p>
                                        <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Complete a chapter to get assignments.</p>
                                    </>
                                ) : (
                                    <>
                                        <History size={28} style={{ opacity: 0.3, marginBottom: '8px' }} />
                                        <p style={{ margin: 0 }}>No graded tasks yet.</p>
                                    </>
                                )}
                            </div>
                        ) : sortedTopics.map(topicTitle => {
                            const isExpanded = expandedGroups[topicTitle] !== false;
                            const modules = groupedTasks[topicTitle];
                            const sortedModules = Object.keys(modules).sort();

                            return (
                                <div key={topicTitle} style={{ marginBottom: '8px' }}>
                                    {/* Topic Folder Header */}
                                    <div onClick={() => toggleGroup(topicTitle)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                            padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                                            background: 'transparent',
                                            transition: 'all 0.15s',
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.04)'}
                                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <ChevronRight size={14} style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0, color: 'var(--text-muted)' }} />
                                        <Folder size={14} style={{ fill: 'transparent', color: '#6366f1', flexShrink: 0, opacity: 0.8 }} />
                                        <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                                            {topicTitle}
                                        </span>
                                        <button
                                            onClick={e => { e.stopPropagation(); handleDeleteTopic(topicTitle, modules); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-muted)' }}
                                            onMouseOver={e => e.currentTarget.style.color = '#ef4444'}
                                            onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}
                                            title="Delete all tasks in this topic"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    {/* Topic Contents (Modules) */}
                                    {isExpanded && (
                                        <div style={{ marginLeft: '12px', borderLeft: '1.5px solid rgba(99,102,241,0.1)', paddingLeft: '4px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {sortedModules.map(moduleName => (
                                                <div key={moduleName}>
                                                    {/* Module Sub-header */}
                                                    {moduleName !== 'General' && (
                                                        <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '4px 8px', letterSpacing: '0.05em', opacity: 0.8 }}>
                                                            {moduleName}
                                                        </div>
                                                    )}

                                                    {/* Tasks in Module */}
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                                        {modules[moduleName].map(task => {
                                                            // Clean up task title to show only the specific task part
                                                            const cleanTitle = task.title.split(' - ')[0].replace(/^Task \d+:\s*/i, '');
                                                            const displayTitle = moduleName !== 'General' ? `${cleanTitle} --${moduleName}` : cleanTitle;

                                                            return (
                                                                <div key={task.id} onClick={() => setSelectedTask(task)}
                                                                    style={{
                                                                        padding: '8px 10px', cursor: 'pointer', borderRadius: '8px',
                                                                        background: selectedTask?.id === task.id ? 'rgba(99,102,241,0.06)' : 'transparent',
                                                                        borderLeft: `3px solid ${selectedTask?.id === task.id ? '#6366f1' : 'transparent'}`,
                                                                        transition: 'all 0.15s',
                                                                        marginBottom: '1px'
                                                                    }}
                                                                    onMouseOver={e => { if (selectedTask?.id !== task.id) e.currentTarget.style.background = 'rgba(99,102,241,0.03)'; }}
                                                                    onMouseOut={e => { if (selectedTask?.id !== task.id) e.currentTarget.style.background = 'transparent'; }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                                            <div style={{ fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                                                                                {displayTitle}
                                                                            </div>
                                                                            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                <Clock size={9} /> {new Date(task.submitted_at).toLocaleDateString()}
                                                                            </div>
                                                                        </div>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                                                            {task.score !== null && task.score !== undefined && (
                                                                                <span style={{ fontSize: '11px', fontWeight: 700, color: scoreColor(task.score) }}>{task.score}</span>
                                                                            )}
                                                                            <button
                                                                                onClick={e => { e.stopPropagation(); handleDelete(task.id); }}
                                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }}
                                                                                onMouseOver={e => e.currentTarget.style.color = '#ef4444'}
                                                                                onMouseOut={e => e.currentTarget.style.color = 'var(--text-muted)'}
                                                                                title="Delete task"
                                                                            >
                                                                                <Trash2 size={13} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* Resizer */}
                <div
                    onMouseDown={startResizing}
                    style={{
                        width: '10px',
                        cursor: 'col-resize',
                        background: 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        zIndex: 10
                    }}
                >
                    <div style={{
                        width: '3px',
                        height: '32px',
                        borderRadius: '2px',
                        background: isResizing ? '#6366f1' : 'var(--border-glass)',
                        transition: 'background 0.2s',
                    }} />
                </div>

                {/* Task Detail Panel */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    {!selectedTask ? (
                        <div className="glass-card" style={{ padding: '60px', textAlign: 'center' }}>
                            <BookOpen size={40} style={{ opacity: 0.3, marginBottom: '16px' }} />
                            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Select a Task</h3>
                            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Click a task on the left to view details and submit your solution.</p>
                        </div>
                    ) : (
                        <div className="glass-card" style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
                            {/* Task Header */}
                            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--border-glass)' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '10px' }}>
                                    <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>
                                        {(() => {
                                            let modName = 'General';
                                            if (selectedTask.title.includes(' - ')) {
                                                modName = selectedTask.title.split(' - ').pop();
                                            } else if (selectedTask.title.includes(': ')) {
                                                modName = selectedTask.title.split(': ').pop();
                                            }
                                            const cleanTaskTitle = selectedTask.title.split(' - ')[0].replace(/^Task \d+:\s*/i, '');
                                            return modName !== 'General' ? `${cleanTaskTitle} --${modName}` : cleanTaskTitle;
                                        })()}
                                    </h2>
                                    <span style={{ padding: '4px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 700, background: selectedTask.status === 'evaluated' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)', color: selectedTask.status === 'evaluated' ? '#10b981' : '#f59e0b', flexShrink: 0 }}>
                                        {selectedTask.status}
                                    </span>
                                </div>
                                {selectedTask.description && (
                                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{selectedTask.description}</p>
                                )}
                            </div>

                            {/* Score & Feedback */}
                            {selectedTask.score !== null && selectedTask.score !== undefined && (
                                <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '14px', background: `${scoreColor(selectedTask.score)}10`, border: `1px solid ${scoreColor(selectedTask.score)}30` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: selectedTask.feedback ? '12px' : 0 }}>
                                        <div style={{ width: '52px', height: '52px', borderRadius: '12px', background: `${scoreColor(selectedTask.score)}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <span style={{ fontSize: '20px', fontWeight: 800, color: scoreColor(selectedTask.score) }}>{selectedTask.score}</span>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '14px', fontWeight: 700 }}>Score: {selectedTask.score}/100</div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                {selectedTask.score >= 80 ? '🌟 Excellent work!' : selectedTask.score >= 60 ? '👍 Good job, keep it up!' : '💪 Room to improve — review the feedback'}
                                            </div>
                                        </div>
                                    </div>
                                    {selectedTask.feedback && (
                                        <div className="markdown-body" style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, background: 'var(--bg-glass)', padding: '16px', borderRadius: '12px', overflow: 'hidden' }}>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedTask.feedback}</ReactMarkdown>
                                        </div>
                                    )}
                                    {selectedTask.improvements && (
                                        <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(99,102,241,0.08)', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                            <strong style={{ color: '#6366f1' }}>💡 Pro tip:</strong> {selectedTask.improvements}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Submit Section — only for pending */}
                            {selectedTask.status === 'pending' && (
                                <div>
                                    {selectedTask.feedback && (
                                        <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                                                ⚠️ Revision Required {(selectedTask.score !== null && selectedTask.score !== undefined) ? `(Score: ${selectedTask.score}/100)` : ''}
                                            </div>
                                            <div className="markdown-body" style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedTask.feedback}</ReactMarkdown>
                                            </div>
                                            {selectedTask.improvements && (
                                                <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                                                    <strong>💡 Suggestion:</strong> {selectedTask.improvements}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px' }}>Submit Your Solution</h4>

                                    {/* Text answer */}
                                    <textarea
                                        className="input"
                                        placeholder="Write your solution, explanation, or code here..."
                                        value={textContent}
                                        onChange={e => setTextContent(e.target.value)}
                                        rows={6}
                                        style={{ resize: 'vertical', marginBottom: '12px', fontFamily: 'var(--font-mono, monospace)', fontSize: '13px', lineHeight: 1.6 }}
                                    />

                                    {/* File drop */}
                                    <div {...getRootProps()} style={{
                                        padding: '16px', borderRadius: '12px', border: `2px dashed ${isDragActive ? '#6366f1' : 'var(--border-glass)'}`,
                                        background: isDragActive ? 'rgba(99,102,241,0.05)' : 'transparent', cursor: 'pointer', textAlign: 'center',
                                        marginBottom: '14px', transition: 'all 0.15s'
                                    }}>
                                        <input {...getInputProps()} />
                                        {files.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                                                {files.map((f, idx) => (
                                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                                        <FileText size={16} style={{ color: '#6366f1' }} />
                                                        <span style={{ fontWeight: 600 }}>{f.name}</span>
                                                        <button onClick={e => {
                                                            e.stopPropagation();
                                                            setFiles(files.filter((_, i) => i !== idx));
                                                        }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex' }}>
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>Click or drop to add more files</div>
                                            </div>
                                        ) : (
                                            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                                                <Upload size={18} style={{ marginBottom: '4px', opacity: 0.5 }} /><br />
                                                Drop files or click to upload
                                            </div>
                                        )}
                                    </div>

                                    {submitSuccess && (
                                        <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', fontSize: '13px', fontWeight: 600 }}>
                                            ✅ {submitSuccess}
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            onClick={files.length > 0 ? handleFileSubmit : handleTextSubmit}
                                            disabled={(files.length === 0 && !textContent.trim()) || submitting}
                                            className="btn btn-primary"
                                            style={{ flex: 1, height: '44px', fontSize: '14px', gap: '8px', justifyContent: 'center', opacity: (files.length === 0 && !textContent.trim()) || submitting ? 0.6 : 1 }}>
                                            {submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : (files.length > 0 ? <><Upload size={15} /> Submit {files.length} File{files.length > 1 ? 's' : ''} & Evaluate</> : <><Send size={15} /> Submit Answer</>)}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
