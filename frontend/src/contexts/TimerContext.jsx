/**
 * TimerContext.jsx
 * 
 * Provides a global state for the Pomodoro Timer across the entire application.
 * Manages the countdown, persistence (via localStorage), and real-time backend sync
 * of focus time. This ensures the timer remains active across page refreshes and navigations.
 */
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { timerAPI } from '../services/api';

// Create context and custom hook for easy access in components
const TimerContext = createContext();
export const useTimer = () => useContext(TimerContext);

export const TimerProvider = ({ children }) => {
    // --- State Initialization ---
    // We initialize state from localStorage to ensure persistence across refreshes

    // The active Pomodoro session object from the backend
    const [session, setSession] = useState(() => {
        const saved = localStorage.getItem('timer_session');
        return saved ? JSON.parse(saved) : null;
    });

    // Boolean flags for timer status
    const [isActive, setIsActive] = useState(() => {
        return localStorage.getItem('timer_isActive') === 'true';
    });
    const [isPaused, setIsPaused] = useState(() => {
        return localStorage.getItem('timer_isPaused') === 'true';
    });
    const [isBreak, setIsBreak] = useState(() => {
        return localStorage.getItem('timer_isBreak') === 'true';
    });

    // Time-keeping states
    const [remainingTimeOnPause, setRemainingTimeOnPause] = useState(() => {
        const saved = localStorage.getItem('timer_remainingTimeOnPause');
        return saved ? parseInt(saved, 10) : null;
    });
    const [totalSessionSeconds, setTotalSessionSeconds] = useState(() => {
        const saved = localStorage.getItem('timer_totalSessionSeconds');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [lastSyncSeconds, setLastSyncSeconds] = useState(() => {
        const saved = localStorage.getItem('timer_lastSyncSeconds');
        return saved ? parseInt(saved, 10) : 0;
    });

    // Meta-data states
    const [topic, setTopic] = useState(() => {
        return localStorage.getItem('timer_topic') || '';
    });
    const [startTime, setStartTime] = useState(() => {
        const saved = localStorage.getItem('timer_startTime');
        return saved ? parseInt(saved, 10) : null;
    });

    // Suspended state for Focus Session (to resume after break)
    const [suspendedFocusState, setSuspendedFocusState] = useState(() => {
        const saved = localStorage.getItem('timer_suspendedFocusState');
        return saved ? JSON.parse(saved) : null;
    });

    // Configurations
    const [duration, setDuration] = useState(() => {
        const saved = localStorage.getItem('timer_duration');
        return saved ? parseInt(saved, 10) : 30 * 60;
    });
    const [timeLeft, setTimeLeft] = useState(duration);
    const [loading, setLoading] = useState(false);
    const [finished, setFinished] = useState(false);

    // Refs for intervals (timer and backend sync)
    const timerRef = useRef(null);
    const syncRef = useRef(null);

    // --- Persistence Side Effect ---
    // Automatically save state to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('timer_session', JSON.stringify(session));
        localStorage.setItem('timer_isActive', isActive);
        localStorage.setItem('timer_isPaused', isPaused);
        localStorage.setItem('timer_isBreak', isBreak);
        localStorage.setItem('timer_duration', duration);
        localStorage.setItem('timer_remainingTimeOnPause', remainingTimeOnPause || '');
        localStorage.setItem('timer_totalSessionSeconds', totalSessionSeconds);
        localStorage.setItem('timer_lastSyncSeconds', lastSyncSeconds);
        localStorage.setItem('timer_topic', topic);
        localStorage.setItem('timer_startTime', startTime || '');
        localStorage.setItem('timer_suspendedFocusState', JSON.stringify(suspendedFocusState));
    }, [session, isActive, isPaused, isBreak, duration, remainingTimeOnPause, totalSessionSeconds, lastSyncSeconds, topic, startTime, suspendedFocusState]);

    // --- Core Timer Logic ---
    // Handles the actual countdown and second-by-second updates
    useEffect(() => {
        if (isActive && !isPaused && startTime) {
            const tick = () => {
                const now = Math.floor(Date.now() / 1000);
                const elapsed = now - startTime;
                const remaining = Math.max(0, duration - elapsed);
                setTimeLeft(remaining);

                // Update total seconds focusing for progress tracking
                setTotalSessionSeconds(elapsed);

                // Auto-complete if time hits zero
                if (remaining <= 0) {
                    clearInterval(timerRef.current);
                    handleComplete(true);
                }
            };

            tick(); // Run initial tick immediately
            timerRef.current = setInterval(tick, 1000); // Set interval for subsequent ticks
        } else if (isPaused && remainingTimeOnPause !== null) {
            // If paused, keep the display static at the pause moment
            clearInterval(timerRef.current);
            setTimeLeft(remainingTimeOnPause);
        } else {
            // Reset state if not active
            clearInterval(timerRef.current);
            if (!isActive) setTimeLeft(duration);
        }

        return () => clearInterval(timerRef.current); // Cleanup on unmount or deps change
    }, [isActive, isPaused, startTime, duration, remainingTimeOnPause]);

    // --- Backend Sync Effect ---
    // Periodically syncs focus progress to the backend in chunks (e.g., every 30s)
    useEffect(() => {
        if (isActive && !isPaused && session) {
            const syncProgress = async () => {
                const delta = totalSessionSeconds - lastSyncSeconds;
                if (delta >= 60) {
                    try {
                        await timerAPI.updateProgress(session.id, delta);
                        setLastSyncSeconds(totalSessionSeconds);
                    } catch (e) {
                        console.error('Failed to sync timer progress:', e);
                    }
                }
            };
            syncRef.current = setInterval(syncProgress, 5000); // Check every 5s if enough time has passed to sync
        } else {
            clearInterval(syncRef.current);
        }
        return () => clearInterval(syncRef.current);
    }, [isActive, isPaused, session, totalSessionSeconds, lastSyncSeconds]);

    /**
     * Helper to sync any pending progress before stopping or pausing.
     */
    const syncFinalProgress = async () => {
        if (!session) return;
        const delta = totalSessionSeconds - lastSyncSeconds;
        if (delta > 0) {
            try {
                await timerAPI.updateProgress(session.id, delta);
                setLastSyncSeconds(totalSessionSeconds);
            } catch (e) {
                console.error('Failed to sync final progress:', e);
            }
        }
    };

    // --- Action Handlers ---

    // Starts a new focus session
    const start = async (customTopic) => {
        setLoading(true);
        const focusTopic = (typeof customTopic === 'string' ? customTopic : topic) || '';
        try {
            const focusMinutes = 30;
            const res = await timerAPI.start({ topic: focusTopic, focus_minutes: focusMinutes });
            const now = Math.floor(Date.now() / 1000);
            const dur = focusMinutes * 60;
            
            setSession(res.data);
            setStartTime(now);
            setTopic(focusTopic);
            setDuration(dur);
            setTimeLeft(dur);
            setIsActive(true);
            setIsPaused(false);
            setIsBreak(false);
            setFinished(false);
            setRemainingTimeOnPause(null);
            setTotalSessionSeconds(0);
            setLastSyncSeconds(0);
        } catch (e) {
            console.error('Failed to start timer:', e);
            throw e;
        } finally {
            setLoading(false);
        }
    };

    // Starts a break session
    const startBreak = async (minutes = 5) => {
        setLoading(true);
        const breakTopic = 'Short Break';

        // If a focus session is active, suspend it
        if (isActive && !isBreak) {
            // Immediate pause to stop the interval from ticking while we call the API
            setIsPaused(true);
            setRemainingTimeOnPause(timeLeft);

            setSuspendedFocusState({
                session,
                timeLeft,
                topic,
                totalSessionSeconds,
                lastSyncSeconds
            });
            // Stop focus session progress sync
            await syncFinalProgress();
        }

        try {
            const res = await timerAPI.start({ topic: breakTopic, focus_minutes: minutes });
            const now = Math.floor(Date.now() / 1000);
            const dur = minutes * 60;

            setSession(res.data);
            setStartTime(now);
            setTopic(breakTopic);
            setDuration(dur);
            setTimeLeft(dur);
            setIsActive(true);
            setIsPaused(false);
            setIsBreak(true);
            setFinished(false);
            setRemainingTimeOnPause(null);
            setTotalSessionSeconds(0);
            setLastSyncSeconds(0);
        } catch (e) {
            console.error('Failed to start break:', e);
            const now = Math.floor(Date.now() / 1000);
            const dur = minutes * 60;
            setStartTime(now);
            setTopic(breakTopic);
            setDuration(dur);
            setTimeLeft(dur);
            setIsActive(true);
            setIsPaused(false);
            setIsBreak(true);
        } finally {
            setLoading(false);
        }
    };

    // Pauses the current session
    const pause = async () => {
        if (!isActive || isPaused) return;
        setIsPaused(true);
        setRemainingTimeOnPause(timeLeft);
        await syncFinalProgress(); // Log the time spent before pausing
    };

    // Resumes a paused session
    const resume = () => {
        if (!isActive || !isPaused) return;
        const now = Math.floor(Date.now() / 1000);
        const elapsedSoFar = duration - remainingTimeOnPause;
        // Adjust startTime so that current 'now' minus elapsedSoFar equals the logic start
        const newStartTime = now - elapsedSoFar;
        setStartTime(newStartTime);
        setIsPaused(false);
        setRemainingTimeOnPause(null);
    };

    // Internal handler for session end (completion or cancellation)
    const handleComplete = async (completed) => {
        if (!session) return;
        try {
            await syncFinalProgress();
            await timerAPI.stop(session.id, completed);
        } catch (e) {
            console.error('Failed to stop timer:', e);
        } finally {
            // Check if we should resume a suspended focus session
            if (isBreak && suspendedFocusState) {
                const s = suspendedFocusState;
                setSession(s.session);
                setTopic(s.topic);
                setDuration(30 * 60); // Default focus duration
                setTimeLeft(s.timeLeft);
                setTotalSessionSeconds(s.totalSessionSeconds);
                setLastSyncSeconds(s.lastSyncSeconds);
                
                // Adjust startTime so it resumes from timeLeft correctly
                const now = Math.floor(Date.now() / 1000);
                const elapsedSoFar = 30 * 60 - s.timeLeft;
                setStartTime(now - elapsedSoFar);
                
                setIsActive(true);
                setIsPaused(false);
                setIsBreak(false);
                setSuspendedFocusState(null);
                setRemainingTimeOnPause(null);
                if (completed) setFinished(true);
            } else {
                // Regular session end
                setSession(null);
                setIsActive(false);
                setIsPaused(false);
                setRemainingTimeOnPause(null);
                setStartTime(null);
                setIsBreak(false);
                setSuspendedFocusState(null);
                setTotalSessionSeconds(0);
                setLastSyncSeconds(0);
                setDuration(30 * 60); // Reset to default
                setTimeLeft(30 * 60);
                // Only clear timer-related keys instead of wiping everything
                const timerKeys = [
                    'timer_session', 'timer_isActive', 'timer_isPaused', 'timer_isBreak',
                    'timer_remainingTimeOnPause', 'timer_totalSessionSeconds',
                    'timer_lastSyncSeconds', 'timer_topic', 'timer_startTime', 'timer_duration',
                    'timer_suspendedFocusState'
                ];
                timerKeys.forEach(k => localStorage.removeItem(k));
                if (completed) {
                    setFinished(true);
                }
            }
        }
    };

    // Exported context value
    const value = {
        session,
        isActive,
        isPaused,
        timeLeft,
        topic,
        setTopic,
        loading,
        start,
        pause,
        resume,
        stop: () => handleComplete(false),
        skip: () => handleComplete(true),
        duration,
        isBreak,
        finished,
        setFinished,
        startBreak,
        totalSessionSeconds
    };

    return (
        <TimerContext.Provider value={value}>
            {children}
        </TimerContext.Provider>
    );
};
