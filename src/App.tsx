import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, Check, Video, ArrowRight, X,
  LogOut, Trash2, RefreshCw, TrendingUp, Info, Shield,
  Upload, Plus, FileDown, FileUp, Flame, StickyNote, Star,
  Sun, Moon, Eye, EyeOff, User, Lock, Calendar, History,
  Table, BarChart2, Loader, Edit2, ChevronDown, ChevronUp,
  Users, Activity, Filter
} from 'lucide-react';
import { ROUTINE_DATA, ADMIN_PASSWORD } from './constants';
import { Exercise, Routine, WorkoutSession, UserProfile, Theme } from './types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import {
  fetchProfileByUsername, fetchProfiles, createProfile, updateProfile, deleteProfile,
  fetchRoutine, upsertRoutine, deleteRoutine,
  fetchSessions, fetchAllSessions, insertSession, deleteSession as dbDeleteSession,
  fetchWeights, upsertWeight,
  fetchFullBackup, restoreFullBackup,
  verifyPassword, hashPassword,
} from './supabase';

// ─── EXCEL PARSER ──────────────────────────────────────────────────────────
async function parseExcelToRoutine(file: File): Promise<Routine> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const routine: Routine = { nombre: file.name.replace(/\.xlsx?$/i, ''), dias: [] };
        wb.SheetNames.forEach((sheetName, si) => {
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
          if (rows.length < 2) return;
          const hdr = (rows[0] as string[]).map(h => String(h).toLowerCase().trim());
          const col = (terms: string[]) => hdr.findIndex(h => terms.some(t => h.includes(t)));
          const cm = {
            nombre: col(['ejercicio', 'nombre', 'exercise', 'name']),
            series: col(['serie', 'sets']),
            reps: col(['rep']),
            rpe: col(['rpe', 'intensidad']),
            descanso: col(['descanso', 'rest', 'seg']),
            video: col(['video', 'url', 'link']),
            obs: col(['observ', 'nota', 'tip', 'comment']),
          };
          const ejercicios: Exercise[] = [];
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] as string[];
            const nombre = cm.nombre >= 0 ? String(row[cm.nombre] || '').trim() : '';
            if (!nombre) continue;
            const series = cm.series >= 0 ? (parseInt(String(row[cm.series])) || 3) : 3;
            const repeticiones = cm.reps >= 0 ? String(row[cm.reps] || '10-12') : '10-12';
            const rpeRaw = cm.rpe >= 0 ? String(row[cm.rpe] || '8') : '8';
            const descanso_segundos = cm.descanso >= 0 ? (parseInt(String(row[cm.descanso])) || 120) : 120;
            const video = cm.video >= 0 ? String(row[cm.video] || '') : '';
            const observaciones = cm.obs >= 0 ? String(row[cm.obs] || '') : '';
            let intensidad_rpe = rpeRaw.includes(',')
              ? rpeRaw.split(',').map(r => parseInt(r.trim()) || 8)
              : [parseInt(rpeRaw) || 8];
            while (intensidad_rpe.length < series) intensidad_rpe.push(intensidad_rpe[intensidad_rpe.length - 1]);
            ejercicios.push({ id: `xl_${si}_${i}_${Date.now()}`, nombre, series, repeticiones, intensidad_rpe, descanso_segundos, video, observaciones });
          }
          if (ejercicios.length > 0) routine.dias.push({ dia: si + 1, nombre: `Día ${si + 1} – ${sheetName}`, ejercicios });
        });
        if (routine.dias.length === 0) reject(new Error('No se encontraron ejercicios. Revisa las columnas.'));
        else resolve(routine);
      } catch (err: any) { reject(new Error('Error al leer el archivo: ' + err.message)); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function getEmbedUrl(url: string): string {
  if (!url) return '';
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|watch\?.+&v=))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  const tt = url.match(/video\/(\d+)/);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  return url;
}

function calcVolume(session: WorkoutSession): number {
  return session.exercises.reduce((t, ex) => t + ex.sets.reduce((s, w) => s + (parseFloat(w) || 0), 0), 0);
}

function calcStreak(sessions: WorkoutSession[]): number {
  const dates = [...new Set(sessions.map(s => new Date(s.date).toDateString()))]
    .map(d => new Date(d)).sort((a, b) => b.getTime() - a.getTime());
  if (!dates.length) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(dates[0]); last.setHours(0, 0, 0, 0);
  if (Math.floor((today.getTime() - last.getTime()) / 86400000) > 1) return 0;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const d1 = new Date(dates[i - 1]); d1.setHours(0, 0, 0, 0);
    const d2 = new Date(dates[i]); d2.setHours(0, 0, 0, 0);
    if (Math.floor((d1.getTime() - d2.getTime()) / 86400000) === 1) streak++;
    else break;
  }
  return streak;
}

function getExercisePR(sessions: WorkoutSession[], exerciseId: string): number {
  const ws = sessions.flatMap(s => { const ex = s.exercises.find(e => e.id === exerciseId); return ex ? ex.sets.map(w => parseFloat(w) || 0) : []; });
  return ws.length ? Math.max(...ws) : 0;
}

function getExerciseChart(sessions: WorkoutSession[], exerciseId: string) {
  return sessions.slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .flatMap(s => {
      const ex = s.exercises.find(e => e.id === exerciseId);
      if (!ex) return [];
      const max = Math.max(...ex.sets.map(w => parseFloat(w) || 0));
      return max > 0 ? [{ date: format(new Date(s.date), 'dd/MM'), weight: max }] : [];
    });
}

function lsGet<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function lsSet(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function vibrate(pattern: number | number[]) {
  try { if ('vibrate' in navigator) navigator.vibrate(pattern); } catch {}
}

// ─── SHARED UI ─────────────────────────────────────────────────────────────
function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [err, setErr] = useState(false);
  const sz = { sm: 'w-9 h-9', md: 'w-14 h-14', lg: 'w-20 h-20' }[size];
  const tx = { sm: 'text-sm', md: 'text-xl', lg: 'text-3xl' }[size];
  return (
    <div className={`${sz} rounded-full overflow-hidden flex-shrink-0`} style={{ border: '1px solid var(--border)' }}>
      {src && !err
        ? <img src={src} alt={name} className="w-full h-full object-cover" onError={() => setErr(true)} />
        : <div className={`w-full h-full flex items-center justify-center font-black ${tx}`} style={{ background: 'var(--surface2)', color: 'var(--ink-muted)' }}>{name[0].toUpperCase()}</div>}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[500] font-black text-[10px] tracking-widest uppercase px-5 py-3 rounded-full shadow-xl whitespace-nowrap"
      style={{ background: 'var(--accent)', color: '#fff' }}>
      {msg}
    </motion.div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={e => e.target === e.currentTarget && onClose?.()}>
      <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        className="w-full max-w-sm rounded-[2rem] p-7 shadow-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4" style={{ background: 'var(--bg)' }}>
      <Loader size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Cargando…</p>
    </div>
  );
}

const Footer = () => (
  <div className="w-full py-8 text-center space-y-1 opacity-40">
    <div className="h-px w-10 mx-auto mb-4" style={{ background: 'var(--border)' }} />
    <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--ink-muted)' }}>
      Desarrollada por <span style={{ color: 'var(--ink)' }}>Marcos Nieto</span>
    </p>
    <p className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--ink-dim)' }}>
      Propuestos por <span style={{ color: 'var(--ink-muted)' }}>Roberto Bosqued</span>
    </p>
  </div>
);

// ─── MAIN APP ──────────────────────────────────────────────────────────────
type AppView = 'login' | 'home' | 'workout' | 'history' | 'progress';

export default function App() {
  const isAdminRoute = window.location.pathname === '/admin';
  const [theme, setTheme] = useState<Theme>(() => lsGet('gym_theme', 'dark'));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    lsSet('gym_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  if (isAdminRoute) return <AdminPanel theme={theme} onToggleTheme={toggleTheme} />;
  return <UserApp theme={theme} onToggleTheme={toggleTheme} />;
}

// ─── USER APP ──────────────────────────────────────────────────────────────
function UserApp({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [view, setView] = useState<AppView>('login');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [routine, setRoutine] = useState<Routine>(ROUTINE_DATA);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [weights, setWeights] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 2500);
  }, []);

  const handleLogin = async (user: UserProfile) => {
    setLoading(true);
    try {
      const [r, s, w] = await Promise.all([
        fetchRoutine(user.id),
        fetchSessions(user.id),
        fetchWeights(user.id),
      ]);
      setRoutine(r || ROUTINE_DATA);
      setSessions(s);
      setWeights(w);
      setCurrentUser(user);
      setView('home');
    } catch { showToast('Error al cargar datos'); }
    setLoading(false);
  };

  const handleLogout = () => { setCurrentUser(null); setView('login'); setSessions([]); setWeights({}); setRoutine(ROUTINE_DATA); };

  const handleFinishWorkout = async (session: WorkoutSession) => {
    if (!currentUser) return;
    try {
      await insertSession(currentUser.id, session);
      setSessions(prev => [session, ...prev]);
      showToast('¡Entrenamiento guardado! 💪');
      setView('home');
    } catch { showToast('Error al guardar sesión'); }
  };

  const handleSaveWeight = async (exerciseId: string, setIndex: number, weight: string) => {
    if (!currentUser) return;
    const newSets = [...(weights[exerciseId] || [])];
    while (newSets.length <= setIndex) newSets.push('');
    newSets[setIndex] = weight;
    setWeights(prev => ({ ...prev, [exerciseId]: newSets }));
    try { await upsertWeight(currentUser.id, exerciseId, newSets); } catch {}
  };

  const handleDeleteSession = async (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    try { await dbDeleteSession(id); } catch {}
  };

  if (loading) return <div style={{ background: 'var(--bg)', minHeight: '100vh' }}><Spinner /></div>;

  return (
    <div className="min-h-screen flex flex-col items-center overflow-x-hidden" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="w-full max-w-md min-h-screen flex flex-col relative">
        <AnimatePresence mode="wait">
          {view === 'login' && <LoginView key="login" theme={theme} onToggleTheme={onToggleTheme} onLogin={handleLogin} />}
          {view === 'home' && currentUser && (
            <HomeView key="home" user={currentUser} sessions={sessions} routine={routine}
              theme={theme} onToggleTheme={onToggleTheme}
              onStartWorkout={() => setView('workout')} onNavigate={setView} onLogout={handleLogout} />
          )}
          {view === 'workout' && currentUser && (
            <WorkoutView key="workout" user={currentUser} sessions={sessions} routine={routine}
              weights={weights} onSaveWeight={handleSaveWeight} onFinish={handleFinishWorkout} onBack={() => setView('home')} />
          )}
          {view === 'history' && currentUser && (
            <HistoryView key="history" sessions={sessions} routine={routine} onBack={() => setView('home')} onDelete={handleDeleteSession} />
          )}
          {view === 'progress' && currentUser && (
            <ProgressView key="progress" sessions={sessions} user={currentUser} routine={routine} onBack={() => setView('home')} />
          )}
        </AnimatePresence>
        <AnimatePresence>{toast && <Toast msg={toast} />}</AnimatePresence>
      </div>
    </div>
  );
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────
function LoginView({ theme, onToggleTheme, onLogin }: {
  theme: Theme; onToggleTheme: () => void; onLogin: (u: UserProfile) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(''); setLoading(true);
    try {
      const user = await fetchProfileByUsername(username);
      if (!user) { setError('Usuario o contraseña incorrectos'); setLoading(false); return; }
      const ok = await verifyPassword(password, user.password);
      if (!ok) { setError('Usuario o contraseña incorrectos'); setLoading(false); return; }
      await onLogin(user);
    } catch { setError('Error de conexión. Inténtalo de nuevo.'); }
    setLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex justify-end p-6"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
      <div className="flex-1 flex flex-col justify-center px-8 pb-8">
        <div className="mb-14">
          <span className="text-[10px] font-black uppercase tracking-[0.4em] block mb-3" style={{ color: 'var(--accent)' }}>Performance Tracking</span>
          <h1 className="font-black italic uppercase leading-none tracking-tighter" style={{ fontSize: 'clamp(3.5rem,14vw,5rem)', color: 'var(--ink)' }}>
            Gym<br />Trainer<br /><span style={{ color: 'var(--accent)' }}>PRO</span>
          </h1>
          <div className="h-[3px] w-10 mt-5 rounded-full" style={{ background: 'var(--accent)' }} />
        </div>
        <div className="space-y-3">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-dim)' }}><User size={15} /></span>
            <input className="input pl-10" placeholder="Usuario" value={username}
              onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoCapitalize="none" autoComplete="username" />
          </div>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-dim)' }}><Lock size={15} /></span>
            <input className="input pl-10 pr-12" placeholder="Contraseña" type={showPw ? 'text' : 'password'}
              value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()} autoComplete="current-password" />
            <button onClick={() => setShowPw(p => !p)} className="absolute right-3.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {error && <p className="text-sm font-bold" style={{ color: 'var(--red)' }}>{error}</p>}
          <button onClick={handleSubmit} disabled={loading}
            className="btn-accent disabled:opacity-50" style={{ marginTop: '0.5rem' }}>
            {loading ? <><Loader size={14} className="animate-spin" /> Entrando…</> : <>Entrar <ArrowRight size={16} /></>}
          </button>
        </div>
      </div>
      <Footer />
    </motion.div>
  );
}

// ─── HOME ──────────────────────────────────────────────────────────────────
function HomeView({ user, sessions, routine, theme, onToggleTheme, onStartWorkout, onNavigate, onLogout }: {
  user: UserProfile; sessions: WorkoutSession[]; routine: Routine; theme: Theme;
  onToggleTheme: () => void; onStartWorkout: () => void; onNavigate: (v: AppView) => void; onLogout: () => void;
}) {
  const lastSession = sessions[0];
  const streak = calcStreak(sessions);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col p-6 pt-10">
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar name={user.name} src={user.avatarUrl} size="md" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 flex items-center justify-center"
              style={{ background: 'var(--success)', borderColor: 'var(--bg)' }}>
              <Check size={8} style={{ color: '#000', strokeWidth: 4 }} />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-black italic uppercase tracking-tight leading-none" style={{ color: 'var(--ink)' }}>{user.name}</h1>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] mt-0.5" style={{ color: 'var(--ink-muted)' }}>{routine.nombre}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button onClick={onLogout} className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {streak > 0 && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-5"
          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)' }}>
          <Flame size={18} style={{ color: 'var(--accent)' }} />
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Racha activa</p>
            <p className="text-sm font-black italic" style={{ color: 'var(--accent)' }}>{streak} día{streak !== 1 ? 's' : ''} seguidos</p>
          </div>
        </div>
      )}

      {/* Bento */}
      <div className="grid grid-cols-6 gap-2.5 mb-7">
        <div className="col-span-3 rounded-2xl p-4 flex flex-col justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '7rem' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}><Calendar size={14} /></div>
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Último</p>
            <p className="text-sm font-black italic" style={{ color: 'var(--ink)' }}>{lastSession ? format(new Date(lastSession.date), 'dd MMM', { locale: es }) : '--'}</p>
          </div>
        </div>
        <div className="col-span-3 rounded-2xl p-4 flex flex-col justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '7rem' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}><TrendingUp size={14} /></div>
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Sesiones</p>
            <p className="text-sm font-black italic" style={{ color: 'var(--ink)' }}>{sessions.length}</p>
          </div>
        </div>
        <button onClick={() => onNavigate('progress')} className="col-span-2 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all"
          style={{ background: 'var(--accent)', minHeight: '6rem' }}>
          <BarChart2 size={18} style={{ color: '#fff' }} />
          <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#fff' }}>Stats</span>
        </button>
        <button onClick={() => onNavigate('history')} className="col-span-2 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '6rem' }}>
          <History size={18} style={{ color: 'var(--ink-muted)' }} />
          <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Log</span>
        </button>
        {routine.sheetUrl ? (
          <a href={routine.sheetUrl} target="_blank" rel="noopener noreferrer"
            className="col-span-2 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all no-underline"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '6rem' }}>
            <Table size={18} style={{ color: 'var(--ink-muted)' }} />
            <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Sheet</span>
          </a>
        ) : (
          <div className="col-span-2 rounded-2xl p-4 flex flex-col items-center justify-center gap-1.5 opacity-20"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', minHeight: '6rem' }}>
            <Table size={18} style={{ color: 'var(--ink-muted)' }} />
            <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Sheet</span>
          </div>
        )}
      </div>

      {/* Days */}
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-4">
          <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--ink-dim)' }}>Entrenamientos</p>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>
        <div className="space-y-2.5">
          {routine.dias.map(day => (
            <button key={day.dia} onClick={onStartWorkout}
              className="w-full rounded-[1.5rem] p-4 text-left flex items-center justify-between group active:scale-[0.98] transition-all"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black italic text-lg"
                  style={{ background: 'var(--surface2)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>{day.dia}</div>
                <div>
                  <h3 className="text-base font-black italic tracking-tight" style={{ color: 'var(--ink)' }}>{day.nombre.split('–')[1]?.trim() || day.nombre}</h3>
                  <p className="text-[8px] font-bold uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>
                    {day.ejercicios.length} ejercicios · {day.ejercicios.reduce((a, e) => a + e.series, 0)} series
                  </p>
                </div>
              </div>
              <span style={{ color: 'var(--ink-dim)' }}>›</span>
            </button>
          ))}
        </div>
      </div>
      <Footer />
    </motion.div>
  );
}

// ─── WORKOUT ───────────────────────────────────────────────────────────────
function WorkoutView({ user, sessions, routine, weights, onSaveWeight, onFinish, onBack }: {
  user: UserProfile; sessions: WorkoutSession[]; routine: Routine;
  weights: Record<string, string[]>; onSaveWeight: (id: string, idx: number, w: string) => void;
  onFinish: (s: WorkoutSession) => void; onBack: () => void;
}) {
  const [dayIdx, setDayIdx] = useState(0);
  const [exIdx, setExIdx] = useState(0);
  const [currentSet, setCurrentSet] = useState(1);
  const [isResting, setIsResting] = useState(false);
  const [restTime, setRestTime] = useState(0);
  const [sessionData, setSessionData] = useState<Record<string, string[]>>(weights);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [showVideo, setShowVideo] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [showConfirmBack, setShowConfirmBack] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingAllSets, setEditingAllSets] = useState(false);
  const [totalRestSecs, setTotalRestSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const day = routine.dias[dayIdx];
  const exercise = day?.ejercicios[exIdx];
  const isLastEx = exIdx === (day?.ejercicios.length ?? 0) - 1;
  const isLastSet = currentSet === exercise?.series;

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startRest = (secs: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsResting(true); setRestTime(secs); setTotalRestSecs(secs);
    timerRef.current = setInterval(() => {
      setRestTime(p => {
        if (p <= 1) {
          clearInterval(timerRef.current!);
          setIsResting(false);
          try { if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]); } catch {}
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  };

  const skipRest = () => { if (timerRef.current) clearInterval(timerRef.current); setIsResting(false); setRestTime(0); };

  const saveWeight = (val: string, overrideIdx?: number) => {
    const idx = overrideIdx !== undefined ? overrideIdx : currentSet - 1;
    setSessionData(prev => {
      const sets = [...(prev[exercise.id] || Array(exercise.series).fill(''))];
      while (sets.length <= idx) sets.push('');
      sets[idx] = val;
      return { ...prev, [exercise.id]: sets };
    });
    onSaveWeight(exercise.id, idx, val);
  };

  const toggleComplete = (id: string) => setCompleted(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const handleNext = () => {
    if (!isLastSet) { startRest(exercise.descanso_segundos); setCurrentSet(p => p + 1); }
    else {
      const nc = new Set(completed); nc.add(exercise.id); setCompleted(nc);
      if (!isLastEx) { setExIdx(p => p + 1); setCurrentSet(1); startRest(exercise.descanso_segundos); }
      else { if (timerRef.current) clearInterval(timerRef.current); setShowFinish(true); }
    }
  };

  const confirmFinish = async () => {
    setSaving(true);
    const session: WorkoutSession = {
      id: crypto.randomUUID(), dayName: day.nombre, userName: user.id,
      date: new Date().toISOString(), note: note || undefined,
      exercises: day.ejercicios
        .filter(ex => completed.has(ex.id) || sessionData[ex.id]?.some(s => s !== ''))
        .map(ex => ({ id: ex.id, nombre: ex.nombre, sets: sessionData[ex.id] || [] }))
    };
    await onFinish(session);
    setSaving(false);
  };

  if (!day || !exercise) return null;

  const pr = getExercisePR(sessions, exercise.id);
  const curW = parseFloat((sessionData[exercise.id] || [])[currentSet - 1] || '');
  const isPR = curW > 0 && curW > pr;
  const prevWeights = weights[exercise.id] || [];
  const curSets = sessionData[exercise.id] || [];
  const rpe = exercise.intensidad_rpe[currentSet - 1] ?? exercise.intensidad_rpe[0];
  const circ = 2 * Math.PI * 45;
  const dashOffset = circ - (circ * restTime) / (totalRestSecs || exercise.descanso_segundos);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex-1 flex flex-col h-screen" style={{ background: 'var(--bg)' }}>

      <header className="px-4 pt-8 pb-3 sticky top-0 z-30 backdrop-blur-xl"
        style={{ background: theme => 'rgba(5,5,5,0.9)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => setShowConfirmBack(true)} className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
            <ChevronLeft size={16} />
          </button>
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>Entrenando</p>
            <h2 className="text-xs font-black uppercase italic truncate max-w-[160px]" style={{ color: 'var(--ink)' }}>
              {day.nombre.split('–')[1]?.trim() || day.nombre}
            </h2>
          </div>
          <button onClick={() => setShowFinish(true)} className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest"
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)', color: 'var(--accent)' }}>
            Terminar
          </button>
        </div>

        {routine.dias.length > 1 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto no-scrollbar">
            {routine.dias.map((d, i) => (
              <button key={d.dia} onClick={() => { setDayIdx(i); setExIdx(0); setCurrentSet(1); skipRest(); }}
                className="flex-shrink-0 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider"
                style={{ background: i === dayIdx ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${i === dayIdx ? 'var(--accent-mid)' : 'var(--border)'}`, color: i === dayIdx ? 'var(--accent)' : 'var(--ink-muted)' }}>
                {d.nombre.split('–')[1]?.trim() || `Día ${d.dia}`}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {day.ejercicios.map((ex, i) => (
            <button key={ex.id} onClick={() => { setExIdx(i); setCurrentSet(1); skipRest(); setEditingAllSets(false); }}
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center relative text-xs font-black italic"
              style={{ background: i === exIdx ? 'var(--accent)' : completed.has(ex.id) ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${i === exIdx ? 'var(--accent)' : completed.has(ex.id) ? 'var(--accent-mid)' : 'var(--border)'}`, color: i === exIdx ? '#fff' : completed.has(ex.id) ? 'var(--accent)' : 'var(--ink-muted)' }}>
              {i + 1}
              {completed.has(ex.id) && i !== exIdx && (
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 flex items-center justify-center"
                  style={{ background: 'var(--success)', borderColor: 'var(--bg)' }}>
                  <Check size={6} style={{ color: '#000', strokeWidth: 5 }} />
                </div>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 no-scrollbar pb-32">
        <AnimatePresence mode="wait">
          {isResting ? (
            <motion.div key="rest" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-10">
              <div className="relative w-48 h-48 flex items-center justify-center mb-8">
                <svg className="absolute inset-0 w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="50%" cy="50%" r="45%" strokeWidth="4" fill="transparent" style={{ stroke: 'var(--surface2)' }} />
                  <circle cx="50%" cy="50%" r="45%" strokeWidth="4" fill="transparent"
                    strokeDasharray={`${circ}px`} strokeDashoffset={`${dashOffset}px`}
                    style={{ stroke: 'var(--accent)', strokeLinecap: 'round', transition: 'stroke-dashoffset 1s linear' }} />
                </svg>
                <div className="text-center">
                  <p className="text-5xl font-black italic tabular-nums" style={{ color: 'var(--ink)' }}>
                    {Math.floor(restTime / 60)}:{String(restTime % 60).padStart(2, '0')}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] mt-1" style={{ color: 'var(--ink-muted)' }}>Descanso</p>
                </div>
              </div>
              <button onClick={skipRest} className="btn-secondary w-36 py-2.5">Saltar</button>
            </motion.div>
          ) : (
            <motion.div key="ex" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.3em] block mb-1" style={{ color: 'var(--accent)' }}>
                    Ejercicio {exIdx + 1} de {day.ejercicios.length}
                  </span>
                  <h3 className="text-3xl font-black italic tracking-tight leading-tight" style={{ color: 'var(--ink)' }}>{exercise.nombre}</h3>
                </div>
                <button onClick={() => toggleComplete(exercise.id)}
                  className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ background: completed.has(exercise.id) ? 'var(--success)' : 'var(--surface)', border: `1px solid ${completed.has(exercise.id) ? 'var(--success)' : 'var(--border)'}`, color: completed.has(exercise.id) ? '#000' : 'var(--ink-dim)' }}>
                  <Check size={20} style={{ strokeWidth: completed.has(exercise.id) ? 4 : 2 }} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Serie', val: <>{currentSet}<span style={{ color: 'var(--ink-dim)', fontSize: '0.7rem' }}>/{exercise.series}</span></> },
                  { label: 'Reps', val: exercise.repeticiones },
                  { label: 'RPE', val: <span style={{ color: 'var(--accent)' }}>@{rpe}</span> },
                ].map(({ label, val }) => (
                  <div key={label} className="rounded-xl p-3 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: 'var(--ink-muted)' }}>{label}</p>
                    <p className="text-xl font-black italic" style={{ color: 'var(--ink)' }}>{val}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--ink-muted)' }}>Registrar Carga</p>
                  {isPR
                    ? <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-wider px-2 py-1 rounded-lg" style={{ background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308' }}>
                        <Star size={9} style={{ fill: '#eab308' }} /> Nuevo PR
                      </span>
                    : pr > 0 ? <span className="text-[9px] font-black" style={{ color: 'var(--ink-dim)' }}>PR: {pr}kg</span> : null}
                </div>
                {/* Botón editar series pasadas */}
                <div className="flex items-center justify-between mb-1">
                  <span />
                  <button onClick={() => setEditingAllSets(p => !p)}
                    className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg"
                    style={{ background: editingAllSets ? 'var(--accent-dim)' : 'var(--surface2)', border: `1px solid ${editingAllSets ? 'var(--accent-mid)' : 'var(--border)'}`, color: editingAllSets ? 'var(--accent)' : 'var(--ink-muted)', cursor: 'pointer' }}>
                    <Edit2 size={9} /> Editar series
                  </button>
                </div>
                <WeightInput exerciseId={exercise.id} setIndex={currentSet - 1}
                  value={curSets[currentSet - 1] || ''} onSave={v => saveWeight(v)} />

                {/* Panel inline para corregir cualquier serie */}
                {editingAllSets && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl p-3 space-y-2 mt-1"
                    style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--ink-muted)' }}>
                      Editar todas las series
                    </p>
                    {Array.from({ length: exercise.series }).map((_, si) => (
                      <div key={si} className="flex items-center gap-2">
                        <span className="text-[9px] font-black w-14 flex-shrink-0"
                          style={{ color: si === currentSet - 1 ? 'var(--accent)' : 'var(--ink-dim)' }}>
                          Serie {si + 1}{si === currentSet - 1 ? ' ●' : ''}
                        </span>
                        <div className="relative flex-1">
                          <input type="number" step="0.5" inputMode="decimal"
                            defaultValue={curSets[si] || ''}
                            onBlur={e => saveWeight(e.target.value, si)}
                            className="w-full rounded-lg px-3 py-2 text-sm font-black outline-none"
                            style={{ background: 'var(--surface)', border: `1px solid ${si === currentSet - 1 ? 'var(--accent-mid)' : 'var(--border)'}`, color: 'var(--ink)' }}
                            placeholder="0.0" />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] font-black" style={{ color: 'var(--ink-dim)' }}>kg</span>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}

                {prevWeights.some(w => w) && (
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'var(--ink-dim)' }}>Cargas anteriores</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {prevWeights.map((w, i) => (
                        <div key={i} className="px-2 py-1 rounded-lg text-[10px] font-black text-center min-w-[2.5rem]"
                          style={{ background: i === currentSet - 1 ? 'var(--accent-dim)' : 'var(--surface2)', border: `1px solid ${i === currentSet - 1 ? 'var(--accent-mid)' : 'var(--border)'}`, color: i === currentSet - 1 ? 'var(--accent)' : 'var(--ink-muted)' }}>
                          {w || '--'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--ink-muted)' }}>
                  <Info size={11} /><span className="text-[9px] font-black uppercase tracking-widest">Observaciones</span>
                </div>
                <p className="text-xs leading-relaxed italic" style={{ color: 'var(--ink-muted)' }}>"{exercise.observaciones}"</p>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setShowVideo(true)} className="flex-1 py-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.15em] rounded-xl"
                  style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer' }}>
                  <Video size={13} /> Ver Técnica
                </button>
                <button onClick={() => setShowNote(true)} className="flex-1 py-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.15em] rounded-xl"
                  style={{ border: `1px solid ${note ? 'var(--accent-mid)' : 'var(--border)'}`, background: note ? 'var(--accent-dim)' : 'transparent', color: note ? 'var(--accent)' : 'var(--ink-muted)', cursor: 'pointer' }}>
                  <StickyNote size={13} /> {note ? 'Nota ✓' : 'Nota'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isResting && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 pt-8 z-40"
          style={{ background: 'linear-gradient(to top, var(--bg) 60%, transparent)' }}>
          <button onClick={handleNext} className="btn-accent py-4 text-sm">
            {isLastSet && isLastEx ? 'Finalizar Entrenamiento' : isLastSet ? 'Siguiente Ejercicio' : `Completar Serie ${currentSet}`}
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      <AnimatePresence>
        {showFinish && (
          <Modal onClose={() => !saving && setShowFinish(false)}>
            <h3 className="text-xl font-black italic mb-1" style={{ color: 'var(--ink)' }}>¿Finalizar sesión?</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
              Se guardará en tu perfil — <span style={{ color: 'var(--accent)' }}>{user.name}</span>
            </p>
            <button onClick={confirmFinish} disabled={saving} className="btn-accent mb-3 disabled:opacity-50">
              {saving ? <><Loader size={14} className="animate-spin" /> Guardando…</> : <>Guardar <Check size={15} /></>}
            </button>
            <button onClick={() => setShowFinish(false)} disabled={saving} className="btn-secondary">Continuar entrenando</button>
          </Modal>
        )}
        {showConfirmBack && (
          <Modal onClose={() => setShowConfirmBack(false)}>
            <h3 className="text-xl font-black italic mb-2" style={{ color: 'var(--ink)' }}>¿Salir del entrenamiento?</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>Perderás el progreso no guardado.</p>
            <button onClick={() => { if (timerRef.current) clearInterval(timerRef.current); onBack(); }}
              className="py-4 w-full rounded-xl font-black text-xs uppercase tracking-widest mb-3 cursor-pointer"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)' }}>
              Sí, salir
            </button>
            <button onClick={() => setShowConfirmBack(false)} className="btn-secondary">Continuar</button>
          </Modal>
        )}
        {showNote && (
          <Modal onClose={() => setShowNote(false)}>
            <h3 className="text-xl font-black italic mb-4" style={{ color: 'var(--ink)' }}>Nota de sesión</h3>
            <textarea rows={4} defaultValue={note} id="noteTA"
              placeholder="Ej: Me noté cargado, nuevo PR…"
              className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            <button onClick={() => { const el = document.getElementById('noteTA') as HTMLTextAreaElement; setNote(el?.value || ''); setShowNote(false); }}
              className="btn-accent mt-4">Guardar</button>
          </Modal>
        )}
      </AnimatePresence>

      {showVideo && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.97)' }}>
          <button onClick={() => setShowVideo(false)} className="absolute top-10 right-6 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
          <div className="w-full max-w-sm aspect-[9/16] rounded-[2rem] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <iframe src={getEmbedUrl(exercise.video)} className="w-full h-full" frameBorder="0" allowFullScreen />
          </div>
        </div>
      )}
    </motion.div>
  );
}

function WeightInput({ exerciseId, setIndex, value, onSave }: { exerciseId: string; setIndex: number; value: string; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex gap-2.5 w-full items-center">
      <div className="relative flex-1">
        <input type="number" step="0.5" inputMode="decimal" value={local}
          onChange={e => setLocal(e.target.value)} onBlur={() => onSave(local)}
          className="w-full rounded-xl px-4 py-3 text-2xl font-black outline-none transition-all placeholder:opacity-20"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          placeholder="0.0" />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>kg</span>
      </div>
      <button onClick={() => onSave(local)} className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
        style={{ background: local && local === value ? 'var(--success)' : 'var(--surface2)', border: `1px solid ${local && local === value ? 'var(--success)' : 'var(--border)'}`, color: local && local === value ? '#000' : 'var(--ink-dim)', cursor: 'pointer' }}>
        <Check size={17} style={{ strokeWidth: local && local === value ? 4 : 2 }} />
      </button>
    </div>
  );
}

// ─── HISTORY ───────────────────────────────────────────────────────────────
function HistoryView({ sessions, routine, onBack, onDelete }: {
  sessions: WorkoutSession[]; routine: Routine; onBack: () => void; onDelete: (id: string) => void;
}) {
  const [filterDay, setFilterDay] = useState<string>('all');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const dayNames = Array.from(new Set(sessions.map(s => s.dayName)));
  const visible = filterDay === 'all' ? sessions : sessions.filter(s => s.dayName === filterDay);

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="flex-1 flex flex-col p-6 pt-10">
      <header className="flex items-center gap-4 mb-4">
        <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)', cursor: 'pointer' }}>
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-3xl font-black italic uppercase tracking-tight" style={{ color: 'var(--ink)' }}>Historial</h2>
        <span className="ml-auto text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>
          {visible.length} sesión{visible.length !== 1 ? 'es' : ''}
        </span>
      </header>

      {/* Filtro por día */}
      {dayNames.length > 1 && (
        <div className="flex gap-1.5 mb-5 overflow-x-auto no-scrollbar pb-1">
          <button onClick={() => setFilterDay('all')}
            className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider"
            style={{ background: filterDay === 'all' ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${filterDay === 'all' ? 'var(--accent)' : 'var(--border)'}`, color: filterDay === 'all' ? '#fff' : 'var(--ink-muted)' }}>
            <Filter size={9} /> Todos
          </button>
          {dayNames.map(d => (
            <button key={d} onClick={() => setFilterDay(d)}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider"
              style={{ background: filterDay === d ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${filterDay === d ? 'var(--accent)' : 'var(--border)'}`, color: filterDay === d ? '#fff' : 'var(--ink-muted)' }}>
              {d.split('–')[1]?.trim() || d}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-5 flex-1 overflow-y-auto no-scrollbar pb-10">
        {visible.length === 0
          ? <div className="flex flex-col items-center justify-center py-24" style={{ color: 'var(--ink-dim)' }}>
              <History size={56} className="mb-5 opacity-20" />
              <p className="text-[10px] font-black uppercase tracking-[0.3em]">Sin registros aún</p>
            </div>
          : visible.map(s => (
            <div key={s.id} className="card-xl overflow-hidden">
              <div className="p-5 flex justify-between items-start" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>
                    {format(new Date(s.date), 'dd MMMM yyyy', { locale: es })}
                  </p>
                  <h3 className="text-lg font-black italic tracking-tight" style={{ color: 'var(--ink)' }}>{s.dayName}</h3>
                  {s.note && <p className="text-xs mt-1 italic" style={{ color: 'var(--ink-muted)' }}>"{s.note}"</p>}
                  <p className="text-[9px] font-black uppercase tracking-widest mt-1" style={{ color: 'var(--ink-dim)' }}>
                    Vol: <span style={{ color: 'var(--ink-muted)' }}>{calcVolume(s).toFixed(0)} kg</span>
                  </p>
                </div>
                {/* Confirmación en 2 pasos antes de borrar */}
                {pendingDelete === s.id ? (
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button onClick={() => { onDelete(s.id); setPendingDelete(null); }}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider cursor-pointer"
                      style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)' }}>
                      Borrar
                    </button>
                    <button onClick={() => setPendingDelete(null)}
                      className="px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider cursor-pointer"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setPendingDelete(s.id)} className="p-2 transition-colors flex-shrink-0"
                    style={{ color: 'var(--ink-dim)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseOver={e => e.currentTarget.style.color = 'var(--red)'}
                    onMouseOut={e => e.currentTarget.style.color = 'var(--ink-dim)'}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="p-5 space-y-3">
                {s.exercises.map((ex, i) => (
                  <div key={i} className="flex justify-between items-center gap-3">
                    <p className="text-sm italic flex-1 min-w-0 truncate" style={{ color: 'var(--ink-muted)' }}>{ex.nombre}</p>
                    <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {ex.sets.map((w, j) => (
                        <span key={j} className="chip">{w || '--'}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
      <Footer />
    </motion.div>
  );
}

// ─── PROGRESS ──────────────────────────────────────────────────────────────
function ProgressView({ sessions, user, routine, onBack }: { sessions: WorkoutSession[]; user: UserProfile; routine: Routine; onBack: () => void }) {
  const allEx = routine.dias.flatMap(d => d.ejercicios);
  const [selEx, setSelEx] = useState(allEx[0]?.id || '');
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const sorted = [...sessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const streak = calcStreak(sessions);
  const totalVol = sessions.reduce((t, s) => t + calcVolume(s), 0);
  const overallChart = sorted.map(s => ({ date: format(new Date(s.date), 'dd/MM'), weight: Math.max(0, ...s.exercises.flatMap(e => e.sets.map(w => parseFloat(w) || 0))) })).filter(d => d.weight > 0);
  const exChart = getExerciseChart(sessions, selEx);
  const exPR = getExercisePR(sessions, selEx);
  const bestOverall = overallChart.length ? Math.max(...overallChart.map(d => d.weight)) : 0;
  const tooltipStyle = { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px' };

  const loadAITip = async () => {
    setAiLoading(true);
    const summary = { nombre: user.name, sesiones: sessions.length, racha: streak, rutina: routine.nombre, mejoresPesos: allEx.map(ex => { const pr = getExercisePR(sessions, ex.id); return pr > 0 ? `${ex.nombre}: ${pr}kg` : null; }).filter(Boolean).slice(0, 6) };
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: `Eres un coach de fitness experto. Da UN consejo motivador y específico en español (máx 80 palabras) basado en los datos. Habla directamente usando "tú". Sin asteriscos ni markdown.\n\nDatos: ${JSON.stringify(summary)}` }] }) });
      const data = await resp.json();
      setAiTip(data.content?.[0]?.text || 'Sigue con consistencia. ¡Cada sesión cuenta!');
    } catch { setAiTip('Sigue entrenando con consistencia. ¡Cada sesión te acerca más a tus objetivos!'); }
    setAiLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="flex-1 flex flex-col p-6 pt-10">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)', cursor: 'pointer' }}>
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-3xl font-black italic uppercase tracking-tight" style={{ color: 'var(--ink)' }}>Progreso</h2>
      </header>
      <div className="space-y-5 flex-1 overflow-y-auto no-scrollbar pb-10">
        <div className="grid grid-cols-2 gap-3">
          {[{ label: 'Sesiones', val: sessions.length, unit: '', col: 'var(--ink)' }, { label: 'Mejor carga', val: bestOverall, unit: 'kg', col: 'var(--accent)' }, { label: 'Volumen total', val: Math.round(totalVol).toLocaleString('es'), unit: 'kg', col: 'var(--ink)' }, { label: 'Racha', val: streak, unit: ` día${streak !== 1 ? 's' : ''}`, col: streak > 0 ? 'var(--accent)' : 'var(--ink)' }].map(s => (
            <div key={s.label} className="card rounded-2xl p-4">
              <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--ink-muted)' }}>{s.label}</p>
              <p className="text-2xl font-black italic" style={{ color: s.col }}>{s.val}<span className="text-base font-bold" style={{ color: 'var(--ink-dim)' }}>{s.unit}</span></p>
            </div>
          ))}
        </div>

        <div className="card-xl p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] mb-5" style={{ color: 'var(--ink-muted)' }}>Carga máxima por sesión</p>
          <div style={{ height: '13rem' }}>
            {overallChart.length >= 2
              ? <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overallChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dx={-10} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--accent)', fontWeight: 'bold' }} />
                    <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={3} dot={{ fill: 'var(--accent)', r: 4, strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              : <div className="h-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>Necesitas al menos 2 sesiones</div>}
          </div>
        </div>

        <div className="card-xl p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] mb-4" style={{ color: 'var(--ink-muted)' }}>Progreso por ejercicio</p>
          <select value={selEx} onChange={e => setSelEx(e.target.value)} className="w-full rounded-xl px-4 py-3 text-sm font-bold outline-none mb-4 cursor-pointer"
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            {routine.dias.map(d => <optgroup key={d.dia} label={d.nombre}>{d.ejercicios.map(ex => <option key={ex.id} value={ex.id}>{ex.nombre}</option>)}</optgroup>)}
          </select>
          {exPR > 0 && <div className="flex justify-between mb-3"><span className="text-[9px] font-black" style={{ color: 'var(--ink-muted)' }}>PR: <span style={{ color: 'var(--accent)' }}>{exPR}kg</span></span><span className="text-[9px] font-black" style={{ color: 'var(--ink-dim)' }}>{exChart.length} registros</span></div>}
          <div style={{ height: '13rem' }}>
            {exChart.length >= 2
              ? <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={exChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="var(--ink-dim)" fontSize={10} tickLine={false} axisLine={false} dx={-10} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--accent)', fontWeight: 'bold' }} />
                    <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={3} dot={{ fill: 'var(--accent)', r: 4, strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              : <div className="h-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>Sin datos suficientes</div>}
          </div>
        </div>

        <div className="card-xl p-6" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black" style={{ background: 'var(--accent)', color: '#fff' }}>
              <RefreshCw size={13} className={aiLoading ? 'animate-spin' : ''} />
            </div>
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'var(--accent)' }}>AI Coach</span>
            <button onClick={loadAITip} disabled={aiLoading} className="ml-auto text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}>
              {aiLoading ? 'Cargando…' : '↻ Actualizar'}
            </button>
          </div>
          <p className="text-sm leading-relaxed italic" style={{ color: 'var(--ink-muted)' }}>"{aiTip || `Llevas ${sessions.length} sesiones. Pulsa "Actualizar" para un consejo personalizado.`}"</p>
        </div>
      </div>
      <Footer />
    </motion.div>
  );
}


// ─── ADMIN PANEL ───────────────────────────────────────────────────────────
type AdminSubview = 'dashboard' | 'upload' | 'profiles' | 'backup';

function AdminPanel({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [subview, setSubview] = useState<AdminSubview>('dashboard');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [routines, setRoutines] = useState<Record<string, Routine | null>>({});
  const [allSessions, setAllSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadedRoutine, setUploadedRoutine] = useState<Routine | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState<Record<number,boolean>>({});
  const [sheetUrl, setSheetUrl] = useState('');
  const [editRoutine, setEditRoutine] = useState<Routine | null>(null);
  const [editRoutineUid, setEditRoutineUid] = useState<string | null>(null);
  const [assignAll, setAssignAll] = useState(false);
  const [addForm, setAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newImg, setNewImg] = useState('');
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editPw, setEditPw] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  const loadData = async () => {
    setLoading(true);
    try {
      const [profiles, sessions] = await Promise.all([fetchProfiles(), fetchAllSessions()]);
      setUsers(profiles);
      setAllSessions(sessions);
      const rMap: Record<string, Routine | null> = {};
      await Promise.all(profiles.map(async p => { rMap[p.id] = await fetchRoutine(p.id); }));
      setRoutines(rMap);
    } catch (e: any) { showToast('Error al cargar: ' + e.message); }
    setLoading(false);
  };

  const submitLogin = async () => {
    const ok = await verifyPassword(pw, ADMIN_PASSWORD).catch(() => pw === ADMIN_PASSWORD);
    if (ok) { setAuthed(true); setPwErr(false); loadData(); }
    else { setPwErr(true); setTimeout(() => setPwErr(false), 800); }
  };

  const handleFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) { setUploadError('Solo se admiten archivos .xlsx'); return; }
    setUploadError(null); setUploadedRoutine(null); setUploadLoading(true);
    try { setUploadedRoutine(await parseExcelToRoutine(file)); setPreviewOpen({}); }
    catch (err: any) { setUploadError(err.message); }
    setUploadLoading(false);
  };

  const routineToSave = () =>
    sheetUrl.trim() ? { ...uploadedRoutine!, sheetUrl: sheetUrl.trim() } : uploadedRoutine!;

  const assignRoutine = async (userId: string) => {
    if (!uploadedRoutine) return;
    try {
      const r = routineToSave();
      await upsertRoutine(userId, r);
      setRoutines(prev => ({ ...prev, [userId]: r }));
      showToast(`Rutina asignada a ${users.find(u => u.id === userId)?.name || userId} ✓`);
    } catch (e: any) { showToast('Error al asignar: ' + e.message); }
  };

  const assignRoutineToAll = async () => {
    if (!uploadedRoutine) return;
    const r = routineToSave();
    let ok = 0;
    for (const u of users) {
      try { await upsertRoutine(u.id, r); setRoutines(prev => ({ ...prev, [u.id]: r })); ok++; } catch {}
    }
    showToast(`Rutina asignada a ${ok} usuarios ✓`);
    setUploadedRoutine(null); setSheetUrl(''); setAssignAll(false);
    if (fileRef.current) fileRef.current.value = '';
    setSubview('dashboard');
  };

  const openEditRoutine = (uid: string) => {
    const r = routines[uid] || ROUTINE_DATA;
    setEditRoutine(JSON.parse(JSON.stringify(r)));
    setEditRoutineUid(uid);
  };

  const saveEditRoutine = async () => {
    if (!editRoutine || !editRoutineUid) return;
    try {
      await upsertRoutine(editRoutineUid, editRoutine);
      setRoutines(prev => ({ ...prev, [editRoutineUid!]: editRoutine }));
      showToast('Rutina actualizada ✓');
      setEditRoutine(null); setEditRoutineUid(null);
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const patchExercise = (di: number, ei: number, field: keyof Exercise, val: any) => {
    if (!editRoutine) return;
    const r = JSON.parse(JSON.stringify(editRoutine)) as Routine;
    (r.dias[di].ejercicios[ei] as any)[field] = val;
    setEditRoutine(r);
  };

  const getUserStats = (uid: string) => {
    const us = allSessions.filter(s => s.userName === uid);
    const streak = calcStreak(us);
    const vol = Math.round(us.reduce((t, s) => t + calcVolume(s), 0));
    const last = us[0] ?? null;
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = us.filter(s => new Date(s.date) >= startMonth).length;
    const daysSince = last ? Math.floor((now.getTime() - new Date(last.date).getTime()) / 86400000) : null;
    return { total: us.length, streak, vol, last, thisMonth, daysSince };
  };

  const resetRoutine = async (userId: string) => {
    if (!confirm('¿Eliminar la rutina personalizada y volver a la por defecto?')) return;
    try {
      await deleteRoutine(userId);
      setRoutines(prev => ({ ...prev, [userId]: null }));
      showToast('Rutina eliminada — usando rutina por defecto');
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const addUser = async () => {
    if (!newName.trim() || !newUsername.trim() || !newPassword.trim()) { showToast('Rellena nombre, usuario y contraseña'); return; }
    if (users.find(u => u.username.toLowerCase() === newUsername.toLowerCase().trim())) { showToast('Ese nombre de usuario ya existe'); return; }
    try {
      const created = await createProfile({ name: newName.trim(), username: newUsername.trim().toLowerCase(), password: newPassword, avatarUrl: newImg.trim() || undefined });
      setUsers(prev => [...prev, created]);
      setRoutines(prev => ({ ...prev, [created.id]: null }));
      setNewName(''); setNewUsername(''); setNewPassword(''); setNewImg(''); setAddForm(false);
      showToast(`Usuario "${newName}" creado ✓`);
    } catch (e: any) { showToast('Error al crear: ' + e.message); }
  };

  const removeUser = async (id: string) => {
    const u = users.find(x => x.id === id);
    if (!confirm(`¿Eliminar a "${u?.name}"? Se borrarán todos sus datos.`)) return;
    try {
      await deleteProfile(id);
      setUsers(prev => prev.filter(u => u.id !== id));
      setRoutines(prev => { const n = { ...prev }; delete n[id]; return n; });
      showToast('Usuario eliminado');
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const saveEditUser = async () => {
    if (!editUser) return;
    const updated = { ...editUser, username: editUser.username.toLowerCase().trim(), ...(editPw ? { password: editPw } : {}) };
    try {
      await updateProfile(updated);
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      setEditUser(null); setEditPw('');
      showToast('Usuario actualizado ✓');
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const exportBackup = async () => {
    setBackupLoading(true);
    try {
      const backup = await fetchFullBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `gymtrainer-backup-${format(new Date(), 'yyyy-MM-dd')}.json`; a.click();
      URL.revokeObjectURL(url);
      showToast('Backup completo exportado ✓');
    } catch (e: any) { showToast('Error al exportar: ' + e.message); }
    setBackupLoading(false);
  };

  const importBackup = async (file: File) => {
    if (!confirm('¿Importar backup? Esto reemplazará todos los datos actuales.')) return;
    setImportLoading(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      await restoreFullBackup(backup);
      showToast('Backup importado correctamente ✓');
      loadData();
    } catch (e: any) { showToast('Error al importar: ' + e.message); }
    setImportLoading(false);
  };

  if (!authed) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8" style={{ background: 'var(--bg)' }}>
      <div className="absolute top-6 right-6"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}><Shield size={16} /></div>
          <div>
            <h2 className="text-xl font-black italic uppercase" style={{ color: 'var(--ink)' }}>Panel Admin</h2>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Acceso restringido</p>
          </div>
        </div>
        <input autoFocus type="password" value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitLogin()} placeholder="Contraseña de administrador"
          className="input mb-3" style={{ borderColor: pwErr ? 'var(--red)' : undefined }} />
        <button onClick={submitLogin} className="w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest text-white cursor-pointer"
          style={{ background: '#7c3aed', border: 'none' }}>Entrar</button>
      </div>
      <AnimatePresence>{toast && <Toast msg={toast} />}</AnimatePresence>
    </div>
  );

  if (loading) return <div style={{ background: 'var(--bg)', minHeight: '100vh' }}><Spinner /></div>;

  const subviews: { key: AdminSubview; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'upload', label: 'Rutinas' },
    { key: 'profiles', label: 'Usuarios' },
    { key: 'backup', label: 'Backup' },
  ];

  return (
    <div className="flex-1 flex flex-col p-6 pt-10" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black italic uppercase tracking-tight" style={{ color: 'var(--ink)' }}>Admin</h2>
          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}>Panel de control</span>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      <div className="flex gap-1 rounded-xl p-1 mb-6" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
        {subviews.map(({ key, label }) => (
          <button key={key} onClick={() => setSubview(key)}
            className="flex-1 py-2 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all cursor-pointer"
            style={{ background: subview === key ? 'var(--surface)' : 'transparent', border: subview === key ? '1px solid var(--border)' : '1px solid transparent', color: subview === key ? 'var(--ink)' : 'var(--ink-muted)' }}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10 space-y-4">

        {subview === 'dashboard' && (
          users.length === 0
            ? <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--ink-dim)' }}>
                <User size={48} className="mb-4 opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest">Sin usuarios. Ve a Usuarios.</p>
              </div>
            : <>
                {/* ── Resumen global ── */}
                <div className="grid grid-cols-3 gap-2 mb-1">
                  {[
                    { icon: <Users size={14} />, val: users.length, label: 'Alumnos' },
                    { icon: <Activity size={14} />, val: allSessions.length, label: 'Sesiones' },
                    { icon: <TrendingUp size={14} />, val: `${Math.round(allSessions.reduce((t,s)=>t+calcVolume(s),0)/1000)}k`, label: 'kg Vol.' },
                  ].map(({ icon, val, label }) => (
                    <div key={label} className="rounded-2xl p-3 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div className="flex justify-center mb-1" style={{ color: '#a78bfa' }}>{icon}</div>
                      <p className="text-lg font-black italic" style={{ color: 'var(--ink)' }}>{val}</p>
                      <p className="text-[7px] font-black uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>{label}</p>
                    </div>
                  ))}
                </div>

                {users.map(u => {
                  const routine = routines[u.id];
                  const hasCustom = !!routine;
                  const display = routine || ROUTINE_DATA;
                  const st = getUserStats(u.id);
                  const inactive = st.daysSince !== null && st.daysSince > 7;
                  return (
                    <div key={u.id} className="card-xl overflow-hidden">
                      {/* Cabecera usuario */}
                      <div className="p-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                        <div className="relative">
                          <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                          {inactive && <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--red)', border: '1.5px solid var(--bg)' }} title="Más de 7 días sin entrenar" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-black" style={{ color: 'var(--ink)' }}>{u.name}</h3>
                            <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{ background: hasCustom ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${hasCustom ? 'var(--accent-mid)' : 'var(--border)'}`, color: hasCustom ? 'var(--accent)' : 'var(--ink-muted)' }}>
                              {hasCustom ? 'Rutina propia' : 'Por defecto'}
                            </span>
                          </div>
                          <p className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>@{u.username} · {display.nombre}</p>
                        </div>
                      </div>

                      {/* Stats del alumno */}
                      <div className="grid grid-cols-4 border-b" style={{ borderColor: 'var(--border)' }}>
                        {[
                          { label: 'Sesiones', val: st.total },
                          { label: 'Este mes', val: st.thisMonth },
                          { label: 'Racha', val: st.streak ? `${st.streak}d` : '—' },
                          { label: 'Última', val: st.daysSince === null ? '—' : st.daysSince === 0 ? 'Hoy' : `Hace ${st.daysSince}d` },
                        ].map(({ label, val }, i) => (
                          <div key={label} className="py-3 text-center" style={{ borderRight: i < 3 ? `1px solid var(--border)` : 'none' }}>
                            <p className="text-xs font-black italic" style={{ color: inactive && label === 'Última' ? 'var(--red)' : 'var(--ink)' }}>{val}</p>
                            <p className="text-[7px] font-black uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>{label}</p>
                          </div>
                        ))}
                      </div>
                      <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.08)' }}>
                        <span className="text-[9px] font-black" style={{ color: 'var(--ink-dim)' }}>
                          Vol. total: <span style={{ color: 'var(--ink-muted)' }}>{st.vol.toLocaleString('es')} kg</span>
                          {st.last && <span className="ml-3">Última sesión: <span style={{ color: 'var(--ink-muted)' }}>{format(new Date(st.last.date), 'dd MMM', { locale: es })}</span></span>}
                        </span>
                      </div>

                      {/* Acciones */}
                      <div className="px-4 py-3 flex gap-2">
                        <button onClick={() => { setSubview('upload'); setUploadedRoutine(null); setUploadError(null); }}
                          className="flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest rounded-xl cursor-pointer"
                          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)', color: 'var(--accent)' }}>
                          {hasCustom ? 'Cambiar' : 'Asignar rutina'}
                        </button>
                        {hasCustom && (
                          <button onClick={() => openEditRoutine(u.id)}
                            className="flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest rounded-xl cursor-pointer"
                            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>
                            <Edit2 size={10} className="inline mr-1" />Editar
                          </button>
                        )}
                        {hasCustom && (
                          <button onClick={() => resetRoutine(u.id)}
                            className="py-2.5 px-3 rounded-xl cursor-pointer"
                            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--ink-dim)' }}
                            onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.color = 'var(--red)'; }}
                            onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--ink-dim)'; }}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
        )}

        {subview === 'upload' && <>
          <div>
            <h3 className="font-black mb-1" style={{ color: 'var(--ink)' }}>Subir Excel de Rutina</h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Cada hoja del Excel es un día. Columnas: <span style={{ color: 'var(--ink)' }}>Ejercicio, Series, Repeticiones, RPE, Descanso (seg), Video, Observaciones</span>. Cada usuario tiene su propia rutina independiente.
            </p>
          </div>

          <div ref={dropRef} onClick={() => fileRef.current?.click()}
            className="rounded-[1.5rem] p-10 text-center cursor-pointer transition-all"
            style={{ border: '2px dashed var(--border)' }}
            onDragOver={e => { e.preventDefault(); if (dropRef.current) { dropRef.current.style.borderColor = 'var(--accent)'; dropRef.current.style.background = 'var(--accent-dim)'; }}}
            onDragLeave={() => { if (dropRef.current) { dropRef.current.style.borderColor = 'var(--border)'; dropRef.current.style.background = ''; }}}
            onDrop={e => { e.preventDefault(); if (dropRef.current) { dropRef.current.style.borderColor = 'var(--border)'; dropRef.current.style.background = ''; } const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
            {uploadLoading
              ? <Loader size={26} className="animate-spin mx-auto mb-3" style={{ color: 'var(--accent)' }} />
              : <Upload size={26} style={{ color: 'var(--accent)', margin: '0 auto 0.75rem' }} />}
            <p className="font-black mb-1" style={{ color: 'var(--ink)' }}>{uploadLoading ? 'Procesando…' : 'Arrastra tu Excel aquí'}</p>
            {!uploadLoading && <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>o haz click · .xlsx</p>}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

          {uploadError && (
            <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)' }}>
              ⚠ {uploadError}
            </div>
          )}

          {uploadedRoutine && <>
            {/* ── Acordeón preview ── */}
            <div className="card-xl overflow-hidden" style={{ border: '1px solid var(--accent-mid)' }}>
              <div className="p-4 flex items-center gap-3" style={{ background: 'var(--accent-dim)' }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}><Check size={12} style={{ strokeWidth: 4 }} /></div>
                <span className="font-black text-sm flex-1" style={{ color: 'var(--accent)' }}>{uploadedRoutine.nombre}</span>
                <span className="text-[9px] font-black" style={{ color: 'var(--ink-muted)' }}>
                  {uploadedRoutine.dias.length} días · {uploadedRoutine.dias.reduce((t, d) => t + d.ejercicios.length, 0)} ej.
                </span>
              </div>
              {uploadedRoutine.dias.map((d, di) => (
                <div key={d.dia} style={{ borderTop: '1px solid var(--border)' }}>
                  <button className="w-full px-4 py-3 flex items-center justify-between text-left cursor-pointer"
                    style={{ background: 'none', border: 'none' }}
                    onClick={() => setPreviewOpen(p => ({ ...p, [di]: !p[di] }))}>
                    <span className="font-black text-sm" style={{ color: 'var(--ink)' }}>{d.nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>{d.ejercicios.length} ejercicios</span>
                      {previewOpen[di] ? <ChevronUp size={14} style={{ color: 'var(--ink-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--ink-muted)' }} />}
                    </div>
                  </button>
                  {previewOpen[di] && (
                    <div className="px-4 pb-3 space-y-1">
                      {d.ejercicios.map((ex, ei) => (
                        <div key={ei} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                          style={{ background: 'rgba(0,0,0,0.12)' }}>
                          <span className="text-xs font-bold flex-1 truncate" style={{ color: 'var(--ink-muted)' }}>{ex.nombre}</span>
                          <span className="text-[8px] font-black flex-shrink-0" style={{ color: 'var(--ink-dim)' }}>
                            {ex.series}×{ex.repeticiones} · RPE {ex.intensidad_rpe[0]} · {ex.descanso_segundos}s
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Sheet URL */}
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--ink-muted)' }}>URL de hoja de cálculo (opcional)</p>
              <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/..." className="input" />
            </div>

            {/* ── Asignación: individual o masiva ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Asignar a:</p>
                <button onClick={() => setAssignAll(p => !p)}
                  className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg cursor-pointer"
                  style={{ background: assignAll ? 'var(--accent)' : 'var(--surface2)', border: '1px solid var(--border)', color: assignAll ? '#fff' : 'var(--ink-muted)' }}>
                  <Users size={10} /> Todos
                </button>
              </div>

              {assignAll ? (
                <button onClick={assignRoutineToAll}
                  className="w-full rounded-2xl px-4 py-4 flex items-center justify-center gap-3 cursor-pointer active:scale-[0.98]"
                  style={{ background: 'var(--accent)', border: 'none', color: '#fff' }}>
                  <Users size={16} />
                  <span className="font-black">Asignar a todos los alumnos ({users.length})</span>
                </button>
              ) : (
                users.length === 0
                  ? <p className="text-sm" style={{ color: 'var(--ink-dim)' }}>No hay usuarios. Créalos primero.</p>
                  : users.map(u => (
                    <button key={u.id} onClick={() => assignRoutine(u.id)}
                      className="w-full rounded-2xl px-4 py-4 flex items-center justify-between mb-2 active:scale-[0.98] cursor-pointer"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                      onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                        <div className="text-left">
                          <p className="font-black" style={{ color: 'var(--ink)' }}>{u.name}</p>
                          <p className="text-[9px]" style={{ color: 'var(--ink-muted)' }}>
                            @{u.username}{routines[u.id] ? ' · reemplazará rutina actual' : ''}
                          </p>
                        </div>
                      </div>
                      <ArrowRight size={16} style={{ color: 'var(--ink-dim)' }} />
                    </button>
                  ))
              )}
            </div>

            <button onClick={() => { setUploadedRoutine(null); setUploadError(null); setSheetUrl(''); setAssignAll(false); if (fileRef.current) fileRef.current.value = ''; }}
              className="btn-secondary">Cancelar y subir otro Excel</button>
          </>}

          <div className="card rounded-xl p-4">
            <p className="text-[9px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--ink-muted)' }}>Formato de columnas</p>
            <div className="overflow-x-auto">
              <table className="text-[9px] border-collapse w-full">
                <thead>
                  <tr>{['Ejercicio', 'Series', 'Reps', 'RPE', 'Descanso', 'Video', 'Observaciones'].map(h => (
                    <th key={h} className="px-2 py-1.5 font-black uppercase tracking-wide whitespace-nowrap text-left"
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  <tr>{['Sentadilla', '3', '8-12', '8,9,10', '240', 'https://...', 'Baja lento'].map((v, i) => (
                    <td key={i} className="px-2 py-1.5" style={{ border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>{v}</td>
                  ))}</tr>
                </tbody>
              </table>
            </div>
          </div>
        </>}

        {subview === 'profiles' && <>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Usuarios ({users.length})</p>
            <button onClick={() => setAddForm(true)} className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg cursor-pointer"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)', color: 'var(--accent)' }}>
              <Plus size={11} /> Añadir
            </button>
          </div>

          {users.map(u => (
            <div key={u.id} className="card rounded-2xl p-4 flex items-center gap-3">
              <Avatar name={u.name} src={u.avatarUrl} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="font-black" style={{ color: 'var(--ink)' }}>{u.name}</p>
                <p className="text-[9px]" style={{ color: 'var(--ink-muted)' }}>@{u.username}</p>
              </div>
              <button onClick={() => { setEditUser(u); setEditPw(''); }} className="p-2 cursor-pointer text-lg"
                style={{ background: 'none', border: 'none', color: 'var(--ink-dim)' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--ink-dim)'}>✎</button>
              <button onClick={() => removeUser(u.id)} className="p-2 cursor-pointer"
                style={{ background: 'none', border: 'none', color: 'var(--ink-dim)' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--red)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--ink-dim)'}><Trash2 size={15} /></button>
            </div>
          ))}

          {addForm && (
            <div className="card rounded-2xl p-5 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>Nuevo usuario</p>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre completo (visible en la app)" className="input" />
              <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="Usuario para el login (ej: marcos)" className="input" autoCapitalize="none" />
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Contraseña" className="input" />
              <input value={newImg} onChange={e => setNewImg(e.target.value)} placeholder="URL de foto de perfil (opcional)" className="input" />
              <div className="flex gap-2">
                <button onClick={addUser} className="btn-accent flex-1">Crear usuario</button>
                <button onClick={() => { setAddForm(false); setNewName(''); setNewUsername(''); setNewPassword(''); setNewImg(''); }} className="btn-secondary flex-1">Cancelar</button>
              </div>
            </div>
          )}

          <AnimatePresence>
            {editUser && (
              <Modal onClose={() => setEditUser(null)}>
                <h3 className="text-lg font-black italic mb-4" style={{ color: 'var(--ink)' }}>Editar usuario</h3>
                <div className="space-y-3 mb-4">
                  <input value={editUser.name} onChange={e => setEditUser({ ...editUser, name: e.target.value })} placeholder="Nombre completo" className="input" />
                  <input value={editUser.username} onChange={e => setEditUser({ ...editUser, username: e.target.value })} placeholder="Nombre de usuario" className="input" autoCapitalize="none" />
                  <input type="password" value={editPw} onChange={e => setEditPw(e.target.value)} placeholder="Nueva contraseña (vacío = sin cambio)" className="input" />
                  <input value={editUser.avatarUrl || ''} onChange={e => setEditUser({ ...editUser, avatarUrl: e.target.value })} placeholder="URL de foto" className="input" />
                </div>
                <button onClick={saveEditUser} className="btn-accent mb-2">Guardar cambios</button>
                <button onClick={() => setEditUser(null)} className="btn-secondary">Cancelar</button>
              </Modal>
            )}
          </AnimatePresence>
        </>}

        {subview === 'backup' && <>
          <div>
            <h3 className="font-black mb-1" style={{ color: 'var(--ink)' }}>Backup completo</h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              El backup incluye usuarios, rutinas personalizadas, todo el historial de entrenamientos y los pesos de cada usuario.
            </p>
          </div>

          <button onClick={exportBackup} disabled={backupLoading}
            className="w-full card rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'left' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
              {backupLoading ? <Loader size={18} className="animate-spin" /> : <FileDown size={18} />}
            </div>
            <div>
              <p className="font-black" style={{ color: 'var(--ink)' }}>Exportar backup completo</p>
              <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>{backupLoading ? 'Descargando…' : 'Descarga un .json con todos los datos'}</p>
            </div>
          </button>

          <div onClick={() => importRef.current?.click()}
            className="w-full card rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] cursor-pointer"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface2)', color: 'var(--ink-muted)' }}>
              {importLoading ? <Loader size={18} className="animate-spin" /> : <FileUp size={18} />}
            </div>
            <div>
              <p className="font-black" style={{ color: 'var(--ink)' }}>Importar backup</p>
              <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>{importLoading ? 'Restaurando…' : 'Carga un .json exportado previamente'}</p>
            </div>
          </div>
          <input ref={importRef} type="file" accept=".json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = ''; }} />

          <div className="rounded-xl p-4" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-mid)' }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Datos en la nube</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Todo está en Supabase y es accesible desde cualquier dispositivo. El backup es una copia de seguridad adicional.
            </p>
          </div>

          <div className="rounded-xl p-4" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: '#eab308' }}>Atención al importar</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Los datos actuales serán reemplazados por los del archivo. Exporta primero si quieres conservarlos.
            </p>
          </div>
        </>}

      </div>

      {/* ── Modal editor inline de rutina ── */}
      <AnimatePresence>
        {editRoutine && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}>
            <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
              className="w-full max-w-md rounded-t-[2rem] flex flex-col"
              style={{ background: 'var(--bg)', maxHeight: '88vh', border: '1px solid var(--border)' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <div>
                  <h3 className="text-lg font-black italic" style={{ color: 'var(--ink)' }}>Editar rutina</h3>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>
                    {users.find(u => u.id === editRoutineUid)?.name}
                  </p>
                </div>
                <button onClick={() => { setEditRoutine(null); setEditRoutineUid(null); }}
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--surface2)', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar space-y-5">
                {editRoutine.dias.map((day, di) => (
                  <div key={di}>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>{day.nombre}</p>
                    <div className="space-y-2">
                      {day.ejercicios.map((ex, ei) => (
                        <div key={ei} className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                          <p className="font-black text-sm" style={{ color: 'var(--ink)' }}>{ex.nombre}</p>
                          <div className="grid grid-cols-3 gap-2">
                            {/* Reps */}
                            <div>
                              <p className="text-[7px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--ink-dim)' }}>Reps</p>
                              <input defaultValue={ex.repeticiones}
                                onBlur={e => patchExercise(di, ei, 'repeticiones', e.target.value)}
                                className="w-full rounded-lg px-2 py-1.5 text-xs font-bold outline-none"
                                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                            </div>
                            {/* Descanso */}
                            <div>
                              <p className="text-[7px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--ink-dim)' }}>Descanso (s)</p>
                              <input type="number" defaultValue={ex.descanso_segundos}
                                onBlur={e => patchExercise(di, ei, 'descanso_segundos', parseInt(e.target.value) || 120)}
                                className="w-full rounded-lg px-2 py-1.5 text-xs font-bold outline-none"
                                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                            </div>
                            {/* RPE */}
                            <div>
                              <p className="text-[7px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--ink-dim)' }}>RPE</p>
                              <input defaultValue={ex.intensidad_rpe.join(',')}
                                onBlur={e => {
                                  const v = e.target.value;
                                  const arr = v.includes(',')
                                    ? v.split(',').map(x => parseInt(x.trim()) || 8)
                                    : [parseInt(v) || 8];
                                  patchExercise(di, ei, 'intensidad_rpe', arr);
                                }}
                                className="w-full rounded-lg px-2 py-1.5 text-xs font-bold outline-none"
                                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
                <button onClick={saveEditRoutine} className="btn-accent flex-1">Guardar cambios</button>
                <button onClick={() => { setEditRoutine(null); setEditRoutineUid(null); }} className="btn-secondary flex-1">Cancelar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{toast && <Toast msg={toast} />}</AnimatePresence>
    </div>
  );
}
