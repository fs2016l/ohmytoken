<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ThirdPartyCatalogue } from '@shared/third-party-notices'
import { useI18n } from '../../i18n/useI18n'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { label } = useI18n()
const catalogue = ref<ThirdPartyCatalogue | null>(null)
const loading = ref(false)
const loadError = ref(false)
const selectedId = ref('')
const documentIndex = ref(0)
const documentText = ref('')
const documentLoading = ref(false)
const documentError = ref(false)
let request = 0
const entries = computed(() => catalogue.value?.entries ?? [])
const selected = computed(
  () => entries.value.find((entry) => entry.id === selectedId.value) ?? entries.value[0],
)

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  loadError.value = false
  try {
    catalogue.value = await window.api.thirdPartyNoticesList()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
async function readDocument(): Promise<void> {
  const current = ++request
  documentText.value = ''
  documentError.value = false
  documentLoading.value = false
  const entry = selected.value
  if (!props.open || !entry?.documents.length) return
  documentLoading.value = true
  try {
    const text = await window.api.thirdPartyNoticesRead(entry.id, documentIndex.value)
    if (current === request) documentText.value = text
  } catch {
    if (current === request) documentError.value = true
  } finally {
    if (current === request) documentLoading.value = false
  }
}
async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) return
  try {
    await window.api.openExternal(url)
  } catch {
    documentError.value = true
  }
}
async function openChromium(): Promise<void> {
  documentError.value = false
  try {
    await window.api.thirdPartyNoticesOpenChromium()
  } catch {
    documentError.value = true
  }
}
watch(
  () => props.open,
  (open) => {
    if (open && !catalogue.value) void load()
  },
  { immediate: true },
)
watch(
  () => selected.value?.id,
  () => {
    documentIndex.value = 0
  },
)
watch([() => selected.value?.id, documentIndex, () => props.open], readDocument)
</script>

<template>
  <WorkspaceDialog
    :open="open"
    :title="label('Open-source software notices', '开源软件声明')"
    wide
    class="oss-dialog"
    style="--dialog-width: 1040px"
    @close="emit('close')"
  >
    <p class="oss-intro">
      {{
        label(
          'Listed in no particular order. Thank you to the developers for their support.',
          '排名不分先后，感谢开发者的支持',
        )
      }}
    </p>
    <p v-if="loading" role="status">{{ label('Loading notices…', '正在读取声明…') }}</p>
    <div v-else-if="loadError" role="alert">
      <p>{{ label('Could not load notices.', '无法读取开源声明。') }}</p>
      <button class="workspace-button" type="button" @click="load">
        {{ label('Retry', '重试') }}
      </button>
    </div>
    <p v-else-if="!entries.length" role="status">
      {{ label('No component notices available.', '暂无组件声明。') }}
    </p>
    <div v-else class="oss-body">
      <nav class="oss-list" :aria-label="label('Components', '组件列表')">
        <button
          v-for="entry in entries"
          :key="entry.id"
          type="button"
          :aria-current="selected?.id === entry.id ? 'true' : undefined"
          @click="selectedId = entry.id"
        >
          <strong>{{ entry.name }}</strong>
          <span>{{ entry.license }} · {{ entry.version }}</span>
        </button>
      </nav>
      <article v-if="selected" class="oss-detail" :aria-label="selected.name">
        <header>
          <h3>{{ selected.name }}</h3>
          <p>{{ selected.version }} · {{ selected.license }}</p>
          <div class="oss-links">
            <button
              v-if="selected.project"
              type="button"
              class="workspace-button"
              @click="openUrl(selected.project)"
            >
              {{ label('Project website', '项目主页') }} ↗
            </button>
            <button
              v-if="selected.source"
              type="button"
              class="workspace-button"
              @click="openUrl(selected.source)"
            >
              {{ label('Version source', '版本来源') }} ↗
            </button>
          </div>
        </header>
        <nav
          v-if="selected.documents.length > 1"
          class="oss-documents"
          :aria-label="label('License documents', '许可文件')"
        >
          <button
            v-for="(document, index) in selected.documents"
            :key="index"
            type="button"
            class="workspace-button"
            :aria-current="documentIndex === index ? 'true' : undefined"
            @click="documentIndex = index"
          >
            {{ document.name }}
          </button>
        </nav>
        <p v-if="documentLoading" role="status">
          {{ label('Loading license…', '正在读取许可原文…') }}
        </p>
        <div v-else-if="documentError" role="alert">
          <p>{{ label('Could not open this notice. Please retry.', '无法打开声明，请重试。') }}</p>
          <button
            type="button"
            class="workspace-button"
            @click="selected.external ? openChromium() : readDocument()"
          >
            {{ label('Retry', '重试') }}
          </button>
        </div>
        <div v-else-if="selected.external === 'chromium'" class="oss-runtime">
          <p>
            {{
              label(
                'The complete Chromium and runtime notices are included with this application. Open the local document to browse all components and licenses.',
                'Chromium 及运行时的完整声明已随应用附带，打开本地文件可查看全部组件与许可原文。',
              )
            }}
          </p>
          <button type="button" class="workspace-button" @click="openChromium">
            {{ label('Open full runtime notices', '打开运行时完整声明') }} ↗
          </button>
        </div>
        <pre
          v-else
          class="oss-license"
          tabindex="0"
          :aria-label="label('License text', '许可原文')"
          >{{ documentText }}</pre>
      </article>
    </div>
  </WorkspaceDialog>
</template>

<style scoped>
.oss-intro {
  margin: 0 0 16px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 20px;
}
.oss-body {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  height: min(560px, calc(100dvh - 280px));
  min-height: 200px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.oss-list {
  overflow: auto;
  padding: 8px;
  border-right: 1px solid var(--border);
  background: var(--surface-low);
}
.oss-list button {
  width: 100%;
  text-align: left;
  padding: 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  transition:
    background var(--motion-hover),
    color var(--motion-hover);
}
.oss-list strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.oss-list span {
  display: block;
  margin-top: 5px;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.oss-list button:hover {
  background: var(--surface-container);
}
.oss-list button[aria-current],
.oss-documents button[aria-current] {
  background: var(--primary-soft);
  color: var(--primary-soft-text);
}
.oss-detail {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 20px;
}
.oss-detail header {
  flex: none;
}
.oss-detail h3 {
  margin: 0;
  font-size: 18px;
  line-height: 26px;
  overflow-wrap: anywhere;
}
.oss-detail header p {
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.oss-links,
.oss-documents {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.oss-links button,
.oss-documents button {
  min-width: 0;
  height: auto;
  min-height: 30px;
  padding: 5px 10px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.oss-documents {
  flex: none;
  max-height: 80px;
  overflow: auto;
}
.oss-license {
  margin: 12px 0 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.75 var(--font-number);
  color: var(--text);
}
.oss-runtime {
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-muted);
}
@media (max-width: 760px) {
  .oss-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 120px minmax(0, 1fr);
    height: calc(100dvh - 310px);
    min-height: 280px;
  }
  .oss-list {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
@media (prefers-reduced-motion: reduce) {
  .oss-list button {
    transition: none;
  }
}
</style>
