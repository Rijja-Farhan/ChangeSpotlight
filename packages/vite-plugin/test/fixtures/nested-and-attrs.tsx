export const Button = (props: { label: string }) => (
  <button
    type="button"
    className="btn"
    icon={<svg width="1" />}
  >
    <span>{props.label}</span>
    <img src="/x.png" alt="" />
  </button>
)
