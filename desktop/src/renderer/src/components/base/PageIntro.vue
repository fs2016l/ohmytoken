<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow: string
    title: string
    subtitle: string
    icon?: string
  }>(),
  {
    icon: 'dashboard',
  },
)
</script>

<template>
  <section class="page-intro">
    <span class="page-intro__accent" aria-hidden="true"></span>
    <div class="page-intro__identity">
      <div class="page-intro__icon" aria-hidden="true">
        <span class="material-symbols-outlined">{{ icon }}</span>
      </div>
      <div class="page-intro__copy">
        <span class="page-intro__eyebrow">{{ eyebrow }}</span>
        <h1>{{ title }}</h1>
        <p>{{ subtitle }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-intro__actions">
      <slot name="actions"></slot>
    </div>
  </section>
</template>

<style scoped>
.page-intro {
  position: relative;
  isolation: isolate;
  width: 100%;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  overflow: hidden;
  padding: var(--space-5) var(--space-6);
  color: var(--text);
  background: linear-gradient(
    112deg,
    var(--surface-emphasis-strong) 0%,
    var(--surface-emphasis) 46%,
    var(--surface-emphasis) 100%
  );
  border: 1px solid var(--border-emphasis);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.page-intro::after {
  position: absolute;
  z-index: -1;
  top: -90px;
  right: -70px;
  width: 280px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--glow-emphasis) 0%, transparent 70%);
  content: '';
  pointer-events: none;
}

.page-intro__accent {
  position: absolute;
  top: var(--space-5);
  bottom: var(--space-5);
  left: 0;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: linear-gradient(180deg, var(--primary), var(--primary-deep));
}

.page-intro__identity {
  position: relative;
  z-index: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.page-intro__icon {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: var(--surface-emphasis-icon);
  border: 1px solid var(--border-emphasis);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--primary) 16%, transparent);
}

.page-intro__icon .material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-size: 24px;
  line-height: 1;
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 24;
}

.page-intro__copy {
  min-width: 0;
  font-family: var(--font-sans);
}

.page-intro__eyebrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
  color: var(--primary);
  font-size: var(--type-caption);
  line-height: 16px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-intro__eyebrow::before {
  width: 16px;
  height: 2px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: currentColor;
  content: '';
}

.page-intro h1 {
  margin: 0;
  color: var(--text);
  font-size: var(--type-title);
  line-height: var(--leading-title);
  font-weight: var(--weight-semibold);
  letter-spacing: -0.015em;
  text-wrap: balance;
}

.page-intro p {
  max-width: 720px;
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--type-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-regular);
}

.page-intro__actions {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 820px) {
  .page-intro {
    min-height: 0;
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .page-intro__actions {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 560px) {
  .page-intro {
    padding: var(--space-4);
    border-radius: var(--radius-lg);
  }

  .page-intro__identity {
    align-items: flex-start;
    gap: var(--space-3);
  }

  .page-intro__icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
  }

  .page-intro__icon .material-symbols-outlined {
    font-size: 24px;
  }

  .page-intro__eyebrow {
    margin-bottom: var(--space-1);
    font-size: var(--type-caption);
  }

  .page-intro h1 {
    font-size: 24px;
    line-height: 32px;
  }

  .page-intro p {
    margin-top: var(--space-1);
    font-size: var(--type-body);
  }
}
</style>
