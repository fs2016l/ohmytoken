import {
  renewalDaysUntil,
  type PlanRenewalInput,
  type RenewalCycle,
} from '../../../shared/plan-renewals'
import { TOKEN_PLAN_PROVIDER_BY_ID } from '../config/token-plan-providers'
import { useI18n } from '../i18n/useI18n'

export function useRenewalLabels() {
  const { label, currentLang } = useI18n()
  function providerName(id: PlanRenewalInput['providerId']): string {
    const provider = TOKEN_PLAN_PROVIDER_BY_ID[id]
    return provider
      ? currentLang.value === 'zh'
        ? provider.nameZh
        : provider.nameEn
      : label('Other', '其他')
  }
  function cycleName(cycle: RenewalCycle): string {
    return {
      monthly: label('Monthly', '每月'),
      quarterly: label('Quarterly', '每季'),
      yearly: label('Yearly', '每年'),
      custom: label('Custom', '自定义'),
    }[cycle]
  }
  function cycleText(item: PlanRenewalInput): string {
    return item.cycle === 'custom'
      ? label(`Every ${item.intervalDays} days`, `每 ${item.intervalDays} 天续费`)
      : label(`${cycleName(item.cycle)} renewal`, `${cycleName(item.cycle)}续费`)
  }
  function statusText(item: Pick<PlanRenewalInput, 'renewOn'>, today: string): string {
    const days = renewalDaysUntil(item.renewOn, today)
    if (days === 0) return label('Due today', '今天续费')
    return days < 0 ? label('Expired', '过期') : label(`Due in ${days} days`, `${days} 天后续费`)
  }
  return { providerName, cycleName, cycleText, statusText }
}
