import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { GoogleOAuthProvider } from '@react-oauth/google';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import Tasks from './pages/Tasks';
import Timer from './pages/Timer';
import Progress from './pages/Progress';
import Planner from './pages/Planner';
import Admin from './pages/Admin';
import Home from './pages/Home';
import { TimerProvider } from './contexts/TimerContext';
import { ChatProvider } from './contexts/ChatContext';

function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return (
        <div className="page-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ width: '32px', height: '32px', border: '3px solid rgba(99,102,241,0.2)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <p style={{ fontSize: '14px', margin: 0 }}>Loading...</p>
            </div>
        </div>
    );
    if (!user) return <Navigate to="/" replace />;
    return children;
}

function AppContent() {
    const { user } = useAuth();
    const { pathname } = useLocation();
    const [sidebarWidth, setSidebarWidth] = useState(260);
    const [isResizing, setIsResizing] = useState(false);

    // Show sidebar only on chat pages
    const isChatPage = pathname.startsWith('/chat');
    const isTasksPage = pathname.startsWith('/tasks');
    const showSidebar = user && (isChatPage);

    const startResizing = (e) => { setIsResizing(true); e.preventDefault(); };
    const stopResizing = () => setIsResizing(false);
    const resize = (e) => {
        if (isResizing) {
            const w = e.clientX;
            if (w >= 200 && w <= 450) setSidebarWidth(w);
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

    return (
        <div className={`app-container ${isResizing ? 'resizing' : ''}`}>
            <div className="bg-mesh" />
            <Navbar />

            {showSidebar && (
                <>
                    <Sidebar width={sidebarWidth} />
                    <div
                        onMouseDown={startResizing}
                        style={{
                            position: 'fixed', left: `${sidebarWidth}px`, top: '64px', bottom: 0,
                            width: '4px', background: isResizing ? 'var(--accent-primary)' : 'transparent',
                            cursor: 'col-resize', zIndex: 100, transition: 'background 0.2s'
                        }}
                    />
                </>
            )}

            <main
                className={`${user ? 'page-wrapper' : ''} ${!showSidebar ? 'no-sidebar' : ''}`}
                style={showSidebar ? { marginLeft: `${sidebarWidth}px` } : {}}
            >
                <Routes>
                    <Route path="/" element={!user ? <Home /> : <Navigate to="/dashboard" />} />
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
                    <Route path="/chat/:sessionId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
                    <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
                    <Route path="/timer" element={<ProtectedRoute><Timer /></ProtectedRoute>} />
                    <Route path="/progress" element={<ProtectedRoute><Progress /></ProtectedRoute>} />
                    <Route path="/planner" element={<ProtectedRoute><Planner /></ProtectedRoute>} />
                    <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
                    <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} />} />
                </Routes>
            </main>

            <svg width="0" height="0" style={{ position: 'absolute' }}>
                <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="50%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#d946ef" />
                    </linearGradient>
                </defs>
            </svg>
        </div>
    );
}

export default function App() {
    return (
        <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || 'MOCK_CLIENT_ID'}>
            <BrowserRouter>
                <AuthProvider>
                    <ThemeProvider>
                        <TimerProvider>
                            <ChatProvider>
                                <AppContent />
                            </ChatProvider>
                        </TimerProvider>
                    </ThemeProvider>
                </AuthProvider>
            </BrowserRouter>
        </GoogleOAuthProvider>
    );
}
