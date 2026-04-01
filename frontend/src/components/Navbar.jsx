import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, LogOut, User, Brain, Menu, X,
  LayoutDashboard, MessageSquare, FileText,
  Timer, TrendingUp, Calendar, ChevronRight, Moon, Sun
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { notifAPI } from '../services/api';
import NotificationPanel from './NotificationPanel';

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/planner', icon: Calendar, label: 'Planner' },
  { to: '/chat', icon: MessageSquare, label: 'InstructorAI' },
  { to: '/tasks', icon: FileText, label: 'Tasks' },
  { to: '/timer', icon: Timer, label: 'Focus Timer' },
  { to: '/progress', icon: TrendingUp, label: 'Progress' },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastNotifs, setToastNotifs] = useState([]);
  const prevNotifIds = useRef(new Set());
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  // Poll for notifications and show toast popups for new ones
  useEffect(() => {
    if (!user) return;
    const fetchNotifs = async () => {
      try {
        const r = await notifAPI.list(false);
        const all = r.data || [];
        const unread = all.filter(n => !n.is_read);
        setUnreadCount(unread.length);
        
        // Show toast for new notifications
        const newOnes = unread.filter(n => !prevNotifIds.current.has(n.id));
        const filteredNewOnes = newOnes.filter(n => {
            if (n.title.includes('Welcome back')) {
                if (sessionStorage.getItem('welcome_shown')) return false;
                sessionStorage.setItem('welcome_shown', 'true');
            }
            return true;
        });
        
        if (filteredNewOnes.length > 0 && prevNotifIds.current.size > 0) {
          setToastNotifs(prev => [...prev, ...filteredNewOnes.slice(0, 2)]);
          filteredNewOnes.forEach(n => setTimeout(() => dismissToast(n.id), 6000));
        }
        
        prevNotifIds.current = new Set(all.map(n => n.id));
      } catch { }
    };
    
    fetchNotifs();
    const iv = setInterval(fetchNotifs, 15000); // Poll slightly faster too
    window.addEventListener('refresh-notifications', fetchNotifs);
    
    return () => {
        clearInterval(iv);
        window.removeEventListener('refresh-notifications', fetchNotifs);
    };
  }, [user]);

  const dismissToast = (id) => setToastNotifs(prev => prev.filter(n => n.id !== id));

  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfile(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setIsMobileMenuOpen(false); }, [pathname]);

  const handleLogout = async () => {
    setShowProfile(false);
    await logout();
    navigate('/');
  };

  const initials = user?.display_name ? user.display_name.slice(0, 2).toUpperCase() : user?.email?.slice(0, 2).toUpperCase() || 'U';

  return (
    <>
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
          <Link to={user ? '/dashboard' : '/'} className="navbar-logo" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/logo.png" alt="InstructorAI" style={{ width: '32px', height: '32px', objectFit: 'contain' }} onError={e => e.target.style.display = 'none'} />
            <span className="logo-text">InstructorAI</span>
          </Link>
        </div>

        {user && (
          <>
            {/* Desktop nav */}
            <div className="navbar-menu-desktop" style={{ flex: 1, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
              <div className="navbar-menu" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginLeft: 0, marginRight: 0 }}>
                {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
                  <Link key={to} to={to} className={`navbar-link ${pathname.startsWith(to) && to !== '/' ? 'active' : ''}`} style={{ whiteSpace: 'nowrap' }}>
                    <Icon className="icon" size={15} />{label}
                  </Link>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="btn btn-ghost"
                style={{ position: 'relative', padding: '8px', borderRadius: '10px' }}
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              </button>

              {/* Bell */}
              <div ref={notifRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setShowNotifs(!showNotifs); setShowProfile(false); }}
                  className="btn btn-ghost"
                  style={{ position: 'relative', padding: '8px', borderRadius: '10px' }}
                  title="Notifications"
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span style={{
                      position: 'absolute', top: '4px', right: '4px',
                      width: '16px', height: '16px', borderRadius: '50%',
                      background: '#ef4444', color: 'white', fontSize: '10px',
                      fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid var(--bg-navbar)'
                    }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                  )}
                </button>
                {showNotifs && (
                  <div style={{ position: 'absolute', right: 0, top: '44px', zIndex: 500 }}>
                    <NotificationPanel onClose={() => setShowNotifs(false)} />
                  </div>
                )}
              </div>

              {/* Profile */}
              <div ref={profileRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => { setShowProfile(!showProfile); setShowNotifs(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
                    borderRadius: '10px', border: '1px solid var(--border-glass)',
                    background: 'var(--bg-glass)', cursor: 'pointer', transition: 'var(--transition)'
                  }}
                  title="Profile"
                >
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '8px',
                    background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: '11px', fontWeight: 700
                  }}>{initials}</div>
                  <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.display_name || user.email?.split('@')[0]}
                  </span>
                </button>

                {showProfile && (
                  <div style={{
                    position: 'absolute', right: 0, top: '44px', zIndex: 500,
                    width: '240px', borderRadius: '16px',
                    background: 'var(--dropdown-bg)',
                    border: '1px solid var(--border-glass)',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.12)',
                    overflow: 'hidden'
                  }}>
                    {/* User info */}
                    <div style={{ padding: '16px', background: 'rgba(99,102,241,0.06)', borderBottom: '1px solid var(--border-glass)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '40px', height: '40px', borderRadius: '12px',
                          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'white', fontSize: '15px', fontWeight: 700
                        }}>{initials}</div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: '14px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {user.display_name || 'User'}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {user.email}
                          </div>
                          <div style={{ marginTop: '4px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#6366f1', textTransform: 'uppercase' }}>
                              {user.role}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ padding: '8px' }}>
                      <button
                        onClick={handleLogout}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '10px 12px', borderRadius: '10px', border: 'none',
                          background: 'transparent', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                          color: '#ef4444', textAlign: 'left',
                          transition: 'background 0.15s'
                        }}
                        onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <LogOut size={15} /> Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile hamburger */}
              <button className="btn btn-ghost" style={{ display: 'none', padding: '8px' }} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} id="mobile-menu-btn">
                {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </>
        )}

        {!user && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Link to="/" style={{ textDecoration: 'none' }}>
            <button style={{ padding: '8px 20px', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                Sign In
              </button>
            </Link>
          </div>
        )}
      </nav>

      {/* Toast popup notifications */}
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {toastNotifs.map(n => (
          <div key={n.id} style={{
            width: '320px', padding: '14px 16px', borderRadius: '14px',
            background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            display: 'flex', alignItems: 'flex-start', gap: '12px',
            animation: 'slideInRight 0.3s ease'
          }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Bell size={16} style={{ color: '#6366f1' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '2px' }}>{n.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{n.message.slice(0, 80)}{n.message.length > 80 ? '...' : ''}</div>
            </div>
            <button onClick={() => dismissToast(n.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)', flexShrink: 0 }}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
