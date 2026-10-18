function identity<T,>(value: T): T {
  return value
}

export const A = () => {
  const items = [1, 2] as number[]
  return <ul>{items.map((n) => <li key={n}>{identity<number>(n)}</li>)}</ul>
}
