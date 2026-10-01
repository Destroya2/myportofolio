const projectLoading = document.getElementById('project-loading');
const projectContent = document.getElementById('project-content');
const projectError = document.getElementById('project-error');
const header = document.querySelector('.header');
const pageTransition = document.getElementById('page-transition');

document.addEventListener('DOMContentLoaded', () => {
    loadProject();
    initScrollEffects();
    setCurrentYear();

    setTimeout(() => {
        pageTransition.classList.remove('active');
    }, 100);
});

async function loadProject() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('id');

    if (!projectId) {
        showError();
        return;
    }

    try {
        const project = await apiClient.get(`/projects/${projectId}`);

        if (!project) {
            throw new Error('Project not found');
        }

        displayProject(project);
    } catch (err) {
        console.error('Error loading project:', err);
        showError();
    }
}

function displayProject(project) {
    document.title = `${project.title} | Alexis Digital`;

    const imageUrl = getPublicUrl(project.image_url) ||
        getPublicUrl(project.thumbnail_url) ||
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&h=800&fit=crop';

    document.getElementById('project-image').src = imageUrl;
    document.getElementById('project-image').alt = project.title;
    document.getElementById('project-category').textContent = getCategoryLabel(project.category);
    document.getElementById('project-title').textContent = project.title;

    const date = new Date(project.created_at);
    document.getElementById('project-date').textContent = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long'
    });

    const descriptionEl = document.getElementById('project-description');
    if (project.description) {
        const paragraphs = project.description.split('\n\n');
        descriptionEl.innerHTML = paragraphs
            .filter(p => p.trim())
            .map(p => `<p>${p.trim()}</p>`)
            .join('');
    } else {
        descriptionEl.innerHTML = '<p>No description available.</p>';
    }

    document.getElementById('meta-category').textContent = getCategoryLabel(project.category);
    document.getElementById('meta-year').textContent = date.getFullYear();

    projectLoading.classList.add('hidden');
    projectContent.classList.remove('hidden');

    setTimeout(() => {
        projectContent.style.opacity = '1';
    }, 100);
}

function getCategoryLabel(category) {
    const labels = {
        'Graphisme': 'Design & Branding',
        'Marketing': 'Marketing & Strategy',
        'Développement Mobile': 'Mobile Development'
    };
    return labels[category] || category;
}

function showError() {
    projectLoading.classList.add('hidden');
    projectError.classList.remove('hidden');
}

function initScrollEffects() {
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

function setCurrentYear() {
    const yearElement = document.getElementById('current-year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}

document.querySelectorAll('a[href^="/"], a[href^="./"], a[href="/#work"]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const href = link.getAttribute('href');

        pageTransition.classList.add('active');

        setTimeout(() => {
            window.location.href = href;
        }, 400);
    });
});

console.log('✅ Project page initialized');
