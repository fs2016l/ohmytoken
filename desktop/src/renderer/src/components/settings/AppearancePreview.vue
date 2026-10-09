<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_MATERIAL, type WindowMaterial } from '@shared/window-material'
import { getTheme, type Appearance } from '../../config/themes'
import { glassThemeTokens, materialSurfaces } from '../../config/glass-materials'

const props = withDefaults(
  defineProps<{
    palette: string
    appearance: Appearance
    material?: WindowMaterial
  }>(),
  { material: 'solid' },
)

const colors = computed(() => {
  const base = getTheme(props.palette).colors[props.appearance]
  return {
    ...base,
    ...glassThemeTokens(base, {
      preferences: { ...DEFAULT_MATERIAL, style: props.material, appearance: props.appearance },
      active: props.material !== 'solid',
      backend: 'none',
      reason: null,
    }),
    '--preview-blur': materialSurfaces[props.material].previewBlur / 4 + 'px',
  }
})
</script>

<template>
  <span
    class="appearance-preview"
    :class="{ 'appearance-preview--glass': material !== 'solid' }"
    :style="colors"
    :data-preview-theme="palette"
    :data-preview-appearance="appearance"
    :data-preview-material="material"
    aria-hidden="true"
  >
    <span class="preview-window">
      <span class="preview-titlebar">
        <i />
        <b />
        <b />
        <b />
      </span>
      <span class="preview-body">
        <span class="preview-sidebar">
          <i class="preview-brand" />
          <i />
          <i />
          <span class="preview-nav-active">
            <b />
            <i />
          </span>
          <i />
          <i />
        </span>
        <span class="preview-workspace">
          <span class="preview-heading">
            <i />
            <b />
          </span>
          <span class="preview-tools">
            <i />
            <b class="preview-primary" />
          </span>
          <span class="preview-table">
            <span class="preview-table-heading">
              <i />
              <i />
              <i />
            </span>
            <span v-for="row in 4" :key="row" class="preview-table-row">
              <i />
              <i />
              <b class="preview-soft" />
            </span>
          </span>
        </span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.appearance-preview {
  display: block;
  width: 100%;
  aspect-ratio: 1.65;
  overflow: hidden;
  border-radius: 6px;
  background: var(--bg-base);
  color: var(--text);
}
.appearance-preview--glass {
  padding: 8px;
  background:
    linear-gradient(126deg, transparent 48%, #ffffff65 49% 56%, transparent 57%),
    linear-gradient(145deg, #d5dce2, #dfd5ce 54%, #ccd3cc);
}
.preview-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.preview-titlebar {
  display: flex;
  align-items: center;
  flex: 0 0 12px;
  gap: 4px;
  padding: 0 5px;
  background: var(--sidebar);
  backdrop-filter: blur(var(--preview-blur));
}
.preview-titlebar > i {
  width: 25px;
  height: 2px;
  margin-right: auto;
  background: var(--text-muted);
}
.preview-titlebar > b {
  width: 3px;
  height: 3px;
  background: var(--border-strong);
}
.preview-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.preview-sidebar {
  display: flex;
  flex: 0 0 25%;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 5px;
  background: var(--sidebar);
  backdrop-filter: blur(var(--preview-blur));
}
.preview-sidebar > i {
  width: 65%;
  height: 3px;
  background: var(--nav-muted);
  opacity: 0.65;
  border-radius: 2px;
}
.preview-sidebar .preview-brand {
  width: 75%;
  height: 5px;
  margin-bottom: 2px;
  background: var(--primary);
  opacity: 1;
}
.preview-nav-active {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  height: 13px;
  padding: 3px;
  border-radius: 2px;
  background: var(--nav-selected);
  color: var(--nav-active-text);
}
.preview-nav-active > b {
  width: 4px;
  height: 4px;
  background: currentColor;
  border-radius: 1px;
}
.preview-nav-active > i {
  width: 60%;
  height: 2px;
  background: currentColor;
}
.preview-workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 8px;
  background: var(--bg-base);
  backdrop-filter: blur(var(--preview-blur));
}
.preview-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.preview-heading > i {
  width: 36%;
  height: 5px;
  border-radius: 1px;
  background: var(--text);
}
.preview-heading > b {
  width: 58%;
  height: 2px;
  background: var(--text-muted);
}
.preview-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.preview-tools > i {
  width: 60%;
  height: 9px;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 2px;
}
.preview-primary {
  width: 22%;
  height: 10px;
  border-radius: 2px;
  background: var(--primary);
}
.preview-table {
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-low);
}
.preview-table-heading,
.preview-table-row {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  min-height: 6px;
  padding: 0 5px;
  gap: 5px;
}
.preview-table-heading,
.preview-table-row:nth-child(odd) {
  background: var(--surface-container);
}
.preview-table-heading > i {
  width: 20%;
  height: 2px;
  background: var(--text-muted);
  opacity: 0.6;
}
.preview-table-row > i {
  width: 22%;
  height: 2px;
  background: var(--text-muted);
  opacity: 0.8;
}
.preview-soft {
  width: 22%;
  height: 7px;
  border-radius: 2px;
  background: var(--primary-soft);
  border: 1px solid var(--primary-border);
}
</style>
