<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  renewalMonthDates,
  renewalOccurrenceDates,
  renewalStatus,
  parseRenewalDate,
  type PlanRenewal,
  type PlanRenewalOccurrence,
} from '../../../../shared/plan-renewals'
import { useI18n } from '../../i18n/useI18n'
import { useRenewalLabels } from '../../composables/useRenewalLabels'
import { renewalColorStyle } from '../../utils/renewal-colors'
import VendorMark from '../base/VendorMark.vue'

const props = defineProps<{ items: PlanRenewal[]; today: string; busy: boolean }>()
const emit = defineEmits<{ edit: [item: PlanRenewal] }>()
const { label, currentLang } = useI18n()
const { providerName, cycleText, statusText } = useRenewalLabels()
const month = ref(props.today.slice(0, 7))
const selectedDate = ref('')
const calendarGrid = ref<HTMLElement | null>(null)
const locale = computed(() => (currentLang.value === 'zh' ? 'zh-CN' : 'en-US'))
const days = computed(() =>
  renewalMonthDates(month.value).filter((day) => day.startsWith(month.value)),
)
const cells = computed(() => {
  const first = parseRenewalDate(days.value[0])
  const offset = first ? (first.getUTCDay() + 6) % 7 : 0
  const length = Math.ceil((offset + days.value.length) / 7) * 7
  return Array.from({ length }, (_, index) => days.value[index - offset] ?? null)
})
const events = computed(() => {
  const result = new Map<string, PlanRenewalOccurrence[]>()
  const from = days.value[0],
    to = days.value.at(-1)
  if (!from || !to) return result
  for (const item of props.items) {
    for (const date of renewalOccurrenceDates(item, from, to)) {
      const day = result.get(date) ?? []
      day.push({ renewal: item, date })
      result.set(date, day)
    }
  }
  return result
})
const monthCount = computed(() =>
  [...events.value.values()].reduce((sum, day) => sum + day.length, 0),
)
const activeDate = computed(() => {
  if (selectedDate.value.startsWith(month.value)) return selectedDate.value
  if (events.value.has(props.today)) return props.today
  const dates = [...events.value.keys()].sort()
  return (
    dates.find((date) => date >= props.today) ??
    dates.at(-1) ??
    (props.today.startsWith(month.value) ? props.today : `${month.value}-01`)
  )
})
const selected = computed(() => events.value.get(activeDate.value) ?? [])
const monthTitle = computed(() =>
  new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parseRenewalDate(`${month.value}-01`)!),
)
const selectedTitle = computed(() => {
  const date = parseRenewalDate(activeDate.value)!
  const title = new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  const weekday = new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date)
  return `${title} · ${weekday}`
})
const weekdays = computed(() =>
  currentLang.value === 'zh'
    ? ['一', '二', '三', '四', '五', '六', '日']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
)
function revealSelectedDate(): void {
  const grid = calendarGrid.value
  const day = grid?.querySelector<HTMLElement>(`[data-date="${activeDate.value}"]`)
  if (!grid || !day) return
  const viewport = grid.getBoundingClientRect()
  const bounds = day.getBoundingClientRect()
  if (bounds.top < viewport.top) grid.scrollTop += bounds.top - viewport.top
  else if (bounds.bottom > viewport.bottom) grid.scrollTop += bounds.bottom - viewport.bottom
}
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  resizeObserver = new ResizeObserver(revealSelectedDate)
  if (calendarGrid.value) resizeObserver.observe(calendarGrid.value)
})
onUnmounted(() => resizeObserver?.disconnect())
watch([activeDate, monthCount], revealSelectedDate, { flush: 'post' })
function changeMonth(delta: number): void {
  const date = parseRenewalDate(`${month.value}-01`)!
  date.setUTCMonth(date.getUTCMonth() + delta)
  if (date.getUTCFullYear() >= 1000 && date.getUTCFullYear() <= 9999) {
    month.value = date.toISOString().slice(0, 7)
    selectedDate.value = ''
  }
}
function goToday(): void {
  month.value = props.today.slice(0, 7)
  selectedDate.value = props.today
}
function countText(day: string): string {
  const count = events.value.get(day)?.length ?? 0
  return label(`${day}, ${count} renewals`, `${day}，${count} 个套餐续费`)
}
</script>

<template>
  <section class="renewal-calendar" :aria-label="label('Renewal calendar', '续费日历')">
    <header class="renewal-calendar-header">
      <div class="renewal-calendar-heading">
        <span class="material-symbols-outlined renewal-calendar-icon" aria-hidden="true">
          calendar_month
        </span>
        <h3>{{ label('Renewal calendar', '续费日历') }}</h3>
        <span class="renewal-calendar-total">
          {{ label(`${monthCount} this month`, `本月 ${monthCount} 次`) }}
        </span>
      </div>
      <div class="renewal-calendar-navigation">
        <button
          type="button"
          class="workspace-button workspace-button--icon"
          :aria-label="label('Previous month', '上个月')"
          @click="changeMonth(-1)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>
        </button>
        <strong aria-live="polite">{{ monthTitle }}</strong>
        <button
          type="button"
          class="workspace-button workspace-button--icon"
          :aria-label="label('Next month', '下个月')"
          @click="changeMonth(1)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" class="workspace-button renewal-calendar-today" @click="goToday">
          {{ label('Today', '今天') }}
        </button>
      </div>
    </header>
    <div class="renewal-calendar-weekdays" aria-hidden="true">
      <span v-for="day in weekdays" :key="day">{{ day }}</span>
    </div>
    <div
      ref="calendarGrid"
      class="renewal-calendar-grid"
      :style="{ '--calendar-weeks': cells.length / 7 }"
    >
      <template v-for="(day, index) in cells" :key="`${month}-${index}`">
        <button
          v-if="day"
          type="button"
          class="renewal-calendar-day"
          :class="{
            'is-today': day === today,
            'is-selected': day === activeDate,
            'has-single': events.get(day)?.length === 1,
            'has-pair': events.get(day)?.length === 2,
            'is-crowded': (events.get(day)?.length ?? 0) > 2,
          }"
          :data-date="day"
          :aria-label="countText(day)"
          :aria-current="day === today ? 'date' : undefined"
          :aria-pressed="day === activeDate"
          @click="selectedDate = day"
        >
          <span class="renewal-calendar-day-heading">
            <span class="renewal-calendar-number">{{ Number(day.slice(-2)) }}</span>
            <span v-if="(events.get(day)?.length ?? 0) > 2" class="renewal-calendar-day-count">
              {{ events.get(day)!.length }}
            </span>
          </span>
          <span
            v-if="events.get(day)?.length"
            class="renewal-calendar-events"
            :class="{
              'is-single': events.get(day)!.length === 1,
              'is-pair': events.get(day)!.length === 2,
            }"
          >
            <span
              v-for="event in events.get(day)!.slice(0, 2)"
              :key="event.renewal.id"
              class="renewal-calendar-event"
              :class="`renewal-tone--${renewalStatus(event.date, today)}`"
              :style="renewalColorStyle(event.renewal.color)"
              :title="`${providerName(event.renewal.providerId)} · ${event.renewal.name} · ${event.date}`"
            >
              <VendorMark
                :provider="event.renewal.providerId"
                :size="events.get(day)!.length === 1 ? 20 : 14"
              />
              <span class="renewal-calendar-event-name">{{ event.renewal.name }}</span>
            </span>
          </span>
          <span v-if="(events.get(day)?.length ?? 0) > 2" class="renewal-calendar-more">
            {{
              label(
                `+${events.get(day)!.length - 2} more`,
                `+${events.get(day)!.length - 2} 个套餐`,
              )
            }}
          </span>
        </button>
        <span v-else class="renewal-calendar-blank" aria-hidden="true" />
      </template>
    </div>
    <section
      class="renewal-day-agenda"
      :aria-label="label(`Renewals · ${activeDate}`, `${activeDate} 的续费套餐`)"
    >
      <header class="renewal-day-heading">
        <h4 aria-live="polite">{{ selectedTitle }}</h4>
        <span class="renewal-day-count">
          {{ label(`${selected.length} subscriptions`, `${selected.length} 个套餐`) }}
        </span>
      </header>
      <p v-if="!selected.length" class="renewal-day-empty">
        <span class="material-symbols-outlined" aria-hidden="true">event_available</span>
        <span>{{ label('No renewals on this day.', '这一天没有需要续费的套餐') }}</span>
      </p>
      <ul
        v-else
        class="renewal-day-list"
        :class="{ 'is-single': selected.length === 1, 'is-pair': selected.length === 2 }"
        :aria-label="countText(activeDate)"
      >
        <li v-for="event in selected" :key="event.renewal.id">
          <button
            type="button"
            class="renewal-day-item"
            :class="`renewal-tone--${renewalStatus(event.date, today)}`"
            :style="renewalColorStyle(event.renewal.color)"
            :disabled="busy"
            :aria-label="
              label(`Edit renewal for ${event.renewal.name}`, `编辑 ${event.renewal.name} 的续费`)
            "
            @click="emit('edit', event.renewal)"
          >
            <VendorMark
              :provider="event.renewal.providerId"
              :size="selected.length <= 2 ? 32 : 24"
            />
            <span class="renewal-day-info">
              <strong :title="event.renewal.name">{{ event.renewal.name }}</strong>
              <span
                v-if="selected.length <= 2"
                class="renewal-day-provider"
                :title="`${providerName(event.renewal.providerId)} · ${cycleText(event.renewal)}`"
              >
                {{ providerName(event.renewal.providerId) }} · {{ cycleText(event.renewal) }}
              </span>
              <span>{{ statusText({ renewOn: event.date }, today) }}</span>
            </span>
            <span class="material-symbols-outlined renewal-day-edit" aria-hidden="true">edit</span>
          </button>
        </li>
      </ul>
    </section>
    <footer class="renewal-calendar-footer">
      <div class="renewal-calendar-legend">
        <span class="today">{{ label('Today', '今天') }}</span>
        <span class="soon">{{ label('Due soon', '即将续费') }}</span>
        <span class="overdue">{{ label('Pending', '待续费') }}</span>
      </div>
      <p class="renewal-calendar-help">
        {{ label('Select a date to see all renewals.', '点击日期查看全部套餐') }}
      </p>
    </footer>
  </section>
</template>

<style scoped src="./plan-renewal-calendar.css"></style>
