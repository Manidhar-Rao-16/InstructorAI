import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
const api = axios.create({ baseURL: BASE });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('instructor_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (axios.isCancel(err)) return new Promise(() => {});
    const isAuthRequest = err.config?.url?.includes('/auth/login') || err.config?.url?.includes('/auth/signup');
    if (err.response?.status === 401 && !isAuthRequest) {
      localStorage.removeItem('instructor_token');
      localStorage.removeItem('instructor_user');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  login: (data) => api.post('/auth/login', data),
  googleLogin: (id_token, role = 'user') => api.post('/auth/google', { id_token, role }),
  me: () => api.get('/auth/me'),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, new_password) => api.post('/auth/reset-password', { token, new_password }),
  logoutNotify: () => api.post('/auth/logout-notify'),
};

export const chatAPI = {
  send: (payload) =>
    api.post('/chat/message', payload),
  stream: (payload) => {
    const token = localStorage.getItem('instructor_token');
    return fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  },
  history: (chat_session_id = null, limit = 50, topic = null) => {
    let url = `/chat/history?limit=${limit}`;
    if (chat_session_id) url += `&session_id=${chat_session_id}`;
    if (topic) url += `&topic=${encodeURIComponent(topic)}`;
    return api.get(url);
  },
  sessions: () => api.get('/chat/sessions'),
  createSession: (title) => api.post('/chat/sessions', { title }),
  deleteSession: (id) => api.delete(`/chat/sessions/${id}`),
  removeModule: (sessionId, stepId) => api.delete(`/chat/sessions/${sessionId}/modules/${stepId}`),
  clearMessages: (sessionId, topic) => {
    let url = `/chat/sessions/${sessionId}/messages`;
    if (topic) url += `?topic=${encodeURIComponent(topic)}`;
    return api.delete(url);
  },
  cleanup: () => api.delete('/chat/sessions/cleanup'),
};

export const assignmentAPI = {
  submitText: (data) => api.post('/tasks/submit/text', data),
  submitFile: (formData) =>
    api.post('/tasks/submit/file', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  list: () => api.get('/tasks/'),
  delete: (id) => api.delete(`/tasks/${id}`),
};

export const progressAPI = {
  dashboard: () => api.get('/progress/dashboard'),
  logs: (days = 30) => api.get(`/progress/logs?days=${days}`),
  sessions: () => api.get('/progress/sessions'),
  steps: (sessionId) => api.get(`/progress/sessions/${sessionId}/steps`),
  generateRoadmap: (data) => api.post('/progress/generate-roadmap', data),
  deleteSession: (sessionId) => api.delete(`/progress/sessions/${sessionId}`),
  toggleStep: (stepId) => api.patch(`/progress/steps/${stepId}/toggle`),
  activateStep: (stepId) => api.post(`/progress/steps/${stepId}/activate`),
};

export const timerAPI = {
  start: (data) => api.post('/timer/start', data),
  stop: (id, completed = true) => api.post(`/timer/stop/${id}?completed=${completed}`),
  updateProgress: (session_id, delta_seconds) =>
    api.post('/timer/progress', { session_id, delta_seconds }),
  history: () => api.get('/timer/history'),
};

export const notifAPI = {
  list: (unreadOnly = false) => api.get(`/notifications/?unread_only=${unreadOnly}`),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/mark-all-read'),
  endOfDay: () => api.post('/notifications/end-of-day'),
};

export const exportAPI = {
  pdf: (sessionId) => api.get(`/export/session/${sessionId}/pdf`, { responseType: 'blob' }),
  docx: (sessionId) => api.get(`/export/session/${sessionId}/docx`, { responseType: 'blob' }),
};

export const adminAPI = {
  users: () => api.get('/admin/users'),
  stats: () => api.get('/admin/stats'),
};

export default api;
