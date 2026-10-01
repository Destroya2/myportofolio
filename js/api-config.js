/* =========================================================================
   Supabase data layer  (remplace l'ancienne API Laravel)
   -------------------------------------------------------------------------
   Interface identique à l'ancienne pour ne rien casser côté project.js /
   project-page.js :
     apiClient.get('/projects')          -> array
     apiClient.get('/projects/{uuid}')   -> objet unique (throw {status:404} si absent)
     apiClient.post('/contacts', body)   -> contact créé
     getPublicUrl(path)                  -> URL absolue de l'image

   Config injectée par la page (index.html / project.html) :
     window.SUPABASE_URL, window.SUPABASE_ANON_KEY   (clé ANON publique uniquement)
     window.STORAGE_URL   -> base des images relatives (elles restent sur OVH)

   ⚠️ Ne jamais mettre la service_role key ici : ce fichier est public.
   ========================================================================= */

const SUPABASE_URL = (window.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
const REST_URL = `${SUPABASE_URL}/rest/v1`;

// Images historiques : chemins relatifs servis depuis OVH /storage.
const STORAGE_BASE_URL = (window.STORAGE_URL || (window.API_URL ? window.API_URL + '/storage' : '')).replace(/\/+$/, '');

function supabaseHeaders(extra = {}) {
    return {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
        ...extra,
    };
}

async function parseBody(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
}

const apiClient = {
    token: null,
    setToken() {}, // Auth admin gérée séparément (Supabase Auth) — non branchée ici.

    async get(endpoint) {
        // /projects/{id} -> enregistrement unique
        const single = endpoint.match(/^\/projects\/([^/?]+)$/);
        if (single) {
            const id = decodeURIComponent(single[1]);
            const url = `${REST_URL}/projects?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
            const response = await fetch(url, { headers: supabaseHeaders() });
            const data = await parseBody(response);
            if (!response.ok) throw { status: response.status, ...(data || {}) };
            const record = Array.isArray(data) ? data[0] : null;
            if (!record) throw { status: 404, message: 'Not found' };
            return record;
        }

        // /projects -> liste complète, plus récents d'abord
        if (endpoint === '/projects') {
            const url = `${REST_URL}/projects?select=*&order=created_at.desc`;
            const response = await fetch(url, { headers: supabaseHeaders() });
            const data = await parseBody(response);
            if (!response.ok) throw { status: response.status, ...(data || {}) };
            return Array.isArray(data) ? data : [];
        }

        // Passthrough PostgREST
        const response = await fetch(`${REST_URL}${endpoint}`, { headers: supabaseHeaders() });
        const data = await parseBody(response);
        if (!response.ok) throw { status: response.status, ...(data || {}) };
        return data;
    },

    async post(endpoint, body) {
        // /contacts -> insertion d'un message
        if (endpoint === '/contacts') {
            const payload = {
                name: body.name,
                email: body.email,
                subject: body.subject || null,
                message: body.message,
            };
            // return=minimal : la table contacts n'a pas de policy SELECT (messages privés),
            // donc on n'essaie pas de relire la ligne insérée (sinon la RLS refuse).
            const response = await fetch(`${REST_URL}/contacts`, {
                method: 'POST',
                headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const data = await parseBody(response);
                const status = response.status === 400 ? 422 : response.status;
                throw { status, errors: {}, ...(data || {}) };
            }
            return { success: true };
        }

        const response = await fetch(`${REST_URL}${endpoint}`, {
            method: 'POST',
            headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
            body: JSON.stringify(body),
        });
        const data = await parseBody(response);
        if (!response.ok) throw { status: response.status, ...(data || {}) };
        return data;
    },

    // --- Écritures admin : passthrough PostgREST (nécessitent Supabase Auth + RLS,
    //     non branché pour l'instant — voir note admin). Conservées pour ne pas casser admin.js.
    async put(endpoint, body) {
        const response = await fetch(`${REST_URL}${endpoint}`, {
            method: 'PATCH',
            headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
            body: JSON.stringify(body),
        });
        const data = await parseBody(response);
        if (!response.ok) throw { status: response.status, ...(data || {}) };
        return data;
    },
    async delete(endpoint) {
        const response = await fetch(`${REST_URL}${endpoint}`, { method: 'DELETE', headers: supabaseHeaders() });
        const data = await parseBody(response);
        if (!response.ok) throw { status: response.status, ...(data || {}) };
        return data;
    },
    async upload(endpoint, formData) {
        const response = await fetch(`${REST_URL}${endpoint}`, { method: 'POST', headers: supabaseHeaders(), body: formData });
        const data = await parseBody(response);
        if (!response.ok) throw { status: response.status, ...(data || {}) };
        return data;
    },
};

function getPublicUrl(path) {
    if (!path) return '';
    if (path.startsWith('http')) {
        if (path.includes('unsplash.com')) return `${path}${path.includes('?') ? '&' : '?'}fm=webp`;
        return path;
    }
    const clean = String(path).replace(/^\/+/, '');
    return STORAGE_BASE_URL ? `${STORAGE_BASE_URL}/${clean}` : `/${clean}`;
}

function generateUniqueFileName(file) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const extension = file.name.split('.').pop();
    return `${timestamp}-${randomString}.${extension}`;
}

console.log('Supabase data layer initialized');
