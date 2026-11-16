import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateOrderForm } from '../App'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke } },
  supabaseSetupError: null,
}))

describe('CreateOrderForm', () => {
  beforeEach(() => { invoke.mockReset() })

  it('adds items and keeps the displayed estimate in sync with quantity and service', () => {
    render(<CreateOrderForm />)
    fireEvent.change(screen.getByLabelText('Item description'), { target: { value: 'Shirts' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Add another item/i }))
    expect(screen.getAllByLabelText('Item description')).toHaveLength(2)
    expect(screen.getByText('$15.00')).toBeInTheDocument()
  })

  it('shows an API validation message without losing the entered fields', async () => {
    invoke.mockResolvedValue({ data: { error: 'INVALID_QUANTITY' }, error: null })
    render(<CreateOrderForm />)
    fireEvent.change(screen.getByLabelText('Item description'), { target: { value: 'Cotton shirts' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number greater than zero')
    await waitFor(() => expect(screen.getByLabelText('Item description')).toHaveValue('Cotton shirts'))
    expect(screen.getByLabelText('Quantity')).toHaveValue(2)
  })
})
