import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useKeys } from './useKeys'

afterEach(cleanup)

function Harness(props: { onKey: () => void }) {
  useKeys({ '2': props.onKey })
  return <select aria-label="pick" />
}

describe('useKeys', () => {
  it('ignores a keydown on a select, and a key pressed with a modifier, but calls the handler otherwise', () => {
    const onKey = vi.fn()
    const { getByLabelText } = render(<Harness onKey={onKey} />)

    fireEvent.keyDown(getByLabelText('pick'), { key: '2' })
    expect(onKey).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: '2', ctrlKey: true })
    expect(onKey).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: '2' })
    expect(onKey).toHaveBeenCalledTimes(1)
  })
})
