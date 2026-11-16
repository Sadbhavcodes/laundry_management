/**
 * ============================================================================
 * create_order_validation.ts
 * SRS Traceability: FR-007 (Item Cataloguing), FR-012 (Pricing), BR-002 (Order owns items)
 * 
 * VIVA EXAM EXPLANATION:
 * This module enforces client-input integrity before database transactions:
 * 1. Checks that an order contains at least 1 item (BR-002: no empty orders).
 * 2. Validates positive integer quantities for each item.
 * 3. Enforces server-authoritative pricing (unitPrices map): Prevents price manipulation
 *    from client-side requests.
 * ============================================================================
 */

const serviceTypes = ['Wash & Fold', 'Dry Cleaning', 'Pressing', 'Delicates'] as const
const unitPrices: Record<(typeof serviceTypes)[number], number> = {
  'Wash & Fold': 5,
  'Dry Cleaning': 12,
  Pressing: 4,
  Delicates: 7.5,
}

export type ValidatedOrderItem = { description: string; serviceType: (typeof serviceTypes)[number]; quantity: number; unitPrice: number }
export type OrderValidation = { items: ValidatedOrderItem[] } | { error: 'EMPTY_ORDER' | 'INVALID_ITEM' | 'INVALID_QUANTITY' }

/**
 * Validates order items list submitted by the customer.
 * @param input Raw items array received from HTTP request body
 * @returns Structured OrderValidation with validated items and fixed unit prices, or error code
 */
export function validateCreateOrderItems(input: unknown): OrderValidation {
  // BR-002 Guard: An order must contain at least one catalogued item before submission
  if (!Array.isArray(input) || input.length === 0) return { error: 'EMPTY_ORDER' }
  const items: ValidatedOrderItem[] = []
  for (const rawItem of input) {
    if (!rawItem || typeof rawItem !== 'object'
      || Array.isArray(rawItem)) return { error: 'INVALID_ITEM' }
    const item = rawItem as Record<string, unknown>
    
    // FR-007: Check non-empty description and service type
    if (typeof item.description !== 'string' || !item.description.trim()
      || typeof item.serviceType !== 'string' || !item.serviceType.trim()) return { error: 'INVALID_ITEM' }
    
    // Validate quantity is a positive whole integer
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 2147483647) {
      return { error: 'INVALID_QUANTITY' }
    }
    
    // Validate supported service catalog item
    if (!serviceTypes.includes(item.serviceType as (typeof serviceTypes)[number])) return { error: 'INVALID_ITEM' }
    const serviceType = item.serviceType as (typeof serviceTypes)[number]
    
    // FR-012: Attach server-authoritative unit price to prevent client tampering
    items.push({ description: item.description.trim(), serviceType, quantity: item.quantity, unitPrice: unitPrices[serviceType] })
  }
  return { items }
}
