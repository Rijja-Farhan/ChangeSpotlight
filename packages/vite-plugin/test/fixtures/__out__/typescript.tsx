function identity<T,>(value: T): T {
  return value
}

export const A = () => {
  const items = [1, 2] as number[]
  return <ul data-cs-loc={"src/typescript.tsx:7-7"}>{items.map((n) => <li key={n} data-cs-loc={"src/typescript.tsx:7-7"}>{identity<number>(n)}</li>)}</ul>
}
