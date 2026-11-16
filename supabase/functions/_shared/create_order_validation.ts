const serviceTypes = ['Wash & Fold', 'Dry Cleaning', 'Pressing', 'Delicates'] as const
const unitPrices: Record<(typeof serviceTypes)[number], number> = {
  'Wash & Fold': 5,
  'Dry Cleaning': 12,
  Pressing: 4,
  Delicates: 7.5,
}

export type ValidatedOrderItem = { description: string; serviceType: (typeof serviceTypes)[number]; quantity: number; unitPrice: number }
export type OrderValidation = { items: ValidatedOrderItem[] } | { error: 'EMPTY_ORDER' | 'INVALID_ITEM' | 'INVALID_QUANTITY' }

export function validateCreateOrderItems(input: unknown): OrderValidation {
  if (!Array.isArray(input) || input.length === 0) return { error: 'EMPTY_ORDER' }
  const items: ValidatedOrderItem[] = []
  for (const rawItem of input) {
    if (!rawItem || typeof rawItem !== 'object'
      || Array.isArray(rawItem)) return { error: 'INVALID_ITEM' }
    const item = rawItem as Record<string, unknown>
    if (typeof item.description !== 'string' || !item.description.trim()
      || typeof item.serviceType !== 'string' || !item.serviceType.trim()) return { error: 'INVALID_ITEM' }
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 2147483647) {
      return { error: 'INVALID_QUANTITY' }
    }
    if (!serviceTypes.includes(item.serviceType as (typeof serviceTypes)[number])) return { error: 'INVALID_ITEM' }
    const serviceType = item.serviceType as (typeof serviceTypes)[number]
    items.push({ description: item.description.trim(), serviceType, quantity: item.quantity, unitPrice: unitPrices[serviceType] })
  }
  return { items }
}
