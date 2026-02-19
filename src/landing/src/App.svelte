<script>
  import Hero from './components/Hero.svelte'
  import Features from './components/Features.svelte'
  import ComingSoon from './components/ComingSoon.svelte'
  import Footer from './components/Footer.svelte'
</script>

<div class="min-h-screen flex flex-col">
  <nav class="fixed top-0 left-0 right-0 z-50 border-b border-border bg-bg-primary/80 backdrop-blur-md">
    <div class="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
      <a href="/" class="flex items-center gap-2 text-lg font-bold text-text-normal no-underline">
        <span class="text-2xl">🐜</span>
        <span>Tiny Claw</span>
      </a>
      <div class="hidden sm:flex items-center gap-8">
        <a href="#features" class="text-sm text-text-muted hover:text-text-normal transition-colors no-underline">Features</a>
        <a href="#coming-soon" class="text-sm text-text-muted hover:text-text-normal transition-colors no-underline">Status</a>
        <a
          href="https://github.com/warengonzaga/tinyclaw"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-hover"
        >
          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.694.825.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
      <!-- Mobile menu button -->
      <a
        href="https://github.com/warengonzaga/tinyclaw"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View on GitHub"
        class="sm:hidden inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-hover"
      >
        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.694.825.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/></svg>
      </a>
    </div>
  </nav>

  <main class="flex-1">
    <Hero />
    <Features />
    <ComingSoon />
  </main>

  <Footer />
</div>
