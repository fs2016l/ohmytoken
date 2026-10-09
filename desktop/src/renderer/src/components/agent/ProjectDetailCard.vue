<script setup lang="ts">
import type { ProjectWorkspaceItem } from '@shared/models'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import TokenBreakdown from '../base/TokenBreakdown.vue'
import RollingText from '../base/RollingText.vue'
import UsageIdentity from './UsageIdentity.vue'
import { useI18n } from '../../i18n/useI18n'
import { formatNumber } from '../../utils/number-format'
const props = defineProps<{ project: ProjectWorkspaceItem | null }>()
const emit = defineEmits<{ notes: [project: ProjectWorkspaceItem] }>()
const { label } = useI18n()
</script>
<template>
  <section v-if="project" class="project-detail workspace-panel usage-detail-card">
    <div>
      <h2 :title="project.name"><RollingText :text="project.name" /></h2>
      <p class="detail-context project-context">
        <RollingText
          :text="
            label(
              formatNumber(project.sessionCount, { compact: true }) +
                ' sessions · ' +
                project.agents.length +
                ' Agents · ' +
                project.models.length +
                ' models',
              formatNumber(project.sessionCount, { compact: true }) +
                ' 个会话 · ' +
                project.agents.length +
                ' 个 Agent · ' +
                project.models.length +
                ' 个模型',
            )
          "
        />
      </p>
    </div>
    <span class="detail-caption">{{ label('Tokens in range', '区间用量') }}</span>
    <AnimatedNumber class="detail-hero" :value="project.totalTokens" :format="{ compact: true }" />
    <div class="detail-cost">
      <span>{{ label('Est. cost', '预估花费') }}</span>
      <strong><AnimatedCost :summary="project.costSummary" :note="false" /></strong>
    </div>
    <div class="detail-metrics">
      <div>
        <span>{{ label('API calls', 'API 调用') }}</span>
        <strong>
          <AnimatedNumber
            :prefix="!project.apiCallCountComplete ? '≥' : ''"
            :value="project.apiCallCount"
            :format="{ compact: true }"
          />
        </strong>
      </div>
      <div>
        <span>{{ label('Turns', '对话次数') }}</span>
        <strong>
          <AnimatedNumber
            :prefix="!project.turns.complete && project.turns.count ? '≥' : ''"
            :value="project.turns.complete || project.turns.count ? project.turns.count : null"
            :format="{ compact: true }"
          />
        </strong>
      </div>
      <div>
        <span>{{ label('Sessions', '会话') }}</span>
        <strong>
          <AnimatedNumber :value="project.sessionCount" :format="{ compact: true }" />
        </strong>
      </div>
    </div>
    <div class="detail-participation">
      <h3>{{ label('Agent / model', 'Agent / 模型') }}</h3>
      <UsageIdentity
        :agents="project.agents"
        :models="project.models"
        :agent-totals="project.agentTotals"
        :model-totals="project.modelTotals"
        labelled
      />
    </div>
    <h3>{{ label('Token breakdown', 'Token 构成') }}</h3>
    <TokenBreakdown :usage="project" />
    <dl class="detail-meta">
      <div>
        <dt>{{ label('Path', '路径') }}</dt>
        <dd class="project-path">{{ project.path }}</dd>
      </div>
      <div>
        <dt>{{ label('Source', '识别') }}</dt>
        <dd>
          {{
            project.source === 'discovered'
              ? label('Auto-detected', '自动识别')
              : label('Manually added', '手动添加')
          }}
        </dd>
      </div>
      <div v-if="project.notes">
        <dt>{{ label('Notes', '备注') }}</dt>
        <dd class="project-notes">{{ project.notes }}</dd>
      </div>
    </dl>
    <button
      type="button"
      class="workspace-button notes-button"
      @click="emit('notes', props.project!)"
    >
      {{ label('Edit display name', '编辑备注名') }}
    </button>
  </section>
  <section v-else class="workspace-panel workspace-empty">
    {{ label('Select a project to view its details', '选择项目查看详情') }}
  </section>
</template>
<style src="./workspace-detail.css" />
