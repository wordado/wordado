import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSwipe } from './useSwipe'

afterEach(cleanup)

function Harness(props: { onLeft: () => void; onRight: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSwipe(ref, props)
  return (
    <div ref={ref} data-testid="area">
      <p>bank</p>
      <label>
        Translation <input />
      </label>
      <button>Keep</button>
    </div>
  )
}

/** One finger down at `from`, up at `to`. */
function swipe(el: Element, from: [number, number], to: [number, number], pointerType = 'touch') {
  fireEvent.pointerDown(el, { pointerId: 1, isPrimary: true, pointerType, clientX: from[0], clientY: from[1] })
  fireEvent.pointerUp(el, { pointerId: 1, isPrimary: true, pointerType, clientX: to[0], clientY: to[1] })
}

function setup() {
  const onLeft = vi.fn()
  const onRight = vi.fn()
  render(<Harness onLeft={onLeft} onRight={onRight} />)
  return { onLeft, onRight }
}

describe('useSwipe', () => {
  it('calls onLeft for a swipe to the left and onRight for one to the right', () => {
    const { onLeft, onRight } = setup()
    swipe(screen.getByText('bank'), [300, 200], [200, 210])
    expect(onLeft).toHaveBeenCalledTimes(1)
    expect(onRight).not.toHaveBeenCalled()
    swipe(screen.getByText('bank'), [100, 200], [200, 190])
    expect(onRight).toHaveBeenCalledTimes(1)
    expect(onLeft).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a movement of 30px, or of exactly 60px', () => {
    const { onLeft, onRight } = setup()
    swipe(screen.getByText('bank'), [300, 200], [270, 200])
    swipe(screen.getByText('bank'), [200, 200], [260, 200])
    expect(onLeft).not.toHaveBeenCalled()
    expect(onRight).not.toHaveBeenCalled()
  })

  it('does nothing for a mostly vertical movement', () => {
    const { onLeft, onRight } = setup()
    swipe(screen.getByText('bank'), [300, 200], [220, 320])
    expect(onLeft).not.toHaveBeenCalled()
    expect(onRight).not.toHaveBeenCalled()
  })

  it('does nothing for a gesture that starts on an input or a button', () => {
    const { onLeft, onRight } = setup()
    swipe(screen.getByLabelText('Translation'), [300, 200], [150, 200])
    swipe(screen.getByRole('button', { name: 'Keep' }), [300, 200], [150, 200])
    expect(onLeft).not.toHaveBeenCalled()
    expect(onRight).not.toHaveBeenCalled()
  })

  it('does nothing for a gesture the browser took over (a scroll), or for a mouse drag', () => {
    const { onLeft, onRight } = setup()
    const el = screen.getByText('bank')
    fireEvent.pointerDown(el, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 300, clientY: 200 })
    fireEvent.pointerCancel(el, { pointerId: 1, isPrimary: true, pointerType: 'touch' })
    fireEvent.pointerUp(el, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 150, clientY: 200 })
    swipe(el, [300, 200], [150, 200], 'mouse')
    expect(onLeft).not.toHaveBeenCalled()
    expect(onRight).not.toHaveBeenCalled()
  })
})
