export const Button = (props: { label: string }) => (
  <button
    type="button"
    className="btn"
    icon={<svg width="1" data-cs-loc={"src/nested-and-attrs.tsx:5-5"} />} data-cs-loc={"src/nested-and-attrs.tsx:2-9"}
  >
    <span data-cs-loc={"src/nested-and-attrs.tsx:7-7"}>{props.label}</span>
    <img src="/x.png" alt="" data-cs-loc={"src/nested-and-attrs.tsx:8-8"} />
  </button>
)
