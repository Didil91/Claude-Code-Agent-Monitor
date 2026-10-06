# Mode Machine — design

Date : 2026-10-07 · Statut : en revue · Repo : `Didil91/agent-monitor` (fork)

## Objectif

Voir en direct si le PC tient la charge pendant que les agents travaillent, et **relier les pics aux agents**. Le Monitor connaît les agents ; aucun outil système (AppControl, Gestionnaire des tâches) ne sait le faire.

Hors objectif v1 : historique au-delà de 5 minutes, attribution exacte de la charge par agent (somme de l'arbre de processus), limite d'agents pilotée par les métriques, températures SSD/CPU.

## Constats de départ

- L'onglet « État de santé » existant surveille le **Monitor lui-même** (mémoire Node, base, score), pas la machine.
- Sa ligne « CPU (1/5/15m) » utilise `os.loadavg()`, qui vaut toujours `0` sous Windows.
- Windows du PC : `fr-FR`. Les noms de compteurs de `Get-Counter` sont traduits ; on passe donc par les classes CIM `Win32_PerfFormattedData_*`, dont les noms ne changent pas avec la langue.
- Mesuré sur le PC (12 cœurs, sans droits admin) : un relevé CPU + disque + processus par CIM coûte environ 1 s dans une session PowerShell déjà ouverte ; le premier appel environ 8 s.
- GPU : NVIDIA GeForce GTX 1650 Ti, `nvidia-smi` présent ; charge, mémoire et température lisibles sans droits admin.

## 1. Collecte (serveur)

Nouveau module `server/lib/machine-metrics.js`, démarré avec le serveur.

| Métrique | Source Windows | Cadence |
|---|---|---|
| CPU % global | `Win32_PerfFormattedData_PerfOS_Processor` (`_Total`) | 2 s |
| Disque : % d'activité, octets lus/écrits par s | `Win32_PerfFormattedData_PerfDisk_PhysicalDisk` (`_Total`) | 2 s |
| RAM utilisée / totale | Node `os.totalmem()` / `os.freemem()` | 2 s |
| Espace disque utilisé (lecteur système) | Node `fs.statfs` | 30 s |
| GPU : charge, mémoire, °C | `nvidia-smi --query-gpu=... --format=csv -l 2` (processus permanent) | 2 s |
| Processus les plus gourmands | `Win32_PerfFormattedData_PerfProc_Process` (`Name`, `IDProcess`, `CreatingProcessID`, `PercentProcessorTime`, `WorkingSetPrivate`) | 5 s |

- **Un seul processus PowerShell permanent** (`pwsh -NoProfile -NonInteractive`) boucle sur les requêtes CIM et écrit une ligne JSON par relevé sur sa sortie standard. Pas de lancement de processus à chaque relevé.
- `PercentProcessorTime` par processus est rapporté à un cœur : on le divise par le nombre de cœurs pour obtenir un % de la machine.
- **Mémoire glissante** en mémoire vive : 5 minutes de relevés (150 points à 2 s). Rien en base.
- **Diffusion** par le WebSocket existant (nouveau type de message `machine.sample`) ; `GET /api/machine` renvoie la mémoire glissante pour remplir le graphe à l'ouverture.
- **Coût du capteur** : il apparaît lui-même dans la liste des processus. Objectif : moins de 2 % du CPU en moyenne. Si la mesure le dépasse, passer les processus à 10 s.

### Dégradation

- Pas de NVIDIA (`nvidia-smi` absent ou en échec) : pas de bloc GPU, aucune erreur affichée.
- Pas Windows : CPU (à partir de `os.cpus()`, par différence entre deux relevés), RAM et espace disque via Node ; pas d'activité disque, pas de processus.
- Le processus PowerShell meurt : relance automatique avec délai croissant (2 s, 4 s, 8 s… plafonné à 60 s) ; l'interface affiche « capteur indisponible » sur les blocs concernés.
- Arrêt du serveur : les processus fils (PowerShell, `nvidia-smi`) sont tués.

## 2. Interface (client)

### Pastille du tableau de bord

À côté de « En direct » : `CPU 20 %  RAM 51 %  Disque 2 %  GPU 39 % · 49 °C`. Neutre sous les seuils, orange puis rouge au-dessus. Un clic ouvre le mode Machine.

### Mode Machine

Troisième onglet de la bascule existante (`DASHBOARD_TABS` : `monitor`, `health`, **`machine`**).

1. **Onglets-métriques** (façon AppControl) : nom, valeur en direct, mini-courbe. L'onglet choisi est surligné à la couleur d'accent.
2. **Grand graphe** de la métrique choisie sur 5 minutes, en d3 (déjà dans le projet) : courbe pleine à dégradé léger ; température en surimpression pour le GPU.
3. **Repères d'agents** sur le graphe : traits verticaux fins aux instants de début et de fin de session, et de fin des commandes Bash longues. Étiquette au survol (nom de la session, commande). Lus dans les événements déjà stockés ; aucune nouvelle collecte.
4. **Processus les plus gourmands** : 8 premiers, tri CPU ou RAM au clic. Les processus `claude` sont mis en évidence.

### Seuils par défaut

| | Orange | Rouge |
|---|---|---|
| CPU | 70 % | 90 % |
| RAM | 80 % | 92 % |
| Disque (activité) | 80 % | 95 % |
| GPU °C | 75 °C | 85 °C |

Constantes dans un seul fichier, réglables plus tard depuis les paramètres (hors v1).

### Braise, le compagnon machine

Petite flamme flottante, sur le principe de Tabby (le chat) : déplaçable, position mémorisée, masquable dans les paramètres. Réutilise la mécanique de position de Tabby (`useTabbyPosition`).

| État | Apparence |
|---|---|
| Au repos (CPU < 10 %) | petite braise bleutée qui somnole |
| Normal | flamme orange calme |
| Seuil orange | flamme plus grande, ondulation rapide |
| Seuil rouge | grande flamme rouge, étincelles, bulle d'alerte (« Le disque est à 97 % ») |

Au clic, encart de résumé : les quatre métriques, le nombre d'agents actifs, le processus le plus gourmand, bouton « Ouvrir le mode Machine ». SVG animé en CSS ; animations coupées si `prefers-reduced-motion`.

### Thèmes et langues

- Aucune couleur en dur : uniquement les variables de thème existantes (surfaces, texte, accent). Orange et rouge d'alerte choisis pour un contraste suffisant sur les deux fonds.
- Textes dans les fichiers i18n, en français et en anglais (les autres langues retombent sur l'anglais).
- Vérification par captures en thème clair **et** sombre avant de déclarer une étape finie.

## 3. Attribution par agent (après la v1, à vérifier)

Piste pour sommer CPU et RAM par agent : les hooks du Monitor sont lancés par le processus `claude` ; `hook-handler.js` peut remonter ses ancêtres (`CreatingProcessID`) jusqu'au processus `claude` et envoyer son PID avec l'id de session. Le serveur somme ensuite l'arbre de chaque PID. À vérifier sous Windows : présence d'un shell intermédiaire, PID stable pendant la session. Permettrait l'empilement par agent sur le graphe.

## 4. Tests

- Serveur : analyse des lignes JSON du capteur et de la sortie `nvidia-smi` (cas nominal, valeurs manquantes, ligne invalide) ; mémoire glissante (taille bornée, ordre) ; normalisation du CPU par processus ; relance après mort du capteur (processus simulé) ; dégradation sans NVIDIA et hors Windows.
- Client : couleur de seuil selon la valeur ; rendu des onglets et de la liste des processus à partir d'échantillons fixes ; états de Braise selon les seuils ; traductions présentes en `fr` et `en`.
- Manuel : captures du mode Machine, de la pastille et de Braise dans les deux thèmes ; coût CPU du capteur relevé dans sa propre liste de processus.

## 5. Livraison

Découpage en tickets Linear, codés par Cyrus sur le fork (premier projet piloté par la spec) :

1. Capteur serveur, mémoire glissante, `GET /api/machine`, message WebSocket.
2. Mode Machine : onglets, grand graphe, processus.
3. Repères d'agents sur le graphe.
4. Pastille du tableau de bord.
5. Braise.

Prérequis : fiche `projets/agent-monitor.json` dans agent-stack et projet Linear `agent-monitor`.
