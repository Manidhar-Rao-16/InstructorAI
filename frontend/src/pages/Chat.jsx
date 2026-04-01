import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { swalConfirm } from '../utils/swalTheme';
import { Send, Loader2, Sparkles, BookOpen, FileText, AlignLeft, Code2, HelpCircle, X, MessageCircle, Plus, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import mermaid from 'mermaid';

// Initialize mermaid with robust settings for version 11
mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
        primaryColor: '#fef2f2',
        primaryTextColor: '#7f1d1d',
        primaryBorderColor: '#ef4444',
        lineColor: '#f97316',
        secondaryColor: '#ffffff',
        tertiaryColor: '#fff2f2'
    },
    securityLevel: 'loose',
    fontFamily: 'Inter, system-ui, sans-serif',
    suppressErrorHelper: true
});

/* ── Mermaid diagram renderer ─────────────────────────────────────── */
const Mermaid = ({ chart }) => {
    const ref = useRef(null);
    const [renderError, setRenderError] = useState(false);

    useEffect(() => {
        if (!ref.current || !chart || typeof chart !== 'string') return;

        const renderDiagram = async () => {
            setRenderError(false);
            const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

            try {
                // Pre-clean: Mermaid 11 is sensitive to HTML entities or extra whitespace
                const cleaned = chart
                    .trim()
                    .replace(/&quot;/g, '"')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&');

                // Clear previous and show loading
                ref.current.innerHTML = '<div style="opacity:0.4; font-size:11px; padding:20px;">Rendering diagram...</div>';

                // In Mermaid 11, parse is async
                await mermaid.parse(cleaned);
                const { svg } = await mermaid.render(id, cleaned);

                if (ref.current) {
                    ref.current.innerHTML = svg;
                }
            } catch (err) {
                console.warn("Mermaid component render error:", err);
                setRenderError(true);
                if (ref.current) {
                    ref.current.innerHTML = ''; // Clear the "Syntax error" stuff if it injected its own
                }
            }
        };

        renderDiagram();
    }, [chart]);

    if (renderError) {
        return (
            <div style={{ margin: '16px auto', maxWidth: '100%', borderRadius: '12px', border: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.02)', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>
                    <BookOpen size={14} /> Workflow Data Representation
                </div>
                <pre style={{ margin: 0, padding: 0, background: 'transparent', border: 'none', textAlign: 'left', fontSize: '11px', opacity: 0.8, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>
                    {chart}
                </pre>
            </div>
        );
    }

    return <div ref={ref} className="mermaid-container" style={{ margin: '20px 0', overflowX: 'auto', display: 'flex', justifyContent: 'center' }} />;
};

/* ── Strip leaked tool-call markup from AI replies ─────────────────── */
const sanitizeReply = (text) => {
    if (!text) return text;
    // Remove <function=toolName>{...}</function> blocks (closed or unclosed)
    return text
        .replace(/<function=\w+>[\s\S]*?<\/function>/g, '')
        .replace(/<function=\w+>[\s\S]*/g, '')
        .trim();
};

/* ── Markdown renderer shared by both roles ───────────────────────── */
const MarkdownContent = memo(({ content, isUser, isCollapsed, onToggle }) => {
    const shouldTruncate = !isUser && content.length > 500;
    const displayContent = shouldTruncate && isCollapsed ? content.slice(0, 450) + '...' : content;

    return (
        <div style={{ position: 'relative' }}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ node, href, ...props }) => {
                        let validHref = href || '#';
                        if (validHref && !validHref.startsWith('http') && !validHref.startsWith('mailto:') && !validHref.startsWith('/')) {
                            validHref = 'https://' + validHref;
                        }
                        return (
                            <a {...props} href={validHref} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: isUser ? '#fff' : 'var(--accent-primary)', textDecoration: 'underline' }} />
                        );
                    },
                    strong: ({ node, ...props }) => (
                        <strong {...props} style={{ color: isUser ? '#fff' : 'var(--accent-primary)' }} />
                    ),
                    code: ({ node, inline, className, children, ...props }) => {
                        const lang = /language-(\w+)/.exec(className || '')?.[1];

                        if (!inline && lang === 'mermaid') {
                            if (!isUser) {
                                return <Mermaid chart={String(children).replace(/\n$/, '')} />;
                            } else {
                                return (
                                    <pre style={{ background: 'rgba(0,0,0,0.1)', padding: '12px', borderRadius: '8px', overflowX: 'auto' }}>
                                        <code {...props} className={className} style={{ color: '#fff', fontSize: '0.9em' }}>
                                            {children}
                                        </code>
                                    </pre>
                                );
                            }
                        }
                        return (
                            <code {...props} className={className}
                                style={{ background: isUser ? 'rgba(0,0,0,0.2)' : 'rgba(99,102,241,0.06)', color: isUser ? '#fff' : 'var(--accent-primary)', padding: '2px 5px', borderRadius: '4px', fontSize: '0.88em' }}>
                                {children}
                            </code>
                        );
                    }
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
});

/* ── Main Chat component ─────────────────────────────────────────── */
export default function Chat() {
    const formatTopicLabel = useCallback((topic, content = '') => {
        if (!topic) return '';

        let label = topic;
        const lower = topic.toLowerCase();
        if (lower.includes('step') || lower.includes('day') || lower.includes('chapter')) {
            const lines = content.split('\n');
            const firstPart = lines.find(l => l.trim() && !l.includes('Estimate:'))?.split('.')[0];
            if (firstPart && firstPart.length < 60) {
                label = `${topic}: ${firstPart.replace(/[#*]/g, '').trim()}`;
            }
        }
        return label;
    }, []);

    const { user } = useAuth();
    const { 
        sessionId 
    } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    // Custom context
    const { 
        sessions, 
        messagesByContext, 
        addMessage,
        updateMessage,
        fetchHistory, 
        historyLoading, 
        fetchSessions,
        lastSessionId,
        setLastSessionId,
        generatingTopic,
        setGeneratingTopic,
        deleteSessionMessages,
        clearSessionMessages
    } = useChat();

    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [expandedMessages, setExpandedMessages] = useState({}); // Tracking which AI messages are unfolded
    const [selection, setSelection] = useState({ text: '', x: 0, y: 0, show: false });

    // New state for right-pane content
    const [currentTopic, setCurrentTopic] = useState('');
    const [currentTopicLabel, setCurrentTopicLabel] = useState('');
    const [currentContent, setCurrentContent] = useState('');
    const [moduleSourceContent, setModuleSourceContent] = useState('');
    const [moduleCompletedAt, setModuleCompletedAt] = useState(null);
    const [moduleTargetDate, setModuleTargetDate] = useState(null);
    const [topicHistoryLoaded, setTopicHistoryLoaded] = useState(null); // Tracks which topic's history loading finished

    // Each message can have an optional `displayContent` for the bubble text
    const contextKey = `${sessionId}_${currentTopic || ''}`;
    const messages = messagesByContext[contextKey] || [];


    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Get the current session to display its title in the chat header
    const currentSession = sessions.find(s => String(s.id) === String(sessionId));
    const sessionTitle = currentSession?.title;
    const learningSessionId = location.state?.session_id || currentSession?.learning_session_id || null;

    // Resize state
    const [chatWidth, setChatWidth] = useState(400); 
    const [isResizing, setIsResizing] = useState(false);

    const scrollAreaRef = useRef(null);
    const bottomRef = useRef(null);           // sentinel at very bottom
    const lastUserMsgRef = useRef(null);      // ref on the latest user message row
    const inputRef = useRef(null);            // ref for input field
    const initialTriggered = useRef(null);
    const dataLoaded = useRef(false);
    const wasLoading = useRef(false); // To track transition from loading to idle

    /* ── Resizing Logic ─────────────────────────────────────────── */
    const startResizing = useCallback((e) => {
        setIsResizing(true);
        e.preventDefault();
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((e) => {
        if (isResizing) {
            // Calculate width based on mouse position from the right edge
            const newWidth = document.body.clientWidth - e.clientX;
            if (newWidth >= 300 && newWidth <= 800) {
                setChatWidth(newWidth);
            }
        }
    }, [isResizing]);

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
    }, [isResizing, resize, stopResizing]);

    /* ── Scroll helpers ─────────────────────────────────────────── */
    // After user sends → anchor the user bubble at the top of the viewport
    const scrollToLastUserMsg = useCallback(() => {
        if (lastUserMsgRef.current) {
            lastUserMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    // After AI responds / loading → reveal bottom of response
    const scrollToBottom = useCallback(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, []);

    /* ── Session / history loading ──────────────────────────────── */
    const initializing = useRef(false);
    const redirectionInProgress = useRef(false);

    useEffect(() => {
        const loadData = async () => {
            if (initializing.current) return;
            initializing.current = true;

            try {
                if (!sessionId) {
                    const res = await fetchSessions(false); 
                    const availableSessions = res || sessions;
                    let targetId = lastSessionId;

                    if (targetId && !availableSessions.find(s => String(s.id) === String(targetId))) {
                        targetId = null;
                    }

                    if (targetId) {
                        navigate(`/chat/${targetId}`, { replace: true, state: location.state });
                    } else if (availableSessions.length > 0) {
                        navigate(`/chat/${availableSessions[0].id}`, { replace: true, state: location.state });
                    } else {
                        const sess = await chatAPI.createSession();
                        await fetchSessions(true);
                        navigate(`/chat/${sess.data.id}`, { replace: true, state: location.state });
                    }
                    initializing.current = false;
                    return;
                }

                if (sessionId !== lastSessionId) {
                    setLastSessionId(sessionId);
                    // Ensure new sessions created via Planner modules populate in Recent Chats
                    if (sessions.length > 0 && !sessions.find(s => String(s.id) === String(sessionId))) {
                        await fetchSessions(true);
                    }
                }

                await fetchHistory(sessionId);
            } catch (err) {
                console.error('Chat init error:', err);
            } finally {
                initializing.current = false;
            }
        };

        loadData();
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;
        
        if (location.state?.clearModule) {
            // Explicit navigation to clear the module view
            setCurrentTopic('');
            setCurrentTopicLabel('');
            setCurrentContent('');
            setModuleSourceContent('');
            setModuleCompletedAt(null);
            setModuleTargetDate(null);
            
            // Clear from local storage
            localStorage.removeItem(`topic_${sessionId}`);
            localStorage.removeItem(`module_content_${sessionId}`);
            localStorage.removeItem(`reader_content_${sessionId}`);
            localStorage.removeItem(`completed_${sessionId}`);
            localStorage.removeItem(`target_${sessionId}`);
        } else if (location.state?.topic) {
            const rawTopic = location.state.topic;
            const content = location.state.content || '';

            setCurrentTopic(rawTopic);
            setCurrentTopicLabel(formatTopicLabel(rawTopic, content));
            setCurrentContent(content);
            setModuleSourceContent(content);
            const compAt = location.state.completed_at || null;
            const targAt = location.state.target_date || null;
            setModuleCompletedAt(compAt);
            setModuleTargetDate(targAt);
            
            // Persist to local storage for quick access later
            localStorage.setItem(`topic_${sessionId}`, rawTopic);
            localStorage.setItem(`module_content_${sessionId}`, content);
            localStorage.setItem(`reader_content_${sessionId}`, content);
            if (compAt) localStorage.setItem(`completed_${sessionId}`, compAt);
            else localStorage.removeItem(`completed_${sessionId}`);
            if (targAt) localStorage.setItem(`target_${sessionId}`, targAt);
            else localStorage.removeItem(`target_${sessionId}`);
            
        } else {
            // No location state, try to restore from local storage
            const savedTopic = localStorage.getItem(`topic_${sessionId}`);
            if (savedTopic) {
                const savedModuleContent = localStorage.getItem(`module_content_${sessionId}`) || '';
                const savedReaderContent = localStorage.getItem(`reader_content_${sessionId}`) || savedModuleContent;
                setCurrentTopic(savedTopic);
                setCurrentTopicLabel(formatTopicLabel(savedTopic, savedModuleContent));
                setCurrentContent(savedReaderContent);
                setModuleSourceContent(savedModuleContent);
                setModuleCompletedAt(localStorage.getItem(`completed_${sessionId}`) || null);
                setModuleTargetDate(localStorage.getItem(`target_${sessionId}`) || null);
            } else {
                setCurrentTopic('');
                setCurrentTopicLabel('');
                setCurrentContent('');
                setModuleSourceContent('');
                setModuleCompletedAt(null);
                setModuleTargetDate(null);
            }
        }
    }, [sessionId, location.key, formatTopicLabel, location.state]);

    useEffect(() => {
        if (!sessionId) return;
        if (currentContent) {
            localStorage.setItem(`reader_content_${sessionId}`, currentContent);
        }
    }, [sessionId, currentContent]);

    // NEW: Re-fetch history whenever the topic changes within the same session
    // GUARD: Skip re-fetch if we're actively streaming (loading=true) — the stream
    // handler is managing optimistic messages in-place and a re-fetch would wipe them.
    useEffect(() => {
        if (sessionId && !loading) {
            setTopicHistoryLoaded(null); // Clear while fetching
            fetchHistory(sessionId, currentTopic).then(() => {
                setTopicHistoryLoaded(currentTopic);
            });
        }
    }, [sessionId, currentTopic, fetchHistory]);

    /* ── Dismiss selection menu on click-away ───────────────────── */
    useEffect(() => {
        const hide = () => setSelection(p => ({ ...p, show: false }));
        window.addEventListener('mousedown', hide);
        return () => window.removeEventListener('mousedown', hide);
    }, []);

    /* ── Auto-navigate to tasks after lesson complete ───────────── */
    useEffect(() => {
        // Only redirect if we were JUST loading an AI response and it finished
        if (wasLoading.current && !loading) {
            const last = messages[messages.length - 1];
            if (last?.role === 'assistant' && (last.content?.includes('Tasks section') || last.content?.includes('task is now ready'))) {
                const t = setTimeout(() => navigate('/tasks', { state: { autoSelect: 'latest' } }), 2500);
                return () => clearTimeout(t);
            }
        }
        wasLoading.current = loading;
    }, [messages, navigate, loading]);

    /* ── Scroll after messages change ───────────────────────────── */
    useEffect(() => {
        if (messages.length === 0) return;
        const last = messages[messages.length - 1];
        if (last?.role === 'user') {
            // User just sent — show the user bubble at top
            setTimeout(scrollToLastUserMsg, 80);
        } else {
            // AI responded — reveal the rest
            setTimeout(scrollToBottom, 80);
        }
    }, [messages.length]); // intentionally only on count change

    useEffect(() => {
        if (loading) setTimeout(scrollToBottom, 80);
    }, [loading]);

    /* ── Text selection context menu ────────────────────────────── */
    const handleSelection = () => {
        const sel = window.getSelection();
        if (sel && sel.toString().trim().length > 0) {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            setSelection({ text: sel.toString().trim(), x: rect.left + rect.width / 2, y: rect.top - 10, show: true });
        }
    };

    const handleAction = async (actionType) => {
        const selectedText = selection.text;
        setSelection(p => ({ ...p, show: false }));
        if (actionType === 'refine') { setInput(selectedText); document.getElementById('chat-input')?.focus(); return; }
        const prompt = actionType === 'explain' ? `Can you explain this: "${selectedText}"?` :
            actionType === 'summarize' ? `Summarize this: "${selectedText}"` : '';
        if (prompt) await handleSend(prompt, prompt);
    };

    /* ── Core send logic ────────────────────────────────────────── */
    /**
     * handleSend(backendMsg, displayMsg, roadmapId?)
     * backendMsg  → sent to the API (can be long with context)
     * displayMsg  → shown in the user bubble (always kept short & clean)
     */
    const handleSend = async (forcedMsg = null, displayMsg = null, roadmapId = null, forcedTopic = null, forcedModuleContent = null) => {
        const contentToSend = forcedMsg || input.trim();
        if (!contentToSend || loading) return;

        const userMsg = {
            role: 'user',
            content: contentToSend,
            displayContent: displayMsg || contentToSend,
            id: Date.now()
        };
        const topicToSave = forcedTopic || currentTopic;
        addMessage(sessionId, topicToSave, userMsg);
        setLoading(true);
        if (displayMsg?.startsWith('📅')) {
            setGeneratingTopic(displayMsg.replace(/^📅\s*/, '').trim());
        }

        // Create an empty assistant message immediately for progressive rendering
        const assistantId = Date.now() + 1;
        addMessage(sessionId, topicToSave, {
            role: 'assistant',
            content: '',
            agent_name: 'InstructorAI',
            id: assistantId,
            isStreaming: true
        });

        try {
            const requestPayload = buildChatPayload(contentToSend, roadmapId, topicToSave, forcedModuleContent);
            const response = await chatAPI.stream(requestPayload);

            if (!response.ok) {
                throw new Error(`Stream failed: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let receivedToken = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;

                    try {
                        const event = JSON.parse(jsonStr);

                        if (event.token) {
                            if (!receivedToken) {
                                fetchSessions(true);
                            }
                            receivedToken = true;
                            // Append token to the assistant message
                            updateMessage(sessionId, topicToSave, assistantId, (msg) => ({
                                ...msg,
                                content: msg.content + event.token
                            }));
                        }

                        if (event.done) {
                            // Stream complete — finalize the message
                            updateMessage(sessionId, topicToSave, assistantId, (msg) => ({
                                ...msg,
                                content: sanitizeReply(msg.content),
                                agent_name: event.agent || msg.agent_name,
                                isStreaming: false
                            }));
                            fetchSessions(true);
                        }
                    } catch (parseErr) {
                        // Skip malformed SSE lines
                    }
                }
            }
            if (!receivedToken) {
                throw new Error('Empty stream response');
            }
        } catch (err) {
            console.error('Stream error:', err);
            try {
                const fallback = await chatAPI.send(buildChatPayload(contentToSend, roadmapId, topicToSave, forcedModuleContent));
                const fallbackReply = fallback?.data?.reply || "I'm sorry, I hit a snag. Please try again.";

                updateMessage(sessionId, topicToSave, assistantId, (msg) => ({
                    ...msg,
                    content: sanitizeReply(fallbackReply),
                    agent_name: 'InstructorAI',
                    isStreaming: false
                }));
                fetchSessions(true);
            } catch (fallbackErr) {
                console.error('Fallback send error:', fallbackErr);
                updateMessage(sessionId, topicToSave, assistantId, (msg) => ({
                    ...msg,
                    content: msg.content || "I'm sorry, I hit a snag. Please try again.",
                    agent_name: 'System',
                    isStreaming: false
                }));
            }
        } finally {
            setLoading(false);
            setGeneratingTopic(null);
            setTopicHistoryLoaded(topicToSave); // Clears the loader in Learning Modules pane instantly
        }
    };

    const isModulePrompt = (m, topic) => {
        if (m.role !== 'user') return false;
        
        const primaryTopicPart = (topic || '').split(':')[0].trim();
        const searchStr = primaryTopicPart.toLowerCase().replace(/[^\w\s]/gi, '');
        
        const dcStr = m.displayContent || '';
        const cStr = m.content || '';
        
        // 1. Matches active session display marker
        const hasDisplayMarker = dcStr.startsWith('📅') && dcStr.includes(primaryTopicPart);
        
        // 2. Matches DB-loaded content prefix (avoids matching follow-up context blocks)
        const isLegacyPrompt = cStr === 'Please provide a comprehensive, detailed lesson for this module, explaining the core concepts clearly.';
        const isChapterPrompt = (
            cStr.startsWith('Course Chapter:') || 
            cStr.startsWith('Daily Module:') || 
            cStr.startsWith('📅 **DAILY MODULE:**') ||
            cStr.startsWith('📅 **COURSE CHAPTER:**') ||
            isLegacyPrompt
        ) && (isLegacyPrompt || cStr.toLowerCase().includes(searchStr));

        return hasDisplayMarker || isChapterPrompt;
    };

    /* ── Auto-trigger Module Explanation ────────────────────────────── */
    useEffect(() => {
        const moduleTopic = location.state?.topic?.trim();
        const moduleContent = location.state?.content || '';
        const moduleTopicLabel = formatTopicLabel(moduleTopic || '', moduleContent);

        // Wait until sessions and history are loaded, AND our specific topic history is loaded
        if (!sessionId || historyLoading || !moduleTopic) return;
        if (topicHistoryLoaded !== moduleTopic) return;

        // Ensure we don't trigger multiple times for the same topic
        if (initialTriggered.current === moduleTopic) return;

        const checkAndTrigger = async () => {
            // Check if there's already a message for this module
            const alreadyAsked = messages.some(m => isModulePrompt(m, moduleTopic));

            if (!alreadyAsked && !loading) {
                initialTriggered.current = moduleTopic;

                const prompt = `📅 **DAILY MODULE:** ${moduleTopicLabel || moduleTopic}\n\nPlease provide a comprehensive, detailed lesson for this module, explaining the core concepts clearly.`;
                const display = `📅 ${moduleTopicLabel || moduleTopic}`;

                // Allow a tiny delay to ensure everything is mounted
                setTimeout(() => {
                    handleSend(prompt, display, learningSessionId, moduleTopic, moduleContent);
                }, 100);
            }
        };

        checkAndTrigger();
    }, [sessionId, location.state?.topic, location.state?.content, historyLoading, messages, topicHistoryLoaded, learningSessionId, formatTopicLabel, loading]);

    /* ── Sync Learning Center with AI Lesson Response ───────────────── */
    useEffect(() => {
        if (!messages.length || !currentTopic) return;

        // Search backwards to get the most recent module prompt
        let targetUserMsgIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (isModulePrompt(messages[i], currentTopic)) {
                targetUserMsgIndex = i;
                break;
            }
        }

        if (targetUserMsgIndex >= 0) {
            // Find AI response immediately following the prompt and display it
            const lessonResponseIndex = messages.findIndex((m, idx) => idx > targetUserMsgIndex && m.role === 'assistant');
            if (lessonResponseIndex !== -1) {
                const newContent = messages[lessonResponseIndex].content;
                if (newContent?.trim()) {
                    setCurrentContent(prev => prev !== newContent ? newContent : prev);
                }
            }
        }
    }, [messages, currentTopic]);

    /* ── Form submit (user typing) ──────────────────────────────── */
    const buildChatPayload = useCallback((content, roadmapId = null, forcedTopic = null, forcedModuleContent = null) => ({
        content,
        chat_session_id: sessionId,
        session_id: roadmapId || learningSessionId,
        topic: forcedTopic || currentTopic || null,
        module_title: forcedTopic || currentTopic || null,
        module_content: forcedModuleContent ?? moduleSourceContent ?? null,
    }), [sessionId, learningSessionId, currentTopic, moduleSourceContent]);

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || loading || !sessionId) return;
        const text = input.trim();
        setInput('');
        // Don't send current module content for user-typed messages.
        // This allows the backend to search across ALL modules for relevance
        // instead of grounding the response only in the currently active module.
        await handleSend(text, text, null, null, '');
    };

    const handleQuickAction = async (actionType) => {
        if (loading || !sessionId || !currentTopic) return;
        const actions = {
            summarize: { display: `Summarize: ${currentTopicLabel || currentTopic}`, prompt: `Please provide a clear, concise summary of this module. Highlight the key concepts, important takeaways, and any critical points the learner should remember.` },
            explain_code: { display: `Explain code in: ${currentTopicLabel || currentTopic}`, prompt: `Please explain all the code examples and code snippets in this module. Break down what each piece of code does, how it works, and why it's written that way. If there are no code examples, explain the key technical concepts instead.` },
            ask: null
        };
        if (actionType === 'ask') {
            inputRef.current?.focus();
            return;
        }
        const action = actions[actionType];
        if (!action) return;
        await handleSend(action.prompt, action.display);
    };

    /* ── Loading skeleton (MOVED AFTER HOOKS) ───────────────── */

    /* ── Chat Actions ─────────────────────────────────────────── */
    const handleNewChat = useCallback(() => {
        setIsMenuOpen(false);
        navigate('/chat');
    }, [navigate]);

    const handleDeleteChat = useCallback(async () => {
        if (!sessionId) {
            alert("No active chat session.");
            return;
        }
        const result = await swalConfirm({
            title: 'Clear chat content?',
            text: 'This will remove all messages from this chat but keep the session and module intact.',
            confirmText: 'Yes, clear it!'
        });
        if (!result.isConfirmed) return;

        try {
            console.log("Clearing messages for session:", sessionId, "topic:", currentTopic);
            await chatAPI.clearMessages(sessionId, currentTopic || undefined);
            clearSessionMessages(sessionId, currentTopic || null);
            setIsMenuOpen(false);
        } catch (err) {
            console.error("Clear chat error:", err);
            alert("Failed to clear chat content. Please try again.");
        }
    }, [sessionId, currentTopic, clearSessionMessages]);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (isMenuOpen && !e.target.closest('.chat-menu-container')) {
                setIsMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMenuOpen]);

    /* ── Loading skeleton ───────────────────────────────────────── */
    if (historyLoading && messages.length === 0) {
        return (
            <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 64px)', color: 'var(--text-muted)' }}>
                <Loader2 size={24} className="animate-spin" style={{ marginRight: 10 }} /> Loading conversation…
            </div>
        );
    }

    /* ── Render ─────────────────────────────────────────────────── */
    // Pre-calculate last user message index to avoid expensive O(N) array ops inside the loop
    const lastUserMsgIndex = [...messages].reverse().findIndex(m => m.role === 'user');
    const finalLastUserIndex = lastUserMsgIndex === -1 ? -1 : messages.length - 1 - lastUserMsgIndex;

    // Isolate active messages based on the current parsed topic
    let activeMessages = messages;
    let activeMessagesStartIndex = 0;

    if (currentTopic && sessions.find(s => String(s.id) === String(sessionId))?.is_roadmap) {
        const moduleStartIndices = [];
        messages.forEach((m, idx) => {
            if (m.role === 'user' && (m.content?.includes('📅 **DAILY MODULE:**') || m.displayContent?.startsWith('📅'))) {
                moduleStartIndices.push({ idx, displayContent: m.displayContent, content: m.content });
            }
        });

        if (moduleStartIndices.length > 0) {
            let startIndex = moduleStartIndices[0].idx;
            let endIndex = messages.length;

            const searchStr = currentTopic.toLowerCase().replace(/[^\w\s]/gi, '');
            const matchIdx = moduleStartIndices.findIndex(m => {
                const dcStr = (m.displayContent || '').toLowerCase().replace(/[^\w\s]/gi, '');
                const cStr = (m.content || '').toLowerCase().replace(/[^\w\s]/gi, '');
                return dcStr.includes(searchStr) || cStr.includes(searchStr);
            });

            if (matchIdx !== -1) {
                startIndex = moduleStartIndices[matchIdx].idx;
                if (matchIdx + 1 < moduleStartIndices.length) {
                    endIndex = moduleStartIndices[matchIdx + 1].idx;
                }
            } else {
                startIndex = moduleStartIndices[moduleStartIndices.length - 1].idx;
            }

            activeMessagesStartIndex = startIndex;
            activeMessages = messages.slice(startIndex, endIndex);
        }
    }

    // Aggressively hide any Daily Module Prompts and their direct follow-up Assistant responses from the feed.
    // These are displayed instead in the "Learning Modules" pane.
    const hiddenActiveIndices = new Set();
    activeMessages.forEach((m, idx) => {
        const isDailyModulePrompt = m.role === 'user' && (
            (m.content && m.content.includes('📅 **DAILY MODULE:**')) || 
            (m.content && m.content === 'Please provide a comprehensive, detailed lesson for this module, explaining the core concepts clearly.') ||
            (m.displayContent && m.displayContent.startsWith('📅'))
        );
        
        if (isDailyModulePrompt) {
            hiddenActiveIndices.add(idx);
            // Hide the next assistant message that follows this prompt (the generated lesson content)
            const nextAssistantIdx = activeMessages.findIndex((m2, i) => i > idx && m2.role === 'assistant');
            if (nextAssistantIdx !== -1) {
                hiddenActiveIndices.add(nextAssistantIdx);
            }
        }
    });

    const visibleMessages = activeMessages.filter((_, idx) => !hiddenActiveIndices.has(idx));

    const globalHiddenSet = new Set([...hiddenActiveIndices].map(localIdx => activeMessagesStartIndex + localIdx));

    // Determine if the learning module pane should display the skeleton loader
    const hasLessonResponse = messages.some((m, idx) => m.role === 'assistant' && idx > 0 && isModulePrompt(messages[idx - 1], currentTopic));
    const isCurrentlyLoadingLesson = !!generatingTopic || (
        currentTopic && 
        !(currentContent && currentContent.length > 150) && (
            historyLoading || 
            topicHistoryLoaded !== currentTopic || 
            (!hasLessonResponse && !messages.some(m => isModulePrompt(m, currentTopic)))
        )
    );

    const showMarkdownContent = hasLessonResponse || (currentContent && currentContent.length > 150) || (!isCurrentlyLoadingLesson && currentContent);

    const showChatPane = isChatOpen || !currentTopic;

    return (
        <>
            <div className="split-view-container page-content" style={{ padding: 0 }}>
                {/* ── LEFT PANE: Learning/Topics Content ─────────────────────── */}
                <div className="split-content-pane" >
                    {/* Header */}
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-chat-input-bar)', flexShrink: 0 }}>
                        <BookOpen size={18} style={{ color: 'var(--accent-primary)' }} />
                        <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, flex: 1 }}>Learning Modules</h2>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
                        {currentTopic ? (
                            <div className="content-reader">
                                <div className="content-reader-header">
                                    <h1 className="content-reader-title">{currentTopicLabel || currentTopic}</h1>
                                </div>
                                <div className="content-reader-body">
                                    {moduleCompletedAt && (
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '6px 12px', borderRadius: '6px', marginBottom: '20px', fontWeight: 600 }}>
                                            <span style={{ fontSize: '14px' }}>📅</span> Completed on {new Date(moduleCompletedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                                        </div>
                                    )}
                                    {!moduleCompletedAt && moduleTargetDate && (
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-card)', padding: '6px 12px', borderRadius: '6px', marginBottom: '20px', fontWeight: 600, border: '1px solid var(--border-glass)' }}>
                                            <span style={{ fontSize: '14px' }}>⏳</span> Scheduled: {moduleTargetDate}
                                        </div>
                                    )}
                                    {isCurrentlyLoadingLesson && (
                                        <div style={{ marginBottom: '24px', padding: '20px', borderRadius: '12px', background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.12)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                                <Loader2 size={18} className="animate-spin" style={{ color: '#6366f1' }} />
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#6366f1' }}>Generating lesson content...</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                {[100, 85, 92, 70].map((w, i) => (
                                                    <div key={i} style={{ height: '12px', width: `${w}%`, borderRadius: '6px', background: 'linear-gradient(90deg, rgba(99,102,241,0.08) 25%, rgba(99,102,241,0.15) 50%, rgba(99,102,241,0.08) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite ease-in-out' }} />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {showMarkdownContent ? (
                                        <MarkdownContent 
                                            content={currentContent} 
                                            isUser={false} 
                                        />
                                    ) : !isCurrentlyLoadingLesson && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
                                            <Loader2 size={16} className="animate-spin" /> Preparing learning materials...
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>
                                <BookOpen size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                                <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Learning Modules</h3>
                                <p style={{ maxWidth: '400px', fontSize: '14px' }}>
                                    Your curriculum and study materials will appear here. Go to the Planner and select a module to begin reading.
                                </p>
                                <button className="btn btn-primary" onClick={() => navigate('/planner')} style={{ marginTop: '24px' }}>
                                    Open Planner
                                </button>
                            </div>
                        )}

                        {/* ── Ask InstructorAI FAB ───────────────────────────────── */}
                        {currentTopic && !isChatOpen && (
                            <button
                                className="ask-ai-fab animate-fade-in"
                                onClick={() => setIsChatOpen(true)}
                                title="Ask InstructorAI about this module"
                            >
                                <Sparkles size={18} />
                                <span>Ask InstructorAI</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* ── Resizer ─────────────────────────────────────────────────── */}
                {currentTopic && showChatPane && (
                    <div
                        onMouseDown={startResizing}
                        style={{
                            width: '6px',
                            cursor: 'col-resize',
                            background: isResizing
                                ? 'var(--accent-primary)'
                                : 'linear-gradient(to right, transparent, rgba(99,102,241,0.15), transparent)',
                            transition: 'background 0.2s',
                            zIndex: 10,
                            position: 'relative',
                        }}
                        className="chat-resizer"
                    >
                        {/* Visual grip indicator */}
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '2px',
                            height: '32px',
                            borderRadius: '2px',
                            background: isResizing ? 'var(--accent-primary)' : 'rgba(99,102,241,0.3)',
                            transition: 'background 0.2s, height 0.2s',
                        }} />
                    </div>
                )}

                {/* ── Chat Pane Header + Feed + Input ───────────────────────────── */}
                {showChatPane && (
                    <div 
                        className={`split-chat-pane ${isMenuOpen ? 'menu-open' : ''}`} 
                        style={{ 
                            width: chatWidth, 
                            flexBasis: chatWidth,
                            minWidth: 300, 
                            maxWidth: '60vw', 
                            transition: isResizing ? 'none' : 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.3s ease' 
                        }}
                    >
                    {/* Header */}
                    <div style={{ borderBottom: '1px solid var(--border-glass)', background: 'var(--bg-chat-input-bar)', flexShrink: 0 }}>
                        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            < Sparkles size={18} style={{ color: 'var(--accent-primary)' }} />
                            <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                InstructorAI {sessionTitle && sessionTitle !== 'New Chat' ? <span style={{ opacity: 0.7, fontWeight: 500 }}>• {sessionTitle}</span> : ''}
                            </h2>

                            
                            <div className="chat-menu-container">
                                <button
                                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                                    className="chat-action-btn"
                                    title="Chat options"
                                >
                                    <Plus size={18} />
                                </button>
                                
                                {isMenuOpen && (
                                    <div className="chat-menu-dropdown">
                                        <button className="menu-item danger" onClick={handleDeleteChat}>
                                            <Trash2 size={16} /> Clear Chat
                                        </button>
                                    </div>
                                )}
                            </div>

                            {currentTopic && (
                                <button
                                    onClick={() => setIsChatOpen(false)}
                                    className="chat-close-btn"
                                    title="Close chat"
                                >
                                    <X size={18} />
                                </button>
                            )}
                        </div>
                        {/* {currentTopic && (
                            <div className="context-bar">
                                <BookOpen size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Reading: <strong>{currentTopic}</strong></span>
                                <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(99,102,241,0.1)', color: '#6366f1', fontWeight: 600, flexShrink: 0 }}>Context Active</span>
                            </div>
                        )} */}
                    </div>

                    {/* Message feed */}
                    <div
                        ref={scrollAreaRef}
                        style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}
                    >
                        {/* Empty state */}
                        {visibleMessages.length === 0 && !loading && !historyLoading && (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '16px', textAlign: 'center', opacity: 0.7, paddingTop: '60px', padding: '40px 24px' }}>
                                {currentTopic ? (
                                    <>
                                        <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <MessageCircle size={28} strokeWidth={1.5} style={{ color: '#6366f1' }} />
                                        </div>
                                        <div>
                                            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                                                Ask about this module
                                            </p>
                                            <p style={{ fontSize: '13px', lineHeight: 1.5 }}>I have full context of <strong style={{ color: 'var(--text-primary)' }}>{currentTopicLabel || currentTopic}</strong>. Ask me anything about the concepts, code, or tasks.</p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={48} strokeWidth={1} />
                                        <div>
                                            <p style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                                                Start a conversation with InstructorAI
                                            </p>
                                            <p style={{ fontSize: '14px' }}>Ask a question, or pick a daily module from the Planner to begin a lesson.</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Messages */}
                        {visibleMessages.map((msg, idx) => {
                            const isUser = msg.role === 'user';
                            const isLastUserMsg = idx === finalLastUserIndex;
                            const isModuleStart = isUser && (msg.content?.includes('📅 **DAILY MODULE:**') || msg.displayContent?.startsWith('📅'));

                            // What to show in the bubble
                            let rawText = msg.displayContent || msg.content || '';
                            if (isUser) {
                                // Strip context block if it leaked into the display string (e.g. after a page reload from DB)
                                rawText = rawText.replace(/\[CONTEXT - Current module:.*?\[END CONTEXT\]/is, '').trim();
                            }
                            const bubbleText = rawText;

                            return (
                                <div
                                    key={msg.id || idx}
                                    ref={isLastUserMsg ? lastUserMsgRef : null}
                                    style={{ display: 'flex', gap: '14px', flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start' }}
                                >
                                    {/* Avatar */}
                                    <div className={`avatar ${isUser ? 'avatar-user' : 'avatar-ai'}`} style={{ marginTop: '2px', flexShrink: 0 }}>
                                        {isUser
                                            ? (user?.display_name || 'U')[0].toUpperCase()
                                            : <Sparkles size={16} />
                                        }
                                    </div>

                                    {/* Bubble + agent label */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxWidth: 'min(75%, 760px)', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                                        {/* Agent name label */}
                                        {msg.agent_name && (
                                            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', paddingLeft: isUser ? 0 : '4px', paddingRight: isUser ? '4px' : 0 }}>
                                                {msg.agent_name}
                                            </span>
                                        )}

                                        {/* Bubble */}
                                        {isUser ? (
                                            /* ── User bubble ── */
                                            <div className="chat-bubble user">
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                                                    <MarkdownContent 
                                                        content={bubbleText} 
                                                        isUser={true} 
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            /* ── AI bubble: full markdown ── */
                                            <div
                                                className="chat-bubble assistant"
                                                onMouseUp={handleSelection}
                                                style={{ maxWidth: '100%' }}
                                            >
                                                {msg.isStreaming && !bubbleText ? (
                                                    <div className="typing-dots"><span /><span /><span /></div>
                                                ) : (
                                                    <MarkdownContent 
                                                        content={bubbleText} 
                                                        isUser={false} 
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Typing indicator removed; now handled directly inside empty AI bubbles */}

                        {/* Scroll sentinel */}
                        <div ref={bottomRef} style={{ height: 1 }} />
                    </div>

                    {/* ── Input bar (Part of RIGHT column) ───────────────────── */}
                    <div style={{
                        borderTop: '1px solid var(--border-glass)',
                        background: 'var(--bg-chat-input-bar)',
                        flexShrink: 0,
                    }}>
                        <div style={{ padding: '12px 20px 16px' }}>
                            <form
                                onSubmit={(e) => {
                                    onSubmit(e);
                                    if (inputRef.current) inputRef.current.focus();
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(e); if (inputRef.current) inputRef.current.focus(); } }}
                                style={{ position: 'relative', width: '100%' }}
                            >
                                <textarea
                                    ref={inputRef}
                                    id="chat-input"
                                    className="input"
                                    placeholder={currentTopic ? 'Ask about this module…' : 'Type your message…'}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    disabled={loading}
                                    rows={1}
                                    style={{
                                        paddingRight: '110px',
                                        minHeight: '48px',
                                        maxHeight: '120px',
                                        height: 'auto',
                                        borderRadius: '14px',
                                        background: 'var(--input-bg)',
                                        color: 'var(--text-primary)',
                                        resize: 'none',
                                        paddingTop: '13px',
                                        lineHeight: '1.4',
                                        border: '1px solid var(--border-glass)',
                                        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                                    }}
                                />
                                <button
                                    type="submit"
                                    id="chat-send-btn"
                                    className="btn btn-primary"
                                    disabled={!input.trim() || loading}
                                    style={{ position: 'absolute', right: '8px', top: '6px', height: '36px', borderRadius: '10px', padding: '0 16px', gap: '6px' }}
                                >
                                    {(loading && !isCurrentlyLoadingLesson) ? <Loader2 size={16} className="animate-spin" /> : <><Send size={15} /> Send</>}
                                </button>
                            </form>
                            <p style={{ textAlign: 'center', margin: '4px 0 0', fontSize: '10px', color: 'var(--text-muted)' }}>
                                InstructorAI may make mistakes.{currentTopic && ' Module context is active.'}
                            </p>
                        </div>
                    </div>
                    </div>
                )}
            </div>

            {/* ── Text-selection context menu ───────────────────── */}
            {selection.show && (
                <div
                    className="selection-menu"
                    style={{ left: selection.x, top: selection.y, transform: 'translate(-50%, -100%)' }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button className="selection-btn" onClick={() => handleAction('explain')}>
                        <Sparkles size={13} /> Ask InstructorAI
                    </button>
                    <div className="selection-divider" />
                    <button className="selection-btn" onClick={() => handleAction('summarize')}>Summarize</button>
                    <div className="selection-divider" />
                    <button className="selection-btn" onClick={() => handleAction('refine')}>
                        <Send size={13} /> Reply / Replay
                    </button>
                </div>
            )}
        </>
    );
}
