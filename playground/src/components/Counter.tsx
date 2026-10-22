import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return (
    <section className="counter">
      <p>Count is {count}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Incrementing
      </button>
    </section>
  )
}
