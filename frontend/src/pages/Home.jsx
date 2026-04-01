import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthModal from '../components/AuthModal';
import {
  Sparkles, Brain, Target, Rocket, ArrowRight,
  GraduationCap, BookOpen, Lightbulb, Code, Zap,
  CheckCircle, Clock, BarChart2, MessageSquare
} from 'lucide-react';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAuthOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signup');

  if (user) { navigate('/dashboard'); return null; }

  const features = [
    { icon: Brain, title: 'AI Multi-Agent System', desc: '10+ specialized agents: Roadmap, Teaching, Assessment, Progress Tracker, and more — all orchestrated intelligently.', color: '#6366f1' },
    { icon: Target, title: 'Personalized Roadmaps', desc: 'Auto-generates day-wise learning plans tailored to your level, topic, and available time — skipping holidays.', color: '#8b5cf6' },
    { icon: MessageSquare, title: 'InstructorAI Chatbot', desc: 'Ask anything. Get textbook-quality explanations, code examples, diagrams, and real resources instantly.', color: '#06b6d4' },
    { icon: CheckCircle, title: 'Smart Task System', desc: 'Assignments auto-generated per chapter. AI evaluates your submission and gives mentor-quality feedback.', color: '#10b981' },
    { icon: Clock, title: 'Pomodoro Focus Timer', desc: '30-minute focus sessions with break management to maximize your productivity and track total study time.', color: '#f59e0b' },
    { icon: BarChart2, title: 'Progress Analytics', desc: 'Visualize daily focus time, completion rates, scores, streaks, and active roadmaps — all in one place.', color: '#f43f5e' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative', overflow: 'hidden' }}>
      {/* Background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 50% at 20% 20%, rgba(99,102,241,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 60% at 80% 0%, rgba(139,92,246,0.08) 0%, transparent 55%), radial-gradient(ellipse 50% 70% at 50% 100%, rgba(6,182,212,0.06) 0%, transparent 50%)'
      }} />

      {/* Navbar */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: '64px',
        background: 'var(--bg-navbar)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border-glass)',
        boxShadow: '0 1px 20px rgba(99,102,241,0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/logo.png" alt="InstructorAI" style={{ width: '32px', height: '32px', objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
          <span style={{ fontSize: '18px', fontWeight: 800, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            InstructorAI
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => { setAuthMode('login'); setAuthOpen(true); }}
            style={{ padding: '8px 20px', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
            Sign In
          </button>
          <button onClick={() => { setAuthMode('signup'); setAuthOpen(true); }}
            style={{ padding: '8px 20px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'white', boxShadow: '0 4px 12px rgba(99,102,241,0.35)' }}>
            Get Started Free
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ paddingTop: '140px', paddingBottom: '80px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '860px', margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '20px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', marginBottom: '28px', fontSize: '13px', fontWeight: 600, color: '#6366f1' }}>
            <Sparkles size={14} /> AI-Powered Personalized Learning Platform
          </div>
          <h1 style={{ fontSize: 'clamp(36px,6vw,72px)', fontWeight: 800, lineHeight: 1.1, margin: '0 0 24px', color: 'var(--text-primary)' }}>
            Master Any Skill with{' '}
            <span style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6,#d946ef)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              InstructorAI
            </span>
          </h1>
          <p style={{ fontSize: '18px', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '40px', maxWidth: '640px', margin: '0 auto 40px' }}>
            A production-ready multi-agent AI platform that builds personalized roadmaps, teaches you step by step, evaluates your assignments, and tracks your progress — all in one place.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => { setAuthMode('signup'); setAuthOpen(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 32px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: 'white', boxShadow: '0 8px 24px rgba(99,102,241,0.4)' }}>
              Start Learning Free <Rocket size={18} />
            </button>
            <button onClick={() => { setAuthMode('login'); setAuthOpen(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 32px', borderRadius: '14px', border: '1.5px solid var(--border-glass)', background: 'var(--bg-glass)', cursor: 'pointer', fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>
              Sign In <ArrowRight size={18} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: '40px', justifyContent: 'center', marginTop: '56px', flexWrap: 'wrap' }}>
            {[['10+', 'Specialist Agents'], ['5', 'Learning Levels'], ['24/7', 'Availability'], ['Free', 'To Start']].map(([val, lbl]) => (
              <div key={lbl} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '28px', fontWeight: 800, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{val}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '4px' }}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section style={{ padding: '60px 40px 80px', position: 'relative', zIndex: 1, maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 800, margin: '0 0 12px' }}>Everything You Need to Master Skills</h2>
          <p style={{ fontSize: '16px', color: 'var(--text-muted)' }}>From roadmap to mastery — InstructorAI handles the entire learning journey</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          {features.map(({ icon: Icon, title, desc, color }) => (
            <div key={title} style={{
              padding: '28px', borderRadius: '20px',
              background: 'var(--bg-card)', backdropFilter: 'blur(12px)',
              border: '1px solid var(--border-glass)',
              boxShadow: '0 4px 24px rgba(99,102,241,0.06)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
              onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(99,102,241,0.12)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(99,102,241,0.06)'; }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <Icon size={24} style={{ color }} />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px' }}>{title}</h3>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '60px 40px 100px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '48px', borderRadius: '24px', background: 'var(--gradient-card)', border: '1px solid var(--border-glass)' }}>
          <GraduationCap size={48} style={{ color: '#6366f1', marginBottom: '20px' }} />
          <h2 style={{ fontSize: '28px', fontWeight: 800, margin: '0 0 12px' }}>Ready to Start Your Learning Journey?</h2>
          <p style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '28px' }}>Join thousands of learners mastering new skills with AI-powered guidance.</p>
          <button onClick={() => { setAuthMode('signup'); setAuthOpen(true); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '14px 36px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: 'white', boxShadow: '0 8px 24px rgba(99,102,241,0.4)' }}>
            Get Started Free <Rocket size={18} />
          </button>
        </div>
      </section>

      <AuthModal isOpen={isAuthOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
    </div>
  );
}
