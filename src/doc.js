'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DOC_NAME = 'CLAUDE_TRACKER.md';
const OPT_OUT = '.no-claude-tracker';
const LOG_MARK = '<!-- claude-tracker:log -->';
const MAX_LOG_LINES = 100;

const template = (name) => `# Suivi du projet — ${name}

> Document de continuité entre les sessions Claude (créé par Claude Tracker).
> Lis-le au début de chaque session. Mets-le à jour AU FUR ET À MESURE (après chaque étape terminée,
> décision ou blocage), pas seulement à la fin : une session peut s'arrêter à tout moment (limite des 5 h).
> Reste concis ; remplace ce qui est obsolète au lieu d'empiler.

## Objectif

## État actuel

## Fait

## En cours

## Prochaines étapes

## Décisions et pièges

## Journal des sessions (automatique)
${LOG_MARK}
`;

// Never create the document in $HOME, in /, inside ~/.claude, or where the project opted out.
function eligible(cwd, home = os.homedir()) {
  if (!cwd || !path.isAbsolute(cwd) || cwd === '/' || cwd === home) return false;
  if (cwd === path.join(home, '.claude') || cwd.startsWith(path.join(home, '.claude') + path.sep)) return false;
  try {
    return fs.statSync(cwd).isDirectory() && !fs.existsSync(path.join(cwd, OPT_OUT));
  } catch {
    return false;
  }
}

// Returns the document path, creating it from the template if missing; null when not applicable.
function ensureDoc(cwd, home = os.homedir()) {
  if (!eligible(cwd, home)) return null;
  const file = path.join(cwd, DOC_NAME);
  try {
    fs.writeFileSync(file, template(path.basename(cwd)), { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') return null; // read-only dir etc.: never break the session
  }
  return file;
}

function sessionContext(file, usageLine) {
  let body = fs.readFileSync(file, 'utf8');
  if (body.length > 8000) body = body.slice(0, 8000) + '\n[… tronqué, lis le fichier complet]';
  return [
    `Claude Tracker : le fichier ${DOC_NAME} (racine du projet) sert de mémoire entre les sessions.`,
    `1) Tiens compte de son contenu ci-dessous. 2) Mets-le à jour au fur et à mesure du travail (après chaque étape, décision ou blocage), pas seulement en fin de session. 3) Garde-le court ; ne touche pas à la section « Journal des sessions » (automatique).`,
    usageLine ? `Usage actuel — ${usageLine}` : '',
    `--- ${DOC_NAME} ---`,
    body,
  ]
    .filter(Boolean)
    .join('\n');
}

function appendLog(file, line) {
  const text = fs.readFileSync(file, 'utf8');
  const i = text.indexOf(LOG_MARK);
  if (i === -1) return false; // user removed the section: respect it
  const head = text.slice(0, i + LOG_MARK.length);
  const rest = text.slice(i + LOG_MARK.length).split('\n').filter(Boolean);
  const kept = [...rest, line].slice(-MAX_LOG_LINES);
  fs.writeFileSync(file, `${head}\n${kept.join('\n')}\n`);
  return true;
}

module.exports = { DOC_NAME, OPT_OUT, LOG_MARK, eligible, ensureDoc, sessionContext, appendLog };
