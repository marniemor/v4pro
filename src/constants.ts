import { Routine } from './types';

export const EXERCISES_SHEET_URL = "https://docs.google.com/spreadsheets/d/1KnV0ymOKG_Cb4foC6KQzBLm4_UtjVPH8bFZHyec9xRU/edit?usp=sharing";
export const ADMIN_PASSWORD = "admin2024";

export const ROUTINE_DATA: Routine = {
  nombre: "Fuerza-Hipertrofia 3 Días",
  dias: [
    {
      dia: 1,
      nombre: "Día 1 – Pierna",
      ejercicios: [
        { id: "p1", nombre: "Aductor en máquina", series: 4, repeticiones: "10-15", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://www.youtube.com/shorts/76uNT_VMhPI", observaciones: "Aguanta lento y haz la negativa en 3 segundos cuando se te abran las piernas. Cierra fuerte apretando y mantén 1 segundo en la máxima contracción." },
        { id: "p2", nombre: "Sentadilla Hack", series: 3, repeticiones: "8-12", intensidad_rpe: [8, 9, 10], descanso_segundos: 240, video: "https://www.tiktok.com/@tweilerfitness/video/7481460012305468727", observaciones: "Coloca las piernas un poco arriba para enfocar glúteo. Baja lo máximo que puedas sin que se te levante la cadera del respaldo." },
        { id: "p3", nombre: "Extensiones de cuádriceps", series: 4, repeticiones: "10-15", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://youtube.com/shorts/KbarMHxQNrk", observaciones: "Bajada lenta y fase concéntrica explosiva. Asegúrate de bloquear las rodillas un segundo arriba." },
        { id: "p4", nombre: "Hip Thrust en máquina", series: 4, repeticiones: "8-12", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://www.tiktok.com/@robertobosqued/video/7486553349609835798", observaciones: "Aprieta fuerte arriba con pausa de 1 segundo. No arquees la espalda excesivamente." },
        { id: "p5", nombre: "Prensa horizontal", series: 3, repeticiones: "8-12", intensidad_rpe: [8, 9, 10], descanso_segundos: 180, video: "https://www.tiktok.com/@trainwithlauri/video/7474480487243828486", observaciones: "Movimiento completo y controlado. Evita bloquear las rodillas al final de la extensión." },
        { id: "p6", nombre: "Curl femoral sentado", series: 3, repeticiones: "10-15", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://youtu.be/I0Z-mrfePJo", observaciones: "Mantén la lumbar pegada al banco. Aprieta en el punto de máxima flexión." },
        { id: "p7", nombre: "Peso muerto unilateral", series: 3, repeticiones: "8-12", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://www.tiktok.com/@mixon_fit/video/7208362172752186667", observaciones: "Lleva la cadera atrás y sube desde ahí. Mantén la espalda neutra en todo momento." }
      ]
    },
    {
      dia: 2,
      nombre: "Día 2 – Torso",
      ejercicios: [
        { id: "t1", nombre: "Remo máquina abierto", series: 4, repeticiones: "8-12", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://youtu.be/2hUvcPd_xjc", observaciones: "Brazo en L. Negativa en 3 seg controlando el estiramiento de las escápulas." },
        { id: "t2", nombre: "Elevaciones laterales banco", series: 4, repeticiones: "10-15", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://youtu.be/hDk9Mrm27OI", observaciones: "Codos lejos del cuerpo. Mantén la inclinación del banco para aislar el deltoides lateral." },
        { id: "t3", nombre: "Remo dorsal máquina", series: 4, repeticiones: "8-12", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://youtube.com/shorts/WzifKEjuHNA", observaciones: "Cadera metida y torso estable. Imagina llevar los codos hacia tus bolsillos traseros." },
        { id: "t4", nombre: "Press militar mancuernas", series: 4, repeticiones: "8-12", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://youtu.be/o5M9RZ-vWrc", observaciones: "Respaldo inclinado 60–75°. No bajes más allá de la altura de tus orejas." },
        { id: "t5", nombre: "Curl bíceps inclinado", series: 4, repeticiones: "10-15", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://www.tiktok.com/@nowtrain/video/7330345791065705761", observaciones: "Estiramiento completo en la parte inferior. No balancees los hombros." },
        { id: "t6", nombre: "Tríceps polea unilateral", series: 4, repeticiones: "10-15", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://www.tiktok.com/@benwilcoxfitness/video/7464730496442830086", observaciones: "Codo ligeramente detrás del cuerpo. Extensión total y control de la fase excéntrica." },
        { id: "t7", nombre: "Crunch abdominal", series: 3, repeticiones: "10-15", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://youtu.be/VtrDTzDvNFU", observaciones: "Aprieta fuerte la contracción. Suelta el aire al subir." }
      ]
    },
    {
      dia: 3,
      nombre: "Día 3 – Torso-Pierna",
      ejercicios: [
        { id: "tp1", nombre: "Peso muerto semi-flex", series: 3, repeticiones: "6-10", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://www.tiktok.com/@nickcalip/video/7275886167550168362", observaciones: "Cierra la puerta con el glúteo. Siente el estiramiento en los isquios." },
        { id: "tp2", nombre: "Búlgara multipower", series: 3, repeticiones: "10-15", intensidad_rpe: [8, 9, 10], descanso_segundos: 150, video: "https://www.tiktok.com/@thetitanfit/video/7207492168418643205", observaciones: "Pie cerca del banco. Mantén el torso vertical para enfocar el cuádriceps." },
        { id: "tp3", nombre: "Laterales polea uni", series: 4, repeticiones: "10-15", intensidad_rpe: [8, 9, 10, 10], descanso_segundos: 120, video: "https://youtube.com/shorts/yIHRhjm1aIc", observaciones: "Controla la parte alta. No uses el impulso del cuerpo." },
        { id: "tp4", nombre: "Jalón pecho cerrado", series: 3, repeticiones: "8-12", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://youtube.com/shorts/Ks58uA42jC8", observaciones: "Lleva el brazo a la cadera. Estira bien el dorsal arriba." },
        { id: "tp5", nombre: "Press plano máquina", series: 3, repeticiones: "8-12", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://youtu.be/v4XTkt2CURc", observaciones: "Rota codos hacia dentro levemente para proteger el hombro." },
        { id: "tp6", nombre: "Tríceps tras nuca polea", series: 3, repeticiones: "10-15", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://www.tiktok.com/@robertobosqued/video/7529942599990447362", observaciones: "Cuerpo inclinado hacia delante. Estira bien el tríceps atrás." },
        { id: "tp7", nombre: "Curl Scott máquina", series: 3, repeticiones: "10-15", intensidad_rpe: [8, 9, 10], descanso_segundos: 120, video: "https://www.youtube.com/shorts/zOefGx0z_FE", observaciones: "Sin rebotes ni ayuda de espalda. Apoyo total de los brazos en el banco." }
      ]
    }
  ]
};
