<script setup lang="ts">
import { useI18n } from '../../i18n/useI18n'
import { formatTokens } from '../../utils/format'
import { formatComparison } from '../../composables/useAgentStats'
import type { Comparisons, ComparisonPair, Overview } from '@shared/models'

interface Props {
  overviewFixed: Overview | null
  totalAgents: number
  totalModels: number
  todayUsage: number
  weekUsage: number
  monthUsage: number
  comparisons: Comparisons | null
}

defineProps<Props>()

const { tr } = useI18n()

function isPositive(comp: ComparisonPair | null | undefined): boolean {
  return (comp?.change ?? 0) >= 0
}

function trendIcon(comp: ComparisonPair | null | undefined): string {
  return isPositive(comp) ? 'trending_up' : 'trending_down'
}
</script>

<template>
  <section class="stats-grid" aria-label="Overview">
    <article class="stat-card featured">
      <div class="stat-head">
        <span>{{ tr('totalTokens') }}</span>
        <span class="live-pill">
          <span></span>
          {{ tr('live') }}
        </span>
      </div>
      <strong>{{ formatTokens(overviewFixed?.grandTotal || 0) }}</strong>
      <small>
        <span class="material-symbols-outlined">trending_up</span>
        <span class="positive">OhMyToken!!</span>
      </small>
    </article>

    <article class="stat-card">
      <div class="stat-head">
        <span>{{ tr('activeAgents') }}</span>
        <span class="material-symbols-outlined">smart_toy</span>
      </div>
      <strong>{{ totalAgents.toString().padStart(2, '0') }}</strong>
      <small>
        <span class="dot-mini"></span>
        {{ tr('allSystemsOperational') }}
      </small>
    </article>

    <article class="stat-card">
      <div class="stat-head">
        <span>{{ tr('modelsEngaged') }}</span>
        <span class="material-symbols-outlined">hub</span>
      </div>
      <strong>{{ totalModels.toString().padStart(2, '0') }}</strong>
      <small>{{ tr('acrossProviders').replace('{count}', String(totalAgents || 0)) }}</small>
    </article>

    <article class="stat-card">
      <div class="stat-head">
        <span>{{ tr('todayUsage') }}</span>
        <span class="material-symbols-outlined">today</span>
      </div>
      <strong>{{ formatTokens(todayUsage) }}</strong>
      <small>
        <span class="material-symbols-outlined">
          {{ trendIcon(comparisons?.todayVsYesterday) }}
        </span>
        <span
          :class="{
            positive: isPositive(comparisons?.todayVsYesterday),
            negative: !isPositive(comparisons?.todayVsYesterday),
          }"
        >
          {{ formatComparison(comparisons?.todayVsYesterday) }}
        </span>
        {{ tr('vsYesterday') }}
      </small>
    </article>

    <article class="stat-card">
      <div class="stat-head">
        <span>{{ tr('thisWeekUsage') }}</span>
        <span class="material-symbols-outlined">calendar_view_week</span>
      </div>
      <strong>{{ formatTokens(weekUsage) }}</strong>
      <small class="dual-comp">
        <span class="comp-row">
          <span class="material-symbols-outlined">
            {{ trendIcon(comparisons?.weekVsLastWeek) }}
          </span>
          <span
            :class="{
              positive: isPositive(comparisons?.weekVsLastWeek),
              negative: !isPositive(comparisons?.weekVsLastWeek),
            }"
          >
            {{ formatComparison(comparisons?.weekVsLastWeek) }}
          </span>
          <span class="comp-label">{{ tr('vsLastWeek') }}</span>
        </span>
        <span class="comp-row">
          <span class="material-symbols-outlined">
            {{ trendIcon(comparisons?.weekVsLastWeekSamePeriod) }}
          </span>
          <span
            :class="{
              positive: isPositive(comparisons?.weekVsLastWeekSamePeriod),
              negative: !isPositive(comparisons?.weekVsLastWeekSamePeriod),
            }"
          >
            {{ formatComparison(comparisons?.weekVsLastWeekSamePeriod) }}
          </span>
          <span class="comp-label">{{ tr('vsLastWeekSamePeriod') }}</span>
        </span>
      </small>
    </article>

    <article class="stat-card">
      <div class="stat-head">
        <span>{{ tr('thisMonthUsage') }}</span>
        <span class="material-symbols-outlined">calendar_month</span>
      </div>
      <strong>{{ formatTokens(monthUsage) }}</strong>
      <small class="dual-comp">
        <span class="comp-row">
          <span class="material-symbols-outlined">
            {{ trendIcon(comparisons?.monthVsLastMonth) }}
          </span>
          <span
            :class="{
              positive: isPositive(comparisons?.monthVsLastMonth),
              negative: !isPositive(comparisons?.monthVsLastMonth),
            }"
          >
            {{ formatComparison(comparisons?.monthVsLastMonth) }}
          </span>
          <span class="comp-label">{{ tr('vsLastMonth') }}</span>
        </span>
        <span class="comp-row">
          <span class="material-symbols-outlined">
            {{ trendIcon(comparisons?.monthVsLastMonthSamePeriod) }}
          </span>
          <span
            :class="{
              positive: isPositive(comparisons?.monthVsLastMonthSamePeriod),
              negative: !isPositive(comparisons?.monthVsLastMonthSamePeriod),
            }"
          >
            {{ formatComparison(comparisons?.monthVsLastMonthSamePeriod) }}
          </span>
          <span class="comp-label">{{ tr('vsLastMonthSamePeriod') }}</span>
        </span>
      </small>
    </article>
  </section>
</template>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.stat-card {
  min-height: 134px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  overflow: hidden;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition:
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.stat-card:hover {
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

.stat-card.featured {
  background: linear-gradient(118deg, var(--surface-emphasis-strong), var(--surface-emphasis) 72%);
  border-color: var(--border-emphasis);
}

.stat-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-soft);
  font-size: 14px;
}

.stat-head .material-symbols-outlined {
  color: var(--text-soft);
  font-size: 18px;
}

.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  color: var(--tertiary);
  background: rgba(78, 222, 163, 0.1);
  border-radius: 999px;
  font-family: var(--font-sans);
  font-size: var(--type-caption);
}

.live-pill span {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--tertiary);
}

.stat-card strong {
  display: block;
  color: var(--text);
  font-family: var(--font-number);
  font-size: 24px;
  line-height: 32px;
  font-weight: var(--weight-semibold);
  word-break: break-word;
}

.stat-card small {
  margin-top: auto;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 18px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-card small.dual-comp {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.stat-card small.dual-comp .comp-row {
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 16px;
}

.stat-card small .material-symbols-outlined {
  font-size: 12px;
}

.positive {
  color: var(--tertiary);
  font-weight: var(--weight-semibold);
}

.negative {
  color: var(--error);
  font-weight: var(--weight-semibold);
}

.dot-mini {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tertiary);
}

@media (max-width: 1120px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
