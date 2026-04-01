import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, chatAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if this is a Google OAuth redirect-back with ?google_auth=<base64-payload>
        const params = new URLSearchParams(window.location.search);
        const googleAuth = params.get('google_auth');
        const googleError = params.get('google_error');

        if (googleAuth) {
            // Decode the base64 JWT payload from the backend callback redirect
            try {
                const decoded = JSON.parse(atob(googleAuth));
                const { access_token, role, user_id, display_name, email } = decoded;
                const userData = { user_id, email, role, display_name };
                localStorage.setItem('instructor_token', access_token);
                localStorage.setItem('instructor_user', JSON.stringify(userData));
                setUser(userData);
                // Create a chat session in the background
                chatAPI.createSession().catch(() => {});
            } catch (e) {
                console.error('Failed to parse Google auth payload:', e);
            }
            // Clean the URL so the user doesn't see the token
            window.history.replaceState({}, '', window.location.pathname);
        } else if (googleError) {
            console.error('Google OAuth error:', googleError);
            window.history.replaceState({}, '', window.location.pathname);
        } else {
            // Normal session restore from localStorage
            const stored = localStorage.getItem('instructor_user');
            if (stored) {
                try { setUser(JSON.parse(stored)); } catch { }
            }
        }
        setLoading(false);
    }, []);

    const login = async (email, password) => {
        const normalizedEmail = email.trim().toLowerCase();
        const res = await authAPI.login({ email: normalizedEmail, password });
        const { access_token, role, user_id, display_name } = res.data;
        const userData = { user_id, email: normalizedEmail, role, display_name };
        localStorage.setItem('instructor_token', access_token);
        localStorage.setItem('instructor_user', JSON.stringify(userData));
        setUser(userData);
        try { await chatAPI.createSession(); } catch (err) { console.error(err); }
        return userData;
    };

    const signup = async (email, password, display_name, role = 'user') => {
        const normalizedEmail = email.trim().toLowerCase();
        const res = await authAPI.signup({ email: normalizedEmail, password, display_name, role });
        const { access_token, role: r, user_id, display_name: dn } = res.data;
        const userData = { user_id, email: normalizedEmail, role: r, display_name: dn };
        localStorage.setItem('instructor_token', access_token);
        localStorage.setItem('instructor_user', JSON.stringify(userData));
        setUser(userData);
        try { await chatAPI.createSession(); } catch (err) { console.error(err); }
        return userData;
    };

    const loginWithGoogle = async (idToken, role = 'user') => {
        const res = await authAPI.googleLogin(idToken, role);
        const { access_token, role: r, user_id, display_name, email } = res.data;
        const userData = { user_id, email, role: r, display_name };
        localStorage.setItem('instructor_token', access_token);
        localStorage.setItem('instructor_user', JSON.stringify(userData));
        setUser(userData);
        try { await chatAPI.createSession(); } catch (err) { console.error(err); }
        return userData;
    };

    const logout = async () => {
        try { await authAPI.logoutNotify(); } catch (e) { /* best-effort */ }
        localStorage.removeItem('instructor_token');
        localStorage.removeItem('instructor_user');
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, signup, loginWithGoogle, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
