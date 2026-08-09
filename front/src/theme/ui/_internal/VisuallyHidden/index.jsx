import "./visually-hidden.css";

export default function VisuallyHidden({ as: Component = "span", ...props }) {
  return <Component className="ui-visually-hidden" {...props} />;
}
