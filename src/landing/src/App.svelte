<script>
  import Hero from './components/Hero.svelte'
  import Features from './components/Features.svelte'
  import ComingSoon from './components/ComingSoon.svelte'
  import Footer from './components/Footer.svelte'
  import GitHubIcon from './components/icons/GitHubIcon.svelte'
</script>

<div class="min-h-screen flex flex-col">
  <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:no-underline">Skip to main content</a>
  <nav class="fixed top-0 left-0 right-0 z-50 border-b border-border bg-bg-primary/80 backdrop-blur-md" aria-label="Primary navigation">
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
          <GitHubIcon />
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
        <GitHubIcon />
      </a>
    </div>
  </nav>

  <main id="main" class="flex-1">
    <Hero />
    <Features />
    <ComingSoon />
  </main>

  <Footer />
</div>
