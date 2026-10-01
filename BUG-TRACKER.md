# 🐛 Bug Tracker — Images inaccessibles sur OVH

**Date** : 2026-07-08
**Projet** : Alexis Portfolio (Laravel 13 + Frontend Netlify)
**Domaine backend** : `porto.iafr-ahd.com` (OVH mutualisé)
**Domaine frontend** : `alexisnk.netlify.app` (Netlify)

---

## 🔴 Problème

Les images stockées dans `storage/app/public/thumbnails/` et `storage/app/public/main/` retournent **404** quand on y accède via `/storage/thumbnails/fichier.jpg`.

Les images sont bien présentes sur le serveur (30 fichiers dans chaque dossier, vérifié via PHP).

---

## ✅ Vérifications faites (tout est OK)

| Élément | Statut |
|---|---|
| Images dans `storage/app/public/` | ✅ 30 fichiers par dossier |
| Permissions dossiers/fichiers | ✅ 0755, lecture OK |
| `.htaccess` avec règle `/storage/` | ✅ Présent (1200 octets) |
| `.htaccess` avec headers CORS | ✅ Présent |
| `web.php` avec route `/storage/{path}` | ✅ Présent (3069 octets) |
| `web.php` contient `realpath()` | ✅ OUI |
| `web.php` contient `Access-Control-Allow-Origin` | ✅ OUI |
| `APP_KEY` dans `.env` | ✅ Générée |
| Caches Laravel vidés | ✅ Fait |
| `public/storage` (symlink cassé) | ✅ Supprimé |
| `DOCUMENT_ROOT` = `public/` | ✅ Correct |
| Serveur web | Apache (avec proxy Nginx devant) |
| `open_basedir` | Aucune restriction |
| PHP version | 8.3.23 |
| API `/api/projects` fonctionne | ✅ (le portfolio charge) |
| `realpath()` sur les images | ✅ Retourne le bon chemin |
| `file_exists()` / `is_readable()` | ✅ OUI |

---

## 🧪 Solutions essayées (échec)

### 1. Symlink `public/storage → storage/app/public`
- **Problème** : Le symlink local (Windows) était cassé sur Linux OVH
- **Action** : Supprimé
- **Résultat** : 403 Forbidden → 404 Not Found (progression, mais toujours KO)

### 2. Route Laravel fallback dans `web.php`
- **Action** : Route `GET /storage/{path}` qui sert les fichiers depuis `storage/app/public/`
- **Résultat** : 404 (la route n'est jamais atteinte)

### 3. Règle `.htaccess` prioritaire pour `/storage/`
- **Action** : `RewriteCond %{REQUEST_URI} ^/storage/` → `RewriteRule ^ index.php [L]`
- **Résultat** : 404

### 4. Headers CORS dans `.htaccess` + `web.php` + `config/cors.php`
- **Action** : Ajout de `Access-Control-Allow-Origin: *` à 3 niveaux
- **Résultat** : Les 404 n'ont toujours pas de header CORS (preuve que Laravel n'est pas atteint)

### 5. Génération de `APP_KEY`
- **Problème** : Le `.env` n'avait pas de `APP_KEY`, causant `MissingAppKeyException`
- **Action** : Générée via `gen-key.php`
- **Résultat** : Clé OK, mais les images toujours en 404

### 6. Sync des images vers `public/storage/`
- **Action** : Copie `storage/app/public/` → `public/storage/` via `sync-images.php`
- **Résultat** : 404

---

## 🔍 Hypothèse principale

**Nginx en proxy frontal intercepte les requêtes de fichiers statiques** (`.jpg`, `.png`, `.txt`) avant qu'elles n'atteignent Apache. Donc le `.htaccess` et la route Laravel ne sont jamais exécutés pour ces URLs.

Indices :
- `X-Forwarded-*` headers détectés
- `/robots.txt` (fichier existant) → servi directement (200, sans PHP)
- `/js/twint_ch.js` (fichier inexistant) → passe par `index.php` (PHP/8.3)
- `/cache-vid.php` → fonctionne (PHP)
- `/storage/*.jpg` → 404 (jamais loggé dans les logs OVH ?)

---

## 🟢 Prochaine tentative : `serve.php`

Un script PHP standalone (`public/serve.php`) qui sert les images avec CORS.

**Test** : `https://porto.iafr-ahd.com/serve.php?p=thumbnails/fichier.jpg`

Si ça marche → on change les URLs du frontend pour utiliser `serve.php`.
Si 404 → le problème est ailleurs.

---

## 🎯 Solution de repli (si tout échoue)

Modifier le frontend et l'API pour utiliser un endpoint PHP non-bloqué par Nginx :
- Backend : endpoint API `/api/images/{folder}/{filename}` qui retourne l'image
- Frontend : `getPublicUrl()` pointe vers ce nouvel endpoint
