// What the dispatcher hears in the background when a call connects. Clues, not answers.
import type { FactVal, WeatherType } from '../types';

const CLUES: Record<string, string[]> = {
  collapse_child: ['[A woman repeating a child’s name, over and over]'],
  cardiac_arrest: ['[Someone shouting a name; a dog barking]', '[A television blaring; someone sobbing]'],
  fall_elderly: ['[A radio playing quietly; slow footsteps]'],
  breathing_trouble: ['[Rasping, wheezing breaths close to the phone]'],
  allergic_reaction: ['[Restaurant noise — cutlery, raised voices]'],
  kitchen_fire: ['[A smoke alarm shrieking]', '[Crackling and a smoke alarm]'],
  apartment_fire: ['[A muffled alarm, doors banging in a corridor]'],
  smell_burning: ['[Quiet hallway — a faint, repeating electrical buzz]'],
  vehicle_fire: ['[Car horns; a loud whoosh]'],
  gas_leak: ['[A faint hiss; an echoing stairwell]'],
  carbon_monoxide: ['[A detector chirping every few seconds]'],
  warehouse_smoke: ['[Wind; an alarm bell in the distance]'],
  water_rescue: ['[Wind and splashing; people shouting from the bank]'],
  boat_fire: ['[Roaring flames, shouting, a ship’s horn]'],
  collision_minor: ['[Car horns and an angry voice]'],
  collision_injury: ['[Car horns; someone moaning nearby]'],
  collision_trapped: ['[A car horn stuck on; someone calling for help]'],
  collision_multi: ['[Many horns, screaming, a car alarm]'],
  burglary_progress: ['[Whispering; a floorboard creaks]'],
  robbery: ['[Hushed breathing; a man shouting in the background]'],
  domestic_disturbance: ['[Shouting through a wall; glass breaking]'],
  public_disturbance: ['[A crowd chanting; a bottle smashes]'],
  pursuit: ['[An engine revving hard; tyres screeching]'],
  escaped_animal: ['[Hooves on tarmac and car horns]'],
  fireworks: ['[A crack — then another. Hard to tell what it is]'],
  accidental_call: ['[A television; muffled rustling]'],
  lost_child: ['[A shopping-centre announcement; a child sniffing]'],
  power_line_down: ['[Sharp electrical snapping; wind]'],
  refuses_explain: ['[Very quiet. A door closes somewhere]'],
  prank_or_real: ['[Teenagers laughing]'],
  harmless_scream: ['[Distant screams — then laughter?]'],
};

export function backgroundClue(templateId: string, weather: WeatherType, truth: Record<string, FactVal>): string | null {
  const list = CLUES[templateId];
  const w = weather === 'storm' ? ' [Thunder rumbling]' : weather === 'rain' ? ' [Rain hammering]' : weather === 'snow' ? ' [Wind whistling]' : '';
  if (!list) return w ? w.trim() : null;
  const i = Math.abs(String(truth.cause ?? '').length) % list.length;
  return list[i] + w;
}
