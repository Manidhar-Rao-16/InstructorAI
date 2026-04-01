import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { chatAPI } from '../services/api';
import { useAuth } from './AuthContext';

const ChatContext = createContext();

export function ChatProvider({ children }) {
    const { user } = useAuth();
    const [sessions, setSessions] = useState(() => {
        const saved = localStorage.getItem('chat_sessions');
        return saved ? JSON.parse(saved) : [];
    });
    const [messagesByContext, setMessagesByContext] = useState(() => {
        const saved = localStorage.getItem('chat_messages_by_context');
        return saved ? JSON.parse(saved) : {};
    });
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [generatingTopic, setGeneratingTopic] = useState(null);
    const [lastSessionId, setLastSessionId] = useState(() => {
        return localStorage.getItem('last_chat_session_id');
    });

    // Ref to track latest messages for stable use in useCallback without re-render loops
    const messagesRef = useRef(messagesByContext);
    useEffect(() => {
        messagesRef.current = messagesByContext;
    }, [messagesByContext]);

    useEffect(() => {
        if (lastSessionId) {
            localStorage.setItem('last_chat_session_id', lastSessionId);
        }
    }, [lastSessionId]);

    useEffect(() => {
        localStorage.setItem('chat_sessions', JSON.stringify(sessions));
    }, [sessions]);

    useEffect(() => {
        localStorage.setItem('chat_messages_by_context', JSON.stringify(messagesByContext));
    }, [messagesByContext]);

    const fetchSessions = useCallback(async (force = false) => {
        if (!user) return [];
        
        // Always fetch if force is true, or if we have no sessions. 
        // This ensures the sidebar stays synced when navigating from Planner.
        if (sessions.length > 0 && !force) return sessions;

        setSessionsLoading(true);
        try {
            const res = await chatAPI.sessions();
            setSessions(res.data);
            return res.data;
        } catch (err) {
            console.error("Fetch sessions error:", err);
            return sessions;
        } finally {
            setSessionsLoading(false);
        }
    }, [user, sessions.length]);

    const fetchHistory = useCallback(async (sessionId, topic = null, force = false) => {
        if (!sessionId) return [];
        const contextKey = `${sessionId}_${topic || ''}`;
        
        const hasCached = messagesRef.current[contextKey] && messagesRef.current[contextKey].length > 0;

        // OPTIMIZATION: Only show loading spinner if we don't have any messages yet for this context
        // This provides an "instant" feel for previously visited topics.
        if (!hasCached || force) {
            setHistoryLoading(true);
        }

        try {
            const res = await chatAPI.history(sessionId, 50, topic);
            const serverMsgs = res.data;

            setMessagesByContext(prev => {
                const cachedMsgs = prev[contextKey] || [];
                // MERGE: preserve displayContent from cached messages (frontend-only field)
                const merged = serverMsgs.map(serverMsg => {
                    const cached = cachedMsgs.find(c =>
                        (c.id && c.id === serverMsg.id) ||
                        (c.content === serverMsg.content && c.role === serverMsg.role)
                    );
                    return cached ? { ...serverMsg, displayContent: cached.displayContent ?? serverMsg.content } : serverMsg;
                });

                // CRITICAL: Preserve locally-added messages (optimistic user/assistant messages
                // with numeric IDs from Date.now()) that haven't been persisted to the server yet.
                // Without this, in-flight streaming messages get wiped when fetchHistory re-runs.
                const localOnlyMsgs = cachedMsgs.filter(cachedMsg => {
                    if (typeof cachedMsg.id !== 'number') return false; // Only numeric (temp) IDs
                    // Check it's not already matched by server data
                    return !merged.some(m =>
                        (m.id === cachedMsg.id) ||
                        (m.content === cachedMsg.content && m.role === cachedMsg.role)
                    );
                });

                return {
                    ...prev,
                    [contextKey]: [...merged, ...localOnlyMsgs]
                };
            });
            return []; 
        } catch (err) {
            console.error("Fetch history error:", err);
            return [];
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    const addMessage = (sessionId, topic, message) => {
        const contextKey = `${sessionId}_${topic || ''}`;
        setMessagesByContext(prev => ({
            ...prev,
            [contextKey]: [...(prev[contextKey] || []), message]
        }));
    };

    const updateMessage = (sessionId, topic, messageId, updater) => {
        const contextKey = `${sessionId}_${topic || ''}`;
        setMessagesByContext(prev => {
            const msgs = prev[contextKey] || [];
            return {
                ...prev,
                [contextKey]: msgs.map(m => m.id === messageId ? updater(m) : m)
            };
        });
    };

    const updateSessionsLocally = (newSessionsOrUpdater) => {
        setSessions(prev =>
            typeof newSessionsOrUpdater === 'function'
                ? newSessionsOrUpdater(prev)
                : newSessionsOrUpdater
        );
    };

    const deleteSessionMessages = (sessionId) => {
        setMessagesByContext(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
                if (key.startsWith(`${sessionId}_`)) delete next[key];
            });
            return next;
        });
        setSessions(prev => prev.filter(s => String(s.id) !== String(sessionId)));
    };

    const clearSessionMessages = (sessionId, topic = null) => {
        const contextKey = `${sessionId}_${topic || ''}`;
        setMessagesByContext(prev => ({
            ...prev,
            [contextKey]: []
        }));
    };

    const clearCache = () => {
        setSessions([]);
        setMessagesByContext({});
        setLastSessionId(null);
        localStorage.removeItem('last_chat_session_id');
        localStorage.removeItem('chat_sessions');
        localStorage.removeItem('chat_messages_by_context');
    };

    useEffect(() => {
        if (!user) clearCache();
    }, [user]);

    return (
        <ChatContext.Provider value={{
            sessions,
            messagesByContext,
            sessionsLoading,
            historyLoading,
            fetchSessions,
            fetchHistory,
            addMessage,
            updateMessage,
            updateSessionsLocally,
            deleteSessionMessages,
            clearSessionMessages,
            clearCache,
            lastSessionId,
            setLastSessionId,
            generatingTopic,
            setGeneratingTopic
        }}>
            {children}
        </ChatContext.Provider>
    );
}

export const useChat = () => useContext(ChatContext);
