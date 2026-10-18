export const A = (props: object) => (
  <div>
    <p {...props} />
    <p id="a" {...props} title="t" />
    <p {...props} id="b" />
  </div>
)
