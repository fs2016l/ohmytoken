<script setup lang="ts">
/**
 * 余额与额度窗口同排显示：结构与 QuotaWindowTile 相同（标题 18、内容 76、底注 16），
 * 同一排卡片因此对齐。余额不是百分比，不画液面，只用由浅到深的底色取得相近分量。
 */
defineProps<{
  caption: string
  value: string
  /** 底注，如币种；没有时保留空行以对齐。 */
  note?: string
  /** 统计值（如累计消费）用中性底色，与可用余额区分。 */
  muted?: boolean
  title?: string
}>()
</script>

<template>
  <div class="quota-balance" :class="{ 'quota-balance--muted': muted }" :title="title">
    <div class="quota-balance__heading">{{ caption }}</div>
    <div class="quota-balance__box">
      <strong>{{ value }}</strong>
    </div>
    <div class="quota-balance__foot">
      <template v-if="note">
        <span class="material-symbols-outlined" aria-hidden="true">payments</span>
        {{ note }}
      </template>
    </div>
  </div>
</template>

<style scoped>
.quota-balance {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.quota-balance__heading {
  height: 18px;
  overflow: hidden;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quota-balance__box {
  box-sizing: border-box;
  height: 76px;
  padding: 8px 10px;
  border: 1px solid var(--quota-outline);
  border-radius: 8px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--primary) 3%, var(--surface-low)),
    color-mix(in srgb, var(--primary) 13%, var(--surface-low))
  );
}
.quota-balance__box strong {
  display: block;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-number);
  font-size: 22px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 26px;
  letter-spacing: -0.4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quota-balance--muted .quota-balance__box {
  background: linear-gradient(
    180deg,
    var(--surface-low),
    color-mix(in srgb, var(--text-muted) 9%, var(--surface-low))
  );
}
.quota-balance--muted .quota-balance__box strong {
  color: var(--text-muted);
}
.quota-balance__foot {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 18px;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
  white-space: nowrap;
}
.quota-balance__foot .material-symbols-outlined {
  font-size: 13px;
}
</style>
