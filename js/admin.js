/* =========================================================================
 * Admin dashboard — branché sur Supabase (Auth + REST + Storage)
 * Auth : Supabase Auth (email/mot de passe)
 * Data : table `projects` + `contacts` (RLS : lecture/écriture pour l'admin connecté)
 * Images : Supabase Storage, bucket public "projects"
 * (getPublicUrl & generateUniqueFileName viennent de api-config.js)
 * ========================================================================= */

const ADM_URL    = (window.SUPABASE_URL || '').replace(/\/+$/, '');
const ADM_KEY    = window.SUPABASE_ANON_KEY || '';
const ADM_BUCKET = 'projects';

let admToken   = localStorage.getItem('sb_admin_token');
let admRefresh = localStorage.getItem('sb_admin_refresh');

/* ------------------------------------------------------- helpers Supabase */
function admHeaders(auth = true, extra = {}) {
    return {
        apikey: ADM_KEY,
        Authorization: 'Bearer ' + ((auth && admToken) ? admToken : ADM_KEY),
        ...extra,
    };
}
async function admJson(res) {
    const t = await res.text();
    if (!t) return null;
    try { return JSON.parse(t); } catch { return t; }
}
function handleAuthError(status) {
    if (status === 401 || status === 403) {
        admToken = null; admRefresh = null;
        localStorage.removeItem('sb_admin_token');
        localStorage.removeItem('sb_admin_refresh');
        showLoginForm();
        showNotification('Session expirée, reconnecte-toi.', 'error');
        return true;
    }
    return false;
}

async function sbLogin(email, password) {
    const res = await fetch(`${ADM_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ADM_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await admJson(res);
    if (!res.ok) throw data || {};
    admToken = data.access_token; admRefresh = data.refresh_token;
    localStorage.setItem('sb_admin_token', admToken);
    localStorage.setItem('sb_admin_refresh', admRefresh || '');
    return data.user;
}
async function sbCurrentUser() {
    if (!admToken) return null;
    const res = await fetch(`${ADM_URL}/auth/v1/user`, {
        headers: { apikey: ADM_KEY, Authorization: 'Bearer ' + admToken },
    });
    if (!res.ok) return null;
    return await admJson(res);
}
async function sbLogout() {
    try {
        await fetch(`${ADM_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: { apikey: ADM_KEY, Authorization: 'Bearer ' + admToken },
        });
    } catch { /* ignore */ }
    admToken = null; admRefresh = null;
    localStorage.removeItem('sb_admin_token');
    localStorage.removeItem('sb_admin_refresh');
}

async function sbGetProjects() {
    const res = await fetch(`${ADM_URL}/rest/v1/projects?select=*&order=created_at.desc`, { headers: admHeaders(false) });
    if (!res.ok) { handleAuthError(res.status); throw await admJson(res); }
    return (await admJson(res)) || [];
}
async function sbCreateProject(data) {
    const res = await fetch(`${ADM_URL}/rest/v1/projects`, {
        method: 'POST',
        headers: admHeaders(true, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(data),
    });
    if (!res.ok) { handleAuthError(res.status); throw await admJson(res); }
    const r = await admJson(res); return Array.isArray(r) ? r[0] : r;
}
async function sbUpdateProject(id, data) {
    const res = await fetch(`${ADM_URL}/rest/v1/projects?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: admHeaders(true, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(data),
    });
    if (!res.ok) { handleAuthError(res.status); throw await admJson(res); }
    const r = await admJson(res); return Array.isArray(r) ? r[0] : r;
}
async function sbDeleteProject(id) {
    const res = await fetch(`${ADM_URL}/rest/v1/projects?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: admHeaders(true),
    });
    if (!res.ok) { handleAuthError(res.status); throw await admJson(res); }
    return true;
}
async function sbUploadImage(file, folder) {
    // Passe par l'Edge Function "upload-image" : elle vérifie que l'admin est
    // connecté puis uploade avec la service_role côté serveur (sécurisé).
    const res = await fetch(`${ADM_URL}/functions/v1/upload-image`, {
        method: 'POST',
        headers: {
            apikey: ADM_KEY,
            Authorization: 'Bearer ' + admToken,
            'Content-Type': file.type || 'application/octet-stream',
            'x-folder': folder,
            'x-filename': file.name || 'image',
        },
        body: file,
    });
    if (!res.ok) { handleAuthError(res.status); throw await admJson(res); }
    const data = await admJson(res);
    if (!data || !data.url) throw { message: 'Upload échoué' };
    return data.url;
}
async function sbGetMessages() {
    const res = await fetch(`${ADM_URL}/rest/v1/contacts?select=*&order=created_at.desc`, { headers: admHeaders(true) });
    if (!res.ok) { handleAuthError(res.status); throw await admJson(res); }
    return (await admJson(res)) || [];
}
async function sbDeleteMessage(id) {
    const res = await fetch(`${ADM_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: admHeaders(true),
    });
    if (!res.ok) { handleAuthError(res.status); throw await admJson(res); }
    return true;
}

/* --------------------------------------------------------------- éléments */
const authContainer = document.getElementById('auth-container');
const adminContainer = document.getElementById('admin-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const projectForm = document.getElementById('project-form');
const deleteModal = document.getElementById('delete-modal');

const thumbnailZone = document.getElementById('thumbnail-zone');
const thumbnailInput = document.getElementById('thumbnail-input');
const thumbnailPreview = document.getElementById('thumbnail-preview');
const imageZone = document.getElementById('image-zone');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');

let currentUser = null;
let allProjects = [];
let allMessages = [];
let currentEditId = null;
let deleteProjectId = null;
let thumbnailFile = null;
let mainImageFile = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAuthState();
    initializeEventListeners();
    initializeUploadZones();
});

async function checkAuthState() {
    try {
        if (!admToken) { showLoginForm(); return; }
        const user = await sbCurrentUser();
        if (!user) { await sbLogout(); showLoginForm(); return; }
        currentUser = user;
        showAdminDashboard();
    } catch (err) {
        console.error('Session check failed:', err);
        await sbLogout();
        showLoginForm();
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const loginBtn = document.getElementById('login-btn');

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="loader-small"></span> Connexion...';
    loginError.classList.add('hidden');

    try {
        currentUser = await sbLogin(email, password);
        showAdminDashboard();
    } catch (err) {
        console.error('Login error:', err);
        const msg = err.error_description || err.msg || err.message || err.error;
        loginError.textContent = getAuthErrorMessage(msg);
        loginError.classList.remove('hidden');
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span>Se connecter</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
    }
});

logoutBtn.addEventListener('click', async () => {
    await sbLogout();
    currentUser = null;
    showLoginForm();
    showNotification('Déconnexion réussie', 'success');
});

function getAuthErrorMessage(message) {
    const errors = {
        'Invalid login credentials': 'Email ou mot de passe incorrect',
        'Email not confirmed': 'Email non confirmé',
        'User not found': 'Utilisateur non trouvé',
        'invalid_grant': 'Email ou mot de passe incorrect',
    };
    return errors[message] || 'Erreur de connexion. Vérifie tes identifiants.';
}

function showLoginForm() {
    authContainer.classList.remove('hidden');
    adminContainer.classList.add('hidden');
}

function showAdminDashboard() {
    authContainer.classList.add('hidden');
    adminContainer.classList.remove('hidden');
    if (currentUser) {
        document.getElementById('user-email').textContent = currentUser.email;
        document.getElementById('user-initial').textContent = (currentUser.email || 'A').charAt(0).toUpperCase();
    }
    loadAllProjects();
    loadMessages();
}

async function loadAllProjects() {
    try {
        showProjectsLoading(true);
        allProjects = (await sbGetProjects()) || [];
        updateDashboardStats();
        displayProjectsList();
        displayRecentProjects();
    } catch (err) {
        console.error('Error loading projects:', err);
        showNotification('Erreur lors du chargement des projets', 'error');
    } finally {
        showProjectsLoading(false);
    }
}

async function createProject(projectData) { return sbCreateProject(projectData); }
async function updateProject(id, projectData) { return sbUpdateProject(id, projectData); }
async function deleteProject(id) { await sbDeleteProject(id); return true; }
async function uploadImage(file, folder = 'main') { return sbUploadImage(file, folder); }

function initializeUploadZones() {
    setupUploadZone(thumbnailZone, thumbnailInput, thumbnailPreview, (file) => { thumbnailFile = file; });
    setupUploadZone(imageZone, imageInput, imagePreview, (file) => { mainImageFile = file; });
}

function setupUploadZone(zone, input, preview, onFileSelect) {
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileSelect(file, preview, onFileSelect);
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleFileSelect(file, preview, onFileSelect);
    });
}

function handleFileSelect(file, preview, onFileSelect) {
    if (!file.type.startsWith('image/')) { showNotification('Veuillez sélectionner une image', 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { showNotification('L\'image ne doit pas dépasser 10MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        preview.innerHTML = `
            <img src="${e.target.result}" alt="Preview">
            <div class="preview-overlay">
                <span class="file-name">${file.name}</span>
                <button type="button" class="remove-file" onclick="removeFile(event, '${preview.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>`;
        preview.classList.add('has-image');
    };
    reader.readAsDataURL(file);
    onFileSelect(file);
}

function removeFile(event, previewId) {
    event.stopPropagation();
    const preview = document.getElementById(previewId);
    const defaultContent = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>
        <p>Cliquez ou glissez une image</p><span>PNG, JPG jusqu'à 10MB</span>`;
    preview.innerHTML = defaultContent;
    preview.classList.remove('has-image');
    if (previewId === 'thumbnail-preview') { thumbnailFile = null; thumbnailInput.value = ''; }
    else { mainImageFile = null; imageInput.value = ''; }
}
window.removeFile = removeFile;

projectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('submit-form');
    const submitText = document.getElementById('submit-text');
    const isEditing = currentEditId !== null;

    if (!isEditing && (!thumbnailFile || !mainImageFile)) {
        showNotification('Veuillez sélectionner les deux images', 'error');
        return;
    }
    submitBtn.disabled = true;
    submitText.textContent = isEditing ? 'Mise à jour...' : 'Création...';

    try {
        let thumbnailUrl = null;
        let mainImageUrl = null;
        if (thumbnailFile) thumbnailUrl = await uploadImage(thumbnailFile, 'thumbnails');
        if (mainImageFile) mainImageUrl = await uploadImage(mainImageFile, 'main');

        const projectData = {
            title: document.getElementById('project-title').value,
            description: document.getElementById('project-description').value,
            category: document.getElementById('project-category').value,
        };
        if (thumbnailUrl) projectData.thumbnail_url = thumbnailUrl;
        if (mainImageUrl) projectData.image_url = mainImageUrl;

        if (isEditing) {
            await updateProject(currentEditId, projectData);
            showNotification('Projet mis à jour avec succès', 'success');
        } else {
            await createProject(projectData);
            showNotification('Projet créé avec succès', 'success');
        }
        resetProjectForm();
        await loadAllProjects();
        switchSection('projects');
    } catch (err) {
        console.error('Form submission error:', err);
        showNotification('Erreur lors de l\'enregistrement', 'error');
    } finally {
        submitBtn.disabled = false;
        submitText.textContent = isEditing ? 'Mettre à jour' : 'Créer le projet';
    }
});

function resetProjectForm() {
    projectForm.reset();
    currentEditId = null;
    thumbnailFile = null;
    mainImageFile = null;
    const defaultContent = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>
        <p>Cliquez ou glissez une image</p><span>PNG, JPG jusqu'à 10MB</span>`;
    thumbnailPreview.innerHTML = defaultContent;
    thumbnailPreview.classList.remove('has-image');
    imagePreview.innerHTML = defaultContent;
    imagePreview.classList.remove('has-image');
    document.getElementById('form-title').textContent = 'Ajouter un projet';
    document.getElementById('form-subtitle').textContent = 'Remplissez les informations du projet';
    document.getElementById('submit-text').textContent = 'Créer le projet';
}

function editProject(id) {
    const project = allProjects.find(p => p.id === id);
    if (!project) return;
    currentEditId = id;
    document.getElementById('project-id').value = id;
    document.getElementById('project-title').value = project.title;
    document.getElementById('project-description').value = project.description || '';
    document.getElementById('project-category').value = project.category;

    if (project.thumbnail_url) {
        thumbnailPreview.innerHTML = `
            <img src="${getPublicUrl(project.thumbnail_url)}" alt="Thumbnail">
            <div class="preview-overlay"><span class="file-name">Image actuelle</span></div>`;
        thumbnailPreview.classList.add('has-image');
    }
    if (project.image_url) {
        imagePreview.innerHTML = `
            <img src="${getPublicUrl(project.image_url)}" alt="Main image">
            <div class="preview-overlay"><span class="file-name">Image actuelle</span></div>`;
        imagePreview.classList.add('has-image');
    }
    document.getElementById('form-title').textContent = 'Modifier le projet';
    document.getElementById('form-subtitle').textContent = 'Modifiez les informations du projet';
    document.getElementById('submit-text').textContent = 'Mettre à jour';
    switchSection('add-project');
}
window.editProject = editProject;

function confirmDeleteProject(id) {
    deleteProjectId = id;
    deleteModal.classList.add('active');
}
window.confirmDeleteProject = confirmDeleteProject;

document.getElementById('confirm-delete').addEventListener('click', async () => {
    if (!deleteProjectId) return;
    const btn = document.getElementById('confirm-delete');
    btn.disabled = true;
    btn.textContent = 'Suppression...';
    try {
        await deleteProject(deleteProjectId);
        showNotification('Projet supprimé avec succès', 'success');
        await loadAllProjects();
    } catch (err) {
        showNotification('Erreur lors de la suppression', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Supprimer';
        deleteModal.classList.remove('active');
        deleteProjectId = null;
    }
});
document.getElementById('cancel-delete').addEventListener('click', () => {
    deleteModal.classList.remove('active');
    deleteProjectId = null;
});

function updateDashboardStats() {
    document.getElementById('total-projects').textContent = allProjects.length;
    document.getElementById('graphisme-count').textContent = allProjects.filter(p => p.category === 'Graphisme').length;
    document.getElementById('marketing-count').textContent = allProjects.filter(p => p.category === 'Marketing').length;
    document.getElementById('mobile-count').textContent = allProjects.filter(p => p.category === 'Développement Mobile').length;
}

function displayRecentProjects() {
    const container = document.getElementById('recent-projects-list');
    const recentProjects = allProjects.slice(0, 5);
    if (recentProjects.length === 0) {
        container.innerHTML = `<tr><td colspan="4" class="empty-row">Aucun projet pour le moment</td></tr>`;
        return;
    }
    container.innerHTML = recentProjects.map(project => {
        const thumbnailUrl = getPublicUrl(project.thumbnail_url) || 'https://via.placeholder.com/50x50/1a1a2e/6c5ce7?text=No';
        const date = new Date(project.created_at).toLocaleDateString('fr-FR');
        return `
            <tr>
                <td><div class="project-cell">
                    <img src="${thumbnailUrl}" alt="${project.title}" class="project-thumb">
                    <span>${project.title}</span>
                </div></td>
                <td><span class="category-badge ${getCategoryClass(project.category)}">${project.category}</span></td>
                <td>${date}</td>
                <td><div class="table-actions">
                    <button class="action-btn edit" onclick="editProject('${project.id}')" title="Modifier">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="action-btn delete" onclick="confirmDeleteProject('${project.id}')" title="Supprimer">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div></td>
            </tr>`;
    }).join('');
}

function displayProjectsList() {
    const container = document.getElementById('projects-list');
    const emptyState = document.getElementById('projects-empty');
    let filteredProjects = [...allProjects];
    const searchQuery = document.getElementById('search-projects').value.toLowerCase();
    const categoryFilter = document.getElementById('filter-category').value;
    if (searchQuery) {
        filteredProjects = filteredProjects.filter(p =>
            p.title.toLowerCase().includes(searchQuery) || p.description?.toLowerCase().includes(searchQuery));
    }
    if (categoryFilter !== 'all') filteredProjects = filteredProjects.filter(p => p.category === categoryFilter);
    if (filteredProjects.length === 0) { container.innerHTML = ''; emptyState.classList.remove('hidden'); return; }
    emptyState.classList.add('hidden');
    container.innerHTML = filteredProjects.map(project => {
        const thumbnailUrl = getPublicUrl(project.thumbnail_url) || 'https://via.placeholder.com/300x200/1a1a2e/6c5ce7?text=No+Image';
        const date = new Date(project.created_at).toLocaleDateString('fr-FR');
        return `
            <div class="project-card-admin">
                <div class="card-image-admin">
                    <img src="${thumbnailUrl}" alt="${project.title}">
                    <span class="category-badge ${getCategoryClass(project.category)}">${project.category}</span>
                </div>
                <div class="card-content-admin">
                    <h3>${project.title}</h3>
                    <p>${truncateText(project.description, 100)}</p>
                    <span class="card-date">${date}</span>
                </div>
                <div class="card-actions-admin">
                    <button class="btn btn-secondary btn-sm" onclick="editProject('${project.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Modifier
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="confirmDeleteProject('${project.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Supprimer
                    </button>
                </div>
            </div>`;
    }).join('');
}

/* --------------------------------------------------------------- Messages */
async function loadMessages() {
    const loading = document.getElementById('messages-loading');
    try {
        if (loading) loading.classList.remove('hidden');
        allMessages = (await sbGetMessages()) || [];
        updateMessagesBadge();
        displayMessages();
    } catch (err) {
        console.error('Error loading messages:', err);
        showNotification('Erreur lors du chargement des messages', 'error');
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

function updateMessagesBadge() {
    const count = allMessages.length;
    const countEl = document.getElementById('messages-count');
    if (countEl) countEl.textContent = count;
    const badge = document.getElementById('messages-badge');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function displayMessages() {
    const container = document.getElementById('messages-list');
    const emptyState = document.getElementById('messages-empty');
    if (!container) return;
    if (allMessages.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');
    container.innerHTML = allMessages.map(m => {
        const date = m.created_at ? new Date(m.created_at).toLocaleString('fr-FR') : '';
        const subject = m.subject ? `<span class="msg-subject">${escapeHtml(m.subject)}</span>` : '';
        const email = escapeHtml(m.email);
        return `
            <div class="message-card">
                <div class="msg-top">
                    <span class="msg-name">${escapeHtml(m.name)}</span>
                    <a class="msg-email" href="mailto:${email}">${email}</a>
                    <span class="msg-date">${date}</span>
                </div>
                ${subject}
                <p class="msg-body">${escapeHtml(m.message)}</p>
                <div class="msg-actions">
                    <a class="btn btn-secondary btn-sm" href="mailto:${email}?subject=RE:%20votre%20message">Répondre par email</a>
                    <button class="btn btn-danger btn-sm" onclick="deleteMessage(${Number(m.id)})">Supprimer</button>
                </div>
            </div>`;
    }).join('');
}

async function deleteMessage(id) {
    if (!window.confirm('Supprimer ce message définitivement ?')) return;
    try {
        await sbDeleteMessage(id);
        allMessages = allMessages.filter(m => Number(m.id) !== Number(id));
        updateMessagesBadge();
        displayMessages();
        showNotification('Message supprimé', 'success');
    } catch (err) {
        console.error('Delete message error:', err);
        showNotification('Erreur lors de la suppression du message', 'error');
    }
}
window.deleteMessage = deleteMessage;

function getCategoryClass(category) {
    const classes = { 'Graphisme': 'category-design', 'Marketing': 'category-marketing', 'Développement Mobile': 'category-mobile' };
    return classes[category] || 'category-default';
}
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}
function showProjectsLoading(show) {
    const loading = document.getElementById('projects-loading');
    const list = document.getElementById('projects-list');
    if (show) { loading.classList.remove('hidden'); list.classList.add('hidden'); }
    else { loading.classList.add('hidden'); list.classList.remove('hidden'); }
}

function initializeEventListeners() {
    document.querySelectorAll('[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchSection(link.getAttribute('data-section'));
        });
    });
    document.getElementById('cancel-form').addEventListener('click', () => { resetProjectForm(); switchSection('projects'); });
    document.getElementById('search-projects').addEventListener('input', displayProjectsList);
    document.getElementById('filter-category').addEventListener('change', displayProjectsList);

    const refreshMessages = document.getElementById('refresh-messages');
    if (refreshMessages) refreshMessages.addEventListener('click', loadMessages);

    const togglePwd = document.querySelector('.toggle-password');
    if (togglePwd) togglePwd.addEventListener('click', function () {
        const input = document.getElementById('login-password');
        const type = input.type === 'password' ? 'text' : 'password';
        input.type = type;
        this.innerHTML = type === 'password'
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    });

    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) { deleteModal.classList.remove('active'); deleteProjectId = null; }
    });
}

function switchSection(sectionName) {
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.toggle('active', link.getAttribute('data-section') === sectionName);
    });
    document.querySelectorAll('.admin-section').forEach(section => section.classList.remove('active'));
    const targetSection = document.getElementById(`section-${sectionName}`);
    if (targetSection) targetSection.classList.add('active');
    if (sectionName === 'add-project' && currentEditId === null) resetProjectForm();
    if (sectionName === 'messages') loadMessages();
}

function showNotification(message, type = 'success') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${type === 'success'
                ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
                : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
        </svg>
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => { notification.classList.remove('show'); setTimeout(() => notification.remove(), 300); }, 5000);
}

console.log('✅ Admin dashboard (Supabase) initialized');
