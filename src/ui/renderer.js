'use strict';
const $ = (id) => document.getElementById(id);
const SIGN = (n) => (n < 0 ? '−' : '+') + Math.abs(Math.round(n));
const WORDS = { behind: 'sous le rythme', ontrack: 'dans le rythme', ahead: 'en avance', over: 'limite proche', unknown: 'limite inconnue' };

function duration(ms) {
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}j ${h}h` : `${h}h${String(m % 60).padStart(2, '0')}`;
}

const bar = (g) => `<div class="bar"><div class="time" style="width:${g.elapsedPct}%"></div><div class="fill" style="width:${Math.min(100, g.usedPct ?? 0)}%"></div><div class="mark" style="left:calc(${g.elapsedPct}% - 1px)"></div></div>`;
const statusOf = (g) => (g.projectedPct > 100 && g.status === 'ahead' ? 'over' : g.status);
const bigOf = (g) => (g.usedPct === null ? `${Math.round(g.used / 1000)}k` : `${Math.round(g.usedPct)}%`);

function session(g) {
  if (!g.active) return '<div class="row"><span class="name">Session 5h</span></div><p class="empty">Aucune session active : la prochaine démarre à ton prochain message.</p>';
  const cls = statusOf(g);
  return `<div class="${cls}" style="display:contents">
    <div class="row"><span><span class="name">Session 5h</span><span class="reset">reset ${duration(g.resetsInMs)}</span></span>
      <span class="big">${bigOf(g)}<small>/ ${Math.round(g.elapsedPct)}% t</small></span></div>
    ${bar(g)}
    <div class="row">${g.deltaPts === null ? '<span></span>' : `<span class="pill">Δ ${SIGN(g.deltaPts)} pts <small>${WORDS[cls]}</small></span>`}
      <span class="proj">${g.projectedPct === null ? '' : `Proj: <b>${Math.round(g.projectedPct)}%</b>`}</span></div></div>`;
}

function week(g) {
  const cls = statusOf(g);
  return `<div class="${cls}" style="display:contents">
    <div class="row"><span class="name">Semaine</span><b>${bigOf(g)}</b></div>
    ${bar(g)}
    <div class="row mark-note"><span>${g.deltaPts === null ? '' : `Δ ${SIGN(g.deltaPts)} pts`}</span><span>reset ${duration(g.resetsInMs)}</span></div></div>`;
}

window.tracker.onUsage((s) => {
  const real = s.session.real || s.week.real;
  $('badge').className = real ? 'badge' : 'badge est';
  $('badge').lastChild.textContent = real ? 'Réel' : 'Estimé';
  $('session').innerHTML = session(s.session);
  $('week').className = 'week';
  $('week').innerHTML = week(s.week);
  $('foot').lastChild.textContent = `${real ? 'statusline' : 'estimé (historique local)'} · maj ${new Date(s.now).toLocaleTimeString('fr-FR')}`;
  $('foot').firstChild.style.setProperty('--c', real ? 'var(--green)' : 'var(--amber)');
});
$('refresh').onclick = () => window.tracker.refresh();
$('config').onclick = () => window.tracker.openConfig();
$('hide').onclick = () => window.tracker.hide();
$('pin').onclick = async () => $('pin').classList.toggle('on', await window.tracker.togglePin());
