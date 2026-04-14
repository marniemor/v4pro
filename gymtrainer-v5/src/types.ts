export interface Exercise {
  id: string;
  nombre: string;
  series: number;
  repeticiones: string;
  intensidad_rpe: number[];
  descanso_segundos: number;
  video: string;
  observaciones: string;
}

export interface Day {
  dia: number;
  nombre: string;
  ejercicios: Exercise[];
}

export interface Routine {
  nombre: string;
  dias: Day[];
  sheetUrl?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  username: string;
  password: string;
  avatarUrl?: string;
}

export interface WorkoutSession {
  id: string;
  dayName: string;
  userName: string;
  date: string;
  note?: string;
  exercises: {
    id: string;
    nombre: string;
    sets: string[];
  }[];
}

export type Theme = 'dark' | 'light';
