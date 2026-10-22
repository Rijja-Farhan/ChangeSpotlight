const features = ['Fast', 'Typed', 'Tested']

export function FeatureList() {
  return (
    <>

      <ul>
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </>
  )
}
