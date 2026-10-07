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

  it('ignores the keys while a dialog is open, wherever the focus is', () => {
    const onKey = vi.fn()
    render(
      <>
        <Harness onKey={onKey} />
        <dialog open>
          <button>inside</button>
        </dialog>
      </>,
    )
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(document.body, { key: '2' })
    expect(onKey).not.toHaveBeenCalled()
  })

  it('ignores the keys while a menu is open (the account menu marks itself with data-menu-open)', () => {
    const onKey = vi.fn()
    const { rerender } = render(
      <>
        <Harness onKey={onKey} />
        <span data-menu-open="">
          <button>inside</button>
        </span>
      </>,
    )
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(document.body, { key: '2' })
    expect(onKey).not.toHaveBeenCalled()
    rerender(
      <>
        <Harness onKey={onKey} />
        <span>
          <button>inside</button>
        </span>
      </>,
    )
    fireEvent.keyDown(window, { key: '2' })
    expect(onKey).toHaveBeenCalledTimes(1)
  })
})
