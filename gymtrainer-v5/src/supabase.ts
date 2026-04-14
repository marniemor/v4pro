import { createClient } from '@supabase/supabase-js';
import { UserProfile, WorkoutSession, Routine } from './types';

const SUPABASE_URL = 'https://sdqgrsishnvdvpyigvxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcWdyc2lzaG52ZHZweWlndnh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMTE2NzcsImV4cCI6MjA5MTU4NzY3N30.cHNnuLnMf67RWg-XXTBxiGdO2jcQSAWzAI5W8AcLBHg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── PASSWORD HASHING (SHA-256) ────────────────────────────────────────────
// Contraseñas nunca viajan en texto plano. Se hashean en el cliente con SHA-256
// antes de guardarse o compararse.
// Compatibilidad con contraseñas legacy (texto plano): si el valor almacenado
// NO es un hex de 64 chars, se trata como texto plano (fallback de una sola vez).
export async function hashPassword(plain: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (/^[0-9a-f]{64}$/.test(stored)) {
    return (await hashPassword(plain)) === stored;
  }
  // Fallback legacy: contraseñas en texto plano ya existentes
  return plain === stored;
}

// ─── PROFILES ──────────────────────────────────────────────────────────────
export async function fetchProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at');
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id, name: row.name, username: row.username,
    password: row.password, avatarUrl: row.avatar_url ?? undefined,
  }));
}

// Login seguro: sólo trae el perfil del usuario solicitado, no todos
export async function fetchProfileByUsername(username: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles').select('*')
    .ilike('username', username.trim())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, name: data.name, username: data.username, password: data.password, avatarUrl: data.avatar_url ?? undefined };
}

export async function createProfile(p: Omit<UserProfile, 'id'>): Promise<UserProfile> {
  const hashedPw = await hashPassword(p.password);
  const { data, error } = await supabase.from('profiles').insert({
    name: p.name, username: p.username, password: hashedPw, avatar_url: p.avatarUrl ?? null,
  }).select().single();
  if (error) throw error;
  return { id: data.id, name: data.name, username: data.username, password: data.password, avatarUrl: data.avatar_url ?? undefined };
}

export async function updateProfile(p: UserProfile): Promise<void> {
  // Sólo re-hashea si la contraseña no es ya un SHA-256 (evita doble hash)
  const pwToStore = /^[0-9a-f]{64}$/.test(p.password) ? p.password : await hashPassword(p.password);
  const { error } = await supabase.from('profiles').update({
    name: p.name, username: p.username, password: pwToStore, avatar_url: p.avatarUrl ?? null,
  }).eq('id', p.id);
  if (error) throw error;
}

export async function deleteProfile(id: string): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('id', id);
  if (error) throw error;
}

// ─── ROUTINES ──────────────────────────────────────────────────────────────
export async function fetchRoutine(userId: string): Promise<Routine | null> {
  const { data, error } = await supabase.from('routines').select('routine_data').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? (data.routine_data as Routine) : null;
}

export async function upsertRoutine(userId: string, routine: Routine): Promise<void> {
  await supabase.from('routines').delete().eq('user_id', userId);
  const { error } = await supabase.from('routines').insert({
    user_id: userId, routine_data: routine, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function deleteRoutine(userId: string): Promise<void> {
  const { error } = await supabase.from('routines').delete().eq('user_id', userId);
  if (error) throw error;
}

// ─── SESSIONS ──────────────────────────────────────────────────────────────
const mapRow = (row: any): WorkoutSession => ({
  id: row.id, dayName: row.day_name, userName: row.user_id,
  date: row.date, note: row.note ?? undefined,
  exercises: row.exercises as WorkoutSession['exercises'],
});

export async function fetchSessions(userId: string): Promise<WorkoutSession[]> {
  const { data, error } = await supabase.from('sessions').select('*').eq('user_id', userId).order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function fetchAllSessions(): Promise<WorkoutSession[]> {
  const { data, error } = await supabase.from('sessions').select('*').order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function insertSession(userId: string, session: WorkoutSession): Promise<void> {
  const { error } = await supabase.from('sessions').insert({
    id: session.id, user_id: userId, day_name: session.dayName,
    date: session.date, note: session.note ?? null, exercises: session.exercises,
  });
  if (error) throw error;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ─── WEIGHTS ───────────────────────────────────────────────────────────────
export async function fetchWeights(userId: string): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from('weights').select('exercise_id, sets').eq('user_id', userId);
  if (error) throw error;
  const result: Record<string, string[]> = {};
  for (const row of data || []) result[row.exercise_id] = row.sets as string[];
  return result;
}

export async function fetchAllWeights(): Promise<{ userId: string; exerciseId: string; sets: string[] }[]> {
  const { data, error } = await supabase.from('weights').select('user_id, exercise_id, sets');
  if (error) throw error;
  return (data || []).map(r => ({ userId: r.user_id, exerciseId: r.exercise_id, sets: r.sets as string[] }));
}

export async function upsertWeight(userId: string, exerciseId: string, sets: string[]): Promise<void> {
  await supabase.from('weights').delete().eq('user_id', userId).eq('exercise_id', exerciseId);
  const { error } = await supabase.from('weights').insert({
    user_id: userId, exercise_id: exerciseId, sets, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ─── FULL BACKUP ───────────────────────────────────────────────────────────
export async function fetchFullBackup() {
  const [profiles, sessions, weights] = await Promise.all([fetchProfiles(), fetchAllSessions(), fetchAllWeights()]);
  const routines: { userId: string; routine: Routine }[] = [];
  await Promise.all(profiles.map(async p => { const r = await fetchRoutine(p.id); if (r) routines.push({ userId: p.id, routine: r }); }));
  return { profiles, sessions, weights, routines, exportedAt: new Date().toISOString() };
}

export async function restoreFullBackup(backup: ReturnType<typeof fetchFullBackup> extends Promise<infer T> ? T : never): Promise<void> {
  for (const p of backup.profiles) {
    await supabase.from('profiles').delete().eq('id', p.id);
    await supabase.from('profiles').insert({ id: p.id, name: p.name, username: p.username, password: p.password, avatar_url: p.avatarUrl ?? null });
  }
  for (const r of backup.routines) { await upsertRoutine(r.userId, r.routine); }
  for (const s of backup.sessions) {
    await supabase.from('sessions').delete().eq('id', s.id);
    await supabase.from('sessions').insert({ id: s.id, user_id: s.userName, day_name: s.dayName, date: s.date, note: s.note ?? null, exercises: s.exercises });
  }
  for (const w of backup.weights) { await upsertWeight(w.userId, w.exerciseId, w.sets); }
}
