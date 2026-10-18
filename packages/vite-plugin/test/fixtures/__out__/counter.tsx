import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return (
    <section className="counter" data-cs-loc={"src/counter.tsx:6-11"}>
      <p data-cs-loc={"src/counter.tsx:7-7"}>Count is {count}</p>
      <button type="button" onClick={() => setCount((c) => c + 1)} data-cs-loc={"src/counter.tsx:8-10"}>
        Increment
      </button>
    </section>
  )
}
