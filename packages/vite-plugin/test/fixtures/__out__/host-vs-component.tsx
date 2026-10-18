import { Card } from './Card'

export function Page() {
  return (
    <main className="page" data-cs-loc={"src/host-vs-component.tsx:5-10"}>
      <Card title="x" />
      <section data-cs-loc={"src/host-vs-component.tsx:7-9"}>
        <h1 data-cs-loc={"src/host-vs-component.tsx:8-8"}>Title</h1>
      </section>
    </main>
  )
}
