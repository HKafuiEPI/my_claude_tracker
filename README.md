# Claude Tracker

Widget Linux (Electron) qui affiche ton usage de **Claude Code** : session de 5 h et semaine, avec le **delta de rythme**
(`% du quota utilisé − % du temps écoulé` : négatif = sous le rythme, positif = en avance, limite possible avant le reset).

- **Pourcentages réels** (badge `RÉEL`) fournis par Claude Code lui-même via sa *statusline* — abonnements Pro/Max uniquement.
- Sinon **estimation** (badge `ESTIMÉ`) d'après tes transcripts locaux.
- Icône de tray, fenêtre 400×160 sans cadre, épinglable au premier plan.
- Optionnel : tient à jour un `CLAUDE_TRACKER.md` par projet, injecté dans chaque session Claude Code.

## Prérequis

- Linux avec un bureau graphique (testé sur Ubuntu / GNOME, Wayland)
- Node.js ≥ 18 et npm
- Claude Code installé (dossier `~/.claude`)
- GNOME : l'icône de tray demande l'extension **AppIndicator** (`gnome-shell-extension-appindicator`). Sans elle le widget fonctionne, mais sans icône de tray.

## Installation

```sh
git clone <url-du-depot> claude-tracker
cd claude-tracker
npm install
npm test                     # optionnel
node scripts/install.js      # démarrage auto + icône + hooks + statusline
bin/claude-tracker           # lancer maintenant
```

Puis ouvre une **nouvelle session Claude Code** : après sa première réponse le badge passe à `RÉEL`.

### Ce que `scripts/install.js` modifie

| Où | Quoi |
|---|---|
| `~/.config/autostart/claude-tracker.desktop` et `~/.local/share/applications/…` | lancement au login + entrée de menu |
| `~/.local/share/icons/hicolor/256x256/apps/claude-tracker.png` | icône |
| `~/.claude/settings.json` | hooks `SessionStart` / `SessionEnd` et `statusLine` (sauvegarde : `settings.json.bak-claude-tracker`) |

Le script est idempotent. Si tu as **déjà une statusline**, elle n'est pas remplacée : fais passer son entrée standard par `src/statusline.js` pour obtenir les vrais pourcentages. Si `settings.json` est invalide, rien n'est écrit.

Désinstaller : `node scripts/install.js uninstall` (retire ces ajouts et rien d'autre), puis supprime le dossier.

## Configuration

`~/.config/claude-tracker/config.json` (créé au premier lancement ; menu du tray → « Ouvrir la config »).
Ces réglages ne servent que **sans** données réelles :

| Clé | Défaut | Rôle |
|---|---|---|
| `limit5h`, `limitWeek` | `null` | limites en tokens ; `null` = estimées par ton plus gros bloc / semaine passés |
| `weeklyReset` | `{ "day": 1, "hour": 0 }` | jour (0 = dimanche) et heure du reset hebdo, heure locale |
| `countCacheRead` | `false` | compter les lectures de cache |
| `refreshSec` | `30` | période de rafraîchissement (min 10) |
| `startHidden` | `false` | démarrer sans afficher la fenêtre |

## Vie privée

Tout reste sur ta machine : le widget lit `~/.claude/projects/**/*.jsonl` (60 derniers jours) et le JSON que Claude Code envoie à la statusline, et n'a **aucun accès réseau** (CSP stricte, aucune requête sortante). Il écrit uniquement dans `~/.cache/claude-tracker/` (`snapshot.json`, `limits.json`) et `~/.config/claude-tracker/`.

Le `CLAUDE_TRACKER.md` créé dans tes projets contient des identifiants de session et ton usage : pense à l'ajouter au `.gitignore` des projets que tu publies. Il n'est jamais créé dans `$HOME`, `/` ou `~/.claude` ; pour l'exclure d'un projet, crée un fichier vide `.no-claude-tracker`.

## Limites connues

- Les quotas réels ne sont pas publiés ; sans statusline, les % sont des estimations.
- Claude.ai web et les autres machines ne sont pas comptés dans l'estimation (le quota réel, lui, est global au compte).
- Les % réels ne se mettent à jour que pendant qu'une session Claude Code tourne.

## Dépannage

- **Pas d'icône de tray** : installe/active l'extension AppIndicator, puis relance.
- **Le widget ne s'ouvre pas** : une instance tourne peut-être déjà (clic sur l'icône de tray) ; sinon lance `bin/claude-tracker` dans un terminal pour voir l'erreur.
- **Toujours `ESTIMÉ`** : compte Pro/Max requis, nouvelle session Claude Code lancée après l'installation, et une réponse reçue. Vérifie `~/.cache/claude-tracker/limits.json`.
- **Ancienne icône** : déconnexion/reconnexion pour vider le cache de GNOME.
- `bin/claude-tracker` lance Electron avec `--no-sandbox` (le sandbox Chromium est bloqué sur Ubuntu pour un Electron installé par npm) ; l'appli ne charge que des fichiers locaux.

## Développement

```sh
npm test                                   # node --test
CLAUDE_TRACKER_SHOT=/tmp/shot.png bin/claude-tracker   # capture le rendu en PNG puis quitte
```

Licence MIT.
