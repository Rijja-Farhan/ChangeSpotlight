const people = ['Ada', 'Grace', 'Linus']

export function Team() {
  return (
    <section className="team">
      <h2>Team</h2>
      <ul>
        {people.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </section>
  )
}
