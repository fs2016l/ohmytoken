import type { ModelAttribution } from '../../shared/usage-cost'
import { findPriceCard } from './price-catalog'
import { modelNameVendor } from './vendor-rules'

export function attributeModel(model: string): ModelAttribution {
  const card = findPriceCard(model)
  const vendor = card?.vendor ?? modelNameVendor(model)
  return {
    vendor,
    vendorBasis: card ? 'catalog' : vendor === 'unknown' ? 'unknown' : 'model-name',
  }
}
