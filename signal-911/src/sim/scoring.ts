// Shift scoring: every term is derived from simulation metrics, never from AI output.
import type { GameState, ShiftScore } from './types';

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function avgResponse(st: GameState): number { return avg(st.stats.responseTimes); }

export function computeScore(st: GameState): ShiftScore {
  const s = st.stats;
  const diffTarget = { casual: 150, standard: 120, hard: 114, expert: 90 }[st.config.difficulty];
  const handled = Object.values(st.incidents).filter((i) => !i.truth.outside && !i.duplicateOf && i.outcome !== 'merged' && i.templateId !== 'traffic_stop');
  const needResponse = handled.filter((i) => i.requires.length > 0 || i.outcome === 'false_alarm');

  // response time: full marks at/under target, zero at 2.2x target
  const rt = avg(s.responseTimes);
  const response = s.responseTimes.length ? Math.max(0, Math.min(1, 1 - (rt - diffTarget) / (diffTarget * 1.3))) : needResponse.length ? 0.2 : 0.8;

  // outcomes weighted by severity
  let w = 0, got = 0;
  for (const i of handled) {
    const wt = Math.max(1, i.severity);
    w += wt;
    switch (i.outcome) {
      case 'success': case 'false_alarm': got += wt; break;
      case 'partial': got += wt * 0.55; break;
      case 'handover': got += wt * 0.35; break;
      default: break;
    }
  }
  const outcomes = w ? got / w : 0.7;

  // dispatch accuracy
  let accuracy = s.dispatches ? s.correctDispatches / s.dispatches : 0.8;
  accuracy -= s.unnecessary * 0.035 + s.wrongLocations * 0.05 + (s.checksBad ?? 0) * 0.04 + (s.checksMissed ?? 0) * 0.03;
  accuracy = Math.max(0, Math.min(1, accuracy));

  // call handling
  const answered = s.callsReceived ? s.callsAnswered / s.callsReceived : 1;
  const at = avg(s.answerTimes);
  const calls = Math.max(0, Math.min(1, answered * (1 - Math.max(0, at - 8) / 40)));

  const cov = (s.coverageSamples.police.length ? (avg(s.coverageSamples.police) + avg(s.coverageSamples.fire) + avg(s.coverageSamples.medical)) / 3 : 0.5);
  const coverage = Math.max(0, Math.min(1, cov / 0.85));

  const penalties = s.casualties * 5 + s.promisesBroken * 1.5 + s.mishandled * 3 + (s.wrongLinks ?? 0) * 2 + (s.harmfulAdvice ?? 0) * 2;
  let total = 100 * (0.27 * response + 0.34 * outcomes + 0.17 * accuracy + 0.12 * calls + 0.10 * coverage) - penalties;
  total = Math.max(0, Math.min(100, total));
  const grade: ShiftScore['grade'] = total >= 91 && s.casualties === 0 ? 'S' : total >= 80 ? 'A' : total >= 68 ? 'B' : total >= 55 ? 'C' : total >= 42 ? 'D' : 'F';
  return { total: Math.round(total), grade, response, outcomes, accuracy, calls, coverage, penalties };
}

export function evaluateObjectives(st: GameState) {
  const s = st.stats;
  const score = st.scoreBreakdown ?? computeScore(st);
  for (const o of st.config.objectives) {
    switch (o.kind) {
      case 'resolved': o.value = s.resolved; o.done = s.resolved >= o.target; break;
      case 'avg_response': o.value = Math.round(avg(s.responseTimes)); o.done = s.responseTimes.length > 0 && avg(s.responseTimes) <= o.target; break;
      case 'no_deaths': o.value = s.casualties; o.done = s.casualties === 0; break;
      case 'grade': o.value = score.total; o.done = score.total >= o.target; break;
      case 'answered': o.value = s.callsAnswered; o.done = s.callsAnswered >= o.target; break;
      case 'no_missed': o.value = s.callsMissed; o.done = s.callsMissed === 0; break;
      case 'categories': o.value = Object.keys(s.byCategory).length; o.done = Object.keys(s.byCategory).length >= o.target; break;
      case 'coverage': o.value = Math.round(avg([...s.coverageSamples.police, ...s.coverageSamples.fire, ...s.coverageSamples.medical]) * 100); o.done = (o.value ?? 0) >= o.target; break;
      case 'no_wrong_location': o.value = s.wrongLocations; o.done = s.wrongLocations === 0; break;
      case 'pursuits': o.value = s.pursuitsCaught; o.done = s.pursuitsCaught >= o.target; break;
      case 'relays': o.value = s.heliRelays ?? 0; o.done = (o.value ?? 0) >= o.target; break;
      case 'aid_good': o.value = s.aidGood; o.done = s.aidGood >= o.target; break;
      case 'checks': o.value = s.checksOk ?? 0; o.done = (o.value ?? 0) >= o.target; break;
      case 'deadlines': o.value = Object.values(st.incidents).filter((i) => i.deadlineMet === true).length; o.done = o.value >= o.target && !Object.values(st.incidents).some((i) => i.deadlineMet === false); break;
      default: break;
    }
  }
}

export const GRADE_COLORS: Record<ShiftScore['grade'], string> = { S: '#E5AC4D', A: '#54B889', B: '#4A9CD6', C: '#98A6B5', D: '#D69A53', F: '#D65353' };
export const averageOf = avg;
