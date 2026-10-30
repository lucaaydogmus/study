// Citywide events and weather behaviour.
import type { CityEvent, CityEventType, WeatherType } from './types';

export const WEATHER_SPEED: Record<WeatherType, number> = { clear: 1, rain: 0.88, snow: 0.7, fog: 0.82, storm: 0.74, heat: 0.98 };
export const WEATHER_LABEL: Record<WeatherType, string> = { clear: 'Clear', rain: 'Rain', snow: 'Snow', fog: 'Fog', storm: 'Thunderstorm', heat: 'Heat wave' };
export const WEATHER_TRAFFIC: Record<WeatherType, number> = { clear: 0, rain: 0.08, snow: 0.18, fog: 0.08, storm: 0.14, heat: 0.02 };

export const EVENT_DEFS: Record<CityEventType, { name: string; description: string; weather?: WeatherType; make: (districts: string[]) => Pick<CityEvent, 'trafficMult' | 'incidentMult' | 'categoryBias' | 'templateBias'> }> = {
  storm: { name: 'Severe Thunderstorm', description: 'Lightning, flooding and fallen trees across the city.', weather: 'storm', make: () => ({ trafficMult: 1.25, incidentMult: 1.5, categoryBias: { police: 1.2, fire: 1.3 }, templateBias: { electrical_fire: 3, collision_minor: 2, collision_injury: 1.8, flooded_basement: 2.5, collision_multi: 1.8, fall_elderly: 1.3 } }) },
  blackout: { name: 'Citywide Blackout', description: 'Power is out. Traffic signals are dark, lifts have stopped.', make: () => ({ trafficMult: 1.35, incidentMult: 1.4, categoryBias: { fire: 1.2 }, templateBias: { elevator_rescue: 5, electrical_fire: 3, sudden_illness: 1.8, collision_minor: 2.2, burglary_progress: 1.7, breathing_trouble: 1.4 } }) },
  flood: { name: 'Regional Flooding', description: 'River levels rising; low-lying streets and bridges at risk.', weather: 'rain', make: () => ({ trafficMult: 1.2, incidentMult: 1.45, categoryBias: { fire: 1.5 }, templateBias: { water_rescue: 5, flooded_basement: 6, collision_minor: 1.5, electrical_fire: 1.5, animal_rescue: 2 } }) },
  festival: { name: 'Festival of Lanterns', description: 'Large crowds downtown and in Old Town.', make: () => ({ trafficMult: 1.5, incidentMult: 1.5, categoryBias: { police: 1.3, medical: 1.2 }, templateBias: { public_disturbance: 3, heat_exhaustion: 3, lost_child: 4, shoplifting: 2, public_intoxication: 3, allergic_reaction: 1.6, welfare_check: 0.6, burglary_progress: 0.6 } }) },
  rush_hour: { name: 'Rush Hour Gridlock', description: 'Peak traffic slows every response.', make: () => ({ trafficMult: 1.9, incidentMult: 1.2, categoryBias: { police: 1.3 }, templateBias: { collision_minor: 3, collision_injury: 2.4, dangerous_driving: 2.2, vehicle_fire: 1.6 } }) },
  industrial_fire: { name: 'Major Industrial Fire', description: 'A large fire at a chemical depot threatens the Industrial Zone.', make: () => ({ trafficMult: 1.2, incidentMult: 1.35, categoryBias: { fire: 1.5 }, templateBias: { warehouse_smoke: 4, industrial_accident: 3, brush_fire: 1.3, gas_leak: 1.8 } }) },
  winter_storm: { name: 'Winter Storm', description: 'Snow and ice make every road treacherous.', weather: 'snow', make: () => ({ trafficMult: 1.35, incidentMult: 1.4, categoryBias: { police: 1.3, medical: 1.2 }, templateBias: { collision_minor: 3, collision_injury: 2.4, collision_trapped: 2, collision_multi: 2.2, fall_elderly: 2.2, dangerous_driving: 1.8 } }) },
  heat_wave: { name: 'Heat Wave', description: 'Record temperatures bring medical and brush fire risk.', weather: 'heat', make: () => ({ trafficMult: 1.05, incidentMult: 1.3, categoryBias: { medical: 1.3, fire: 1.2 }, templateBias: { heat_exhaustion: 5, brush_fire: 3, vehicle_fire: 2, breathing_trouble: 1.5 } }) },
};

export function nextWeather(cur: WeatherType, r: number, hour: number): WeatherType {
  // simple Markov chain
  const table: Record<WeatherType, Array<[WeatherType, number]>> = {
    clear: [['clear', 0.62], ['rain', 0.16], ['fog', 0.08], ['heat', 0.08], ['snow', 0.03], ['storm', 0.03]],
    rain: [['rain', 0.45], ['clear', 0.25], ['storm', 0.15], ['fog', 0.15]],
    snow: [['snow', 0.6], ['clear', 0.2], ['fog', 0.2]],
    fog: [['fog', 0.4], ['clear', 0.4], ['rain', 0.2]],
    storm: [['storm', 0.4], ['rain', 0.5], ['clear', 0.1]],
    heat: [['heat', 0.6], ['clear', 0.35], ['storm', 0.05]],
  };
  void hour;
  let acc = 0;
  for (const [w, p] of table[cur]) { acc += p; if (r <= acc) return w; }
  return cur;
}
