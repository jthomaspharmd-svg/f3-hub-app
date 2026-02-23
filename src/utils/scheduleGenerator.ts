import type { WorkoutSession } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const generateWorkoutSchedule = (monthsToGenerate: number = 24): WorkoutSession[] => {
  const sessions: WorkoutSession[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const futureDate = new Date();
  futureDate.setMonth(today.getMonth() + monthsToGenerate);

  let currentDate = new Date(today);
  // Start from the beginning of the current week to ensure we don't miss past workout days in the initial generation
  currentDate.setDate(currentDate.getDate() - currentDate.getDay());


  while (currentDate <= futureDate) {
    const dayOfWeek = currentDate.getDay(); // 0=Sun, 2=Tue, 4=Thu, 6=Sat

    if (dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6) {
      let time = '';
      if (dayOfWeek === 2 || dayOfWeek === 4) { // Tuesday or Thursday
        time = '0530';
      } else { // Saturday
        time = '0630';
      }
      
      const dateString = `${currentDate.getMonth() + 1}/${currentDate.getDate()}/${String(currentDate.getFullYear()).slice(-2)} (${currentDate.toLocaleString('en-US', { weekday: 'short' })})`;

      sessions.push({
        id: uuidv4(), // Use uuid for a unique string ID
        date: dateString,
        time: time,
        q: '',
        notes: '',
        dbj: '',
        food: '',
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return sessions;
};
