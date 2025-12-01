// --- Trace'N Find Public App Logic ---
// This single file powers all public-facing pages (index.html, about.html, etc.)
// It handles shared UI like the preloader, header, theme, and animations.

// --- App State ---
const state = {
    theme: 'light',
    isMobileMenuOpen: false,
};

// --- DOM Elements ---
// Queries for all possible elements on public pages.
// Gracefully handles null if an element doesn't exist on a page.
const elements = {
    preloader: document.getElementById('preloader'),
    header: document.getElementById('header'),
    mobileMenuButton: document.getElementById('mobileMenuButton'),
    mobileMenu: document.getElementById('mobileMenu'),
    // This query robustly finds all theme toggles on any page
    themeToggles: document.querySelectorAll('#themeToggle, #themeToggleMobile, .theme-toggle'),
    backToTop: document.getElementById('backToTop'),
    
    // Stats (from index.html)
    statUsers: document.getElementById('stat-users'),
    statRecovery: document.getElementById('stat-recovery'),
    statSupport: document.getElementById('stat-support'),
    
    // Animations
    sectionsToAnimate: document.querySelectorAll('.fade-in-section, .timeline-item-container'),
    
    // Particles (from about.html)
    particleContainer: document.getElementById('particle-container'),
};

// ========================================================================
// INITIALIZATION
// ========================================================================

/**
 * Initializes the application.
 * Runs on DOMContentLoaded.
 */
function initApp() {
    setupEventListeners();
    
    // Note: The initial theme is set by a render-blocking script in <head>.
    // This function just syncs the toggle button icon.
    syncThemeToggleButton(); 
    
    setupScrollAnimations();
    setupCounterAnimation();
    
    if (elements.particleContainer) {
        createParticles(20); // Create 20 particles for the hero
    }
    
    hidePreloader();
}

/**
 * Sets up all event listeners for the page.
 */
function setupEventListeners() {
    // Theme toggles
    if (elements.themeToggles) {
        elements.themeToggles.forEach(toggle => {
            if(toggle) toggle.addEventListener('click', toggleTheme);
        });
    }

    // Back to top button
    if (elements.backToTop) {
        elements.backToTop.addEventListener('click', scrollToTop);
    }
    
    // Mobile menu
    if (elements.mobileMenuButton && elements.mobileMenu) {
        elements.mobileMenuButton.addEventListener('click', () => toggleMobileMenu());
        
        // Close mobile menu when a link is clicked
        elements.mobileMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => toggleMobileMenu(false));
        });
    }
    
    // Header scroll effect
    if (elements.header) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                elements.header.classList.add('scrolled');
            } else {
                elements.header.classList.remove('scrolled');
            }
        });
    }
    
    // Back to top button visibility
    if (elements.backToTop) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                // Use a class-based approach for visibility
                elements.backToTop.classList.add('is-visible');
                elements.backToTop.classList.remove('opacity-0', 'translate-y-20');
            } else {
                elements.backToTop.classList.remove('is-visible');
                elements.backToTop.classList.add('opacity-0', 'translate-y-20');
            }
        });
    }
}

// ========================================================================
// UI & ANIMATION FUNCTIONS
// ========================================================================

/**
 * Hides the preloader after the page is loaded.
 */
function hidePreloader() {
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (elements.preloader) {
                elements.preloader.style.opacity = '0';
                setTimeout(() => {
                    elements.preloader.style.display = 'none';
                }, 500);
            }
        }, 500); // Give a brief moment for content to render
    });
}

/**
 * Toggles the theme between light and dark.
 */
function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    state.theme = isDark ? 'dark' : 'light';
    
    // Update data-theme for Tailwind config
    document.documentElement.setAttribute('data-theme', state.theme);
    
    // Save preference
    localStorage.setItem('theme', state.theme);
    
    syncThemeToggleButton();
}

/**
 * Syncs the theme toggle button icon with the current theme.
 */
function syncThemeToggleButton() {
    const isDark = document.documentElement.classList.contains('dark');
    state.theme = isDark ? 'dark' : 'light';
    
    elements.themeToggles.forEach(toggle => {
        if (toggle) {
            const moonIcon = toggle.querySelector('.bi-moon-fill');
            const sunIcon = toggle.querySelector('.bi-sun-fill');
            // If dark, show sun icon (to switch to light)
            if (sunIcon) sunIcon.style.display = isDark ? 'block' : 'none';
            // If light, show moon icon (to switch to dark)
            if (moonIcon) moonIcon.style.display = isDark ? 'none' : 'block';
        }
    });
}

/**
 * Toggles the mobile navigation menu.
 * @param {boolean} [force] - Optional. Force open (true) or close (false).
 */
function toggleMobileMenu(force) {
    state.isMobileMenuOpen = (force !== undefined) ? force : !state.isMobileMenuOpen;
    if (elements.mobileMenu) {
        elements.mobileMenu.classList.toggle('hidden', !state.isMobileMenuOpen);
    }
    if (elements.mobileMenuButton) {
        const icon = elements.mobileMenuButton.querySelector('i');
        if (icon) {
            icon.className = state.isMobileMenuOpen ? 'bi bi-x-lg text-3xl' : 'bi bi-list text-3xl';
        }
    }
}

/**
 * Sets up Intersection Observer to animate sections on scroll.
 */
function setupScrollAnimations() {
    if (!elements.sectionsToAnimate) return;

    const observerOptions = {
        threshold: 0.1, // Trigger when 10% of the element is visible
        rootMargin: '0px 0px -50px 0px' // Start animation a bit later
    };

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                obs.unobserve(entry.target);
            }
        });
    }, observerOptions);

    elements.sectionsToAnimate.forEach(el => {
        if(el) observer.observe(el);
    });
}

/**
 * Sets up the animated counters for the hero statistics.
 */
function setupCounterAnimation() {
    const animateValue = (el, end, duration, isPercent = false) => {
        if (!el) return; // Guard against missing elements
        
        let start = 0;
        let endVal = parseInt(end, 10);
        if (isNaN(endVal)) endVal = 0; // Handle NaN
        
        let startTimestamp = null;
        
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            let currentValue = Math.floor(progress * (endVal - start) + start);
            
            // Format number with commas
            el.textContent = currentValue.toLocaleString();
            
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                // After animation finishes, add the suffix
                if (isPercent) {
                    el.textContent += '%';
                }
            }
        };
        window.requestAnimationFrame(step);
    };

    // **SCALABILITY FIX**: Check if each stat element exists before observing
    // This allows the script to run on pages without stats (e.g., about.html)
    if (elements.statUsers) {
        const counterObserver = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Animate all available stats once the container is visible
                    if (elements.statUsers) animateValue(elements.statUsers, 67, 2000);
                    if (elements.statRecovery) animateValue(elements.statRecovery, 69, 2000, true);
                    if (elements.statSupport) animateValue(elements.statSupport, 24, 1500);
                    
                    obs.unobserve(entry.target);
                }
            });
        }, { threshold: 0.8 }); // Trigger when 80% visible

        // Observe the parent of the first stat to trigger when the group comes into view
        const statParent = elements.statUsers.parentElement ? elements.statUsers.parentElement.parentElement : null;
        if (statParent) {
            counterObserver.observe(statParent);
        }
    }
}

/**
 * Creates animated particles for the hero section (used on about.html).
 * @param {number} count - The number of particles to create.
 */
function createParticles(count) {
    if (!elements.particleContainer) return;
    
    let styleSheet = null;
    try {
        // Find a stylesheet to insert keyframes
        if (document.styleSheets.length > 0) {
             styleSheet = document.styleSheets[document.styleSheets.length - 1];
        } else {
            let styleEl = document.createElement('style');
            document.head.appendChild(styleEl);
            styleSheet = styleEl.sheet;
        }
    } catch (e) {
        console.error("Could not access stylesheet to add particle keyframes.", e);
        return;
    }

    // --- PERFORMANCE & SCALABILITY FIX ---
    // 1. Create a fixed number of keyframe rules ONCE, outside the loop.
    const numAnimations = 5; // Create 5 unique animation styles
    for (let j = 1; j <= numAnimations; j++) {
        const animName = `particleFloat_${j}`;
        const xTranslate = Math.random() * 100 - 50; // Random horizontal drift
        try {
            styleSheet.insertRule(`
                @keyframes ${animName} {
                    0% {
                        transform: translateY(0) translateX(0);
                        opacity: 0;
                    }
                    20% {
                        opacity: 0.7;
                    }
                    80% {
                        opacity: 0.7;
                    }
                    100% {
                        transform: translateY(-100vh) translateX(${xTranslate}px);
                        opacity: 0;
                    }
                }
            `, styleSheet.cssRules.length);
        } catch (e) {
             // This might fail in some sandboxed environments, but it's not critical.
            console.warn(`Could not insert particle animation rule: ${animName}`, e);
        }
    }

    // 2. Create the particles and RANDOMLY ASSIGN one of the pre-made animations.
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        
        const size = Math.random() * 5 + 2; // 2px to 7px
        const posX = Math.random() * 100;
        const delay = Math.random() * 15; // Increased random delay
        const duration = Math.random() * 10 + 15; // 15s to 25s
        
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${posX}%`;
        particle.style.bottom = `-${size}px`; // Start from bottom
        
        // Pick one of the 5 pre-made animations
        const animName = `particleFloat_${(i % numAnimations) + 1}`; 
        
        particle.style.animation = `${animName} ${duration}s linear ${delay}s infinite`;
        
        elements.particleContainer.appendChild(particle);

        // --- REMOVED ---
        // The original code injected a new rule here *inside* the loop.
    }
}

/**
 * Scrolls the window smoothly to the top.
 */
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Run App ---
// Ensure the script runs after the DOM is fully parsed
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    // DOM is already loaded
    initApp();
}