import { validateCreateOrderItems } from '../_shared/create_order_validation.ts'

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

Deno.test('create_order rejects an empty list', () => {
  assertEquals(validateCreateOrderItems([]), { error: 'EMPTY_ORDER' })
})

Deno.test('create_order rejects a non-positive or fractional quantity', () => {
  assertEquals(validateCreateOrderItems([{ description: 'Shirt', serviceType: 'Wash & Fold', quantity: 0 }]), { error: 'INVALID_QUANTITY' })
  assertEquals(validateCreateOrderItems([{ description: 'Shirt', serviceType: 'Wash & Fold', quantity: 1.5 }]), { error: 'INVALID_QUANTITY' })
})

Deno.test('create_order validates every item before returning priced normalized input', () => {
  assertEquals(validateCreateOrderItems([
    { description: '  Shirt  ', serviceType: 'Wash & Fold', quantity: 2 },
    { description: '', serviceType: 'Pressing', quantity: 1 },
  ]), { error: 'INVALID_ITEM' })
  assertEquals(validateCreateOrderItems([{ description: ' Shirt ', serviceType: 'Wash & Fold', quantity: 2 }]), {
    items: [{ description: 'Shirt', serviceType: 'Wash & Fold', quantity: 2, unitPrice: 5 }],
  })
})
