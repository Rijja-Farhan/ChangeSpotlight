export function Header({ title }: { title: string }) {
  return (
    <header className="header">
      <h1>{title}</h1>
      <nav>
        <a href="#features">Features</a> · <a href="#pricing">Pricing</a>
      </nav>
    </header>
  )
}
