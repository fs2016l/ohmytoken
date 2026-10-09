import type {
  CostReason,
  ModelVendor,
  UsageCostAssessment,
  UsageCostRollup,
} from '@shared/usage-cost'
import { useI18n } from '../i18n/useI18n'
import { convertMoney, sumMoneyInUsd } from '@shared/cost-currency'
import { useCostCurrency } from './useCostCurrency'
import { formatNumber } from '../utils/number-format'

export function formatCostAmount(value: number, compact = false): string {
  if (compact) {
    if (value > 0 && value < 0.01) return '<0.01'
    return formatNumber(value, { compact: true })
  }
  if (value > 0 && value < 0.0001) return '<0.0001'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  })
}

export function useCostLabels() {
  const { label } = useI18n()
  const { currency, exchange } = useCostCurrency()
  function vendorName(vendor: ModelVendor): string {
    const names: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      google: 'Google',
      alibaba: label('Alibaba', '阿里云'),
      zhipu: label('Zhipu', '智谱'),
      deepseek: 'DeepSeek',
      minimax: 'MiniMax',
      moonshot: 'Moonshot / Kimi',
      xiaomi: label('Xiaomi', '小米'),
      xai: 'xAI',
      bytedance: label('ByteDance', '字节跳动'),
      tencent: label('Tencent', '腾讯'),
      unknown: label('Unknown', '未知'),
    }
    return names[vendor] ?? vendor
  }
  function reasonLabel(reason?: CostReason): string {
    if (!reason) return ''
    return {
      'model-unpriced': label('No reference price for this model ID', '模型 ID 无参考价格'),
      'model-not-historical': label(
        'No model evidence for individual requests',
        '缺少逐次调用的模型证据',
      ),
      'uncertain-buckets': label('Token breakdown is uncertain', 'Token 分桶依据不足'),
      'invalid-tokens': label('Token validation failed', 'Token 数据校验未通过'),
      'missing-bucket-rate': label(
        'A used token category has no reference rate',
        '部分 Token 类型无参考单价',
      ),
      'cache-duration': label('Cache write duration is unknown', '缓存写入有效期未知'),
      'request-size': label(
        'Aggregate data cannot determine request pricing tiers',
        '累计数据无法确定逐次价格档位',
      ),
      'price-variants': label(
        'Price depends on time or input modality',
        '价格随时段或输入模态变化',
      ),
      'pricing-time-unknown': label(
        'Request time or time span is uncertain',
        '调用时间或累计时段不明确',
      ),
      'historical-price-unavailable': label(
        'No reference price for this date',
        '该日期缺少历史参考价格',
      ),
    }[reason]
  }
  function costLabel(
    cost: Pick<UsageCostAssessment, 'status' | 'min' | 'max' | 'currency'>,
    compact = false,
  ): string {
    if (
      cost.status === 'unpriced' ||
      !cost.currency ||
      cost.min === undefined ||
      cost.max === undefined
    )
      return label('Unpriced', '未计价')
    const usd = sumMoneyInUsd(
      [{ currency: cost.currency, min: cost.min, max: cost.max }],
      exchange.value.snapshot,
    )
    const displayed = usd && convertMoney(usd, currency.value, exchange.value.snapshot)
    if (!displayed) return label('Exchange rate unavailable', '汇率暂不可用')
    const amount = formatCostAmount(displayed.min, compact)
    const upper = formatCostAmount(displayed.max, compact)
    return `${displayed.currency} ${amount}${amount !== upper ? ` – ${upper}` : ''}`
  }
  function pricingPeriodLabel(period?: UsageCostAssessment['pricingPeriod']): string {
    if (!period) return ''
    return {
      flat: label('Historical flat rate', '历史固定价'),
      peak: label('Peak rate', '高峰时段价格'),
      'off-peak': label('Off-peak rate', '低谷时段价格'),
    }[period]
  }
  function rollupCostLabel(rollup: UsageCostRollup, compact = true): string {
    if (!rollup.pricedRecords) return label('Unpriced', '未计价')
    const usd = sumMoneyInUsd(rollup.totals, exchange.value.snapshot)
    return usd
      ? costLabel({ ...usd, status: 'estimated' }, compact)
      : label('Exchange rate unavailable', '汇率暂不可用')
  }
  return { vendorName, reasonLabel, costLabel, pricingPeriodLabel, rollupCostLabel }
}
