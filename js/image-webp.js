/**
 * Convertit les images affichées (locales + CDN) en WebP côté client
 * lorsque le navigateur supporte l'encodage WebP et que CORS le permet (canvas non « tainted »).
 * Les échecs conservent l'URL d'origine.
 */
(function () {
    const MAX_EDGE = 1920;
    const WEBP_QUALITY = 0.82;
    const DATA_ATTR = 'data-webp-done';
    const DATA_ORIGINAL = 'data-webp-original-src';

    let supportsWebpEncode = null;
    let observer = null;

    function checkWebpEncode() {
        if (supportsWebpEncode !== null) return supportsWebpEncode;
        const c = document.createElement('canvas');
        c.width = 2;
        c.height = 2;
        try {
            supportsWebpEncode = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
        } catch {
            supportsWebpEncode = false;
        }
        return supportsWebpEncode;
    }

    function isRasterCandidate(url) {
        if (!url || typeof url !== 'string') return false;
        if (url.startsWith('blob:') || url.startsWith('data:')) return false;
        const path = url.split('?')[0].toLowerCase();
        if (path.endsWith('.webp')) return false;
        if (path.endsWith('.svg') || path.endsWith('.gif') || path.endsWith('.ico')) return false;
        if (/\.(jpe?g|png)$/i.test(path)) return true;
        if (/images\.unsplash\.com|picsum\.photos|imgix\.net/i.test(url)) return true;
        return false;
    }

    function downscaleDimensions(nw, nh) {
        if (nw <= MAX_EDGE && nh <= MAX_EDGE) return { w: nw, h: nh };
        const r = Math.min(MAX_EDGE / nw, MAX_EDGE / nh);
        return { w: Math.max(1, Math.round(nw * r)), h: Math.max(1, Math.round(nh * r)) };
    }

    const urlBlobCache = new Map();

    function convertUrlToWebpBlob(url, callback) {
        if (urlBlobCache.has(url)) {
            const cached = urlBlobCache.get(url);
            if (cached instanceof Promise) {
                cached.then((b) => callback(b)).catch(() => callback(null));
            } else {
                callback(cached);
            }
            return;
        }

        const promise = new Promise((resolve) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => {
                try {
                    const { w, h } = downscaleDimensions(im.naturalWidth, im.naturalHeight);
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        resolve(null);
                        return;
                    }
                    ctx.drawImage(im, 0, 0, w, h);
                    canvas.toBlob(
                        (blob) => resolve(blob && blob.size > 0 ? blob : null),
                        'image/webp',
                        WEBP_QUALITY
                    );
                } catch {
                    resolve(null);
                }
            };
            im.onerror = () => resolve(null);
            im.src = url;
        });

        urlBlobCache.set(url, promise);
        promise.then((blob) => {
            urlBlobCache.set(url, blob);
            callback(blob);
        });
    }

    function applyToImg(img) {
        if (!img || img.tagName !== 'IMG') return;
        const state = img.getAttribute(DATA_ATTR);
        if (state === '1' || state === 'skip' || state === 'pending') return;

        const src = img.currentSrc || img.getAttribute('src');
        if (!isRasterCandidate(src)) {
            img.setAttribute(DATA_ATTR, 'skip');
            return;
        }

        img.setAttribute(DATA_ATTR, 'pending');

        convertUrlToWebpBlob(src, (blob) => {
            if (!blob) {
                img.setAttribute(DATA_ATTR, 'skip');
                return;
            }
            if (!img.getAttribute(DATA_ORIGINAL)) {
                img.setAttribute(DATA_ORIGINAL, src);
            }
            const prev = img.getAttribute('data-webp-blob-url');
            if (prev) {
                try {
                    URL.revokeObjectURL(prev);
                } catch {
                    /* ignore */
                }
            }
            const objectUrl = URL.createObjectURL(blob);
            img.setAttribute('data-webp-blob-url', objectUrl);
            img.setAttribute(DATA_ATTR, '1');
            img.src = objectUrl;
        });
    }

    function scan(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('img').forEach(applyToImg);
    }

    function initObserver() {
        if (observer || !document.body) return;
        observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    if (node.tagName === 'IMG') applyToImg(node);
                    else if (node.querySelectorAll) scan(node);
                });
                if (m.type === 'attributes' && m.target.tagName === 'IMG' && m.attributeName === 'src') {
                    const img = m.target;
                    const st = img.getAttribute(DATA_ATTR);
                    if (st === '1' || st === 'pending') return;
                    const newSrc = img.currentSrc || img.getAttribute('src') || '';
                    if (newSrc.startsWith('blob:') || newSrc.startsWith('data:')) return;
                    img.removeAttribute(DATA_ATTR);
                    applyToImg(img);
                }
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src'],
        });
    }

    function init() {
        if (!checkWebpEncode()) return;
        scan(document);
        initObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
