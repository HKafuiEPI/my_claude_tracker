# Claude Tracker — résumé du projet

## 1. Ce que c'est

Widget Linux (Electron, ~800 lignes, 1 seule devDependency) qui affiche l'usage de Claude Code :
- **session de 5 h** et **semaine** (barres + temps avant reset) ;
- **delta de rythme** = `% du quota utilisé − % du temps écoulé` (négatif = en retard / quota qui va se perdre ; positif = en avance / limite risquée) ; seuil « dans le rythme » = ±5 pts ;
- projection de fin de fenêtre (`usedFrac / elapsed`, dès 3 % du temps écoulé) ;
- icône de tray (tooltip), fenêtre 400×600 sans cadre, masquée à la fermeture, instance unique.

Le projet fait aussi office de **mémoire de projet pour Claude Code** : un hook crée/injecte `CLAUDE_TRACKER.md` au démarrage de chaque session (avec l'usage courant) et ajoute une ligne de journal à la fin.

## 2. Architecture

| Fichier | Rôle |
|---|---|
| `src/usage.js` | Cœur : lit `~/.claude/projects/**/*.jsonl` (60 j), parse `message.usage`, dédoublonne (sessions reprises), blocs de 5 h façon ccusage, semaine, `gauge()`, `snapshot()`, `describe()`, config |
| `src/main.js` | Electron : fenêtre, tray, refresh toutes les 30 s, écrit `~/.cache/claude-tracker/snapshot.json` pour les hooks |
| `src/hook.js` | Hooks SessionStart / fin de session : lit le snapshot, injecte `CLAUDE_TRACKER.md` |
| `src/doc.js` | Création/mise à jour du `CLAUDE_TRACKER.md` (jamais dans `$HOME`, `/`, `~/.claude` ; opt-out `.no-claude-tracker`) |
| `src/ui/*`, `preload.js` | Rendu du widget (contextIsolation, pas de nodeIntegration) |
| `scripts/install.js` | Autostart + enregistrement des hooks (`uninstall` pour annuler) |
| `test/*` | `node --test` : doc, install, usage |

Config : `~/.config/claude-tracker/config.json` (`limit5h`, `limitWeek`, `weeklyReset`, `countCacheRead`, `refreshSec`, `startHidden`).

## 3. Point faible central

Les **limites sont devinées** : Anthropic ne les publie pas, donc `limit = ton plus gros bloc 5 h / ta plus grosse semaine passés`, en tokens (sans cache read). Conséquences :
- le « % utilisé » n'est pas celui de `/usage` ;
- ne voit que cette machine et pas claude.ai web / IDE / cloud (le quota est **partagé** entre tous) ;
- les limites réelles dépendent du plan, du modèle (limite Sonnet séparée sur Max) et fluctuent.

➡ Le plus gros gain possible : **remplacer l'estimation par les vrais pourcentages** (section 4).

## 4. Ce que j'ai trouvé sur internet

> Sources majoritairement tierces/non officielles ; les noms de champs peuvent changer → à vérifier sur ta version de Claude Code.

### 4.1 Vraies données de quota (priorité n°1)
1. **Statusline Claude Code** : sur Pro/Max, le JSON passé au script `statusLine` (stdin) contient `rate_limits` avec deux fenêtres (5 h / 7 j), chacune avec un pourcentage utilisé (0–100) et un reset en epoch secondes. Absent sur API key et avant la première réponse de la session. Un script statusLine pourrait écrire ce JSON dans le snapshot → le widget affiche les vrais %. ccusage signale que la disposition des clés a changé (tableau `limits` structuré, fenêtre pas toujours de 5 h) : **ne pas coder en dur « 5 h » ni les noms de clés**, tolérer l'absence.
2. **Endpoint OAuth non documenté** `https://api.anthropic.com/api/oauth/usage` : Bearer token (lu dans `~/.claude/.credentials.json` sous Linux) + header `anthropic-beta: oauth-2025-04-20`. Renvoie `five_hour`, `seven_day`, `seven_day_sonnet`, `extra_usage` avec `utilization` (0–100) et reset en ISO 8601. Fonctionne sans que Claude Code tourne, mais non officiel, risque de casse et de rate-limit → poll rare (≥ 60 s), cache, gestion 401/429, ne jamais logger le token.
3. `/usage` (alias `/cost`, `/stats`) dans Claude Code et claude.ai → Settings → Usage : référence pour calibrer/valider.

### 4.2 Fonctions à reprendre des outils existants
- **Claude-Code-Usage-Monitor** (Maciek-roboblog) : burn rate récent, prédiction « limite atteinte avant le reset », limite auto par **P90** de l'historique (plus robuste que le `max` actuel, qui est tiré par un pic isolé), plans Pro/Max5/Max20, fuseau et heure de reset configurables, entrepôt local pour garder l'historique au-delà des 30 j que Claude purge.
- **ccusage** : référence pour les blocs de 5 h (déjà imitée), coût en $ par modèle/jour/projet, rapport JSON. Rappel : il mesure tokens/coût, **pas** le quota restant.
- **cship** (statusline Rust), **claude-usage** / **clauth** (crates Rust) : exemples de lecture de l'endpoint OAuth et de la statusline.
- Extension Chrome « Claude Code Usage » : lit le compte claude.ai (couvre l'usage web).

### 4.3 Règles de quota à connaître
- Fenêtre 5 h : démarre au premier message, reset 5 h après.
- Hebdo : sources **contradictoires** (reset fixe par compte vs fenêtre glissante depuis le 1er prompt). Ne pas supposer `lundi 00:00` : le lire depuis `resets_at` quand dispo.
- Max : limite hebdo **Sonnet séparée** + limite tous modèles ; `extra_usage` (dépassement payant).
- Quota partagé claude.ai + terminal + IDE + cloud.
- Anthropic a déjà remis les compteurs à zéro ponctuellement (ex. 15 mai 2026) → un delta peut sauter ; prévoir un bouton « recalibrer ».

### 4.4 Linux / Electron
- **Tray sur GNOME** : pas d'icône sans l'extension AppIndicator (Wayland n'a pas de spec tray). Un bug de tray sur Ubuntu 26.04 / GNOME 50 Wayland a été corrigé côté Electron (43.4.1 selon un rapport Obsidian) ; ton `package.json` est en `^41.7.1` → vérifier le tray après la migration 26.04, envisager de monter Electron.
- Wayland : placement de fenêtre et always-on-top contrôlés par le compositeur ; `setPosition` dans `main.js` peut être ignoré → tester, prévoir un repli (fenêtre déplaçable, ou position sauvée).
- `--no-sandbox` dans `npm start` : à éviter si possible (voir `chrome-sandbox` / userns restreints sur Ubuntu 24.04+).

## 5. Pistes d'amélioration (ordre conseillé)

1. **Vrais %** via statusLine `rate_limits` (local, propre) avec repli sur l'estimation actuelle ; badge « estimé / réel » dans l'UI.
2. Reset hebdo réel (`resets_at`) à la place de `weeklyReset` figé.
3. Limite estimée par **P90** plutôt que `max`.
4. **Notifications** (libnotify/Electron `Notification`) : « 80 % de la session », « limite prévue dans X min », « tu es 30 pts en retard, la semaine se perd ».
5. Jauge Sonnet séparée + `extra_usage` si plan Max.
6. Historique/graphique (SQLite ou JSON) des deltas et du burn rate ; export CSV.
7. Coût estimé en $ par modèle (tarifs API, via ccusage-like).
8. Multi-machines : agrégation via fichier synchronisé (Syncthing) ou endpoint OAuth qui est, lui, global au compte — c'est aussi la solution la plus simple au problème « claude.ai non compté ».
9. Packaging : AppImage/.deb (electron-builder), autostart `.desktop`, extension GNOME Shell comme alternative légère au tray.

## 6. Points d'attention

- Sécurité : si l'endpoint OAuth est utilisé, le token ne sort jamais de la machine, jamais loggé ; fichier de snapshot sans secret.
- `CLAUDE_TRACKER.md` est injecté dans le contexte à chaque session : le garder court (coût en tokens).
- L'hypothèse « tokens sans cache read » est une approximation ; non validée contre le vrai compteur Anthropic.

## Sources

- [Claude Code usage limits — Hashnode](https://hashnode.com/blog/claude-code-usage-limits)
- [Claude Code usage limits — DataCamp](https://www.datacamp.com/tutorial/claude-code-usage-limits)
- [Check Claude Code usage — ContextBolt](https://contextbolt.com/blog/how-to-check-claude-code-usage/)
- [Status line 5h/7d — skoula.cz](https://skoula.cz/blog/2026/6/how-to-display-context-and-5h-7d-limits-in-the-claude-code-status-bar/)
- [Status line usage limit — wmedia.es](https://wmedia.es/en/tips/claude-code-usage-limit-status-line)
- [ccusage (PyPI)](https://pypi.org/project/ccusage/)
- [cship `usage_limits.rs`](https://docs.rs/crate/cship/1.7.1/source/src/usage_limits.rs)
- [claude-usage (crate)](https://docs.rs/crate/claude-usage/0.2.3/source/README.md)
- [clauth `usage/fetch.rs`](https://docs.rs/crate/clauth/0.5.5/source/src/usage/fetch.rs)
- [Claude-Code-Usage-Monitor](https://gittrend.io/repo/Maciek-roboblog/Claude-Code-Usage-Monitor)
- [Limites hebdo/Sonnet — Verdent](https://www.verdent.ai/guides/claude/usage-limits)
- [Rate limits explained — Inventive HQ](https://inventivehq.com/blog/claude-code-rate-limits-explained)
- [Reset des compteurs 15 mai 2026](https://pasqualepillitteri.it/en/news/2614/claude-resets-rate-limits-5-hour-weekly-may-15-2026)
- [Tray Electron cassé Ubuntu 26.04 — Obsidian forum](https://forum.obsidian.md/t/linux-tray-icon-is-a-dead-placeholder-obsidian-1-13-7-bundles-electron-43-3-0-fixed-upstream-in-43-4-1/117750)
- [AppIndicator sous GNOME](https://discourse.gnome.org/t/appindicator-support-in-gnome-3/1807)
