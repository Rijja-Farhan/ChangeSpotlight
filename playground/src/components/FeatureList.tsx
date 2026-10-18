const features = ['Fast', 'Typed', 'Tested']

export function FeatureList() {
  return (
    <>
      <h2 id="features">Features</h2>
      <ul>
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </>
  )
}
