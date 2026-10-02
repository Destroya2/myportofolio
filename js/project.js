const projectsGrid = document.getElementById('projects-grid');
const loadingState = document.getElementById('loading');
const emptyState = document.getElementById('empty-state');
const filterTabs = document.querySelectorAll('.filter-tab');
const header = document.querySelector('.header');
const navToggle = document.getElementById('nav-toggle');
const mobileMenu = document.getElementById('mobile-menu');
const cursorFollower = document.getElementById('cursor-follower');
const pageTransition = document.getElementById('page-transition');

let allProjects = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    initNavigation();
    initCursor();
    initScrollEffects();
    setCurrentYear();
});

async function loadProjects() {
    try {
        // Warm-up : réveille Supabase si le projet est en pause (cold start).
        await warmUpSupabase();

        const projects = await apiClient.get('/projects');

        allProjects = projects || [];
        displayProjects(allProjects);
    } catch (err) {
        console.error('Error loading projects:', err);
        showError();
    } finally {
        loadingState.classList.add('hidden');
    }
}

/**
 * Envoie un ping léger à Supabase pour déclencher le cold start
 * avant la vraie requête. Affiche un message de progression et
 * retry automatiquement si le serveur met du temps à répondre.
 */
async function warmUpSupabase() {
    const maxAttempts = 3;
    const timeoutMs = 8000; // 8s par tentative
    const loadingText = loadingState.querySelector('.loading-text');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (loadingText) {
                loadingText.textContent = attempt === 1
                    ? 'Connexion au portfolio...'
                    : `Tentative ${attempt}/${maxAttempts}...`;
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(
                `${SUPABASE_URL}/rest/v1/projects?select=id&limit=1`,
                {
                    headers: {
                        apikey: SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    },
                    signal: controller.signal,
                }
            );
            clearTimeout(timer);

            if (response.ok || response.status < 500) {
                if (loadingText) loadingText.textContent = 'Chargement des projets...';
                return; // Supabase est réveillé
            }
        } catch (_) {
            // timeout ou erreur réseau → on retry
        }

        // Petite pause avant le retry
        if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Si on arrive ici, Supabase ne répond toujours pas mais on tente
    // quand même la requête principale (elle pourrait réussir).
    if (loadingText) loadingText.textContent = 'Chargement des projets...';
}

function displayProjects(projects) {
    projectsGrid.innerHTML = '';

    if (!projects || projects.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    projects.forEach((project, index) => {
        const card = createProjectCard(project, index);
        projectsGrid.appendChild(card);
    });

    animateCards();
}

function createProjectCard(project, index) {
    const article = document.createElement('article');
    article.className = 'project-card';
    article.style.opacity = '0';
    article.style.transform = 'translateY(40px)';

    const thumbnailUrl = getPublicUrl(project.thumbnail_url) ||
        getPublicUrl(project.image_url) ||
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=600&fit=crop';

    const categoryLabel = getCategoryLabel(project.category);

    article.innerHTML = `
        <a href="project.html?id=${project.id}" class="project-card-link">
            <div class="project-card-image">
                <img src="${thumbnailUrl}" alt="${project.title}" loading="lazy">
            </div>
            <div class="project-card-content">
                <span class="project-card-category">${categoryLabel}</span>
                <h3 class="project-card-title">${project.title}</h3>
                <p class="project-card-excerpt">${truncateText(project.description, 100)}</p>
            </div>
            <div class="project-card-arrow">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M7 17L17 7M17 7H7M17 7V17"/>
                </svg>
            </div>
        </a>
    `;

    const link = article.querySelector('.project-card-link');
    link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateToProject(project.id);
    });

    return article;
}

function getCategoryLabel(category) {
    const labels = {
        'Graphisme': 'Design',
        'Marketing': 'Marketing',
        'Développement Mobile': 'Mobile Dev'
    };
    return labels[category] || category;
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

function animateCards() {
    const cards = document.querySelectorAll('.project-card');
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        currentFilter = tab.getAttribute('data-filter');

        let filtered;
        if (currentFilter === 'all') {
            filtered = allProjects;
        } else {
            filtered = allProjects.filter(p => p.category === currentFilter);
        }

        projectsGrid.style.opacity = '0';

        setTimeout(() => {
            displayProjects(filtered);
            projectsGrid.style.opacity = '1';
        }, 300);
    });
});

function navigateToProject(projectId) {
    pageTransition.classList.add('active');

    // Transfère les données du projet via localStorage pour éviter
    // un cold start Supabase sur la page détail.
    const project = allProjects.find(p => String(p.id) === String(projectId));
    if (project) {
        try {
            localStorage.setItem('pending_project', JSON.stringify(project));
        } catch (_) { /* quota exceeded → fallback fetch */ }
    }

    setTimeout(() => {
        window.location.href = `project.html?id=${projectId}`;
    }, 400);
}

function initNavigation() {
    if (navToggle) {
        navToggle.addEventListener('click', () => {
            navToggle.classList.toggle('active');
            mobileMenu.classList.toggle('active');
            document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
        });
    }

    document.querySelectorAll('.mobile-nav-link').forEach(link => {
        link.addEventListener('click', () => {
            navToggle.classList.remove('active');
            mobileMenu.classList.remove('active');
            document.body.style.overflow = '';
        });
    });

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

function initScrollEffects() {
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }

        lastScroll = currentScroll;
    });
}

function initCursor() {
    if (!cursorFollower) return;

    let mouseX = 0, mouseY = 0;
    let cursorX = 0, cursorY = 0;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        cursorFollower.classList.add('visible');
    });

    document.addEventListener('mouseleave', () => {
        cursorFollower.classList.remove('visible');
    });

    const interactiveElements = document.querySelectorAll('a, button, .project-card');
    interactiveElements.forEach(el => {
        el.addEventListener('mouseenter', () => cursorFollower.classList.add('hover'));
        el.addEventListener('mouseleave', () => cursorFollower.classList.remove('hover'));
    });

    function animateCursor() {
        cursorX += (mouseX - cursorX) * 0.15;
        cursorY += (mouseY - cursorY) * 0.15;
        cursorFollower.style.left = cursorX + 'px';
        cursorFollower.style.top = cursorY + 'px';
        requestAnimationFrame(animateCursor);
    }
    animateCursor();
}

function setCurrentYear() {
    const yearElement = document.getElementById('current-year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}

const contactForm = document.getElementById('contact-form');
if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = contactForm.querySelector('.btn-submit');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span>Sending...</span>';
        submitBtn.disabled = true;

        const formData = {
            name: contactForm.name.value,
            email: contactForm.email.value,
            subject: contactForm.subject.value,
            message: contactForm.message.value
        };

        try {
            await apiClient.post('/contacts', formData);

            showNotification('Message sent successfully!', 'success');
            contactForm.reset();
        } catch (err) {
            console.error('Error:', err);
            showNotification('Failed to send message. Please try again.', 'error');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

function showNotification(message, type = 'success') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

function showError() {
    projectsGrid.innerHTML = `
        <div class="empty-state">
            <p>Unable to load projects. Please try again later.</p>
        </div>
    `;
}

console.log('✅ Portfolio initialized');
