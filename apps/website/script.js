// ============================================
// Navigation
// ============================================
const nav = document.getElementById('nav');
const navToggle = document.getElementById('nav-toggle');
const mobileMenu = document.getElementById('mobile-menu');

// Scroll effect
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset;

  if (currentScroll > 50) {
    nav.classList.add('scrolled');
  } else {
    nav.classList.remove('scrolled');
  }

  lastScroll = currentScroll;
});

// Mobile menu toggle
navToggle.addEventListener('click', () => {
  mobileMenu.classList.toggle('active');
  navToggle.classList.toggle('active');
});

// Close mobile menu on link click
mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('active');
    navToggle.classList.remove('active');
  });
});

// ============================================
// Terminal Animation
// ============================================
function animateTerminal() {
  const lines = document.querySelectorAll('.terminal-line');

  lines.forEach((line, index) => {
    const delay = line.dataset.delay || index * 500;
    setTimeout(() => {
      line.style.animationDelay = '0s';
      line.style.animation = 'typeIn 0.3s ease forwards';
    }, parseInt(delay));
  });
}

// Run terminal animation when in view
const terminalObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateTerminal();
      terminalObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

const terminal = document.querySelector('.terminal');
if (terminal) {
  terminalObserver.observe(terminal);
}

// ============================================
// Counter Animation
// ============================================
function animateCounters() {
  const counters = document.querySelectorAll('[data-count]');

  counters.forEach(counter => {
    const target = parseInt(counter.dataset.count);
    const duration = 2000;
    const step = target / (duration / 16);
    let current = 0;

    const updateCounter = () => {
      current += step;
      if (current < target) {
        counter.textContent = Math.floor(current);
        requestAnimationFrame(updateCounter);
      } else {
        counter.textContent = target;
      }
    };

    updateCounter();
  });
}

// Run counter animation when in view
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCounters();
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

const heroStats = document.querySelector('.hero-stats');
if (heroStats) {
  statsObserver.observe(heroStats);
}

// ============================================
// Deployment Tabs
// ============================================
const deployTabs = document.querySelectorAll('.deploy-tab');
const deployPanels = document.querySelectorAll('.deploy-panel');

deployTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetPanel = tab.dataset.tab;

    // Update tabs
    deployTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Update panels
    deployPanels.forEach(panel => {
      panel.classList.remove('active');
      if (panel.id === `panel-${targetPanel}`) {
        panel.classList.add('active');
      }
    });
  });
});

// ============================================
// Copy to Clipboard
// ============================================
const copyButtons = document.querySelectorAll('.copy-btn');

copyButtons.forEach(btn => {
  btn.addEventListener('click', async () => {
    const codeBlock = btn.closest('.code-block');
    const code = codeBlock.querySelector('code').textContent;

    try {
      await navigator.clipboard.writeText(code);
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        Copied!
      `;
      btn.classList.add('copied');

      setTimeout(() => {
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Copy
        `;
        btn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  });
});

// ============================================
// Smooth Scroll for Anchor Links
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      const offsetTop = target.offsetTop - 80;
      window.scrollTo({
        top: offsetTop,
        behavior: 'smooth'
      });
    }
  });
});

// ============================================
// Scroll Reveal Animation
// ============================================
const revealElements = document.querySelectorAll('.feature-card, .pricing-card, .comparison-card, .arch-diagram');

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, index) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }, index * 100);
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

revealElements.forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  revealObserver.observe(el);
});

// ============================================
// Feature Card Hover Effect
// ============================================
const featureCards = document.querySelectorAll('.feature-card');

featureCards.forEach(card => {
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    card.style.setProperty('--mouse-x', `${x}px`);
    card.style.setProperty('--mouse-y', `${y}px`);
  });
});

// ============================================
// Comparison Table Highlight
// ============================================
const comparisonRows = document.querySelectorAll('.comparison-table tbody tr');

comparisonRows.forEach(row => {
  row.addEventListener('mouseenter', () => {
    row.style.background = 'rgba(59, 130, 246, 0.05)';
  });

  row.addEventListener('mouseleave', () => {
    row.style.background = '';
  });
});

// ============================================
// Keyboard Navigation
// ============================================
document.addEventListener('keydown', (e) => {
  // ESC to close mobile menu
  if (e.key === 'Escape') {
    mobileMenu.classList.remove('active');
    navToggle.classList.remove('active');
  }

  // Tab navigation for deploy tabs
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const activeTab = document.querySelector('.deploy-tab.active');
    const tabs = Array.from(deployTabs);
    const currentIndex = tabs.indexOf(activeTab);

    let newIndex;
    if (e.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % tabs.length;
    } else {
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }

    if (document.activeElement.classList.contains('deploy-tab')) {
      tabs[newIndex].click();
      tabs[newIndex].focus();
    }
  }
});

// ============================================
// Performance: Lazy load images
// ============================================
const lazyImages = document.querySelectorAll('img[data-src]');
const imageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
      imageObserver.unobserve(img);
    }
  });
});

lazyImages.forEach(img => imageObserver.observe(img));

// ============================================
// Console Easter Egg
// ============================================
console.log(`
%c Plane Lite %c Lightning Fast Project Management

%c Want to contribute? Visit https://github.com/makeplane/plane

`,
'background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 10px 20px; font-size: 20px; font-weight: bold; border-radius: 4px;',
'color: #a1a1aa; font-size: 14px;',
'color: #71717a; font-size: 12px;'
);
